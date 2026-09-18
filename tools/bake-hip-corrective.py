"""Bake a local pose corrective from a licensed Blender body into a motion clip.

Blender --background --factory-startup --disable-autoexec --python this-file --
  --blend SOURCE.blend --rig RIG --body BODY --model TARGET.glb
  --motion kung-fu-punch.json.deflate --output CORRECTED.json.deflate

The source file is never saved. The generated clip is private derived asset
content: keep it under ignored build/characters, and distribute in .gla packs.
"""
import argparse
import json
import math
import struct
import sys
import zlib
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

parser = argparse.ArgumentParser()
for name in ('blend', 'rig', 'body', 'model', 'motion', 'output'):
    parser.add_argument('--' + name, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
raw = Path(args.motion).read_bytes()
clip = json.loads(zlib.decompress(raw, -15) if args.motion.endswith('.deflate') else raw)
if clip['id'] != 'kung-fu-punch':
    raise ValueError('This corrective has only been reviewed for kung-fu-punch')
raw = Path(args.model).read_bytes()
doc = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
bpy.ops.wm.open_mainfile(filepath=args.blend)
source, body = bpy.data.objects[args.rig], bpy.data.objects[args.body]
source.data.pose_position = 'REST'
def show(layer):
    layer.exclude = False
    layer.hide_viewport = False
    for child in layer.children:
        show(child)
show(bpy.context.view_layer.layer_collection)
for collection in bpy.data.collections:
    collection.hide_viewport = False
body.hide_set(False)
body.hide_viewport = False
if body.data.shape_keys:
    body.data.shape_keys.animation_data_clear()
    for shape in body.data.shape_keys.key_blocks:
        shape.value = 0
C = Matrix.Rotation(-math.pi / 2, 4, 'X')
ids = {node['name']: i for i, node in enumerate(doc['nodes'])}
parents = {child: i for i, node in enumerate(doc['nodes']) for child in node.get('children', [])}
def node_matrix(node):
    if 'matrix' in node:
        return Matrix(np.array(node['matrix']).reshape(4, 4).T.tolist())
    q = node.get('rotation', [0, 0, 0, 1])
    return Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])),
                             Quaternion((q[3], *q[:3])), Vector(node.get('scale', [1, 1, 1])))
def world_matrices(locals):
    result = {}
    def world(i):
        if i not in result:
            result[i] = (world(parents[i]) if i in parents else Matrix.Identity(4)) @ locals[i]
        return result[i]
    for i in range(len(locals)):
        world(i)
    return result
rest_local = [node_matrix(node) for node in doc['nodes']]
rest_world = world_matrices(rest_local)
posed_local = [m.copy() for m in rest_local]
for j, name in enumerate(clip['bones']):
    values = clip['frames'][-1][j * 12:j * 12 + 12]
    posed_local[ids[name]] = Matrix([values[:4], values[4:8], values[8:12], [0, 0, 0, 1]])
posed_world = world_matrices(posed_local)
# Evaluate the original source body against exactly the exported final pose.
rig = bpy.data.objects.new('QA_hip_corrective', bpy.data.armatures.new('QA_hip_corrective'))
bpy.context.collection.objects.link(rig)
rig.matrix_world = source.matrix_world.copy()
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name in clip['bones']:
    if name not in source.data.bones:
        continue
    original = source.data.bones[name]
    bone = rig.data.edit_bones.new(name)
    bone.head, bone.tail, bone.matrix = original.head_local, original.tail_local, original.matrix_local
    bone.use_deform = True
bpy.ops.object.mode_set(mode='OBJECT')
# Match Sarah's already-shipped restoration of the authored pelvis influence.
bend = body.vertex_groups.get('c_root_bend.x')
root = body.vertex_groups.get('root.x') or body.vertex_groups.new(name='root.x')
if bend:
    for vertex in body.data.vertices:
        weight = next((g.weight for g in vertex.groups if g.group == bend.index), 0)
        if weight:
            root.add([vertex.index], weight, 'ADD')
for modifier in body.modifiers:
    modifier.show_viewport = modifier.type in ('ARMATURE', 'SUBSURF', 'MIRROR')
    if modifier.type == 'ARMATURE':
        modifier.object = rig
        modifier.use_deform_preserve_volume = False
    if modifier.type == 'SUBSURF':
        modifier.levels = 1
corrected = body.copy()
corrected.data = body.data.copy()
bpy.context.collection.objects.link(corrected)
def smooth(a, b, value):
    t = max(0, min(1, (value - a) / (b - a)))
    return t * t * (3 - 2 * t)
group = corrected.vertex_groups.new(name='QA_hip_transition')
for vertex in corrected.data.vertices:
    weight = smooth(.78, .90, vertex.co.z) * (1 - smooth(1.13, 1.24, vertex.co.z))
    if weight:
        group.add([vertex.index], weight, 'REPLACE')
