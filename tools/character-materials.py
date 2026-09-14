"""Flatten authored color blends and retain original alternative texture choices."""
import argparse,copy,hashlib,importlib.util,io,json,re
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter
spec=importlib.util.spec_from_file_location('character_glb',Path(__file__).with_name('complete-sarah.py'));g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)

def linear(v):return np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4)
def srgb(v):return np.where(v<=.0031308,v*12.92,1.055*np.maximum(v,0)**(1/2.4)-.055)
def pad_normal_texture(image):
 # Normal-map alpha is not coverage in glTF. Black transparent texels must
 # not become inward-pointing normals when bilinear/mipmap filtering reaches
 # a strand edge. Extend nearby vectors into unused texels, leaving every
 # authored, nontransparent texel untouched. A flat normal fills distant gaps.
 rgba=np.array(image.convert('RGBA'));missing=(rgba[:,:,3]==0)&np.all(rgba[:,:,:3]==0,axis=2)
 if not np.any(missing):return image
 rgb=rgba[:,:,:3].copy();rgb[missing]=0
 weight=np.array(Image.fromarray(np.uint8(~missing)*255).filter(ImageFilter.BoxBlur(8)),dtype=np.float32)
 average=np.array(Image.fromarray(rgb).filter(ImageFilter.BoxBlur(8)),dtype=np.float32)
 padding=np.uint8(np.clip(average*255/np.maximum(weight[:,:,None],1),0,255)+.5)
 padding[weight==0]=[128,128,255];rgb[missing]=padding[missing]
 return Image.fromarray(rgb,'RGB')
def friendly_choices(pack):
 # Persisted appearance keys use simple identifiers; source material names may
 # contain spaces, punctuation and internal authoring names.
 slots={'tank03':'sports-bra','dress01':'dress','material.006':'flats','panties05':'underwear','shorts-05-sports':'sports-shorts','shorts-05':'casual-shorts','tank02sports':'workout-top','tank02':'casual-top','gold':'jewelry-metal','gem':'jewelry-stones','material.010':'underwear','flats-w-ribbon':'shoes','spaghetti_tank':'tank-top','cloth top & skirt':'cloth-top','sweater top':'zip-top','body-suit.002':'bodysuit-trim','brow_lash':'brows-and-lashes','hed_tet01_m':'teeth','seraphim_base_udim':'armor-base','seraphim_trim_color_udim':'armor-trim','seraphim_armor_color_udim':'armor-plates','swar_base_udim':'armor-details','seraphim_handgun':'handgun','spacelegs':'flight-leggings','spacejumpsuit':'flight-suit','unica6':'unica-revolver'}
 used={}
 for item in pack['items']:
  raw=item.get('sourceLabel',item['label']);item['sourceLabel']=raw
  item['slot']=slots.get(item['slot'],re.sub('[^a-z0-9]+','-',item['slot'].lower()).strip('-'))
  if item['slot']=='skin':
   label='Heavy makeup' if 'makup' in raw.lower() else 'Dark' if 'dark' in raw.lower() else 'Medium' if 'med' in raw.lower() else 'Light' if re.search('ligh|nude',raw,re.I) else 'Skin style'
  else:
   words=re.findall('darkgrey|black|blk|white|pink|peach|salmon|olive|brown|brun|brn|blonde|blue|blu|green|grn|grey|gray|hazl|red|orange|orang|beige|bronze|dark|drk|light|desert|race|wool|knit',raw,re.I)
   replacements={'blk':'black','brun':'brown','brn':'brown','blu':'blue','grn':'green','gray':'grey','hazl':'hazel','orang':'orange','drk':'dark','darkgrey':'dark grey','race':'racing'}
   words=list(dict.fromkeys(replacements.get(w.lower(),w.lower()) for w in words))
   label=' '.join(words).capitalize() if words else ('Carbon fiber' if raw.endswith('_CF') else 'Style')
  key=(item['slot'],label);used[key]=used.get(key,0)+1
  item['label']=label+(f' {used[key]}' if used[key]>1 or label in ['Style','Skin style'] else '')
 return pack
