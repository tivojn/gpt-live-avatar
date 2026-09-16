"""Build a private character package from an audited native Blender export.

Retargets body motion in world space while retaining each character's limb
lengths and facial rest transforms. Source models are never modified.
"""
import argparse,copy,hashlib,importlib.util,io,json,re,shutil,struct,zlib
from pathlib import Path
import numpy as np
from PIL import Image
spec=importlib.util.spec_from_file_location('character_glb',Path(__file__).with_name('complete-sarah.py'));glb=importlib.util.module_from_spec(spec);spec.loader.exec_module(glb)

def trs(n):
 if 'matrix'in n:return np.array(n['matrix']).reshape(4,4).T
 x,y,z,w=n.get('rotation',[0,0,0,1]);s=n.get('scale',[1,1,1]);a=np.eye(4)
 a[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])*np.array(s)
 a[:3,3]=n.get('translation',[0,0,0]);return a

def skeleton(doc):
 nodes=doc['nodes'];parents={c:i for i,n in enumerate(nodes) for c in n.get('children',[])};local=np.array([trs(n) for n in nodes]);world={}
 def get(i):
  if i not in world:world[i]=(get(parents[i]) if i in parents else np.eye(4))@local[i]
  return world[i]
 for i in range(len(nodes)):get(i)
 joints=sorted({j for s in doc['skins'] for j in s['joints']});names={nodes[j]['name']:j for j in joints if nodes[j].get('name')!='neutral_bone'}
 return names,parents,local,np.array([world[i] for i in range(len(nodes))])

def rot(a):
 u,s,v=np.linalg.svd(a[...,:3,:3]);return u@v

def clothing_fit(doc,binary,cfg):
 # Small authored-pack corrections provide room between layered garments.
 # This operates on the garment only, never on the character's body or face.
 applied=doc.setdefault('extras',{}).setdefault('avatarClothingFit',[])
 for fit in cfg.get('clothingFit',[]):
  name=fit['node']
  if name in applied:continue
  for node in doc['nodes']:
   if node.get('name')!=name or 'mesh'not in node:continue
   for primitive in doc['meshes'][node['mesh']]['primitives']:
    positions=glb.array(doc,binary,primitive['attributes']['POSITION'])
    radial=positions[:,[0,2]]-np.array(fit.get('centerXZ',[0,0]));length=np.linalg.norm(radial,axis=1)
    lower,upper=fit['height'];fade=fit.get('fade',.03)
    weight=np.clip((positions[:,1]-lower)/fade,0,1)*np.clip((upper-positions[:,1])/fade,0,1)
    positions[:,[0,2]]+=radial*(weight*fit['margin']/np.maximum(length,1e-6))[:,None]
    accessor=doc['accessors'][primitive['attributes']['POSITION']];accessor['min']=positions.min(0).tolist();accessor['max']=positions.max(0).tolist()
  applied.append(name)

def align_directions(a,b):
 a=a/np.linalg.norm(a);b=b/np.linalg.norm(b);v=np.cross(a,b);c=np.dot(a,b)
 if c>1-1e-10:return np.eye(3)
 if c<-1+1e-8:
  axis=np.cross(a,[1,0,0] if abs(a[0])<.9 else [0,1,0]);axis/=np.linalg.norm(axis)
  return 2*np.outer(axis,axis)-np.eye(3)
 k=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
 return np.eye(3)+k+k@k/(1+c)

