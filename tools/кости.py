import bpy, sys
арг = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=арг[0])
for o in bpy.context.scene.objects:
    print('OBJ', o.type, o.name, len(o.data.bones) if o.type == 'ARMATURE' else '', len(o.vertex_groups) if o.type == 'MESH' else '')
    if o.type == 'ARMATURE': print('BONES', [b.name for b in o.data.bones])
print('ACTIONS', [a.name for a in bpy.data.actions])
