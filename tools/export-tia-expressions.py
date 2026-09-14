"""Restore Tia's authored smiles and a separately identified jaw refinement.
Run Blender with the original Tia .blend, then --python this file -- --package <runtime package>.
Every runtime vertex must exactly match the subdivided source; mismatches abort export.
"""
import bpy,json,numpy as np,base64,argparse,sys,hashlib
from pathlib import Path
from mathutils import kdtree,Vector
parser=argparse.ArgumentParser();parser.add_argument('--package',type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);resident=args.package/'runtime/resident'
root=args.package/'appearance/tia-expressions';root.mkdir(parents=True,exist_ok=True)
j=json.loads((resident/'model.gltf').read_text());buffers=[(resident/b['uri']).read_bytes() for b in j['buffers']]
def acc(i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];d={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']];n={'VEC3':3,'VEC2':2,'VEC4':4,'SCALAR':1}[a['type']];stride=v.get('byteStride',np.dtype(d).itemsize*n)
 return np.ndarray((a['count'],n),dtype=d,buffer=buffers[v['buffer']],offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(stride,np.dtype(d).itemsize)).copy()
shapes=['Mth.Sml.Op2','Mth.Sml.Op4','Mth.Sml.Op5','Portrait.Jaw.Refinement']
body=bpy.data.objects['Fem-A2__Whl_BY_Tia.Blender']
jaw=body.shape_key_add(name=shapes[-1],from_mix=False)
def smooth(a,b,x):
 t=max(0.,min(1.,(x-a)/(b-a)));return t*t*(3-2*t)
for vertex in jaw.data:
 x,depth,height=vertex.co
 # Narrow the lower jaw, fading out before the lips, ears and neck. This
 # is an explicit proportion adjustment, not an alleged source-asset fix.
 band=smooth(1.465,1.50,height)*(1-smooth(1.53,1.595,height))
 cheek=smooth(.023,.055,abs(x));front=smooth(-.015,.06,-depth)
 vertex.co.x=x*(1-.14*band*cheek*front)
records={s:[] for s in shapes};report=[]
for rig in [o for o in bpy.data.objects if o.type=='ARMATURE']:rig.data.pose_position='REST'
for node in j['nodes']:
 if 'mesh' not in node:continue
 m=j['meshes'][node['mesh']]; name=node['name']; source=name
 if 'Whl_BY_Tia.Blender' in name:source='Fem-A2__Whl_BY_Tia.Blender'
 if source not in bpy.data.objects:continue
 o=bpy.data.objects[source];keys=o.data.shape_keys
 if not keys or not any(s in keys.key_blocks for s in shapes):continue
 for mod in o.modifiers:
  if mod.type=='ARMATURE':mod.show_viewport=False
  if mod.type=='SUBSURF':mod.levels=2;mod.show_viewport=source=='Fem-A2__Whl_BY_Tia.Blender'
 keys.animation_data_clear()
 for k in keys.key_blocks:k.value=0
 if keys.key_blocks.get('Smaller.breast'):keys.key_blocks['Smaller.breast'].value=1
 def evaluated():
  bpy.context.view_layer.update(); ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get()); mesh=ev.to_mesh(); pts=np.zeros(len(mesh.vertices)*3,dtype=np.float32);mesh.vertices.foreach_get('co',pts);pts=pts.reshape(-1,3); pts=pts[:,[0,2,1]];pts[:,2]*=-1;normals=np.zeros(len(mesh.vertices)*3,dtype=np.float32);mesh.vertices.foreach_get('normal',normals);normals=normals.reshape(-1,3)[:,[0,2,1]];normals[:,2]*=-1;ev.to_mesh_clear();return pts,normals
 base,baseNormals=evaluated();tree=kdtree.KDTree(len(base))
 for i,p in enumerate(base):tree.insert(p,i)
 tree.balance()
 mappings=[]
 for pi,prim in enumerate(m['primitives']):
  pos=acc(prim['attributes']['POSITION']);found=[tree.find(p) for p in pos];ix=np.array([p[1] for p in found]);dist=np.array([p[2] for p in found]);report.append(dict(node=name,primitive=pi,count=len(pos),source=len(base),maxDistance=float(dist.max()),medianDistance=float(np.median(dist)),bounds=[pos.min(0).tolist(),pos.max(0).tolist()],sourceBounds=[base.min(0).tolist(),base.max(0).tolist()]));assert dist.max()<1e-6, f'{name} does not match original geometry';mappings.append((pi,ix,len(pos)))
 for shape in shapes:
  k=keys.key_blocks.get(shape)
  if not k:continue
  k.value=1;posed,posedNormals=evaluated();delta=posed-base;normalDelta=posedNormals-baseNormals;k.value=0
  for pi,ix,count in mappings:
   dd=delta[ix];nd=normalDelta[ix];ids=np.flatnonzero((np.linalg.norm(dd,axis=1)>1e-7)|(np.linalg.norm(nd,axis=1)>1e-6)).astype('<u4')
   if len(ids):records[shape].append(dict(node=name,primitive=pi,count=count,indices=base64.b64encode(ids.tobytes()).decode(),deltas=base64.b64encode(dd[ids].astype('<f4').tobytes()).decode(),normals=base64.b64encode(nd[ids].astype('<f4').tobytes()).decode()))
files={};items=[]
for shape,data in records.items():
 name=shape.lower()+'.json';raw=json.dumps(dict(version=1,meshes=data),separators=(',',':')).encode();(root/name).write_bytes(raw)
 files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
ids=['portraitSmile','portraitLaugh','portraitGrin','portraitJaw']
index=args.package/'appearance/index.json';catalogue=json.loads(index.read_text())
catalogue['packs']=[p for p in catalogue['packs'] if p['id']!='tia-expressions']
catalogue['packs'].append({'id':'tia-expressions','directory':'tia-expressions','label':'Tia · original smiles','files':files,'items':[],
 'facialRig':[{'channel':channel,'file':shape.lower()+'.json'} for channel,shape in zip(ids,shapes)]})
index.write_text(json.dumps(catalogue,indent=1))
(root/'source-audit.json').write_text(json.dumps({'source':'Tia-001.1.blend','neutralVerticesMatchSource':True,'customRefinements':['Portrait.Jaw.Refinement'],'matches':report},indent=2))
print(json.dumps({'expressions':shapes,'maximumVertexError':max(r['maxDistance'] for r in report),'files':files}),flush=True)