class Retarget:
 def __init__(self,source,target,_secondary=True):
  self.snames,self.sp,self.sl,self.sw=skeleton(source);self.tnames,self.tp,self.tl,self.tw=skeleton(target)
  self.names=list(self.tnames);self.source=source;self.target=target;self.sri=rot(self.sw).transpose(0,2,1);self.tr=rot(self.tw)
  self.scale=self.tw[self.tnames['root.x'],1,3]/self.sw[self.snames['root.x'],1,3]
  spine=sorted(n for n in self.tnames if re.match(r'c_spine_\d+_bend.x$',n));self.chest=spine[-1];self.mapping={}
  for n in self.names:
   mapped=n
   if n in spine and len(spine)<5:mapped='c_spine_'+str(round(spine.index(n)*4/max(1,len(spine)-1))+1).zfill(2)+'_bend.x'
   if n=='c_neck_01.x':mapped='neck.x'
   if n.startswith('c_toes_'):mapped='toes_01.'+n[-1]
   self.mapping[n]=mapped if mapped in self.snames else None
  # A shortened spine maps its controls across the donor's whole torso.
  # Deform aliases must use the same anatomical source segment; mapping them
  # by their numeric suffix gives the skin and garment different rotations.
  for n in self.names:
   if re.match(r'^spine_\d+\.x$',n):
    source_control=self.mapping.get('c_'+n.replace('.x','_bend.x'))
    source_deform=source_control.replace('c_','',1).replace('_bend','') if source_control else None
    if source_deform in self.snames:self.mapping[n]=source_deform
  # Facial and hair rest shapes belong to their own character, not the donor.
  body=re.compile(r'^(root|foot|toes|c_toes|c_thigh|c_leg|c_arm|c_forearm|shoulder|hand|neck|subneck|c_neck|head|c_spine|spine|c_breast|c_index|c_middle|c_ring|c_pinky|c_thumb|index|middle|ring|pinky|thumb)')
  for n in self.names:
   if not body.match(n):self.mapping[n]=None
  # The donor's rest forearms bend forward; these characters' forearms rest
  # almost vertically. A world rotation delta alone carries that difference
  # into every pose, pushing wrists back through the waist and skirt. Align
  # anatomical segment directions first, retaining target lengths and skin.
  # Legs need the same treatment: different resting knee angles otherwise
  # carry into every step and pull the feet inward.
  self.segment_alignment={}
  # The pelvis is the triangle between the waist and the two hip joints.
  # Characters with different lumbar rest curves need this anatomical basis
  # alignment just like their limbs; a shared world rotation delta alone
  # leaves a permanent forward/back pelvic pitch in every motion.
  def pelvis_frame(names,world):
   left=world[names['c_thigh_twist.l'],:3,3];right=world[names['c_thigh_twist.r'],:3,3]
   x=left-right;up=world[names['root.x'],:3,3]-(left+right)*.5
   if np.linalg.norm(x)<1e-5 or np.linalg.norm(up)<1e-5:raise ValueError('Degenerate anatomical pelvis landmarks')
   x=x/np.linalg.norm(x);y=up-x*np.dot(up,x)
   if np.linalg.norm(y)<1e-5:raise ValueError('Collinear anatomical pelvis landmarks')
   y=y/np.linalg.norm(y);return np.stack([x,y,np.cross(x,y)],axis=1)
  self.segment_alignment['root.x']=pelvis_frame(self.snames,self.sw)@pelvis_frame(self.tnames,self.tw).T
  for side in ['l','r']:
   segments=[('arm','c_arm_twist.','c_forearm_stretch.'),('forearm','c_forearm_stretch.','hand.'),('hand','hand.','middle1.'),
             ('thigh','c_thigh_twist.','c_leg_stretch.'),('leg','c_leg_stretch.','foot.')]
   corrections={}
   for group,start,end in segments:
    a,b=start+side,end+side
    if all(n in self.snames and n in self.tnames for n in [a,b]):
     corrections[group]=align_directions(self.tw[self.tnames[b],:3,3]-self.tw[self.tnames[a],:3,3],self.sw[self.snames[b],:3,3]-self.sw[self.snames[a],:3,3])
   # Retain the native elbow bending plane across characters as well as
   # limb direction; endpoint alignment alone can rotate the elbow crease.
   def elbow_frames(names,world):
    if not all(n+side in names for n in ['c_arm_twist.','c_forearm_stretch.','hand.']):return None
    upper=world[names['c_forearm_stretch.'+side],:3,3]-world[names['c_arm_twist.'+side],:3,3]
    lower=world[names['hand.'+side],:3,3]-world[names['c_forearm_stretch.'+side],:3,3]
    upper/=np.linalg.norm(upper);lower/=np.linalg.norm(lower)
    z=np.cross(upper,lower)
    if np.linalg.norm(z)<.03:return None
    z/=np.linalg.norm(z)
    result={}
    for group,y in [('arm',upper),('forearm',lower)]:
     x=np.cross(y,z);x/=np.linalg.norm(x);result[group]=np.stack([x,y,np.cross(x,y)],axis=1)
    return result
   sf=elbow_frames(self.snames,self.sw);tf=elbow_frames(self.tnames,self.tw)
   if sf and tf:
    for group in ['arm','forearm']:corrections[group]=sf[group]@tf[group].T
   # Match both palm direction and normal. A one-vector wrist swing leaves
   # different character palm rolls in every transferred hand motion.
   def palm_frame(names,world):
    origin=world[names['hand.'+side],:3,3]
    middle=world[names['middle1.'+side],:3,3]-origin
    index=world[names['index1.'+side],:3,3]-origin
    pinky=world[names['pinky1.'+side],:3,3]-origin
    y=middle/np.linalg.norm(middle)
    z=np.cross(index,pinky)*(1 if side=='l' else -1)
    z/=np.linalg.norm(z);x=np.cross(y,z);x/=np.linalg.norm(x)
    return np.stack([x,y,np.cross(x,y)],axis=1)
   if all(n+side in self.snames and n+side in self.tnames for n in ['hand.','middle1.','index1.','pinky1.']):
    corrections['hand']=palm_frame(self.snames,self.sw)@palm_frame(self.tnames,self.tw).T

   for n in self.names:
    if not n.endswith('.'+side):continue
    group='arm' if n.startswith('c_arm') else 'forearm' if n.startswith('c_forearm') else 'thigh' if n.startswith('c_thigh') else 'leg' if n.startswith('c_leg') else 'hand' if re.match(r'^(hand|c_index|c_middle|c_ring|c_pinky|c_thumb|index|middle|ring|pinky|thumb)',n) else None
    if group in corrections:self.segment_alignment[n]=corrections[group]
  self.logical={}
  for n,j in self.tnames.items():
   p=self.target['nodes'][self.tp[j]].get('name') if j in self.tp else None
   side=n[-1]
   if n=='root.x':p=None
   elif n in spine:p=spine[spine.index(n)-1] if spine.index(n)>0 else 'root.x'
   elif re.match(r'^spine_\d+\.x$',n) and 'c_'+n.replace('.x','_bend.x') in self.tnames:p='c_'+n.replace('.x','_bend.x')
   elif n.startswith('c_thigh'):p='root.x' if n=='c_thigh_twist.'+side else 'c_thigh_twist.'+side
   elif n.startswith('c_leg'):p='c_thigh_twist.'+side if n=='c_leg_stretch.'+side else 'c_leg_stretch.'+side
   elif n.startswith('foot.'):p='c_leg_stretch.'+side
   elif n.startswith('shoulder.'):p=self.chest
   elif n.startswith('c_arm'):p='shoulder.'+side if n=='c_arm_twist.'+side else 'c_arm_twist.'+side
   elif n.startswith('c_forearm'):p='c_arm_twist.'+side if n=='c_forearm_stretch.'+side else 'c_forearm_stretch.'+side
   elif n.startswith('hand.'):p='c_forearm_stretch.'+side
   elif n in ['neck.x','subneck_twist_1.x','c_neck_01.x']:p=self.chest
   elif n=='head.x':p='neck.x'
   elif p not in self.tnames:p='head.x' if any(k in n for k in ['eye','lid','brow','lip','cheek','jaw','nose','skull','ear','tong','teeth','chin','Head','Hair','Ponytail','spline']) else 'root.x'
   self.logical[n]=p if p in self.tnames and p!=n else None
  self.order=[]
  def visit(n,trail=()):
   if n in self.order:return
   if n in trail:raise ValueError('Logical rig cycle '+n)
   if self.logical[n]:visit(self.logical[n],trail+(n,))
   self.order.append(n)
  for n in self.names:visit(n)
  self.secondaries=[]
  if _secondary:
   # Namespaced full-body attachments use the same performance, reconstructed
   # from their own joint offsets. Hair/skirt chains continue to follow their
   # attachment parent; they are not separate humanoids.
   prefixes=[n[:-len('root.x')] for n in self.names if n.endswith(':root.x') and n[:-len('root.x')]+'hand.l' in self.tnames]
   for prefix in prefixes:
    sub=copy.deepcopy(target)
    for skin in sub['skins']:skin['joints']=[j for j in skin['joints'] if target['nodes'][j]['name'].startswith(prefix)]
    sub['skins']=[s for s in sub['skins'] if s['joints']]
    for node in sub['nodes']:
     if node.get('name','').startswith(prefix):node['name']=node['name'][len(prefix):]
    child=Retarget(source,sub,_secondary=False);self.secondaries.append(child)
    for name in child.names:self.mapping[prefix+name]=child.mapping[name]
 def world(self,sw):
  # sw: frames x all source nodes x 4 x 4. Apply rotations, then reconstruct
  # joint positions from the target character's own anatomical offsets.
  f=len(sw);dest=np.repeat(self.tw[None],f,axis=0);sd=rot(sw)@self.sri;td={}
  for n in self.order:
   j=self.tnames[n];p=self.logical[n];mapped=self.mapping[n]
   delta=sd[:,self.snames[mapped]]@self.segment_alignment.get(n,np.eye(3)) if mapped else td[p] if p else np.repeat(np.eye(3)[None],f,axis=0)
   td[n]=delta;dest[:,j,:3,:3]=delta@self.tr[j]
   if p:
    pj=self.tnames[p];dest[:,j,:3,3]=dest[:,pj,:3,3]+np.einsum('fij,j->fi',td[p],self.tw[j,:3,3]-self.tw[pj,:3,3])
   else:dest[:,j,:3,3]=self.tw[j,:3,3]+(sw[:,self.snames['root.x'],:3,3]-self.sw[self.snames['root.x'],:3,3])*self.scale
  for child in self.secondaries:
   own=child.world(sw);indices=list(child.tnames.values());dest[:,indices]=own[:,indices]
  return dest
 def local(self,world):
  return np.array([np.linalg.inv(world[:,self.tp[j]])@world[:,j] if j in self.tp else world[:,j] for j in self.tnames.values()]).transpose(1,0,2,3)
 def clip(self,data):
  frames=np.array(data['frames']).reshape(-1,len(data['bones']),3,4);count=len(frames);loc=np.repeat(self.sl[None],count,axis=0)
  for bi,n in enumerate(data['bones']):loc[:,self.snames[n],:3,:]=frames[:,bi]
  world=np.empty_like(loc);done=set()
  def visit(j):
   if j in done:return
   if j in self.sp:visit(self.sp[j]);world[:,j]=world[:,self.sp[j]]@loc[:,j]
   else:world[:,j]=loc[:,j]
   done.add(j)
  for j in range(len(self.sl)):visit(j)
  target_world=self.world(world);target=self.local(target_world);value={**data,'bones':self.names,'frames':np.round(target[:,:,:3,:],7).reshape(count,-1).tolist()}
  points=target_world[:,list(self.tnames.values()),:3,3];margin=.12*self.scale
  value['bounds']=[np.round(points.min(axis=(0,1))-margin,5).tolist(),np.round(points.max(axis=(0,1))+margin,5).tolist()]
  if value.get('gesture'):value['gesture']['anchor']=self.chest
  if value.get('retargeting',{}).get('forwardSpeed'):value['retargeting']['forwardSpeed']*=self.scale
  return value
 def pose(self,p):
  w=self.sw.copy()
  for n,d in p['deltas'].items():
   if n in self.snames:w[self.snames[n]]=np.array(d)@w[self.snames[n]]
  result=self.world(w[None])[0];deltas={}
  if p['group']!='body':
   # A hand preset is a local finger layer. The full retargeted rest pose
   # includes forearm alignment, but the receiving hand is already posed by
   # its body clip. Baking that alignment into the finger roots applies it
   # a second time and stretches the fingers away from their knuckles.
   # Donor hand assets also contain the donor's arms. Those absolute arm
   # locations do not belong to a finger overlay on a different body pose.
   selected={j for n,j in self.tnames.items() if self.mapping[n] in p['deltas'] and re.match(r'^(c_)?(index|middle|ring|pinky|thumb)',n.split(':')[-1])}
   posed=self.tw.copy();done=set()
   def visit(j):
    if j in done:return
    parent=self.tp.get(j)
    if parent in selected:visit(parent)
    local=np.linalg.inv(result[parent])@result[j] if parent is not None else result[j]
    posed[j]=(posed[parent] if parent is not None else np.eye(4))@local
    done.add(j)
   for j in selected:visit(j)
   result=posed
  for n,j in self.tnames.items():
   if p['group']!='body' and j not in selected:continue
   m=result[j]@np.linalg.inv(self.tw[j])
   if not np.allclose(m,np.eye(4),atol=1e-6):deltas[n]=np.round(m,7).tolist()
  return {**p,'deltas':deltas}

