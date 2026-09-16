"""Blender facing gate for Avatar Show motions.

Measures how far a generated clip turns the character away from its initial
facing. Desk avatars perform toward the user, so a clip whose hips rotate
more than the limit is unusable on stage and gets regenerated with a
stronger front-facing prompt instead of being retargeted.

  blender --factory-startup -b --python tools/show-motion-facing.py -- --glb clip.glb --report out.json
"""
import json, math, re, sys

import bpy
from mathutils import Vector

SAMPLES = 24


def arg(name, default=''):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default


def find_pair(arm, patterns):
    names = [b.name for b in arm.pose.bones]
    for pat in patterns:
        left = [n for n in names if re.search(pat % 'left', n, re.I)]
        right = [n for n in names if re.search(pat % 'right', n, re.I)]
        if left and right:
            return left[0], right[0]
    return None, None


def action_range():
    start, end = None, None
    for act in bpy.data.actions:
        a, b = act.frame_range
        start = a if start is None else min(start, a)
        end = b if end is None else max(end, b)
    return (int(start), int(end)) if start is not None else (1, 1)


def facing_yaw(arm, lname, rname):
    l = arm.matrix_world @ arm.pose.bones[lname].head
    r = arm.matrix_world @ arm.pose.bones[rname].head
    across = l - r
    across.z = 0
    if across.length < 1e-6:
        return None
    fwd = Vector((0, 0, 1)).cross(across)  # up x (right->left) = forward
    return math.degrees(math.atan2(fwd.x, fwd.y))


def main():
    glb, report = arg('--glb'), arg('--report')
    out = {'error': ''}
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb)
        arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
        if not arm:
            raise RuntimeError('The clip has no armature.')
        lname, rname = find_pair(arm, [r'%s.*(upleg|thigh|hip)', r'%s.*(shoulder|clavicle)', r'%s.*arm'])
        if not lname:
            raise RuntimeError('No left/right bone pair to measure facing.')
        start, end = action_range()
        yaws = []
        for i in range(SAMPLES):
            f = int(start + (end - start) * i / max(1, SAMPLES - 1))
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            yaw = facing_yaw(arm, lname, rname)
            if yaw is not None:
                yaws.append(yaw)
        if not yaws:
            raise RuntimeError('Could not measure facing.')
        base = yaws[0]
        deltas = [abs((y - base + 180) % 360 - 180) for y in yaws]
        out = {'error': '', 'maxDeg': round(max(deltas), 1), 'overLimit': sum(1 for d in deltas if d > 60), 'samples': len(deltas), 'frames': [start, end], 'bones': [lname, rname]}
    except Exception as e:  # noqa: BLE001
        out = {'error': str(e)[:400]}
    with open(report, 'w') as handle:
        json.dump(out, handle)


main()
