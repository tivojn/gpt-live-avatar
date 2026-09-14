"""Export an owned Blender character without executing or saving its source project.

Blender --factory-startup --disable-autoexec -b original.blend --python this.py -- config.json out.glb
One authored subdivision level and all source expression targets are retained.
"""
import bpy, json, sys, re, hashlib
import numpy as np
from pathlib import Path
from mathutils import Matrix
config_path,out_path=sys.argv[sys.argv.index('--')+1:];cfg=json.loads(Path(config_path).read_text());out=Path(out_path).resolve();out.parent.mkdir(parents=True,exist_ok=True)
textures=out.parent/'textures';textures.mkdir(exist_ok=True)
report={'meshes':[],'materials':[],'images':[],'warnings':[]}
if bpy.context.object and bpy.context.object.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
rig=bpy.data.objects[cfg['rig']]
def show(l):
 l.exclude=False;l.hide_viewport=False
 for c in l.children:show(c)
show(bpy.context.view_layer.layer_collection)
for c in bpy.data.collections:c.hide_viewport=False
for o in bpy.data.objects:
 if o.type=='ARMATURE':o.data.pose_position='REST';o.animation_data_clear()
rig.hide_set(False);rig.hide_viewport=False
bpy.context.view_layer.update()
objects=[bpy.data.objects[n] for n in cfg['names']]
# Save the source maps, including alternate colors, with stable collision-free names.
# Packed bytes preserve the original map resolution and color encoding.
image_files={}
for img in bpy.data.images:
 if img.source=='TILED':
  pattern=Path(bpy.path.abspath(img.filepath))
  if not Path(str(pattern).replace('<UDIM>','1001')).is_file():pattern=Path(bpy.data.filepath).parent/'textures'/Path(img.filepath.replace('\\','/')).name
  if Path(str(pattern).replace('<UDIM>','1001')).is_file():report['images'].append({'name':img.name,'udim':str(pattern),'size':list(img.size)})
  continue
 if img.type not in ['IMAGE','UV_TEST'] or not all(img.size):continue
 if img.packed_file:
  raw=bytes(img.packed_file.data);ext='.png' if raw[:8]==b'\x89PNG\r\n\x1a\n' else '.jpg' if raw[:2]==b'\xff\xd8' else '.bin'
  path=textures/(hashlib.sha256(raw).hexdigest()[:16]+ext);path.write_bytes(raw)
  image_files[img.name]=str(path);report['images'].append({'name':img.name,'file':path.name,'size':list(img.size)})
 elif img.source!='TILED':
  path=Path(bpy.path.abspath(img.filepath))
  if not path.is_file():
   candidates=list(Path(bpy.data.filepath).parent.rglob(Path(img.filepath).name));path=candidates[0] if candidates else path
  if path.is_file():image_files[img.name]=str(path);report['images'].append({'name':img.name,'file':str(path),'size':list(img.size)})
# Resolve a graph's selected image through constant blends and simple color controls.
# This preserves the artist's chosen map; procedural adjustments are recorded.
def origin(socket,depth=0):
 if not socket or depth>20:return None
 if not socket.is_linked:return {'value':list(socket.default_value) if hasattr(socket.default_value,'__len__') else socket.default_value} if hasattr(socket,'default_value') else None
 link=socket.links[0];n=link.from_node
 if n.type=='TEX_IMAGE':
  if not n.image:return None
  value={'image':n.image.name,'output':link.from_socket.name,'colorSpace':n.image.colorspace_settings.name}
  vector=n.inputs.get('Vector')
  if vector and vector.is_linked:
   upstream=vector.links[0].from_node
   if upstream.type=='UVMAP':value['uv']=upstream.uv_map
  return value
 if n.type in ['MIX','MIX_RGB']:
  if n.type=='MIX':factor=n.inputs[0];a=n.inputs[6];b=n.inputs[7]
  else:factor,a,b=n.inputs[:3]
  f=origin(factor,depth+1);mode=getattr(n,'blend_type','MIX')
  constant=f.get('value') if f else 0
  if isinstance(constant,(int,float)):
   fv=max(0,min(1,constant))
   if fv<=.00001:return origin(a,depth+1)
   if fv>=.99999 and mode=='MIX':return origin(b,depth+1)
   f=fv
  return {'mix':mode,'factor':f,'a':origin(a,depth+1),'b':origin(b,depth+1)}
 if n.type in ['NORMAL_MAP','BUMP','BEVEL']:
  if n.type=='NORMAL_MAP':return origin(n.inputs['Color'],depth+1)
  if n.inputs.get('Normal') and n.inputs['Normal'].is_linked:return origin(n.inputs['Normal'],depth+1)
  return None
 if n.type in ['BRIGHTCONTRAST','HUE_SAT','VALTORGB','GAMMA','INVERT','RGBTOBW','REROUTE']:
  s=n.inputs.get('Color') or n.inputs[0]
  value=origin(s,depth+1)
  if n.type=='BRIGHTCONTRAST':return {'adjust':'brightnessContrast','bright':n.inputs['Bright'].default_value,'contrast':n.inputs['Contrast'].default_value,'source':value}
  return value
 return None

