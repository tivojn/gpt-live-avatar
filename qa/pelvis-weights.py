#!/usr/bin/env python3
"""Validate Sarah's authored pelvis-weight repair without changing assets.

Uses Python's standard library. Licensed source-weight references are optional
and are supplied separately, never embedded into this source file.
"""
import argparse, copy, hashlib, itertools, json, math, struct
from pathlib import Path

NODES = {'Fem-A__Whl_BY_Sarah.export', 'Fem-A_Bot_Ac_BknBrzl_1',
         'Fem-A_Bot_Ac_BknBrzl_2', 'Fem-A_Bot_Ac_ChnPnts_1',
         'Fem-A_Bot_Ac_ChnPnts_2', 'Fem-A_Whl_Ac_VDress'}
BODY = 'Fem-A__Whl_BY_Sarah.export'
BRIEF = 'Fem-A_Bot_Ac_BknBrzl_1'
TYPES = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
         5125: ('I', 4), 5126: ('f', 4)}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def digest(data): return hashlib.sha256(data).hexdigest()

class Asset:
    def __init__(self, resident, fallback=None):
        self.root = Path(resident)
        self.fallback = Path(fallback) if fallback else None
        self.model = (self.root / 'model.gltf').read_bytes()
        self.doc = json.loads(self.model)
        self.buffers = {}
        self.arrays = {}
    def blob(self, index):
        if index not in self.buffers:
            uri = self.doc['buffers'][index]['uri']
            path = self.root / uri
            if not path.exists() and self.fallback: path = self.fallback / uri
            self.buffers[index] = path.read_bytes()
        return self.buffers[index]
    def view(self, vi, count, width, component, offset=0):
        view = self.doc['bufferViews'][vi]
        fmt, size = TYPES[component]
        raw = self.blob(view['buffer'])
        start = view.get('byteOffset', 0) + offset
        stride = view.get('byteStride', width * size)
        return [struct.unpack_from('<' + fmt * width, raw, start + i * stride)
                for i in range(count)]
    def array(self, index):
        if index not in self.arrays:
            a = self.doc['accessors'][index]
            width = WIDTHS[a['type']]
            values = (self.view(a['bufferView'], a['count'], width, a['componentType'], a.get('byteOffset', 0))
                      if 'bufferView' in a else [(0,) * width for _ in range(a['count'])])
            if 'sparse' in a:
                sp = a['sparse']; ix = sp['indices']; val = sp['values']
                indices = self.view(ix['bufferView'], sp['count'], 1, ix['componentType'], ix.get('byteOffset', 0))
                sparse = self.view(val['bufferView'], sp['count'], width, a['componentType'], val.get('byteOffset', 0))
                for i, row in zip(indices, sparse): values[i[0]] = row
            self.arrays[index] = values
        return self.arrays[index]
    def primitives(self):
        for node in self.doc['nodes']:
            if 'mesh' not in node or 'skin' not in node: continue
            names = [self.doc['nodes'][i]['name'] for i in self.doc['skins'][node['skin']]['joints']]
            for p in self.doc['meshes'][node['mesh']]['primitives']:
                a = p['attributes']
                if 'JOINTS_0' not in a: continue
                yield node['name'], self.doc['materials'][p['material']]['name'], names, a
    def fingerprint(self):
        return {'modelSHA256': digest(self.model),
                'buffers': {b['uri']: digest(self.blob(i)) for i, b in enumerate(self.doc['buffers'])}}

def weights(indices, values):
    result = {}
    for joint, value in zip(indices, values):
        if value: result[joint] = result.get(joint, 0) + value
    return result

def difference(a, b):
    return max((abs(a.get(k, 0) - b.get(k, 0)) for k in set(a) | set(b)), default=0)

def structural_check(base, current):
    a, b = base.doc, current.doc
    for field in ['nodes', 'skins', 'materials', 'textures', 'images', 'animations', 'scenes', 'scene']:
        assert a.get(field) == b.get(field), 'Unrelated asset data changed: ' + field
    assert a['accessors'] == b['accessors'][:len(a['accessors'])], 'Existing accessors changed'
    assert a['bufferViews'] == b['bufferViews'][:len(a['bufferViews'])], 'Existing buffer views changed'
    assert a['buffers'] == b['buffers'][:len(a['buffers'])], 'Existing buffers changed'
    for i, entry in enumerate(a['buffers']):
        assert digest(base.blob(i)) == digest(current.blob(i)), 'Original buffer modified: ' + entry['uri']
    old, new = copy.deepcopy(a['meshes']), copy.deepcopy(b['meshes'])
    assert len(old) == len(new), 'Mesh count changed'
    for node in a['nodes']:
        if node.get('name') not in NODES: continue
        for meshes in [old, new]:
            for primitive in meshes[node['mesh']]['primitives']:
                for field in ['JOINTS_0', 'WEIGHTS_0']: primitive['attributes'].pop(field, None)
    assert old == new, 'Geometry, morphs, indices, or unrelated skin weights changed'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--resident', required=True, type=Path)
