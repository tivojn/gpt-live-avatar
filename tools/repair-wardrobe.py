"""Repair licensed resident wardrobe geometry; never changes authoring projects.

Usage: python repair-wardrobe.py --sarah DIR --sarah-surfaces native-bottoms.glb
       python repair-wardrobe.py --iselda DIR
Run after resident export and before creating a NEW encrypted asset revision.
The Sarah input is exported by export-sarah-surfaces.py --bottoms-only.
"""
import argparse,importlib.util,json
from pathlib import Path
import numpy as np

spec=importlib.util.spec_from_file_location('glb',Path(__file__).with_name('complete-sarah.py'))
glb=importlib.util.module_from_spec(spec);spec.loader.exec_module(glb)

def repair(directory,surfaces=None):
 path=Path(directory)/'runtime/resident/model.gltf';doc=json.loads(path.read_text())
 marker='fitted-bottoms-v1' if surfaces else 'pelvis-skirt-v1'
 repairs=doc.setdefault('extras',{}).setdefault('avatarWardrobeRepairs',[])
 if marker in repairs:raise ValueError('This resident export is already repaired; use the original export.')
 joints=[doc['nodes'][i]['name']for i in doc['skins'][0]['joints']];pelvis=joints.index('root.x')
 buffer_index=len(doc['buffers']);payload=bytearray();buffers={}
 def read(index):
  acc=doc['accessors'][index];view=doc['bufferViews'][acc['bufferView']];bi=view['buffer']
  if bi not in buffers:buffers[bi]=(path.parent/doc['buffers'][bi]['uri']).read_bytes()
  dtype=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[acc['componentType']])
  width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[acc['type']]
  return np.ndarray((acc['count'],width),dtype=dtype,buffer=buffers[bi],offset=view.get('byteOffset',0)+acc.get('byteOffset',0),strides=(view.get('byteStride',width*dtype.itemsize),dtype.itemsize))
 def append(values,ctype,kind):
  raw=values.tobytes();vi=len(doc['bufferViews']);ai=len(doc['accessors'])
  doc['bufferViews'].append({'buffer':buffer_index,'byteOffset':len(payload),'byteLength':len(raw)})
  payload.extend(raw);payload.extend(b'\0'*(-len(payload)%4))
  acc={'bufferView':vi,'componentType':ctype,'count':len(values),'type':kind}
  if kind=='VEC3':acc.update(min=values.min(0).tolist(),max=values.max(0).tolist())
  doc['accessors'].append(acc);return ai
 if surfaces:
  source,blob=glb.read_glb(surfaces)
  node=next(n for n in source['nodes']if n.get('name')=='Fem-A_Bot_Ac_BknBrzl_1')
  target=next(n for n in doc['nodes']if n.get('name')==node['name']);mesh=source['meshes'][node['mesh']]
  materials={m['name']:i for i,m in enumerate(doc['materials'])};primitives=[]
  for primitive in mesh['primitives']:
   attrs={}
   for name,index in primitive['attributes'].items():
    acc=source['accessors'][index];values=glb.array(source,blob,index).copy()
    if name=='POSITION':
     values+=glb.array(source,blob,primitive['attributes']['NORMAL'])*.003
     t=np.clip((values[:,1]-.98)/.045,0,1);values[:,1]-=.009*(1-t*t*(3-2*t))
    # The fitted panel spans both thighs; separate thigh rotations folded it
    # through the body. Side ties retain their independent authored weights.
    if name=='JOINTS_0':values[:]=pelvis
    if name=='WEIGHTS_0':values[:]=[1,0,0,0]
    attrs[name]=append(values,acc['componentType'],acc['type'])
   ia=source['accessors'][primitive['indices']]
   primitives.append({'attributes':attrs,'indices':append(glb.array(source,blob,primitive['indices']).copy(),ia['componentType'],'SCALAR'),'material':materials[source['materials'][primitive['material']]['name']]})
  doc['meshes'][target['mesh']]={'name':mesh['name'],'primitives':primitives,'extras':{'openclamDeferred':True}}
 else:
  for node in doc['nodes']:
   if node.get('name')not in ['Short Skirt','Long Skirt']:continue
   for primitive in doc['meshes'][node['mesh']]['primitives']:
    attrs=primitive['attributes'];count=len(read(attrs['POSITION']))
    weights=np.zeros((count,4),dtype='<f4');weights[:,0]=1
    attrs['JOINTS_0']=append(np.full((count,4),pelvis,dtype='<u2'),5123,'VEC4')
    attrs['WEIGHTS_0']=append(weights,5126,'VEC4')
 file=marker+'.bin';(path.parent/file).write_bytes(payload)
 doc['buffers'].append({'uri':file,'byteLength':len(payload)});repairs.append(marker)
 path.write_text(json.dumps(doc,separators=(',',':')))
 print(marker,len(payload),'geometry bytes')

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--sarah');parser.add_argument('--sarah-surfaces');parser.add_argument('--iselda');args=parser.parse_args()
 if args.sarah:
  if not args.sarah_surfaces:parser.error('--sarah-surfaces is required with --sarah')
  repair(args.sarah,args.sarah_surfaces)
 if args.iselda:repair(args.iselda)
 if not args.sarah and not args.iselda:parser.error('Choose a character resident directory.')
