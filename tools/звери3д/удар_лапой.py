# Размашистый удар лапой демона, поставленный вручную (мокап не подошёл: punch — тычок, slash — меч, kick — вертушка).
#   blender -b аним/шаг.blend -P удар_лапой.py -- выход.blend
# Основа — стойка из ходьбы; три новых кадра (301 замах, 302 удар, 303 протяжка). Кость нацеливаем по направлению
# «сустав → следующий сустав» (собственные оси костей в файле Customuse смотрят куда попало), корпус крутим вокруг таза.
# Оси модели: вперёд +X, влево +Y, вверх +Z. Бьёт правой лапой.
import bpy, sys, math
from mathutils import Vector, Matrix, Quaternion
арг = sys.argv[sys.argv.index('--') + 1:]
SC = bpy.context.scene
ARM = [o for o in SC.objects if o.type == 'ARMATURE'][0]
P = ARM.pose.bones

# стойка: кадр ходьбы, где копыта ближе всего
def x(n): return P[n].head.x
лучший = min(range(SC.frame_start, SC.frame_end + 1), key=lambda f: (SC.frame_set(f), abs(x('left_ankle') - x('right_ankle')))[1])
SC.frame_set(лучший)
база = {pb.name: pb.matrix.copy() for pb in P}
порядок = [b.name for b in ARM.data.bones]

def сброс():
    for n in порядок: P[n].matrix = база[n]; bpy.context.view_layer.update()

def навести(n, ребёнок, куда):
    M = P[n].matrix.copy(); h = M.translation.copy()
    d = (P[ребёнок].head - P[n].head).normalized()
    q = d.rotation_difference(Vector(куда).normalized())
    P[n].matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ M
    bpy.context.view_layer.update()

def корпус(поворот, наклон):
    """Поворот плеч вокруг вертикали (+ — влево) и наклон вперёд (+) на костях spine2/spine3, пополам."""
    for n in ('spine2', 'spine3'):
        M = P[n].matrix.copy(); h = M.translation.copy()
        R = Matrix.Rotation(math.radians(поворот / 2), 4, 'Z') @ Matrix.Rotation(math.radians(наклон / 2), 4, 'Y')
        P[n].matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ M
        bpy.context.view_layer.update()

ПОЗЫ = {
    # Порядок под движок: у зверей кадры удара идут 0,1,2 по два такта, урон — на кадре 2 (combat.js 0x1a7cb).
    # кадр: (поворот плеч, наклон, правое плечо, правый локоть, левое плечо, левый локоть, выпад таза вперёд)
    301: (-15, -3, (-0.1, -0.7, 0.5), (0.0, -0.3, 0.9), (0.5, 0.5, -0.4), (0.7, 0.3, -0.3), 0.0),       # лапа поднимается
    302: (-45, -12, (-0.35, -0.45, 0.8), (-0.2, 0.0, 1.0), (0.8, 0.4, -0.1), (0.9, 0.2, -0.1), -0.03),   # полный замах над головой
    303: (30, 32, (0.95, -0.15, -0.1), (0.85, 0.1, -0.55), (-0.5, 0.6, -0.4), (-0.4, 0.4, -0.7), 0.13),  # УДАР: выпад, когти вниз на цель
}
H = (P['head'].head - P['left_ankle'].head).length * 1.15
for f, (пов, накл, пп, пл, лп, лл, вып) in ПОЗЫ.items():
    сброс()
    if вып:      # выпад: таз вперёд и чуть вниз, всё тело едет следом
        M = P['pelvis'].matrix.copy(); P['pelvis'].matrix = Matrix.Translation(Vector((вып * H, 0, -0.03 * H))) @ M
        bpy.context.view_layer.update()
    корпус(пов, накл)
    навести('right_shoulder', 'right_elbow', пп); навести('right_elbow', 'right_wrist', пл)
    навести('left_shoulder', 'left_elbow', лп); навести('left_elbow', 'left_wrist', лл)
    for n in порядок:
        pb = P[n]
        if pb.rotation_mode != 'QUATERNION': pb.rotation_mode = 'QUATERNION'
        pb.keyframe_insert('rotation_quaternion', frame=f)
        if not ARM.data.bones[n].parent: pb.keyframe_insert('location', frame=f)
SC.frame_start, SC.frame_end = 301, 303
bpy.ops.wm.save_as_mainfile(filepath=арг[0])
print('ГОТОВО стойка из кадра', лучший, flush=True)
