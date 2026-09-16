"""Run in Blender with Sarah's original ARP blend loaded; never saves the blend.

Blender --factory-startup -b source.blend --python tools/export-sarah-extras.py -- out.glb
Exports missing wardrobe/props in the same rest space as the existing Sarah GLB.
"""
import bpy, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sarah_pelvis_weights import mark_glb
from mathutils import Matrix

out = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
rig = bpy.data.objects['Fem-A_Sara_RIG']
if bpy.context.object and bpy.context.object.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
rig.data.pose_position = 'REST'
for collection in bpy.data.collections:
    collection.hide_viewport = False
def show(layer):
    layer.exclude = False; layer.hide_viewport = False
    for child in layer.children: show(child)
show(bpy.context.view_layer.layer_collection)
bpy.context.view_layer.update()

# Only runtime geometry. The two independently rigged strap halves are an
# authoring alternative to the complete strap mesh, not extra visible layers.
spec = {
    'Fem-A_Bot_Ac_BknBrzl_1': None,
    'Fem-A_Bot_Ac_BknBrzl_2': None,
    'Fem-A_Fot_Ac_Strphl': None,
    'Ac_Tommy_Bag': 'shoulder.r',
    'Weap_1911': 'hand.r',
    'Weap_FN-SCAR-20S.001': 'hand.r',
}
deform = {b.name for b in rig.data.bones if b.use_deform}
selected = []
report = []
for name, rigid_bone in spec.items():
    obj = bpy.data.objects[name]
    obj.hide_set(False); obj.hide_viewport = False; obj.hide_render = False
    # Preserve the source accessory placement before stripping its control rig.
    world = obj.matrix_world.copy()
    for mod in obj.modifiers:
        if mod.type in {'ARMATURE', 'NODES'}: mod.show_viewport = False
        if mod.type == 'SUBSURF': mod.levels = 1
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=bpy.context.evaluated_depsgraph_get())
    old_names = {g.index: g.name for g in obj.vertex_groups}
    # Capture evaluated weights before removing the source groups.
    # Keep authored pelvis support even though its control is not a glTF
    # deform bone. root.x receives the same root transform in exported clips.
    weights = []
    for vertex in mesh.vertices:
        merged = {}
        for group in vertex.groups:
            source = old_names.get(group.group)
            target = 'root.x' if source == 'c_root_bend.x' else source
            if target in deform and group.weight > 0:
                merged[target] = merged.get(target, 0) + group.weight
        weights.append(list(merged.items()))
    obj.modifiers.clear(); obj.parent = None; obj.constraints.clear()
    obj.data = mesh; obj.matrix_world = world
    obj.vertex_groups.clear()
    groups = {n: obj.vertex_groups.new(name=n) for n in deform}
    fallback = 0
    for vertex, values in zip(mesh.vertices, weights):
        if rigid_bone: values = [(rigid_bone, 1.0)]
        elif not values:
            p = world @ vertex.co
            values = [(('foot.l' if p.x > 0 else 'foot.r') if 'Strphl' in name else 'root.x', 1.0)]
            fallback += 1
        values = sorted(values, key=lambda x: x[1], reverse=True)[:4]
        total = sum(w for _, w in values)
        for n, weight in values: groups[n].add([vertex.index], weight / total, 'REPLACE')
    mod = obj.modifiers.new('Runtime skeleton', 'ARMATURE'); mod.object = rig
    selected.append(obj)
    points = [world @ v.co for v in mesh.vertices]
    report.append({'name': name, 'vertices': len(mesh.vertices), 'rigidBone': rigid_bone, 'fallbackVertices': fallback,
                   'bounds': [[min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]]})

# Explicit PBR inputs avoid silently losing Blender Mix/Glossy node graphs.
# All maps below are supplied by the original asset.
maps = {
    'Bot_Ac_BknBrzl': ['BottomTie-alb-whiteb.jpg', 'BottomTie-normal.jpg', 'BottomTie-rough2.jpg', 'BottomTie-metal2.jpg', 'BottomTie-ALPHA3.jpg'],
    'Fot_Ac_Strphl': ['Mid-boot-07-LACK.jpg', 'Mid-boot-normal02.jpg', 'Mid-boot-rough01.jpg', None, None],
    'Ac_Tommy_Bag': ['ommybag-light-DARK BROWN.jpg', 'ommybag-normal2.jpg', 'ommybag-rough.jpg', None, None],
    'Weap_1911_RIG_R': ['1911 ALB-D3.jpg', None, '1911-L-Rough--D.jpg', None, None],
    'Weap_1911_RIG_L': ['1911 ALB-D3-B.jpg', None, '1911-L-Rough--E.jpg', None, None],
    'Weap_FN-SCAR-20S': ['FN-SCAR-ALB.png', 'UntitledFN-SCAR-Normal2i.jpg', 'UntitledFN-SCAR-rough.jpg', None, None],
}
textures = Path(bpy.data.filepath).parent / 'textures'
for mat in {m for obj in selected for m in obj.data.materials if m}:
    if mat.name == 'Metal_Gold': continue
    if mat.name not in maps: raise RuntimeError('Unmapped material: ' + mat.name)
    filenames = maps[mat.name]
    mat.use_nodes = True; nodes = mat.node_tree.nodes; nodes.clear()
    shader = nodes.new('ShaderNodeBsdfPrincipled'); output = nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    shader.inputs['Roughness'].default_value = .5
    shader.inputs['Metallic'].default_value = .65 if mat.name.startswith('Weap_1911') else 0
    for slot, filename in zip(['Base Color', 'Normal', 'Roughness', 'Metallic', 'Alpha'], filenames):
        if not filename: continue
        image = bpy.data.images.load(str(textures / filename), check_existing=False)
        image.colorspace_settings.name = 'sRGB' if slot == 'Base Color' else 'Non-Color'
        node = nodes.new('ShaderNodeTexImage'); node.image = image
        socket = node.outputs['Color']
        if slot == 'Normal':
            normal = nodes.new('ShaderNodeNormalMap'); mat.node_tree.links.new(socket, normal.inputs['Color']); socket = normal.outputs['Normal']
        mat.node_tree.links.new(socket, shader.inputs[slot])
    mat.surface_render_method = 'DITHERED'

bpy.ops.object.select_all(action='DESELECT')
rig.hide_set(False); rig.hide_viewport = False; rig.select_set(True)
for obj in selected: obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
    export_animations=False, export_def_bones=True, export_rest_position_armature=True,
    export_extras=False, export_morph=False, export_apply=False)
mark_glb(out)
out.with_suffix('.json').write_text(json.dumps(report, indent=2))
print('SARAH EXTRAS', json.dumps(report))