def prop_pose_variants(lib,cfg,retarget):
 # Mirrored grips use the target's own rest transforms. A two-weapon grip
 # starts from the neutral torso and mirrors the held arm in chest space.
 mirror=np.diag([-1,1,1,1]);poses={p['id']:p for p in lib['poses']}
 for entry in cfg.get('propPoseVariants',[]):
  base=poses[entry['source']];pose=copy.deepcopy(base);pose.update(id=entry['id'],label=entry['label'])
  swap=lambda n:n[:-2]+('.l' if n.endswith('.r') else '.r') if n.endswith(('.l','.r')) else n
  if entry['kind']=='mirror':pose['deltas']={swap(n):(mirror@np.array(t)@mirror).round(7).tolist() for n,t in base['deltas'].items()}
  elif entry['kind']=='dual':
   pose['deltas']={}
   rigs=[('',retarget)]+[(n[:-len('root.x')],child) for n,child in zip([n for n in retarget.names if n.endswith(':root.x')],retarget.secondaries)]
   for prefix,rig in rigs:
    chest=prefix+rig.chest;rest=retarget.tw[retarget.tnames[chest]];posed=np.array(base['deltas'].get(chest,np.eye(4)))@rest;rebase=rest@np.linalg.inv(posed)
    angle=-float(entry.get('outwardYaw',0));c,s=np.cos(angle),np.sin(angle);turn=np.eye(4);turn[:3,:3]=[[c,0,s],[0,1,0],[-s,0,c]]
    upper=prefix+'c_arm_twist.r';pivot=(rebase@np.array(base['deltas'][upper])@retarget.tw[retarget.tnames[upper]])[:3,3];turn[:3,3]=pivot-turn[:3,:3]@pivot
    for n,t in base['deltas'].items():
     local=n[len(prefix):]
     if n.startswith(prefix) and ':' not in local and n.endswith('.r') and re.match(r'^(c_)?(arm|forearm|hand|index|middle|ring|pinky|thumb)|^shoulder',local):
      d=rebase@np.array(t)
      if not local.startswith('shoulder'):d=turn@d
      pose['deltas'][n]=d.round(7).tolist();pose['deltas'][swap(n)]=(mirror@d@mirror).round(7).tolist()
  else:raise ValueError('Unknown prop pose variant')
  lib['poses']=[p for p in lib['poses'] if p['id']!=pose['id']]+[pose]

