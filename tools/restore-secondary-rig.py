"""Restore an independent armor rig in a previously merged character package.

Usage: restore-secondary-rig.py PACKAGE RIG_JSON RIG_NAME DONOR_PACKAGE
RIG_JSON contains original Blender world rest matrices and deform parents,
keyed by rig name. Source mesh positions, face morphs, maps and weights are
unchanged. Only armor joint indices/binds and its animation tracks change.
"""
from pathlib import Path
import sys,json,copy,importlib.util,hashlib,zlib
import numpy as np
spec=importlib.util.spec_from_file_location('prepare',Path(__file__).with_name('prepare-character.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p);g=p.glb
package,source,rig,donor=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3],Path(sys.argv[4])
doc,binary=g.read_glb(package/'model.glb');original_prefix=rig+':';prefix='Restored-'+rig+':'
assert not any(n.get('name')==prefix+'root.x' for n in doc['nodes']),'Rig is already independent'
audit=json.loads((package/'source-audit.json').read_text());mesh_names={m['name'] for m in audit['meshes'] if m.get('sourceRig')==rig}
assert mesh_names,'Source audit has no meshes for this rig'
original=copy.deepcopy(doc);bones=json.loads(source.read_text())[rig]
names,parents,local,world=p.skeleton(doc);parent=parents[names['root.x']]
basis=np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]])
rest={n:basis@b['world'] for n,b in bones.items()};indices={n:len(doc['nodes'])+i for i,n in enumerate(bones)}
for n,b in bones.items():
 par=b['parent'];mat=np.linalg.inv(rest[par] if par else world[parent])@rest[n]
 doc['nodes'].append({'name':prefix+n,'matrix':mat.T.reshape(-1).tolist(),'children':[]})
for n,b in bones.items():doc['nodes'][indices[b['parent']] if b['parent'] else parent].setdefault('children',[]).append(indices[n])
def append(values,kind,component):
 while len(binary)%4:binary.append(0)
 blob=values.tobytes();view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(blob)});binary.extend(blob)
 index=len(doc['accessors']);doc['accessors'].append({'bufferView':view,'componentType':component,'count':len(values),'type':kind});return index
bind=np.array([np.linalg.inv(rest[n]).T.reshape(-1) for n in bones],dtype='<f4')
new_skin=len(doc['skins']);doc['skins'].append({'joints':list(indices.values()),'inverseBindMatrices':append(bind,'MAT4',5126),'skeleton':parent})
bone_order=list(bones);changed=[];position_hashes={};seen={}
for node in doc['nodes']:
 if node.get('name') not in mesh_names or 'mesh' not in node:continue
 old=doc['skins'][node['skin']]['joints'];oldnames=[doc['nodes'][j]['name'] for j in old]
 remap=np.array([bone_order.index(n[len(original_prefix):] if n.startswith(original_prefix) else n) if (n[len(original_prefix):] if n.startswith(original_prefix) else n) in bones else -1 for n in oldnames])
 for primitive in doc['meshes'][node['mesh']]['primitives']:
  attrs=primitive['attributes'];pos=g.array(doc,binary,attrs['POSITION']);position_hashes[str(attrs['POSITION'])]=hashlib.sha256(pos.tobytes()).hexdigest()
  for key,idx in list(attrs.items()):
   if not key.startswith('JOINTS_'):continue
   if idx in seen:attrs[key]=seen[idx];continue
   joints=g.array(doc,binary,idx);weights=g.array(doc,binary,attrs[key.replace('JOINTS','WEIGHTS')]);mapped=remap[joints]
   assert np.all((mapped>=0)|(weights==0)),f'Unmapped weighted armor bones on {node["name"]}'
   mapped=np.maximum(mapped,0).astype('<u2');attrs[key]=append(mapped,'VEC4',5123);seen[idx]=attrs[key]
 node['skin']=new_skin;changed.append(node['name'])
for idx,sha in position_hashes.items():assert hashlib.sha256(g.array(doc,binary,int(idx)).tobytes()).hexdigest()==sha
donor_doc=json.loads((donor/'runtime/resident/model.gltf').read_text());retarget=p.Retarget(donor_doc,doc)
assert len(retarget.secondaries)==1
child=retarget.secondaries[0];lib=doc['extras']['openclamAvatar']
lib['rest'].update({prefix+n:child.tl[j].tolist() for n,j in child.tnames.items()})
source_poses={v['id']:v for v in donor_doc['extras']['openclamAvatar']['poses']}
for pose in lib['poses']:
 added=child.pose(source_poses[pose['id']]);pose['deltas'].update({prefix+n:v for n,v in added['deltas'].items()})
motion=package/'runtime/motions';library=json.loads((motion/'library.json').read_text())
for entry in library['clips']:
 def read(base):
  f=base/entry['file'];f=f if f.exists() else Path(str(f)+'.deflate');blob=f.read_bytes();return json.loads(zlib.decompress(blob,-15) if f.suffix=='.deflate' else blob)
 existing=read(motion);added=child.clip(read(donor/'runtime/motions'))
 a=np.array(existing['frames']).reshape(len(existing['frames']),-1,12);b=np.array(added['frames']).reshape(len(added['frames']),-1,12)
 # Motion files store one flattened matrix list per frame.
 assert len(a)==len(b);existing['frames']=np.concatenate([a,b],axis=1).reshape(len(a),-1).tolist();existing['bones']+= [prefix+n for n in added['bones']]
 raw=json.dumps(existing,separators=(',',':')).encode();compress=zlib.compressobj(7,zlib.DEFLATED,-15);(motion/(entry['file']+'.deflate')).write_bytes(compress.compress(raw)+compress.flush())
g.write_glb(package/'model.glb',doc,binary)
manifest=json.loads((package/'manifest.json').read_text());manifest['assetRevision']=package.name+'-portrait-v5';(package/'manifest.json').write_text(json.dumps(manifest,indent=2))
result={'rig':rig,'meshCount':len(changed),'boneCount':len(bones),'motionClips':len(library['clips']),'geometryPositionsUnchanged':True,'pilotFaceAndTexturesUnchanged':True,'meshes':changed}
(package/'secondary-rig-repair.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
