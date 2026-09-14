"""Bake one authored subdivision level including every facial shape key.

Run inside Blender with the original Sarah ARP blend loaded. Writes only the
GLB supplied after --. Materials are placeholders, matched to the base export.
"""
import bpy, sys, json
import numpy as np
from pathlib import Path

out=Path(sys.argv[sys.argv.index('--')+1]).resolve()
if bpy.context.object and bpy.context.object.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
rig=bpy.data.objects['Fem-A_Sara_RIG'];rig.data.pose_position='REST'
def show(layer):
    layer.exclude=False;layer.hide_viewport=False
    for child in layer.children:show(child)
show(bpy.context.view_layer.layer_collection)
for collection in bpy.data.collections:collection.hide_viewport=False
names=['Fem-A__Whl_BY_Sarah.export','Fem-A_Whl_Ac_VDress','Fem-A_Top_Ac_Tshtt','Fem-A_Top_Ac_ChnCt',
    'Fem-A_Bot_Ac_ChnPnts_1','Fem-A_Fot_Ac_Chnhl','Fem-A_Fot_Ac_Sndlhl']
objects=[];report=[]
for name in names:
    obj=bpy.data.objects[name];obj.hide_set(False);obj.hide_viewport=False
    keys=obj.data.shape_keys
    records=[(k.name,k.value,k.slider_min,k.slider_max) for k in list(keys.key_blocks)[1:]] if keys else []
    if keys:keys.animation_data_clear()
    for key in keys.key_blocks if keys else []:key.value=0
    for mod in obj.modifiers:
        mod.show_viewport=mod.type in {'SUBSURF','MIRROR'}
        if mod.type=='SUBSURF':mod.levels=1;mod.subdivision_type='CATMULL_CLARK'
    obj.show_only_shape_key=False
    bpy.context.view_layer.update()
    deps=bpy.context.evaluated_depsgraph_get()
    mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
    for p in mesh.polygons:p.use_smooth=True
    refined=bpy.data.objects.new(name+'.refined',mesh);bpy.context.collection.objects.link(refined)
    refined.matrix_world=obj.matrix_world.copy()
    # Evaluated mesh deform weights retain the source group indices.
    for group in obj.vertex_groups:refined.vertex_groups.new(name=group.name)
    refined.shape_key_add(name='Basis')
    for index,(key_name,value,low,high) in enumerate(records):
        source=keys.key_blocks[key_name];source.value=1
        obj.data.update();bpy.context.view_layer.update()
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        sample=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
        assert len(sample.vertices)==len(mesh.vertices),'Subdivision changed topology between morphs'
        coords=np.empty(len(mesh.vertices)*3,dtype=np.float32);sample.vertices.foreach_get('co',coords)
        dest=refined.shape_key_add(name=key_name);dest.data.foreach_set('co',coords)
        dest.slider_min=low;dest.slider_max=high;dest.value=value
        evaluated.to_mesh_clear();source.value=0
        if index%25==0:print('MORPH',name,index,len(records),flush=True)
    obj.name=name+'.authoring';refined.name=name
    mod=refined.modifiers.new('Runtime skeleton','ARMATURE');mod.object=rig
    objects.append(refined);report.append(dict(name=name,vertices=len(mesh.vertices),morphs=len(records)))
bpy.ops.object.select_all(action='DESELECT')
rig.hide_set(False);rig.hide_viewport=False;rig.select_set(True)
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
# Export lightweight named materials so primitive-to-material assignments
# survive. Blender's PLACEHOLDER mode omits those assignments from the GLB.
for mat in {m for obj in objects for m in obj.data.materials if m}:
    mat.use_nodes=True;mat.node_tree.nodes.clear()
    shader=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled');output=mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(shader.outputs['BSDF'],output.inputs['Surface'])
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_animations=False,
    export_def_bones=True,export_rest_position_armature=True,export_extras=False,export_morph=True,
    export_morph_normal=True,export_apply=False,export_materials='EXPORT')
out.with_suffix('.json').write_text(json.dumps(report,indent=2));print('SURFACES',json.dumps(report),flush=True)