def dominant(v):
 if not v:return None
 if 'image' in v:return v
 if 'source'in v:return dominant(v['source'])
 if 'mix'in v:return dominant(v['b'] if isinstance(v['factor'],(int,float)) and v['factor']>=.5 else v['a']) or dominant(v['a']) or dominant(v['b'])
 return v
used_mats={m for o in objects for m in o.data.materials if m}
for mat in used_mats:
 nodes=mat.node_tree.nodes if mat.node_tree else []
 outputs=[n for n in nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output]
 shader=outputs[0].inputs['Surface'].links[0].from_node if outputs and outputs[0].inputs['Surface'].is_linked else None
 if not shader or shader.type!='BSDF_PRINCIPLED':shader=next((n for n in nodes if n.type=='BSDF_PRINCIPLED' and n.inputs['Base Color'].is_linked),next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None))
 record={'name':mat.name,'maps':{},'allImages':[n.image.name for n in nodes if n.type=='TEX_IMAGE' and n.image]}
 for slot in ['Base Color','Normal','Roughness','Metallic','Alpha','Emission Color','Specular IOR Level','Subsurface Weight','Subsurface Scale','Subsurface Radius','IOR']:
  record['maps'][slot]=origin(shader.inputs.get(slot)) if shader else None
 # Cornea requires desktop-safe reflection rather than glass refraction.
 kind='skin' if mat.name in cfg['skin'] else 'cornea' if mat.name in cfg['cornea'] else 'iris' if mat.name in cfg['iris'] else 'hair' if mat.name in cfg['hair'] else None
 record['kind']=kind
 if shader:
  record['specular']=shader.inputs['Specular IOR Level'].default_value
  record['ior']=shader.inputs['IOR'].default_value
  normal=shader.inputs['Normal']
  record['normalStrength']=normal.links[0].from_node.inputs['Strength'].default_value if normal.is_linked and normal.links[0].from_node.type=='NORMAL_MAP' else 1
 mat.use_nodes=True;mat.node_tree.nodes.clear();nodes=mat.node_tree.nodes;shader=nodes.new('ShaderNodeBsdfPrincipled');output=nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(shader.outputs['BSDF'],output.inputs['Surface'])
 shader.inputs['Roughness'].default_value=.5;shader.inputs['Metallic'].default_value=0
 for slot,v in record['maps'].items():
  value=dominant(v)
  if value and 'image'in value:
   img=bpy.data.images.get(value['image'])
   if img and img.source!='TILED':
    # Use a file-backed copy to make glTF export independent of stale external paths.
    if img.name in image_files:
     try:img=bpy.data.images.load(image_files[img.name],check_existing=False)
     except:pass
    img.colorspace_settings.name='sRGB' if slot in ['Base Color','Emission Color'] else 'Non-Color'
    node=nodes.new('ShaderNodeTexImage');node.image=img
    if value.get('uv'):
     uv=nodes.new('ShaderNodeUVMap');uv.uv_map=value['uv'];mat.node_tree.links.new(uv.outputs['UV'],node.inputs['Vector'])
    socket=node.outputs['Alpha' if value.get('output')=='Alpha' else 'Color']
    if slot=='Normal':
     normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=record.get('normalStrength',1);mat.node_tree.links.new(socket,normal.inputs['Color']);socket=normal.outputs['Normal']
    mat.node_tree.links.new(socket,shader.inputs[slot])
   else:report['warnings'].append({'material':mat.name,'slot':slot,'tiledImage':value['image']})
  elif value and 'value' in value:
   try:shader.inputs[slot].default_value=value['value']
   except (TypeError,ValueError):pass
 if kind:
  mat['avatarSurface']=kind;mat['avatarPortrait']=kind;mat['avatarPortraitProfile']='authored'
 if kind in ['skin','hair','iris']:shader.inputs['Metallic'].default_value=0
 if kind=='hair':
  for link in list(shader.inputs['Metallic'].links):mat.node_tree.links.remove(link)
  shader.inputs['Roughness'].default_value=.48
 if kind=='cornea':
  for socket in shader.inputs:
   for link in list(socket.links):mat.node_tree.links.remove(link)
  shader.inputs['Base Color'].default_value=(1,1,1,1);shader.inputs['Alpha'].default_value=.06;shader.inputs['Roughness'].default_value=.025
 mat.surface_render_method='DITHERED';mat.use_backface_culling=False
 report['materials'].append(record)
