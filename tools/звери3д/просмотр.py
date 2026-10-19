# blender -b файл.blend -P просмотр.py -- выход_префикс кадров [угол_камеры_по_кругу] [наклон]
# Полоска кадров анимации: ортокамера смотрит на модель сверху под углом, свет как днём.
import bpy, sys, math, os
ТАЗ = os.environ.get('PELVIS', 'pelvis')   # корневая кость тела (у Tripo quadruped — tripo::Root)
from mathutils import Vector
арг = sys.argv[sys.argv.index('--') + 1:]
ПРЕФ, N = арг[0], int(арг[1])
ЯВ = math.radians(float(арг[2]) if len(арг) > 2 else 35)
НАКЛОН = math.radians(float(арг[3]) if len(арг) > 3 else 35)     # над горизонтом
SC = bpy.context.scene
ARM = [o for o in SC.objects if o.type == 'ARMATURE'][0]
меш = [o for o in SC.objects if o.type == 'MESH'][0]
SC.render.engine = 'BLENDER_EEVEE'
SC.render.resolution_x = SC.render.resolution_y = 320
SC.render.film_transparent = True
мир = bpy.data.worlds.new('w'); SC.world = мир; мир.use_nodes = True
мир.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.6, 0.6, 1); мир.node_tree.nodes['Background'].inputs[1].default_value = 0.8
солнце = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); SC.collection.objects.link(солнце)
солнце.data.energy = 3.5; солнце.rotation_euler = (math.radians(40), 0, math.radians(-30))
кам = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); SC.collection.objects.link(кам); SC.camera = кам
# размер модели берём из неё самой: файлы со скелетом приходят ростом около 100 единиц, без скелета — около 1
SC.frame_set(SC.frame_start)
zs = [(меш.matrix_world @ v.co).z for v in меш.data.vertices]
H = max(zs) - min(zs); ПОЛ = min(zs)
все = [(меш.matrix_world @ v.co) for v in меш.data.vertices]; ДЛ = max(max(v.x for v in все) - min(v.x for v in все), max(v.y for v in все) - min(v.y for v in все))
H = max(H, ДЛ * 0.75)
кам.data.type = 'ORTHO'; кам.data.ortho_scale = H * 1.5; кам.data.clip_end = H * 50
f0, f1 = SC.frame_start, SC.frame_end
кадры = [round(f0 + (f1 - f0) * k / max(1, N - 1)) for k in range(N)]
for k, f in enumerate(кадры):
    SC.frame_set(f)
    таз = (ARM.matrix_world @ ARM.pose.bones[ТАЗ].head)
    ц = Vector((таз.x, таз.y, ПОЛ + H * 0.45))
    д = H * 4
    кам.location = ц + Vector((math.cos(НАКЛОН) * math.sin(ЯВ) * д, -math.cos(НАКЛОН) * math.cos(ЯВ) * д, math.sin(НАКЛОН) * д))
    кам.rotation_euler = (math.radians(90) - НАКЛОН, 0, ЯВ)
    SC.render.filepath = f'{ПРЕФ}_{k:02d}.png'
    bpy.ops.render.render(write_still=True)