parser.add_argument('--fallback', type=Path, help='Original resident buffers for a staged overlay')
parser.add_argument('--baseline', type=Path, help='Pre-repair resident, used to prove the change is weights only')
parser.add_argument('--authored-body', type=Path, help='Licensed local source records from Blender')
parser.add_argument('--authored-cloth', type=Path, help='Licensed local garment reference tables')
parser.add_argument('--expected-manifest', type=Path, help='Verify exact previously validated payload')
parser.add_argument('--write-manifest', type=Path, help='Save payload hashes and validation summary')
args = parser.parse_args()
asset = Asset(args.resident, args.fallback)
assert asset.doc.get('extras', {}).get('avatarSarahPelvisWeights'), 'Missing pelvis repair metadata'
baseline = Asset(args.baseline, args.fallback) if args.baseline else None
if baseline: structural_check(baseline, asset)
oldskin = {(name, material): (baseline.array(a['JOINTS_0']), baseline.array(a['WEIGHTS_0']))
           for name, material, names, a in baseline.primitives()} if baseline else {}
report = {'structuralBaselineChecked': bool(args.baseline), 'maxWeightSumError': 0,
          'briefVertices': 0, 'maxBriefBodyWeightDifference': 0, 'referenceChecks': {}}
refs = {}
if args.authored_body:
    rows = json.loads(args.authored_body.read_text())['records']
    refs[BODY] = refs[BRIEF] = rows
if args.authored_cloth:
    refs.update({r['name']: r['records'] for r in json.loads(args.authored_cloth.read_text()) if r['name'] in NODES})
key = lambda p: tuple(round(x * 100000) for x in p)
lookup = {}
for name, rows in refs.items():
    table = {}
    for row in rows:
        if row['missing'] > 1e-7: table.setdefault(key(row['p']), []).append(row)
    lookup[name] = table
body = {}; brief = []
for name, material, names, a in asset.primitives():
    if name not in NODES: continue
    positions = asset.array(a['POSITION']); joints = asset.array(a['JOINTS_0']); values = asset.array(a['WEIGHTS_0'])
    for vertex, (p, js, ws) in enumerate(zip(positions, joints, values)):
        assert all(math.isfinite(w) and w >= 0 for w in ws), 'Invalid skin weight'
        assert all(0 <= j < len(names) for j in js), 'Invalid bone index'
        report['maxWeightSumError'] = max(report['maxWeightSumError'], abs(sum(ws) - 1))
        actual = weights(js, ws)
        previous = oldskin.get((name, material))
        changed = bool(previous and difference(actual, weights(previous[0][vertex], previous[1][vertex])) > 1e-6)
        if name == BODY and material == 'Top_Sara01A_M.001': body.setdefault(p, []).append(actual)
        if name == BRIEF: brief.append((p, actual))
        if name not in lookup: continue
        x, y, z = p
        if (asset.doc['extras']['avatarSarahPelvisWeights'].get('preserveGusset') and name in [BODY, BRIEF]
                and abs(x) < .037 and .953 < y < 1.023 and .002 < z < .100): continue
        table = lookup[name]; k = key(p); candidates = table.get(k, [])
        if not candidates:
            candidates = [r for off in itertools.product([-1, 0, 1], repeat=3)
                          for r in table.get(tuple(a + b for a, b in zip(k, off)), [])]
        if not candidates:
            assert not changed, 'Changed weight has no authored reference: ' + name
            continue
        row = min(candidates, key=lambda r: sum((a - b) ** 2 for a, b in zip(p, r['p'])))
        distance = sum((a - b) ** 2 for a, b in zip(p, row['p']))
        if distance >= 9e-12:
            assert not changed, 'Changed weight is outside authored reference: ' + name
            continue
        expected = weights([names.index(n) for n in row['j']], row['w'])
        error = difference(actual, expected)
        record = report['referenceChecks'].setdefault(name, {'vertices': 0, 'maxWeightError': 0})
        record['vertices'] += 1; record['maxWeightError'] = max(record['maxWeightError'], error)
        assert error < 2e-6, 'Authored weight mismatch: ' + name
assert report['maxWeightSumError'] < 1e-6, 'Unnormalized skin weights'
assert len(brief) > 0 and body, 'Missing Sarah body or fitted brief'
for p, ws in brief:
    assert p in body, 'Brief position differs from body'
    error = min(difference(ws, bs) for bs in body[p])
    report['maxBriefBodyWeightDifference'] = max(report['maxBriefBodyWeightDifference'], error)
assert report['maxBriefBodyWeightDifference'] < 1e-7, 'Body and fitted brief skinning diverge'
report['briefVertices'] = len(brief)
fingerprint = asset.fingerprint()
if args.expected_manifest:
    expected = json.loads(args.expected_manifest.read_text())
    assert fingerprint == expected['payload'], 'Payload differs from the independently validated candidate'
manifest = {'version': 1, 'payload': fingerprint, 'validation': report}
if args.write_manifest:
    args.write_manifest.parent.mkdir(parents=True, exist_ok=True)
    args.write_manifest.write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'passed': True, **report}, indent=2))
