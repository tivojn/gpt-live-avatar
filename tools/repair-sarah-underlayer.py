import json,argparse,hashlib
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
parser=argparse.ArgumentParser(description='Derive Sarah clothing fit from licensed resident assets; originals stay untouched.')
parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args(__import__('sys').argv[__import__('sys').argv.index('--')+1:] if '--' in __import__('sys').argv else [])
root=args.source.resolve();out=args.output.resolve();assert root!=out,'Output must differ from source';out.mkdir(parents=True,exist_ok=True)
path=root/'model.gltf';doc=json.loads(path.read_text());assert not doc.get('extras',{}).get('avatarSarahSurfaceRepair'),'Source is already repaired';buffers={};payload=bytearray();buffer_index=len(doc['buffers'])
def read(index):
 a=doc['accessors'][index];dtype=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]);w={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
 def view(vi,count,width,dt,offset=0):
  v=doc['bufferViews'][vi];bi=v['buffer']
  if bi not in buffers:buffers[bi]=(root/doc['buffers'][bi]['uri']).read_bytes()
  return np.ndarray((count,width),dtype=dt,buffer=buffers[bi],offset=v.get('byteOffset',0)+offset,strides=(v.get('byteStride',width*dt.itemsize),dt.itemsize)).copy()
 result=view(a['bufferView'],a['count'],w,dtype,a.get('byteOffset',0))if'bufferView'in a else np.zeros((a['count'],w),dtype=dtype)
 if 'sparse'in a:
  sp=a['sparse'];idx=sp['indices'];ids=view(idx['bufferView'],sp['count'],1,np.dtype({5121:'u1',5123:'<u2',5125:'<u4'}[idx['componentType']]),idx.get('byteOffset',0)).reshape(-1);v=sp['values'];result[ids]=view(v['bufferView'],sp['count'],w,dtype,v.get('byteOffset',0))
 return result
def append(values,template):
 raw=values.tobytes();vi=len(doc['bufferViews']);ai=len(doc['accessors']);doc['bufferViews'].append({'buffer':buffer_index,'byteOffset':len(payload),'byteLength':len(raw)});payload.extend(raw);payload.extend(b'\0'*(-len(payload)%4));acc={**template,'bufferView':vi,'count':len(values)};acc.pop('byteOffset',None);acc.pop('sparse',None);acc.pop('min',None);acc.pop('max',None)
 if acc['type']=='VEC3':acc.update(min=values.min(0).tolist(),max=values.max(0).tolist())
 doc['accessors'].append(acc);return ai
panel=next(n for n in doc['nodes']if n.get('name')=='Fem-A_Bot_Ac_BknBrzl_1');panel_primitive=doc['meshes'][panel['mesh']]['primitives'][0];uvs={k:read(v)for k,v in panel_primitive['attributes'].items()if k.startswith('TEXCOORD')}
body=next(n for n in doc['nodes']if n.get('name')=='Fem-A__Whl_BY_Sarah.export');bodymesh=doc['meshes'][body['mesh']];primitive=next(q for q in bodymesh['primitives']if doc['materials'][q['material']]['name']=='Top_Sara01A_M.001');a=primitive['attributes'];position=read(a['POSITION']);all_triangles=read(primitive['indices']).reshape(-1,3)
parent=list(range(len(position)))
def find(v):
 while parent[v]!=v:parent[v]=parent[parent[v]];v=parent[v]
 return v
for tri in all_triangles:
 f=find(int(tri[0]))
 for v in tri[1:]:parent[find(int(v))]=f
components={}
for i in range(len(position)):components.setdefault(find(i),[]).append(i)
outer=np.zeros(len(position),dtype=bool);internal=np.zeros(len(position),dtype=bool);removed=[]
for vertices in components.values():
 pts=position[vertices]
 if pts[:,1].min()<.2 and pts[:,1].max()>1.4:outer[vertices]=True
 lo=pts.min(0);hi=pts.max(0)
 if len(vertices)<1000 and np.abs(pts[:,0]).max()<.05 and lo[1]>.94 and hi[1]<1.10 and lo[2]>-.025 and hi[2]<.10:
  internal[vertices]=True;removed.append({'vertices':len(vertices),'min':lo.tolist(),'max':hi.tolist()})
inside=outer&(position[:,1]>.90)&(position[:,1]<1.095)&(np.abs(position[:,0])<.22);triangles=all_triangles[inside[all_triangles].all(1)];ids=np.unique(triangles);remap=np.full(len(position),-1);remap[ids]=np.arange(len(ids));triangles=remap[triangles].astype('<u2');positions=position[ids]
base={name:read(a[name])[ids]for name in ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0']}
# Weld only for locating boundary loops; keep source vertices and weights.
_,canonical=np.unique(np.round(positions,5),axis=0,return_inverse=True);representative={int(c):i for i,c in reversed(list(enumerate(canonical)))};edges={}
for tri in triangles:
 ct=canonical[tri]
 for k in range(3):
  edge=(int(ct[k]),int(ct[(k+1)%3]));key=tuple(sorted(edge));edges.setdefault(key,[]).append(edge)
boundary=[e[0]for e in edges.values()if len(e)==1];nxt={a:b for a,b in boundary};seen=set();loops=[];caps=[]
for start,_ in boundary:
 if start in seen:continue
 loop=[];cur=start
 while cur not in seen and cur in nxt:
  seen.add(cur);loop.append(cur);cur=nxt[cur]
 if cur!=start:continue
 loc=[representative[v]for v in loop];pts=positions[loc];lo=pts.min(0);hi=pts.max(0);loops.append({'vertices':len(loop),'min':lo.tolist(),'max':hi.tolist()})
 if np.abs(pts[:,0]).max()<.06 and lo[1]>.94 and hi[1]<1.09:
  vectors=[Vector(positions[v])for v in reversed(loc)];lookup={tuple(v):loc[len(loc)-1-i]for i,v in enumerate(vectors)}
  cap=np.array([[(loc[len(loc)-1-v] if isinstance(v,int) else lookup[tuple(v)])for v in tri]for tri in tessellate_polygon([vectors])],dtype='<u2');caps.append(cap);triangles=np.vstack([triangles,cap])
# Remove only internal anatomical components. Close their outer boundary with
# triangles using original boundary vertices/weights/morphs (no body cutout).
body_triangles=all_triangles[~internal[all_triangles].any(1)]
for cap in caps:body_triangles=np.vstack([body_triangles,ids[cap]])
primitive['indices']=append(body_triangles.astype('<u4').reshape(-1,1),{'componentType':5125,'type':'SCALAR'})
# Fair only the small outer gusset boundary: source weights switch abruptly to
# opposite thighs and pelvis there. Harmonic interpolation uses unchanged outer
# neighbours as constraints and is applied identically to body and fitted cloth.
bj=read(a['JOINTS_0']);bw=read(a['WEIGHTS_0']);bn=read(a['NORMAL'])
_,weld=np.unique(np.round(position,5),axis=0,return_inverse=True)
nw=int(weld.max()+1);coords=np.zeros((nw,3));counts=np.bincount(weld,minlength=nw);np.add.at(coords,weld,position);coords/=counts[:,None]
mask=(np.abs(coords[:,0])<.037)&(coords[:,1]>.953)&(coords[:,1]<1.023)&(coords[:,2]>.002)&(coords[:,2]<.100)
unknown=np.flatnonzero(mask);local_edges=[]
for tri in body_triangles:
 wt=weld[tri]
 for n in range(3):
  u,v=int(wt[n]),int(wt[(n+1)%3])
  if u!=v:
   if mask[u]:local_edges.append((u,v))
   if mask[v]:local_edges.append((v,u))
edges=np.unique(local_edges,axis=0);used=np.unique(edges);bones=np.unique(bj[np.isin(weld,used)]);dense=np.zeros((nw,len(bones)),dtype=np.float64)
for k,bone in enumerate(bones):np.add.at(dense[:,k],weld,(bw*(bj==bone)).sum(1))
dense/=counts[:,None];starts=edges[:,0];ends=edges[:,1];degree=np.bincount(starts,minlength=nw);unknown=unknown[degree[unknown]>0]
for _ in range(400):
 acc=np.zeros_like(dense);np.add.at(acc,starts,dense[ends]);dense[unknown]=acc[unknown]/degree[unknown,None]
old_j=bj.copy();old_w=bw.copy();changed=np.flatnonzero(mask[weld]&~internal&(degree[weld]>0))
for v in changed:
 d=dense[weld[v]];top=np.argsort(d)[-4:][::-1];bj[v]=bones[top];bw[v]=d[top]/d[top].sum()
assert np.isfinite(bw).all() and np.max(np.abs(bw.sum(1)-1))<1e-4
# Recompute only normals bordering a new cap, using welded face normals.
face=np.cross(position[body_triangles[:,1]]-position[body_triangles[:,0]],position[body_triangles[:,2]]-position[body_triangles[:,0]])
normal_sum=np.zeros((nw,3));
for k in range(3):np.add.at(normal_sum,weld[body_triangles[:,k]],face)
normal_sum/=np.maximum(np.linalg.norm(normal_sum,axis=1,keepdims=True),1e-12)
cap_weld=np.unique(weld[np.concatenate([ids[c].reshape(-1)for c in caps])]);normal_vertices=np.flatnonzero(np.isin(weld,cap_weld));bn[normal_vertices]=normal_sum[weld[normal_vertices]]
a['JOINTS_0']=append(bj,doc['accessors'][a['JOINTS_0']]);a['WEIGHTS_0']=append(bw,doc['accessors'][a['WEIGHTS_0']]);a['NORMAL']=append(bn,doc['accessors'][a['NORMAL']])
# New body accessors are in the output buffer, not a source file.
base['JOINTS_0']=bj[ids];base['WEIGHTS_0']=bw[ids];base['NORMAL']=bn[ids]

positions=base['POSITION'];attrs={name:append(values,doc['accessors'][a[name]])for name,values in base.items()};tex={k:np.zeros((len(positions),v.shape[1]),dtype='<f4')for k,v in uvs.items()}
# Layout the fitted panel in the original material's front/back pattern islands;
# nearest-point UVs collapse onto the old gusset seam and amplify its normal map.
for k,values in tex.items():
 t=np.clip((positions[:,1]-.946)/.122,0,1)
 front=base['NORMAL'][:,2]>-.15
 values[:,0]=.5+positions[:,0]*np.where(front,3.0,1.08)
 values[:,1]=np.where(front,.190+.502*t,.748+.218*t)
for k,v in tex.items():attrs[k]=append(v,{'componentType':5126,'type':'VEC2'})
result={'attributes':attrs,'indices':append(triangles.reshape(-1,1),{'componentType':5123,'type':'SCALAR'}),'material':panel_primitive['material']}
target_names=bodymesh.get('extras',{}).get('targetNames',[]);target_records=[];targets=[]
for i,target in enumerate(primitive.get('targets',[])):
 values={k:read(v)[ids]for k,v in target.items()}

 if any(np.abs(v).max()>1e-6 for v in values.values()):
  targets.append({k:append(v,doc['accessors'][target[k]])for k,v in values.items()});target_records.append({'index':i,'name':target_names[i],'max':max(float(np.abs(v).max())for v in values.values())})
if targets:result['targets']=targets
mesh={'name':'Sarah body-fitted brief','primitives':[result],'extras':{'openclamDeferred':True,'avatarBodyFittedUnderlayer':True}}
if targets:mesh['extras']['targetNames']=[t['name']for t in target_records];mesh['weights']=[bodymesh.get('weights',[0]*len(target_names))[t['index']]for t in target_records]
doc['meshes'][panel['mesh']]=mesh;panel.setdefault('extras',{})['avatarBodyFittedUnderlayer']=True
for outfit in doc['extras']['openclamAvatar']['outfits']:
 if outfit['id']in ['dress','dress-straps']:outfit['nodes'].append(panel['name'])
assert len(removed)==6 and int(internal.sum())==1393 and len(caps)==2 and len(changed)==706,'Source topology changed: review the bounded repair before exporting'
doc.setdefault('extras',{})['avatarSarahSurfaceRepair']={'version':1,'sourceModelSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'removedInternalVertices':1393,'smoothedWeightVertices':706}
file='body-fitted-brief-v5.bin';(out/file).write_bytes(payload);doc['buffers'].append({'uri':file,'byteLength':len(payload)});(out/'body-fitted-model-v5.gltf').write_text(json.dumps(doc,separators=(',',':')))
report={'vertices':len(positions),'removedInternalComponents':removed,'removedInternalVertices':int(internal.sum()),'bodyTrianglesBefore':len(all_triangles),'bodyTrianglesAfter':len(body_triangles),'gussets':len(caps),'boundaryLoops':loops,'triangles':len(triangles),'bytes':len(payload),'bodyPrimitiveVertices':len(position),'morphTargets':target_records,'identityWeights':True,'smoothedWeightVertices':len(changed),'normalRepairVertices':len(normal_vertices),'smoothRegionMin':position[changed].min(0).tolist(),'smoothRegionMax':position[changed].max(0).tolist()};(out/'body-brief-report-v5.json').write_text(json.dumps(report,indent=2));print(report)