def main():
 ap=argparse.ArgumentParser();ap.add_argument('config');ap.add_argument('source');ap.add_argument('output');ap.add_argument('--tia',required=True);ap.add_argument('--motions-only',action='store_true');args=ap.parse_args()
 cfg=json.loads(Path(args.config).read_text());source=Path(args.source);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
 doc,binary=glb.read_glb(out/'model.glb' if args.motions_only else source);audit=json.loads((out/'source-audit.json' if args.motions_only else source.with_suffix('.audit.json')).read_text());tia=Path(args.tia);donor=json.loads((tia/'runtime/resident/model.gltf').read_text());retarget=Retarget(donor,doc)
 lib={'version':1,'rest':{n:retarget.tl[j].tolist() for n,j in retarget.tnames.items()},'poses':[retarget.pose(p) for p in donor['extras']['openclamAvatar']['poses']],**{k:cfg.get(k,[]) for k in ['outfits','props','accessories']},'defaultOutfit':cfg['defaultOutfit'],'channelAliases':{},'expressions':[]}
 if cfg.get('clothClearance'):lib['clothClearance']=cfg['clothClearance']
 if cfg.get('propRestOffsets'):lib['propRestOffsets']=cfg['propRestOffsets']
 prop_pose_variants(lib,cfg,retarget)
 if 'playback'in donor['extras']['openclamAvatar']:lib['playback']=donor['extras']['openclamAvatar']['playback']
 shapes=list(dict.fromkeys(n for m in doc['meshes'] for n in m.get('extras',{}).get('targetNames',[])))
 for name in shapes:
  if re.match(r'^(Brow|Eye|Mth|Mouth|Smile|Sneer|Pucker)',name,re.I):lib['expressions'].append({'id':'original-'+re.sub('[^a-z0-9]+','-',name.lower()).strip('-'),'label':name.strip('-'),'region':'eyes' if 'eye' in name.lower() else 'brow' if 'brow'in name.lower() else 'mouth','weights':{name:1}})
 if cfg['slug']!='seraphim':
  recipes={'aa':'Viseme Ah','ih':'Viseme Ee','ou':'Viseme Oo','E':'Viseme Eh','oh':'Viseme Oh','CH':'Viseme Ch','FF':'Viseme Ff','PP':'Viseme B','DD':'Viseme C','kk':'Viseme C','SS':'Viseme C','nn':'Viseme L','RR':'Viseme C','TH':'Viseme Th'}
  for channel,prefix in recipes.items():lib['channelAliases']['viseme:'+channel]=[s for s in shapes if s.startswith(prefix)]
  aliases={'eyeBlinkLeft':['Eye closed L','L Eye Closed  1'],'eyeBlinkRight':['Eye closed R','R Eye Closed 1'],'blink':['Eyes Closed','Eyes Closed 1'],'browInnerUp':['Brows Up'],'jawOpen':['Mouth open wide-','Mouth Open'],'smile':['Mouth smile closed','Smile closed'],'sorrow':['Mouth sad','Mouth Sad']}
  lib['channelAliases'].update({k:[n for n in v if n in shapes] for k,v in aliases.items()})
 lib['characterId']=cfg['slug']
 lib['preserveVolumeNodes']=[m['name'] for m in audit.get('meshes',[]) if m.get('preserveVolume')]
 doc.setdefault('extras',{})['openclamAvatar']=lib
 clothing_fit(doc,binary,cfg)
 # Keep only runtime metadata, not Blender authoring properties.
 for n in doc['nodes']:n.pop('extras',None)
 for m in doc['materials']:
  m['extras']={k:v for k,v in m.get('extras',{}).items() if k.startswith('avatar')};pbr=m.setdefault('pbrMetallicRoughness',{})
  if any(m['name'] in o.get('bodyMasks',{}) for o in cfg['outfits']):m['extras']['avatarBodyMasks']=True
  if m['extras'].get('avatarSurface')=='cornea':pbr.update(baseColorFactor=[1,1,1,.06],metallicFactor=0,roughnessFactor=.025);m['alphaMode']='BLEND';m['doubleSided']=False;pbr.pop('baseColorTexture',None)
  elif m['extras'].get('avatarSurface')=='hair':pbr['metallicFactor']=0;m['alphaMode']='BLEND';m['doubleSided']=True
  elif m.get('alphaMode')=='BLEND':m['alphaMode']='MASK';m['alphaCutoff']=.35;m['doubleSided']=True
  if m['name']=='Hair 01' or 'haircap' in m['name'].lower():
   m['extras']['avatarPortrait']='scalp';m['alphaMode']='MASK';m['alphaCutoff']=.15
  if m['name'].lower() in ['eyebrows','eyebrow','lashes','eyelashes','eyelashes.flip']:
   m['extras']['avatarPortrait']='lash';m['alphaMode']='BLEND';m.pop('alphaCutoff',None)
 # Repair unweighted vertices in the same way as the existing avatars.
 for node in doc['nodes']:
  if 'mesh'not in node or 'skin'not in node:continue
  joints=doc['skins'][node['skin']]['joints'];names=[doc['nodes'][j]['name'] for j in joints]
  if 'neutral_bone'not in names:continue
  for p in doc['meshes'][node['mesh']]['primitives']:
   if 'JOINTS_0'in p['attributes']:
    a=glb.array(doc,binary,p['attributes']['JOINTS_0']);a[a==names.index('neutral_bone')]=names.index('root.x')
 glb.write_glb(out/'model.glb',doc,binary)
 manifest={'slug':cfg['slug'],'name':cfg['name'],'renderer':'3d','model':'model.glb','pose':'relaxed','yaw':0,'assetRevision':cfg['slug']+'-original-v1','visemes':['sil','PP','FF','TH','DD','kk','CH','SS','nn','RR','aa','E','ih','oh','ou']}
 if (out/'appearance/index.json').exists():manifest['appearance']='appearance/index.json'
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
 mdst=out/'runtime/motions';mdst.mkdir(parents=True,exist_ok=True);mlib=json.loads((tia/'runtime/motions/library.json').read_text())
 for i,entry in enumerate(mlib['clips']):
  path=tia/'runtime/motions'/entry['file'];path=path if path.exists() else Path(str(path)+'.deflate');raw=path.read_bytes();raw=zlib.decompress(raw,-15) if path.suffix=='.deflate' else raw
  clip=retarget.clip(json.loads(raw));data=json.dumps(clip,separators=(',',':')).encode();compress=zlib.compressobj(7,zlib.DEFLATED,-15);(mdst/(entry['id']+'.json.deflate')).write_bytes(compress.compress(data)+compress.flush());entry['file']=entry['id']+'.json'
  if i%10==0:print(cfg['slug'],'MOTIONS',i,len(mlib['clips']),flush=True)
 (mdst/'library.json').write_text(json.dumps(mlib,indent=2));audit.update(runtimeJoints=len(retarget.names),motionClips=len(mlib['clips']),expressions=len(lib['expressions']),originalFaceShape=True,retargetScale=retarget.scale)
 (out/'source-audit.json').write_text(json.dumps(audit,indent=2));print('PREPARED',out,flush=True)
if __name__=='__main__':main()
