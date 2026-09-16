"""Compare private motion overlays without rendering or changing assets.

Requires NumPy. Example:
  python tools/audit-motion-kinematics.py --characters build/characters \
    --candidates /path/to/motion-overlays --output /path/to/report.json

Each candidates/<character>/runtime/motions directory contains only revised
*.json.deflate files. Licensed motion/model data stays outside source control.
The report checks joint trajectories, body transforms, bone scale, and twist
helper continuity relative to the same limb, independent of global dance turns.
"""
import argparse
import json
import re
import zlib
from pathlib import Path

import numpy as np


def matrix(node):
    if 'matrix' in node:
        return np.asarray(node['matrix']).reshape(4, 4).T
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    value = np.eye(4)
    value[:3, :3] = np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
    ]) * np.asarray(node.get('scale', [1, 1, 1]))
    value[:3, 3] = node.get('translation', [0, 0, 0])
    return value


def rotation(matrices):
    u, _, v = np.linalg.svd(matrices[..., :3, :3])
    return u @ v


def load_clip(path):
    return json.loads(zlib.decompress(path.read_bytes(), -15))


def world_bones(document, clip):
    nodes = document['nodes']
    names = {n.get('name'): i for i, n in enumerate(nodes)}
    parents = {child: i for i, n in enumerate(nodes) for child in n.get('children', [])}
    values = np.asarray(clip['frames']).reshape(-1, len(clip['bones']), 3, 4)
    local = np.repeat(np.asarray([matrix(n) for n in nodes])[None], len(values), axis=0)
    for k, bone in enumerate(clip['bones']):
        local[:, names[bone], :3] = values[:, k]
    cache = {}

    def get(index):
        if index not in cache:
            cache[index] = get(parents[index]) @ local[:, index] if index in parents else local[:, index]
        return cache[index]
    return {name: get(names[name]) for name in clip['bones']}


def twist_steps(world):
    issues = []
    maximum = 0.0
    for bone, matrices in world.items():
        match = re.fullmatch(r'(.*?)(c_(arm|forearm|thigh|leg))_twist_2\.([lr])', bone)
        if not match:
            continue
        prefix, part, limb, side = match.groups()
        anchor = prefix + part + ('_twist.' if limb in ('arm', 'thigh') else '_stretch.') + side
        if anchor not in world:
            continue
        relative = rotation(world[anchor]).transpose(0, 2, 1) @ rotation(matrices)
        delta = relative[1:] @ relative[:-1].transpose(0, 2, 1)
        angles = np.degrees(np.arccos(np.clip((np.trace(delta, axis1=1, axis2=2)-1)*.5, -1, 1)))
        maximum = max(maximum, float(angles.max(initial=0)))
        bad = np.flatnonzero(angles > 120)
        if len(bad):
            issues.append({'bone': bone, 'frames': bad.tolist(), 'maximumDegrees': float(angles[bad].max())})
    return maximum, issues


def compare(document, original, revised):
    if original['bones'] != revised['bones'] or len(original['frames']) != len(revised['frames']):
        raise ValueError('The bone order or frame count changed')
    if abs(original['fps'] - revised['fps']) > 1e-7:
        raise ValueError('The motion timing changed')
    for field in ('sourceFrameRange', 'stationaryRoot', 'supportedStance', 'inPlace', 'gaitClearance', 'walkingCycle'):
        if original.get('retargeting', {}).get(field, False) != revised.get('retargeting', {}).get(field, False):
            raise ValueError('A motion setting changed: ' + field)
    before, after = world_bones(document, original), world_bones(document, revised)
    revised_groups = re.compile(r'^(c_arm|c_forearm|hand|c_index|c_middle|c_pinky|c_ring|c_thumb|index|middle|pinky|ring|thumb)')
    unchanged = [n for n in before if not revised_groups.match(n.split(':')[-1])]
    body_error = max(float(np.max(np.abs(before[n] - after[n]))) for n in unchanged)
    joints = [n for n in before if re.search(r'^(?:.*:)?(?:c_arm_twist|c_forearm_stretch|hand)\.[lr]$', n)]
    endpoint_error = max(float(np.max(np.abs(before[n][:, :3, 3] - after[n][:, :3, 3]))) for n in joints)
    scale_error = max(float(np.max(np.abs(np.linalg.svd(v[:, :3, :3], compute_uv=False)-1))) for v in after.values())
    max_step, branch_issues = twist_steps(after)
    original_max_step, original_branches = twist_steps(before)
    problems = []
    if body_error > .00002:
        problems.append('Unrelated body transform changed')
    if endpoint_error > .00002:
        problems.append('Shoulder/elbow/wrist trajectory changed')
    if scale_error > .001:
        problems.append('Bone lost rigid scale')
    if branch_issues:
        problems.append('A half-twist helper still flips')
    return {
        'frames': len(revised['frames']), 'unchangedBodyMaximumMatrixDifference': body_error,
        'armJointMaximumPositionDifferenceMeters': endpoint_error, 'boneScaleMaximumError': scale_error,
        'maximumHelperStepDegrees': max_step, 'originalMaximumHelperStepDegrees': original_max_step,
        'helperBranchIssues': branch_issues, 'originalHelperBranchIssues': original_branches,
        'problems': problems,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--characters', type=Path, required=True)
    parser.add_argument('--candidates', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    results = {}
    for directory in sorted(args.candidates.iterdir()):
        files = sorted((directory / 'runtime/motions').glob('*.json.deflate'))
        if not files:
            continue
        root = args.characters / directory.name
        document = json.loads((root / 'runtime/resident/model.gltf').read_text())
        results[directory.name] = {}
        for path in files:
            try:
                result = compare(document, load_clip(root / 'runtime/motions' / path.name), load_clip(path))
            except (KeyError, ValueError, OSError) as error:
                result = {'problems': [str(error)]}
            results[directory.name][path.name.removesuffix('.json.deflate')] = result
    count = sum(len(v) for v in results.values())
    failures = sum(bool(item['problems']) for v in results.values() for item in v.values())
    report = {'clipsChecked': count, 'failures': failures, 'characters': results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2))
    print(json.dumps({'clipsChecked': count, 'failures': failures, 'report': str(args.output)}))
    raise SystemExit(1 if failures or not count else 0)


if __name__ == '__main__':
    main()
