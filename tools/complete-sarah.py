"""Complete Sarah from the existing ARP export and original accessory export.

Requires numpy and Pillow. Run with --help for inputs. Source files are read-only.
The existing face, morphs and inverse bind matrices are retained byte-for-byte.
"""
import argparse, copy, hashlib, io, json, re, shutil, struct
from pathlib import Path
import numpy as np
from PIL import Image

def read_glb(path):
    b = Path(path).read_bytes()
    assert b[:4] == b'glTF' and struct.unpack_from('<I', b, 4)[0] == 2
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20+n]), bytearray(b[28+n:])

def write_glb(path, doc, binary):
    while len(binary) % 4: binary.append(0)
    doc['buffers'] = [{'byteLength': len(binary)}]
    j = json.dumps(doc, separators=(',', ':')).encode()
    j += b' ' * (-len(j) % 4)
    Path(path).write_bytes(struct.pack('<III', 0x46546c67, 2, 28+len(j)+len(binary)) + struct.pack('<II',len(j),0x4e4f534a) + j + struct.pack('<II',len(binary),0x004e4942) + binary)

def array(doc, binary, index):
    a = doc['accessors'][index]; v = doc['bufferViews'][a['bufferView']]
    dtype = {5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]
    width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    size = np.dtype(dtype).itemsize
    return np.ndarray((a['count'],width),dtype=dtype,buffer=binary,
        offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',size*width),size))

def replace_surfaces(doc,binary,path):
    surf,blob=read_glb(path)
    names=[doc['nodes'][i]['name'] for i in doc['skins'][0]['joints']]
    snames=[surf['nodes'][i]['name'] for i in surf['skins'][0]['joints']]
    remap=np.array([names.index(n) for n in snames])
    np.testing.assert_allclose(array(doc,binary,doc['skins'][0]['inverseBindMatrices'])[remap],
        array(surf,blob,surf['skins'][0]['inverseBindMatrices']),atol=1e-6,rtol=0)
    if 'neutral_bone' in snames:remap[snames.index('neutral_bone')]=names.index('root.x')
    seen=set();ao=len(doc['accessors']);vo=len(doc['bufferViews']);mo=len(doc['meshes']);bo=len(binary)
    mats={m['name']:i for i,m in enumerate(doc['materials'])}
    for mesh in surf['meshes']:
        for p in mesh['primitives']:
            for key,idx in p['attributes'].items():
                if key.startswith('JOINTS_') and idx not in seen:
                    a=array(surf,blob,idx);a[:]=remap[a];seen.add(idx)
            p['attributes']={k:v+ao for k,v in p['attributes'].items()}
            if 'indices' in p:p['indices']+=ao
            for t in p.get('targets',[]):
                for key in t:t[key]+=ao
            p['material']=mats[surf['materials'][p['material']]['name']]
    for a in surf['accessors']:
        if 'bufferView' in a:a['bufferView']+=vo
        for item in a.get('sparse',{}).values():
            if isinstance(item,dict) and 'bufferView' in item:item['bufferView']+=vo
    for v in surf['bufferViews']:v['byteOffset']=v.get('byteOffset',0)+bo;v['buffer']=0
    for node in surf['nodes']:
        if 'mesh' not in node:continue
        target=next(n for n in doc['nodes'] if n.get('name')==node['name'])
        old=doc['meshes'][target['mesh']];new=surf['meshes'][node['mesh']]
        assert old.get('extras',{}).get('targetNames',[])==new.get('extras',{}).get('targetNames',[]),'Original morph names changed'
        if 'weights' in old:new['weights']=old['weights']
        target['mesh']=node['mesh']+mo
    binary.extend(blob);doc['accessors'].extend(surf['accessors']);doc['bufferViews'].extend(surf['bufferViews']);doc['meshes'].extend(surf['meshes'])
    if surf.get('extras', {}).get('avatarSarahPelvisWeights'):
        doc.setdefault('extras', {})['avatarSarahPelvisWeights'] = copy.deepcopy(surf['extras']['avatarSarahPelvisWeights'])

def compact(doc,binary):
    # Remove the superseded coarse geometry and duplicated face buffers.
    used=sorted({n['mesh'] for n in doc['nodes'] if 'mesh' in n})
    for n in doc['nodes']:
        if 'mesh' in n:n['mesh']=used.index(n['mesh'])
    doc['meshes']=[doc['meshes'][i] for i in used]
    ais=set()
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            ais.update(p['attributes'].values());ais.update([p['indices']] if 'indices' in p else [])
            for t in p.get('targets',[]):ais.update(t.values())
    for s in doc['skins']:ais.add(s['inverseBindMatrices'])
    used=sorted(ais);remap={old:i for i,old in enumerate(used)}
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            p['attributes']={k:remap[v] for k,v in p['attributes'].items()}
            if 'indices' in p:p['indices']=remap[p['indices']]
            for t in p.get('targets',[]):
                for k in t:t[k]=remap[t[k]]
    for s in doc['skins']:s['inverseBindMatrices']=remap[s['inverseBindMatrices']]
    doc['accessors']=[doc['accessors'][i] for i in used]
    containers=list(doc['images'])
    for a in doc['accessors']:
        containers.append(a);containers.extend(v for v in a.get('sparse',{}).values() if isinstance(v,dict))
    used=sorted({c['bufferView'] for c in containers if 'bufferView' in c});remap={old:i for i,old in enumerate(used)}
    for c in containers:
        if 'bufferView' in c:c['bufferView']=remap[c['bufferView']]
    packed=bytearray();views=[]
    for i in used:
        v=doc['bufferViews'][i];start=v.get('byteOffset',0);chunk=binary[start:start+v['byteLength']]
        while len(packed)%4:packed.append(0)
        v['byteOffset']=len(packed);v['buffer']=0;packed.extend(chunk);views.append(v)
    doc['bufferViews']=views
    return packed

def fit_masks(doc):
    """Hide only covered underlayers, in the source mesh's rest coordinates.

    Sara's independently weighted garments cross the skin at extreme poses.
    Keeping covered skin and shirt shoulders out of the draw is the usual
    real-time wardrobe solution; all original geometry remains available.
    """
    for m in doc['materials']:
        if m['name'] in ['Top_Sara01A_M.001','Top_Ac_Tshtt']:m.setdefault('extras',{})['avatarBodyMasks']=True
    lib=doc['extras']['openclamAvatar']
    for outfit in lib['outfits']:
        masks={}
        if outfit['id'] in ['tactical','casual']:
            masks['Top_Sara01A_M.001']=[{'min':[-.23,.17,-1],'max':[.23,1.002,1]}]
        if outfit['id']=='tactical':
            masks['Top_Ac_Tshtt']=[{'min':[.075,1.375,-1],'max':[1,2,1]}, {'min':[-1,1.375,-1],'max':[-.075,2,1]}]
            masks['Top_Sara01A_M.001'].extend([{'min':[.13,1.1,-1],'max':[.4,1.48,1]}, {'min':[-.4,1.1,-1],'max':[-.13,1.48,1]}])
        outfit['bodyMasks']=masks

def complete(base, extras, surfaces=None):
    doc, binary = read_glb(base); extra, blob = read_glb(extras)
    skin = doc['skins'][0]; source_skin = extra['skins'][0]
    names = [doc['nodes'][i]['name'] for i in skin['joints']]
    other_names = [extra['nodes'][i]['name'] for i in source_skin['joints']]
    remap = np.array([names.index(n) for n in other_names])
    # Sharing the skin is valid only if every inverse bind matrix agrees.
    np.testing.assert_allclose(array(doc,binary,skin['inverseBindMatrices'])[remap],
        array(extra,blob,source_skin['inverseBindMatrices']),atol=1e-6,rtol=0)
    seen = set()
    for mesh in extra['meshes']:
        for p in mesh['primitives']:
            for semantic, index in p['attributes'].items():
                if semantic.startswith('JOINTS_') and index not in seen:
                    a = array(extra,blob,index); a[:] = remap[a]; seen.add(index)
    offsets = {k: len(doc.get(k, [])) for k in ['bufferViews','accessors','images','textures','samplers','materials','meshes']}
    boff = len(binary); binary.extend(blob)
    for view in extra.get('bufferViews',[]): view['buffer'] = 0; view['byteOffset'] = view.get('byteOffset',0)+boff
    for a in extra.get('accessors',[]):
        if 'bufferView' in a: a['bufferView'] += offsets['bufferViews']
        for part in a.get('sparse',{}).values():
            if isinstance(part,dict) and 'bufferView' in part: part['bufferView'] += offsets['bufferViews']
    for image in extra.get('images',[]): image['bufferView'] += offsets['bufferViews']
    for texture in extra.get('textures',[]):
        if 'source' in texture: texture['source'] += offsets['images']
        if 'sampler' in texture: texture['sampler'] += offsets['samplers']
        for ext in texture.get('extensions',{}).values():
            if 'source' in ext: ext['source'] += offsets['images']
    def texture_indices(value):
        if not isinstance(value,dict): return
        for key, item in value.items():
            if key.endswith('Texture') and isinstance(item,dict) and 'index' in item: item['index'] += offsets['textures']
            else: texture_indices(item)
    for material in extra.get('materials',[]): texture_indices(material)
    for mesh in extra['meshes']:
        for p in mesh['primitives']:
            p['attributes'] = {k: v+offsets['accessors'] for k,v in p['attributes'].items()}
            if 'indices' in p: p['indices'] += offsets['accessors']
            if 'material' in p: p['material'] += offsets['materials']
    for key in offsets: doc.setdefault(key,[]).extend(extra.get(key,[]))
    scene = doc['scenes'][doc.get('scene',0)]
    for node in extra['nodes']:
        if 'mesh' not in node: continue
        assert not any(k in node for k in ['translation','rotation','scale','matrix']), 'Accessory export must bake transforms'
        scene['nodes'].append(len(doc['nodes']))
        doc['nodes'].append({'name':node['name'],'mesh':node['mesh']+offsets['meshes'],'skin':0})
    for key in ['extensionsUsed','extensionsRequired']:
        if extra.get(key): doc[key] = sorted(set(doc.get(key,[])+extra[key]))
    # The merged export body already contains the eye/teeth geometry and its
    # morphs. The separate source objects are Blender authoring alternatives.
    for node in doc['nodes']:
        if node.get('name') in ['Fem-A__Head_B_Sarah_Eyes','Fem-A_Teeth_Tongue']:
            node.pop('mesh',None); node.pop('skin',None)
    if surfaces:replace_surfaces(doc,binary,surfaces)
    binary=compact(doc,binary)
    for material in doc['materials']:
        name = material.get('name',''); pbr = material.setdefault('pbrMetallicRoughness',{})
        if name.startswith('Top_Sara'):
            material.setdefault('extras',{})['avatarSurface'] = 'skin'
        if name.startswith('Hed_clr'):
            material.setdefault('extras',{})['avatarSurface'] = 'cornea'
        # Hair cards and cutout cloth need depth writes to avoid seeing the
        # rear layer through the face/front layer when rotating the character.
        if name.startswith(('Whl_Ac_VDress','Top_Ac_Tshtt','Top_Ac_ChnCt','Bot_Ac_BknBrzl')):
            material.update(alphaMode='MASK',alphaCutoff=.35,doubleSided=True)
        if name.startswith('Hed_Hair'):
            material.update(alphaMode='BLEND',doubleSided=True)
            pbr.update(metallicFactor=0,roughnessFactor=.42)
            material['extensions'] = {'KHR_materials_ior':{'ior':1.55}, 'KHR_materials_specular':{'specularFactor':.5}}
    lib = doc['extras']['openclamAvatar']
    assert len(lib['rest']) == 157 and len(lib['poses']) == 69
    top='Fem-A_Top_Ac_Tshtt'; coat='Fem-A_Top_Ac_ChnCt'; dress='Fem-A_Whl_Ac_VDress'
    pants=['Fem-A_Bot_Ac_ChnPnts_1','Fem-A_Bot_Ac_ChnPnts_2']
    bikini=['Fem-A_Bot_Ac_BknBrzl_1','Fem-A_Bot_Ac_BknBrzl_2']
    sandals='Fem-A_Fot_Ac_Sndlhl'; boots='Fem-A_Fot_Ac_Chnhl'; straps='Fem-A_Fot_Ac_Strphl'
    recipes=[('dress','Dress & sandals',[dress,sandals]),('dress-straps','Dress & strap heels',[dress,straps]),
        ('tactical','Coat, tie top & chain pants',[top,coat,*pants,boots]),('casual','Tie top, chain pants & sandals',[top,*pants,sandals]),
        ('summer','Tie top, Brazilian bottoms & sandals',[top,*bikini,sandals])]
    lib['defaultOutfit']='dress';lib['outfits']=[dict(id=i,label=l,nodes=n) for i,l,n in recipes]
    lib['props']=[dict(id='bag',label='Tommy shoulder bag',nodes=['Ac_Tommy_Bag']),
        dict(id='pistol',label='1911 pistol',nodes=['Weap_1911'],pose='Ps052.pistol',hands='Hndgrp_pistol'),
        dict(id='rifle',label='FN SCAR 20S',nodes=['Weap_FN-SCAR-20S.001'],pose='Ps071.rifle',hands='Hndgrp.rifle')]
    body=next(n for n in doc['nodes'] if n.get('name')=='Fem-A__Whl_BY_Sarah.export')
    shapes = doc['meshes'][body['mesh']]['extras']['targetNames']
    def expression_label(s):
        text=s.replace('Brow.','Brows · ').replace('Eye.','Eyes · ').replace('Mth.','Mouth · ')
        for short,long in [('BitLi','Lip bite'),('Sml.Cls','Closed smile'),('Sml.Grn','Grin'),('Sml.Op','Open smile '),('Sml.Sp','Smile variant'),('Sml.Tng','Smile with tongue'),('Puc','Pucker'),('Tng','Tongue'),('Op','Open '),('Sp','Variant')]:
            text=re.sub(r'Op(?=[.\d-]|$)',long,text) if short=='Op' else text.replace(short,long)
        return 'Original · '+re.sub(r'[.\-]',' ',text)
    lib['expressions']=[dict(id='original-'+re.sub('[^a-z0-9]+','-',s.lower()).strip('-'),label=expression_label(s),
        weights={s:1},region='mouth' if s.startswith('Mth.') else 'eyes' if s.startswith('Eye.') else 'brow')
        for s in shapes if s.startswith(('Brow.','Eye.','Mth.'))]
    lib['accessories']=[dict(id='earrings',label='Original hoop earrings',nodes=['Fem-A_Ac_Errng02']),dict(id='none',label='No earrings',nodes=[])]
    lib['defaultAccessory']='earrings'
    fit_masks(doc)
    return doc,binary

def build_colors(doc,binary,textures,out):
    packdir=out/'appearance'/'sarah-original';packdir.mkdir(parents=True,exist_ok=True)
    files={};items=[]
    specs=[('skin','Top_Sara01A_M.001','Top_Sara01[AC]_alb_.*'),('eyes','Hed_Eye_M.001','Hed_Eye_Alb_.*'),
        ('hair','Hed_Hair-21_flp','(?:Hed_Har01A_Alb_.*|Hair_long_blond01|Hair-brb-05)'),
        ('dress','Whl_Ac_VDress','Dress-V-alb-.*'),('coat','Top_Ac_ChnCt','Chain-Coat\\.(?:WHITE|black|PIN|STRIPE|BROWN|PEACH)'),
        ('pants','Bot_Ac_ChnPnts','Chain-pants-(?:PEACH|WHITE|BROWN|BLACK|PIN|STRIPE)'),
        ('top','Top_Ac_Tshtt','TshirtTie-(?:white|black|peach)'),('bottoms','Bot_Ac_BknBrzl','BottomTie-alb-.*'),
        ('sandals','Fot_Ac_Sndlhl','Sandal_Heel_alb_.*'),('boots','Fot_Ac_Chnhl','Mid-boot-(?:07-.*|alb0[16].*)'),
        ('strap-heels','Fot_Ac_Strphl','Mid-boot-(?:07-.*|alb0[16].*)'),('bag','Ac_Tommy_Bag','ommybag-(?:light-.*|white)')]
    for slot,material_name,pattern in specs:
        mat=next(m for m in doc['materials'] if m['name']==material_name)
        ti=mat['pbrMetallicRoughness'].get('baseColorTexture',{}).get('index')
        alpha=None
        if ti is not None and mat.get('alphaMode') in ['MASK','BLEND']:
            tex=doc['textures'][ti]; image=doc['images'][tex.get('source',tex.get('extensions',{}).get('EXT_texture_webp',{}).get('source'))]
            v=doc['bufferViews'][image['bufferView']];start=v.get('byteOffset',0)
            im=Image.open(io.BytesIO(binary[start:start+v['byteLength']])).convert('RGBA');alpha=im.getchannel('A')
        for path in sorted(textures.iterdir()):
            if not re.fullmatch(pattern,path.stem,re.I) or path.suffix.lower() not in ['.png','.jpg','.jpeg']:continue
            im=Image.open(path).convert('RGBA');im.thumbnail((2048,2048),Image.Resampling.LANCZOS)
            if alpha:im.putalpha(alpha.resize(im.size,Image.Resampling.LANCZOS))
            name=f'{slot}-{len(items):03}.png';dest=packdir/name;im.save(dest,optimize=True)
            raw=dest.read_bytes();files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
            stem=path.stem
            if slot=='skin':label=stem.rsplit('_',1)[-1].replace('med','Medium').title()+' · '+('A' if '01A' in stem else 'C')
            elif slot=='eyes':label=stem.split('_')[-1]
            elif slot=='hair':label={'Hair-brb-05':'Light brown','Hair_long_blond01':'Long blonde'}.get(stem,stem.split('_')[-1])
            elif slot=='dress':label=stem.removeprefix('Dress-V-alb-')
            elif slot=='coat':label=stem.split('.')[-1]
            elif slot in ['boots','strap-heels']:label=stem.replace('Mid-boot-07-','').replace('Mid-boot-alb06-beige','Beige').replace('Mid-boot-alb01','Original brown')
            elif slot=='bag':label=stem.removeprefix('ommybag-').replace('light-','')
            else:label=re.split('[-_]',stem)[-1]
            fixes={'Brn01':'Brown 01','Drk01':'Dark brown','Grn01':'Green 01','Grn02':'Green 02','Hazl01':'Hazel','Blon01':'Blonde','Brun01':'Brunette','LACK':'Black','PIN':'Pinstripe','STRIPE':'Stripes','TOUPE':'Taupe','poink':'Pink','blackb':'Black','peachb':'Peach','whiteb':'White'}
            label=fixes.get(label,label).replace('-',' ').title()
            label=re.sub(r'([a-z])([0-9])',r'\1 \2',label)
            items.append(dict(id=f'{slot}-{len(items):03}',kind='texture',slot=slot,label=label,material=material_name,file=name))
    pack=dict(id='sarah-original',directory='sarah-original',label='Sarah · original colors',files=files,items=items)
    (out/'appearance'/'index.json').write_text(json.dumps({'version':1,'packs':[pack]},indent=1))
    return len(items)

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base',required=True,type=Path);ap.add_argument('--extras',required=True,type=Path)
    ap.add_argument('--textures',required=True,type=Path);ap.add_argument('--output',required=True,type=Path)
    ap.add_argument('--surfaces',type=Path,help='Subdivided source mesh export from export-sarah-surfaces.py')
    ap.add_argument('--motions',required=True,type=Path)
    args=ap.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    doc,binary=complete(args.base,args.extras,args.surfaces)
    colors=build_colors(doc,binary,args.textures,out)
    write_glb(out/'model.glb',doc,binary)
    manifest={'slug':'sarah','name':'Sarah','renderer':'3d','model':'model.glb','pose':'relaxed','yaw':0,
        'appearance':'appearance/index.json','assetRevision':'sarah-original-complete-v1',
        'visemes':['sil','PP','FF','TH','DD','kk','CH','SS','nn','RR','aa','E','ih','oh','ou']}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=1))
    shutil.copytree(args.motions,out/'runtime'/'motions',dirs_exist_ok=True)
    lib=doc['extras']['openclamAvatar']
    report=dict(meshes=len(doc['meshes']),outfits=len(lib['outfits']),props=len(lib['props']),poses=len(lib['poses']),
        expressions=len(lib['expressions']),colors=colors,removedDuplicateObjects=['Fem-A__Head_B_Sarah_Eyes','Fem-A_Teeth_Tongue'],
        preserved='Original design, 145 morph targets and 157 driven bones; inverse bind matrices verified. One subdivision level baked into the body and major garments.' if args.surfaces else 'Original body, 145 morph targets and 157 driven bones; inverse bind matrices verified.',
        authoringAlternatives='Separate body/face parts, split bikini strap rigs, rig controllers and reference meshes are not duplicate runtime layers.',
        accessoryMotion='Bag follows shoulder; weapons follow right hand; original hair and earrings follow head. Blender secondary dynamics are not simulated.')
    (out/'source-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__': main()
