# blender -b клип.blend -P замер_шага.py -- рост_стойки_px высота_стойки_в_сыром_кадре_px
# Сколько пикселей игры проходит таз за полный цикл шага (нужно 32: 8 тактов по 4 px).
import bpy, sys
from mathutils import Vector
арг = sys.argv[sys.argv.index('--') + 1:]
РОСТ, СЫР = float(арг[0]), float(арг[1])
SC = bpy.context.scene; ARM = [o for o in SC.objects if o.type == 'ARMATURE'][0]; меш = [o for o in SC.objects if o.type == 'MESH'][0]
ARM.data.pose_position = 'REST'; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); zs = [(меш.matrix_world @ v.co).z for v in меш.evaluated_get(dg).data.vertices]
H = max(zs) - min(zs); ARM.data.pose_position = 'POSE'
пикс_на_ед = 512 / (H * 1.6) * (РОСТ / СЫР)
P = ARM.pose.bones
def x(n): return (ARM.matrix_world @ P[n].head).x
f0, f1 = SC.frame_start, SC.frame_end
d = []
for f in range(f0, f1 + 1): SC.frame_set(f); d.append((x('left_ankle') - x('right_ankle'), x('pelvis')))
пики = [i for i in range(1, len(d) - 1) if d[i][0] >= d[i-1][0] and d[i][0] >= d[i+1][0] and d[i][0] > 0.3 * max(z[0] for z in d)]
t0, t1 = пики[0], пики[1]
путь = d[t1][1] - d[t0][1]
print('ЦИКЛ', t1 - t0, 'кадров, таз прошёл', round(путь, 2), 'ед =', round(путь * пикс_на_ед, 1), 'px игры (нужно 32)', flush=True)
