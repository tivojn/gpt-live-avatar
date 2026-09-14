"""Validate a completed Sarah GLB, including skinning and source coverage.

python qa/sarah-assets.py build/sarah/complete/model.glb
Requires numpy. Does not write the model.
"""
import json, struct, sys
from pathlib import Path
import numpy as np

path=Path(sys.argv[1]);raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0]
assert raw[:4]==b'glTF' and struct.unpack_from('<I',raw,8)[0]==len(raw)
d=json.loads(raw[20:20+n]);binary=raw[28+n:]
nodes=d['nodes'];lib=d['extras']['openclamAvatar']
meshnames={n['name'] for n in nodes if 'mesh' in n}
assert len(lib['rest'])==157 and len(lib['poses'])==69
assert len(lib['outfits'])==5 and len(lib['props'])==3 and len(lib['expressions'])==65
assert not {'Fem-A__Head_B_Sarah_Eyes','Fem-A_Teeth_Tongue'}&meshnames
assert {'Ac_Tommy_Bag','Weap_1911','Weap_FN-SCAR-20S.001','Fem-A_Fot_Ac_Strphl','Fem-A_Bot_Ac_BknBrzl_1','Fem-A_Bot_Ac_BknBrzl_2'}<=meshnames
for key in ['outfits','props','accessories']:
    for option in lib[key]:assert set(option['nodes'])<=meshnames,(key,option['id'])
body=next(n for n in nodes if n.get('name')=='Fem-A__Whl_BY_Sarah.export')
shapes=d['meshes'][body['mesh']]['extras']['targetNames'];assert len(shapes)==145
for e in lib['expressions']:assert set(e['weights'])<=set(shapes)
def read(index):
    a=d['accessors'][index];v=d['bufferViews'][a['bufferView']]
    dtype={5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]
    width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];size=np.dtype(dtype).itemsize
    return np.ndarray((a['count'],width),dtype=dtype,buffer=binary,
        offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',size*width),size))
vertices=0
for node in nodes:
    if 'mesh' not in node:continue
    skin=d['skins'][node['skin']];names=[nodes[i]['name'] for i in skin['joints']]
    for p in d['meshes'][node['mesh']]['primitives']:
        attrs=p['attributes'];pos=read(attrs['POSITION']);vertices+=len(pos)
        assert np.isfinite(pos).all() and np.abs(pos).max()<4,node['name']
        joints=read(attrs['JOINTS_0']);weights=read(attrs['WEIGHTS_0'])
        assert joints.max()<len(names) and np.isfinite(weights).all() and (weights>=0).all()
        np.testing.assert_allclose(weights.sum(axis=1),1,atol=1e-5,rtol=0)
        if 'neutral_bone' in names:assert not np.any((joints==names.index('neutral_bone'))&(weights>0)),node['name']
        if node['name'] in ['Weap_1911','Weap_FN-SCAR-20S.001']:
            assert np.all(joints[weights>0]==names.index('hand.r')),'Weapon detached from hand'
        if node['name']=='Ac_Tommy_Bag':assert np.all(joints[weights>0]==names.index('shoulder.r'))
mat={m['name']:m for m in d['materials']}
assert mat['Top_Sara01A_M.001']['extras']['avatarSurface']=='skin'
assert mat['Hed_Hair-21_flp']['pbrMetallicRoughness']['metallicFactor']<=.1
assert mat['Hed_Brow_M.001']['alphaMode']=='BLEND'
assert vertices>130000,'Expected refined surfaces'
pack=json.loads((path.parent/'appearance/index.json').read_text())['packs'][0]
assert len(pack['items'])==74
for item in pack['items']:
    assert item['material'] in mat
    file=path.parent/'appearance'/pack['directory']/item['file']
    assert file.stat().st_size==pack['files'][item['file']]['bytes']
print(json.dumps(dict(passed=True,vertices=vertices,meshes=len(d['meshes']),morphs=len(shapes),poses=69,outfits=5,props=3,expressions=65,colors=74)))