def main():
 ap=argparse.ArgumentParser();mode=ap.add_mutually_exclusive_group();mode.add_argument('--colors-only',action='store_true');mode.add_argument('--surfaces-only',action='store_true');ap.add_argument('--material',action='append',help='Restore only these materials, without rebuilding appearance choices');ap.add_argument('export');ap.add_argument('package');args=ap.parse_args();source=Path(args.export);out=Path(args.package);report=json.loads(source.with_suffix('.audit.json').read_text());doc,binary=g.read_glb(out/'model.glb')
 images={r['name']:r for r in report['images']};records={r['name']:r for r in report['materials']};appearance=out/'appearance';appearance.mkdir(exist_ok=True)
 def imagepath(name,tile=1001):
  r=images[name]
  if 'udim'in r:return Path(r['udim'].replace('<UDIM>',str(tile)))
  p=Path(r['file']);return p if p.is_absolute() else source.parent/'textures'/p
 def image_array(name,size,color=True,tile=1001):
  im=Image.open(imagepath(name,tile)).convert('RGBA');im=im.resize((size,size),Image.Resampling.LANCZOS) if im.size!=(size,size) else im
  a=np.asarray(im,dtype=np.float32)/255
  if color:a[:,:,:3]=linear(a[:,:,:3])
  return a
 def evaluate(v,size,color=True,tile=1001):
  if not v:return None
  if 'image'in v:
   a=image_array(v['image'],size,color and v.get('colorSpace','sRGB') not in ['Non-Color','Raw','Linear Rec.709'],tile)
   if v.get('output')=='Alpha':a[:,:,:3]=a[:,:,3,None]
   return a
  if 'value'in v:
   a=v['value'];a=[a]*3+[1] if isinstance(a,(float,int)) else a
   return np.broadcast_to(np.array(a,dtype=np.float32),(size,size,4)).copy()
  if 'mix'in v:
   a=evaluate(v['a'],size,color,tile);b=evaluate(v['b'],size,color,tile);f=v['factor']
   if isinstance(f,dict):
    factor=evaluate(f,size,True,tile)
    f=np.clip(np.sum(factor[:,:,:3]*np.array([.2126,.7152,.0722],dtype=np.float32),axis=2,keepdims=True),0,1)
   if a is None:return b
   if b is None:return a
   if v['mix']=='MULTIPLY':b=a*b
   elif v['mix']=='ADD':b=a+b
   elif v['mix']=='SCREEN':b=1-(1-a)*(1-b)
   result=a*(1-f)+b*f;result[:,:,3]=1;return result
  if 'source'in v:
   a=evaluate(v['source'],size,color,tile)
   if a is not None and v.get('adjust')=='brightnessContrast':
    bright=v['bright'];contrast=v['contrast'];factor=1+contrast
    a[:,:,:3]=np.maximum(0,a[:,:,:3]*factor+bright-.5*(factor-1))
   return a
 def image_names(v):
  if not v:return []
  if 'image'in v:return [v['image']]
  return sum((image_names(x) for x in v.values() if isinstance(x,dict)),[])
 def color_choice(v,name):
  # A selected albedo still passes through the author's outer tint and skin
  # mask. Only a blend between alternative albedos collapses to that choice.
  if not v:return {'image':name,'output':'Color'}
  if 'source'in v:return {**v,'source':color_choice(v['source'],name)}
  if 'mix'in v:
   if isinstance(v['factor'],dict) or not image_names(v['b']):return {**v,'a':color_choice(v['a'],name)}
   if not image_names(v['a']):return {**v,'b':color_choice(v['b'],name)}
  return {'image':name,'output':'Color'}
 def rgba(record,alternate=None,limit=4096):
  base=record['maps']['Base Color'];alpha=record['maps'].get('Alpha');tile=record.get('tile',1001)
  if alternate:base=color_choice(base,alternate)
  names=image_names(base)+image_names(alpha);size=min(limit,max([max(images[n].get('size',[1024,1024])) for n in names if n in images]+[1024]))
  if not size:size=1024
  a=evaluate(base,size,True,tile)
  if a is None:return None
  # Scalar alpha is linear, and an image's Color alpha mask is not gamma corrected.
  al=evaluate(alpha,size,False,tile)
  if al is not None:
   # White lace masks can store their entire pattern in PNG transparency.
   # Reading RGB alone turns those accessories into solid white collars.
   transparent_white=alpha.get('output')=='Color' and np.all(al[:,:,:3]>.999) and np.min(al[:,:,3])<.999
   a[:,:,3]=al[:,:,3] if transparent_white else al[:,:,0]
  else:a[:,:,3]=1
  a[:,:,:3]=srgb(a[:,:,:3]);return Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5),'RGBA')
 def add_texture(im):
  output=io.BytesIO();im.save(output,format='PNG',compress_level=3);blob=output.getvalue()
  while len(binary)%4:binary.append(0)
  vi=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(blob)});binary.extend(blob)
  ii=len(doc['images']);doc['images'].append({'bufferView':vi,'mimeType':'image/png'});ti=len(doc['textures']);doc['textures'].append({'source':ii});return ti
 def size_for(*values):
  names=sum((image_names(v) for v in values),[])
  return min(4096,max([max(images[n].get('size',[1024,1024])) for n in names if n in images]+[1]))
 def scalar(v,size,tile=1001,default=0):
  a=evaluate(v,size,True,tile)
  return np.full((size,size),default,dtype=np.float32) if a is None else np.sum(a[:,:,:3]*np.array([.2126,.7152,.0722],dtype=np.float32),axis=2)
 normal_cache={}
 def surface_maps(mat,record):
  # The graph feeding roughness matters as much as the source image. In
  # particular, Ming-Mei's hair turns an AO map into a glossy strand mask
  # using Bright/Contrast. Exporting that unadjusted image made it matte.
  maps=record['maps'];pbr=mat['pbrMetallicRoughness'];tile=record.get('tile',1001)
  rough=maps.get('Roughness');metal=maps.get('Metallic');size=size_for(rough,metal)
  if image_names(rough) or image_names(metal):
   a=np.ones((size,size,4),dtype=np.float32);a[:,:,1]=scalar(rough,size,tile,.5);a[:,:,2]=scalar(metal,size,tile,0)
   pbr['metallicRoughnessTexture']={**pbr.get('metallicRoughnessTexture',{}),'index':add_texture(Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5),'RGBA'))}
   pbr['roughnessFactor']=1;pbr['metallicFactor']=1
  else:
   pbr.pop('metallicRoughnessTexture',None);pbr['roughnessFactor']=float(scalar(rough,1,tile,.5)[0,0]);pbr['metallicFactor']=float(scalar(metal,1,tile,0)[0,0])
  spec=maps.get('Specular IOR Level',{'value':record.get('specular',.5)});size=size_for(spec)
  ext=mat.setdefault('extensions',{}).setdefault('KHR_materials_specular',{})
  if image_names(spec):
   a=np.ones((size,size,4),dtype=np.float32);a[:,:,3]=np.clip(scalar(spec,size,tile)*2,0,1)
   ext.update(specularFactor=1,specularTexture={'index':add_texture(Image.fromarray(np.uint8(a*255+.5),'RGBA'))})
  else:
   ext['specularFactor']=min(1,max(0,float(scalar(spec,1,tile,.5)[0,0])*2));ext.pop('specularTexture',None)
  mat['extensions']['KHR_materials_ior']={'ior':record.get('ior',1.5)}
  for name in ['KHR_materials_specular','KHR_materials_ior']:
   if name not in doc.setdefault('extensionsUsed',[]):doc['extensionsUsed'].append(name)
  if mat.get('normalTexture'):
   mat['normalTexture']['scale']=record.get('normalStrength',1)
   normal=maps.get('Normal',{})
   if normal and 'image' in normal:
    name=normal['image'];key=(name,tile)
    if key not in normal_cache:
     with Image.open(imagepath(name,tile)) as image:
      padded=pad_normal_texture(image)
      if padded is not image:
       padded.thumbnail((4096,4096),Image.Resampling.LANCZOS)
       normal_cache[key]=add_texture(padded)
      else:normal_cache[key]=None
    if normal_cache[key] is not None:mat['normalTexture']['index']=normal_cache[key]
  mat.setdefault('extras',{}).update(avatarSourceMetallic=pbr['metallicFactor'],avatarSourceSpecular=ext['specularFactor'])
  if record.get('kind')=='skin':
   scatter=maps.get('Subsurface Scale');size=min(2048,size_for(scatter));a=np.clip(scalar(scatter,size,tile,.5),0,1)
   # Retain the author's spatial scattering mask independently of the albedo.
   (appearance/'original').mkdir(exist_ok=True)
   Image.fromarray(np.uint8(a*255+.5),'L').save(appearance/'original'/'skin-scatter.png')
 def prune_textures():
  refs=[]
  def visit(v):
   if isinstance(v,dict):
    for k,x in v.items():
     if k.endswith('Texture') and isinstance(x,dict) and 'index'in x:refs.append(x)
     else:visit(x)
   elif isinstance(v,list):
    for x in v:visit(x)
  visit(doc['materials']);used=sorted({r['index'] for r in refs});remap={old:i for i,old in enumerate(used)}
  for r in refs:r['index']=remap[r['index']]
  doc['textures']=[doc['textures'][i] for i in used]
  # glTF permits WebP/KTX2 image sources in texture extensions, including
  # extension-only textures without an ordinary fallback source.
  sources=[v for t in doc['textures'] for v in [t,*t.get('extensions',{}).values()] if isinstance(v,dict) and 'source'in v]
  used=sorted({v['source'] for v in sources});remap={old:i for i,old in enumerate(used)}
  for v in sources:v['source']=remap[v['source']]
  doc['images']=[doc['images'][i] for i in used]
 for mat in ([] if args.colors_only else doc['materials']):
  if args.material and mat['name'] not in args.material:continue
  record=records.get(mat['name']);kind=mat.get('extras',{}).get('avatarSurface')
  if not record:continue
  if kind=='cornea':
   # Select MeshPhysicalMaterial so the desktop-safe corneal reflection can
   # use an actual IOR and specular intensity; StandardMaterial ignores both.
   mat.setdefault('extensions',{})['KHR_materials_specular']={'specularFactor':1}
   mat['extensions']['KHR_materials_ior']={'ior':1.376}
   for name in ['KHR_materials_specular','KHR_materials_ior']:
    if name not in doc.setdefault('extensionsUsed',[]):doc['extensionsUsed'].append(name)
   continue
  if mat['name']=='Sneakers':record['maps']['Base Color']={'image':'Sneakers01-alb-2.png','output':'Color'}
  im=None if args.surfaces_only else rgba(record)
  if im is not None:mat['pbrMetallicRoughness']['baseColorTexture']={**mat['pbrMetallicRoughness'].get('baseColorTexture',{}),'index':add_texture(im)};mat['pbrMetallicRoughness']['baseColorFactor']=[1,1,1,1]
  surface_maps(mat,record)
  print('MATERIAL',mat['name'],flush=True)
 if not args.colors_only:
  prune_textures();binary=g.compact(doc,binary);g.write_glb(out/'model.glb',doc,binary)
 if args.surfaces_only or args.material:return
 # Store original map choices. Each choice can update several materials, e.g.
 # all hair sections or all four UDIM armor tiles, without separate menu rows.
 mats={m['name']:m for m in doc['materials']};groups={}
 for name in mats:
  r=records.get(name)
  if not r or r.get('kind')=='cornea':continue
  slot={'skin':'Skin','iris':'Eyes','hair':'Hair'}.get(r.get('kind'),name.split('-tile-')[0])
  groups.setdefault(slot,[]).append(r)
 pack={'id':'original','directory':'original','label':'Original colors','files':{},'items':[]};color_count=0
 for slot,rs in groups.items():
  candidates=[]
  for r in rs:
   for n in r['allImages']:
    if n not in images or n in candidates:continue
    # Only authored color maps, never normals, masks, AO or previews.
    if re.search(r'normal|nrm|rough|rou_|spec|spe_|sss|bump|alpha|alp_|opacity|emmiss|emmission|_ao|_id|mask|uv|bake',n,re.I):continue
    if not re.search(r'alb|diff|color|necklace|hair dark|blonde|hair-brb|Eponine|Top_Pia|Haru-eye|Pipi_Eye|HairStrip',n,re.I):continue
    candidates.append(n)
  if len(candidates)<2:continue
  for n in candidates:
   bindings=[]
   for r in rs:
    if n not in r['allImages'] and len(rs)>1:continue
    im=rgba(r,n)
    if im is None:continue
    temp=io.BytesIO();im.save(temp,'PNG',compress_level=3);raw=temp.getvalue();file=hashlib.sha256(raw).hexdigest()[:18]+'.png';(appearance/file).write_bytes(raw);pack['files'][file]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};bindings.append({'material':r['name'],'file':file})
   if not bindings:continue
   identifier=re.sub('[^a-z0-9]+','-',slot.lower()).strip('-')+'-'+str(color_count).zfill(3)
   label=re.sub(r'\.(png|jpg|jpeg|tif)(\.\d+)?$','',n,flags=re.I).replace('<UDIM>','').strip(' .')
   pack['items'].append({'id':identifier,'kind':'texture','slot':slot.lower(),'label':label,'material':bindings[0]['material'],'file':bindings[0]['file'],'bindings':bindings});color_count+=1
  print('COLORS',slot,len(candidates),flush=True)
 if pack['items']:
  friendly_choices(pack)
  (appearance/'original').mkdir(exist_ok=True)
  for file in pack['files']:(appearance/file).replace(appearance/'original'/file)
  (appearance/'index.json').write_text(json.dumps({'version':1,'packs':[pack]},indent=2));manifest=json.loads((out/'manifest.json').read_text());manifest['appearance']='appearance/index.json';(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
 audit=json.loads((out/'source-audit.json').read_text());audit['colors']=color_count;audit['sourceColorBlendsPreserved']=True;(out/'source-audit.json').write_text(json.dumps(audit,indent=2));print('COLORS TOTAL',color_count,flush=True)
if __name__=='__main__':main()