modifier = corrected.modifiers.new('QA outer hip correction', 'CORRECTIVE_SMOOTH')
modifier.factor = 1
modifier.iterations = 240
modifier.smooth_type = 'LENGTH_WEIGHTED'
modifier.vertex_group = group.name
modifier.rest_source = 'BIND'
bpy.context.view_layer.objects.active = corrected
while list(corrected.modifiers).index(modifier) > 1:
    bpy.ops.object.modifier_move_up(modifier=modifier.name)
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
bpy.ops.object.correctivesmooth_bind(modifier=modifier.name)
def geometry(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    transform = C @ obj.matrix_world
    points = np.array([list(transform @ v.co) for v in mesh.vertices])
    triangles = np.array([list(t.vertices) for t in mesh.loop_triangles])
    evaluated.to_mesh_clear()
    return points, triangles
rest, triangles = geometry(body)
rig.data.pose_position = 'POSE'
for bone in rig.pose.bones:
    bone.matrix = (rig.matrix_world.inverted() @ C.inverted() @ posed_world[ids[bone.name]]
                   @ rest_world[ids[bone.name]].inverted() @ C @ source.matrix_world
                   @ source.data.bones[bone.name].matrix_local)
bpy.context.view_layer.update()
original, triangles = geometry(body)
changed, changed_triangles = geometry(corrected)
if original.shape != changed.shape:
    raise ValueError('Corrective changed vertex count')
def normals(points, triangles):
    result = np.zeros_like(points)
    face = np.cross(points[triangles[:, 1]] - points[triangles[:, 0]],
                    points[triangles[:, 2]] - points[triangles[:, 0]])
    for corner in range(3):
        np.add.at(result, triangles[:, corner], face)
    lengths = np.linalg.norm(result, axis=1)
    return result / np.maximum(lengths[:, None], 1e-12)
# Preserve the central gluteal fold and thigh girth; correct only the lateral
# bridge between the iliac crest and proximal femur. Recompute normals after
# applying this mask so the transition has the same surface and shading.
masks = np.array([smooth(.06, .15, abs(p[0])) * smooth(.88, .96, p[1])
                  * (1 - smooth(1.12, 1.22, p[1])) for p in rest])
changed = original + (changed - original) * masks[:, None]
# Remove the remaining sharp surface crease at the upper outer junction.
# The mask excludes the central buttock and the lower thigh.
neighbors = [set() for _ in rest]
for triangle in changed_triangles:
    for a in triangle:
        neighbors[a].update(int(b) for b in triangle if b != a)
crease = np.array([.4 * smooth(.09, .17, abs(p[0])) * smooth(.93, 1.00, p[1])
                   * (1 - smooth(1.13, 1.23, p[1])) for p in rest])
active = [i for i, weight in enumerate(crease) if weight and neighbors[i]]
for _ in range(16):
    previous = changed.copy()
    for i in active:
        changed[i] += (previous[list(neighbors[i])].mean(axis=0) - previous[i]) * crease[i]
# Smooth the remaining short lateral notch along the reviewed waist-to-thigh
# contour. This patch is above the thigh rim: its delta is exactly zero below
# source height .965 m, above 1.11 m, and outside the hip width. A tapered
# lateral displacement fills the recess; it does not lift the proximal thigh.
def smooth_array(a, b, values):
    t = np.clip((values - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
notch = smooth_array(.06, .135, np.abs(rest[:, 0])) * (1 - smooth_array(.18, .22, np.abs(rest[:, 0])))
notch *= np.exp(-((rest[:, 1] - 1.020) / .044) ** 2)
notch *= smooth_array(.965, .985, rest[:, 1]) * (1 - smooth_array(1.075, 1.11, rest[:, 1]))
notch *= np.exp(-((rest[:, 2] - .05) / .10) ** 2)
# Use anatomical lateral directions in the posed pelvis frame, not the camera.
root_delta = posed_world[ids['root.x']] @ rest_world[ids['root.x']].inverted()
lateral = np.array(root_delta.to_3x3())[:, 0]
changed += .024 * notch[:, None] * np.sign(rest[:, 0, None]) * lateral[None, :]
old_normal, new_normal = normals(original, triangles), normals(changed, changed_triangles)
samples = []
for i, point in enumerate(rest):
    if not .76 <= point[1] <= 1.27:
        continue
    mask = 1
    rotation = Vector(old_normal[i]).rotation_difference(Vector(new_normal[i])).slerp(Quaternion(), 1 - mask)
    if rotation.w < 0:
        rotation.negate()
    samples.append([round(float(v), 7) for v in [*point, *((changed[i] - original[i]) * mask),
                                               rotation.x, rotation.y, rotation.z, rotation.w]])
root_matrix = posed_world[ids['root.x']]
root_rotation = root_matrix.to_quaternion()
hips = []
for side in ('l', 'r'):
    rotation = root_rotation.inverted() @ posed_world[ids['c_thigh_twist.' + side]].to_quaternion()
    hips.append([rotation.x, rotation.y, rotation.z, rotation.w])
clip['hipCorrective'] = dict(version=1, kind='hip-surface-v1', radius=.035,
    source='Blender Corrective Smooth, length weighted, 240 iterations, outer hip bridge with softened crease and local lateral notch contour',
    root=[root_matrix[r][c] for c in range(4) for r in range(4)], hips=hips, samples=samples)
encoded = json.dumps(clip, separators=(',', ':')).encode()
if args.output.endswith('.deflate'):
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    encoded = compressor.compress(encoded) + compressor.flush()
Path(args.output).write_bytes(encoded)
print('Baked hip corrective:', len(samples), 'samples;', len(encoded), 'bytes; skeleton and frames unchanged')