# Preserve each 4K UDIM tile as an ordinary glTF material, rather than
# shrinking the armor's four texture tiles into one atlas.
tiled_images={r['name']:r['udim'] for r in report['images'] if 'udim'in r}
tiled_materials={r['name']:r for r in report['materials'] if any(dominant(v) and dominant(v).get('image') in tiled_images for v in r['maps'].values())}
tile_mats={}
for obj in objects:
 if not obj.data.uv_layers.active:continue
 uv=obj.data.uv_layers.active.data
 for poly in obj.data.polygons:
  original=obj.data.materials[poly.material_index]
  if not original or original.name not in tiled_materials:continue
  record=tiled_materials[original.name]
  center=sum((uv[i].uv.x for i in poly.loop_indices))/len(poly.loop_indices)
  tile=max(1001,min(1004,1001+int(np.floor(center))))
  key=(original.name,tile)
  if key not in tile_mats:
   mat=original.copy();mat.name=original.name+'-tile-'+str(tile)
   shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
   for slot,value in record['maps'].items():
    value=dominant(value)
    if not value or value.get('image') not in tiled_images:continue
    path=tiled_images[value['image']].replace('<UDIM>',str(tile))
    image=bpy.data.images.load(path,check_existing=False);image.colorspace_settings.name='sRGB' if slot in ['Base Color','Emission Color'] else 'Non-Color'
    n=mat.node_tree.nodes.new('ShaderNodeTexImage');n.image=image;socket=n.outputs['Color']
    if slot=='Normal':
     normal=mat.node_tree.nodes.new('ShaderNodeNormalMap');mat.node_tree.links.new(socket,normal.inputs['Color']);socket=normal.outputs['Normal']
    mat.node_tree.links.new(socket,shader.inputs[slot])
   tile_mats[key]=mat;report['materials'].append({**record,'name':mat.name,'tile':tile})
  mat=tile_mats[key]
  if mat.name not in obj.data.materials:obj.data.materials.append(mat)
  poly.material_index=list(obj.data.materials).index(mat)
  for i in poly.loop_indices:uv[i].uv.x-=tile-1001
# Secondary hair/skirt rigs become child bones in the avatar rig. Independent
# full-body rigs retain their own pivots and lengths, even when bone names
# match the pilot. Sharing human finger pivots tears a larger robot's hands.
remaps={};extras=[];deform={b.name for b in rig.data.bones if b.use_deform}
for obj in objects:
 source=next((m.object for m in obj.modifiers if m.type=='ARMATURE' and m.object),None)
 if source is None or source==rig:continue
 if source.name in remaps:continue
 remap={}
 for b in source.data.bones:
  if not b.use_deform:continue
  if source.name in ['Seraphim_Pistol.r','Unica6_RIG']:remap[b.name]='hand.r'
  elif source.name=='Seraphim_Pistol.l':remap[b.name]='hand.l'
  elif b.name in deform and not all(n in source.data.bones for n in ['root.x','hand.l','hand.r']):remap[b.name]=b.name
  else:
   name=source.name+':'+b.name;remap[b.name]=name
   parent=b.parent
   while parent and not parent.use_deform:parent=parent.parent
   extras.append((name,source.matrix_world@b.matrix_local,b.length,source.name+':'+parent.name if parent else ('head.x' if 'Ponytail' in source.name else 'root.x')))
 remaps[source.name]=remap
