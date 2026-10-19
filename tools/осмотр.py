# blender -b -P осмотр.py -- модель.glb выход.png : четыре ракурса модели в один лист
import bpy, sys, math, mathutils
арг = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=арг[0])
меши = [o for o in bpy.context.scene.objects if o.type == 'MESH']
mn = mathutils.Vector((1e9,)*3); mx = -mn
for o in меши:
    for v in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(v); mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
ц = (mn + mx) / 2; р = max(mx - mn)
print('габарит', tuple(round(x, 3) for x in (mx - mn)), 'треугольников', sum(len(o.data.polygons) for o in меши))
сц = bpy.context.scene; сц.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
сц.render.resolution_x = 512; сц.render.resolution_y = 512; сц.render.film_transparent = False
мир = bpy.data.worlds.new('w'); сц.world = мир; мир.use_nodes = True; мир.node_tree.nodes['Background'].inputs[1].default_value = 1.0
мир.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
кам = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); сц.collection.objects.link(кам); сц.camera = кам
кам.data.type = 'ORTHO'; кам.data.ortho_scale = р * 1.15
свет = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); сц.collection.objects.link(свет); свет.data.energy = 3; свет.rotation_euler = (0.8, 0.2, 0.6)
import os
кадры = []
for k, у in enumerate([0, 90, 180, 270]):
    a = math.radians(у); д = р * 3
    кам.location = ц + mathutils.Vector((math.sin(a) * д, -math.cos(a) * д, 0))
    кам.rotation_euler = (math.radians(90), 0, a)
    сц.render.filepath = f'/tmp/осмотр_{k}.png'; bpy.ops.render.render(write_still=True); кадры.append(сц.render.filepath)
from PIL import Image
