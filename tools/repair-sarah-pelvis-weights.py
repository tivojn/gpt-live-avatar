"""Restore Sarah's authored pelvis weights in an existing resident asset overlay.

The references must be derived from the licensed original Blender mesh at the
same subdivision level. Output changes only JOINTS_0/WEIGHTS_0 for matched
vertices; rest positions, indices, normals, UVs, morphs and materials stay intact.
Copy the output overlay onto the source package only after visual review.
"""
import argparse,json,struct,math,copy,hashlib
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',type=Path,required=True,help='Source resident directory')
parser.add_argument('--output',type=Path,required=True,help='Separate staging overlay directory')
parser.add_argument('--body-reference',type=Path,required=True)
parser.add_argument('--cloth-reference',type=Path,required=True)
parser.add_argument('--fallback',type=Path,help='Original resident resources when source is an overlay')
args=parser.parse_args();base=args.source.resolve();out=args.output.resolve()
assert base!=out,'Stage separately from the source'
source=json.loads((base/'model.gltf').read_text());refs=json.loads(args.body_reference.read_text())['records']
kind={5121:('B',1),5123:('H',2),5125:('I',4),5126:('f',4)};widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16};cache={}
def read(doc,index):
 a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];fmt,size=kind[a['componentType']];width=widths[a['type']];bi=v['buffer']
 if bi not in cache:
  resource=base/doc['buffers'][bi]['uri']
  if not resource.exists() and args.fallback:resource=args.fallback/doc['buffers'][bi]['uri']
  cache[bi]=resource.read_bytes()
 b=cache[bi];offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',width*size)
 return [list(struct.unpack_from('<'+fmt*width,b,offset+i*stride))for i in range(a['count'])]
def key(p):return tuple(round(v*100000)for v in p)
lookup={}
for rec in refs:lookup.setdefault(key(rec['p']),[]).append(rec)
tables={'Fem-A__Whl_BY_Sarah.export':lookup,'Fem-A_Bot_Ac_BknBrzl_1':lookup}
clothpath=args.cloth_reference
if clothpath.exists():
 for item in json.loads(clothpath.read_text()):
  if item['name'] not in ['Fem-A_Bot_Ac_BknBrzl_2','Fem-A_Bot_Ac_ChnPnts_1','Fem-A_Bot_Ac_ChnPnts_2','Fem-A_Whl_Ac_VDress']:continue
  table={}
  for rec in item['records']:
   if rec['missing']>1e-7:table.setdefault(key(rec['p']),[]).append(rec)
  tables[item['name']]=table

def find(p,table=lookup):
 k=key(p);rs=table.get(k,[])
 if not rs:
  for dx in [-1,0,1]:
   for dy in [-1,0,1]:
    for dz in [-1,0,1]:rs+=table.get((k[0]+dx,k[1]+dy,k[2]+dz),[])
 if not rs:return None
 match=min(rs,key=lambda r:sum((a-b)**2 for a,b in zip(r['p'],p)))
 return match if sum((a-b)**2 for a,b in zip(match['p'],p))<3e-6**2 else None

def run():
 preserve=False
 doc=copy.deepcopy(source);payload=bytearray();bufferid=len(doc['buffers']);counts=[];out.mkdir(parents=True,exist_ok=True)
 def append(rows,template):
  a=copy.deepcopy(template);fmt,size=kind[a['componentType']];w=widths[a['type']];offset=len(payload)
  for row in rows:payload.extend(struct.pack('<'+fmt*w,*row))
  payload.extend(b'\0'*(-len(payload)%4));view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':bufferid,'byteOffset':offset,'byteLength':len(rows)*w*size});a['bufferView']=view;a.pop('byteOffset',None);a.pop('sparse',None);ai=len(doc['accessors']);doc['accessors'].append(a);return ai
 for node in doc['nodes']:
  if node.get('name')not in tables:continue
  joints=[doc['nodes'][j]['name']for j in doc['skins'][node['skin']]['joints']]
  for primitive in doc['meshes'][node['mesh']]['primitives']:
   attrs=primitive['attributes'];p=read(source,attrs['POSITION']);j=read(source,attrs['JOINTS_0']);w=read(source,attrs['WEIGHTS_0']);changed=0;kept=0;overlap=0;maxdelta=0;maxdistance=0
   for i,point in enumerate(p):
    rec=find(point,tables[node['name']])
    if not rec:continue
    x,y,z=point;gusset=node['name'] in ['Fem-A__Whl_BY_Sarah.export','Fem-A_Bot_Ac_BknBrzl_1'] and abs(x)<.037 and .953<y<1.023 and .002<z<.100
    if gusset:
     overlap+=1
     if preserve:kept+=1;continue
    desiredj=[joints.index(n)for n in rec['j']];desiredw=list(rec['w'])
    while len(desiredj)<4:desiredj.append(0);desiredw.append(0)
    olddict={n:sum(v for k,v in zip(j[i],w[i])if k==n)for n in set(j[i])};newdict=dict(zip(desiredj,desiredw));delta=max(abs(olddict.get(n,0)-newdict.get(n,0))for n in set(olddict)|set(newdict))
    if delta<1e-6:continue
    j[i]=desiredj;w[i]=desiredw;changed+=1;maxdelta=max(maxdelta,delta);maxdistance=max(maxdistance,math.sqrt(sum((a-b)**2 for a,b in zip(rec['p'],point))))
   counts.append({'node':node['name'],'vertices':len(p),'changed':changed,'overlapGusset':overlap,'preservedGusset':kept,'maxWeightDelta':maxdelta,'maxPositionMatchDistance':maxdistance})
   if changed:
    attrs['JOINTS_0']=append(j,source['accessors'][attrs['JOINTS_0']]);attrs['WEIGHTS_0']=append(w,source['accessors'][attrs['WEIGHTS_0']])
 if not payload:
  assert source.get('extras',{}).get('avatarSarahPelvisWeights',{}).get('version',0)>=1,'No authored weights matched the supplied source'
  (out/'model.gltf').write_text(json.dumps(doc,separators=(',',':')))
  print(json.dumps({'changed':False,'reason':'Authored weights already restored'}));return
 filename='pelvis-weight-restoration-v2.bin';doc['buffers'].append({'uri':filename,'byteLength':len(payload)});doc['extras']['avatarSarahPelvisWeights']={'version':1,'source':'Authored c_root_bend.x restored to deform root.x','preserveGusset':preserve,'bodyRestGeometryChanged':False}
 (out/filename).write_bytes(payload);(out/'model.gltf').write_text(json.dumps(doc,separators=(',',':')));(out/'pelvis-weight-report.json').write_text(json.dumps({'sourceModelSHA256':hashlib.sha256((base/'model.gltf').read_bytes()).hexdigest(),'counts':counts,'payloadBytes':len(payload)},indent=2));print(out,counts)
run()