if extras:
 bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for name,matrix,length,parent in extras:
  b=rig.data.edit_bones.new(name);b.matrix=matrix;b.length=max(.005,length);b.use_deform=True
 for name,matrix,length,parent in extras:
  rig.data.edit_bones[name].parent=rig.data.edit_bones.get(parent) or rig.data.edit_bones.get('head.x' if 'Ponytail' in name else 'root.x')
 bpy.ops.object.mode_set(mode='OBJECT')
result=[]
for obj in objects:
 name=obj.name;obj.hide_set(False);obj.hide_viewport=False;obj.hide_render=False
 source=next((m.object for m in obj.modifiers if m.type=='ARMATURE' and m.object),rig)
 world=obj.matrix_world.copy();keys=obj.data.shape_keys
 records=[(k.name,k.value if not k.mute else 0,k.slider_min,k.slider_max) for k in list(keys.key_blocks)[1:]] if keys else []
 if keys:keys.animation_data_clear()
 for k in keys.key_blocks if keys else []:k.value=0;k.mute=False
 for mod in obj.modifiers:
  mod.show_viewport=mod.type in ['SUBSURF','MIRROR']
  if mod.type=='SUBSURF':mod.levels=1
 obj.show_only_shape_key=False;bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
 mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
 refined=bpy.data.objects.new(name+'.runtime',mesh);bpy.context.collection.objects.link(refined);refined.matrix_world=world
 for p in mesh.polygons:p.use_smooth=True
 mapping=remaps.get(source.name,{})
 # Preserve all group indices; merge duplicate rigid hand groups below.
 for group in obj.vertex_groups:refined.vertex_groups.new(name=group.name)
 if records:
  refined.shape_key_add(name='Basis')
  for index,(key_name,value,low,high) in enumerate(records):
   sk=keys.key_blocks[key_name];sk.value=1;obj.data.update();bpy.context.view_layer.update()
   evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());sample=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
   assert len(sample.vertices)==len(mesh.vertices),'Morph topology changed'
   coords=np.empty(len(mesh.vertices)*3,dtype=np.float32);sample.vertices.foreach_get('co',coords)
   dest=refined.shape_key_add(name=key_name);dest.data.foreach_set('co',coords);dest.slider_min=low;dest.slider_max=high;dest.value=0
   # Keep clothing fit correctives, but neutralize all expression authoring controls.
   if key_name in ['Smaller.breast','Smooth Chest','Thicker.Thigh','Key 1','Inside canopy','Key 2','Low profile']:dest.value=value
   evaluated.to_mesh_clear();sk.value=0
   if index%30==0:print('SHAPES',name,index,len(records),flush=True)
 if mapping:
  names={g.index:g.name for g in refined.vertex_groups};weights=[[(mapping.get(names[g.group],names[g.group]),g.weight) for g in v.groups] for v in mesh.vertices]
  refined.vertex_groups.clear();groups={}
  for v,entries in zip(mesh.vertices,weights):
   merged={}
   for n,w in entries:merged[n]=merged.get(n,0)+w
   for n,w in merged.items():
    if n not in groups:groups[n]=refined.vertex_groups.new(name=n)
    groups[n].add([v.index],min(1,w),'REPLACE')
 mod=refined.modifiers.new('Runtime skeleton','ARMATURE');mod.object=rig
 obj.name=name+'.authoring';refined.name=name;result.append(refined)
 report['meshes'].append({'name':name,'sourceVertices':len(obj.data.vertices),'vertices':len(mesh.vertices),'targets':len(records),'sourceRig':source.name,'preserveVolume':any(m.type=='ARMATURE' and m.use_deform_preserve_volume for m in obj.modifiers)})
 print('MESH',name,len(mesh.vertices),flush=True)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for obj in result:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_animations=False,export_def_bones=True,export_rest_position_armature=True,export_extras=True,export_morph=True,export_morph_normal=True,export_apply=False,export_materials='EXPORT',export_try_sparse_sk=True)
out.with_suffix('.audit.json').write_text(json.dumps(report,indent=2));print('EXPORTED',out,flush=True)
