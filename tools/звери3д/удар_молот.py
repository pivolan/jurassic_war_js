# Удар «молот»: обе лапы в замок, замах над рогами, обрушение вниз перед собой (владелец 04.10: «молот сверху
# неплохо… и с трещинами на земле»). Три кадра под движок (урон на третьем):
#   301 подготовка — замок перед грудью; 302 замах — замок над рогами, корпус прогнут назад, чуть на носках;
#   303 УДАР — замок у земли перед собой, глубокий наклон, колени подогнуты, таз ниже и вперёд.
#   blender -b аним/шаг2.blend -P удар_молот.py -- выход.blend
# Оси модели: вперёд +X, влево +Y, вверх +Z. Кость наводим по направлению «сустав → следующий сустав».
import bpy, sys, math
from mathutils import Vector, Matrix
арг = sys.argv[sys.argv.index('--') + 1:]
SC = bpy.context.scene
ARM = [o for o in SC.objects if o.type == 'ARMATURE'][0]
P = ARM.pose.bones

def x(n): return P[n].head.x
лучший = min(range(SC.frame_start, SC.frame_end + 1), key=lambda f: (SC.frame_set(f), abs(x('left_ankle') - x('right_ankle')))[1])
SC.frame_set(лучший)
база = {pb.name: pb.matrix.copy() for pb in P}
порядок = [b.name for b in ARM.data.bones]
H = (P['head'].head - P['left_ankle'].head).length * 1.15

def сброс():
    for n in порядок: P[n].matrix = база[n]; bpy.context.view_layer.update()
def навести(n, ребёнок, куда):
    M = P[n].matrix.copy(); h = M.translation.copy()
    d = (P[ребёнок].head - P[n].head).normalized()
    q = d.rotation_difference(Vector(куда).normalized())
    P[n].matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ M
    bpy.context.view_layer.update()
def ик(верх, низ, конец, цель, полюс):
    """Двухзвенная ОК: ставит кости верх→низ→конец так, чтобы конец пришёл в точку цель; сгиб — в сторону полюс."""
    A = P[верх].head.copy()
    l1 = (P[низ].head - A).length; l2 = (P[конец].head - P[низ].head).length
    d = цель - A; дл = min(d.length, (l1 + l2) * 0.999); н = d.normalized()
    a = (l1 * l1 - l2 * l2 + дл * дл) / (2 * дл); h = max(0.0, l1 * l1 - a * a) ** 0.5
    p = (полюс - н * полюс.dot(н)).normalized()
    K = A + н * a + p * h
    навести(верх, низ, K - A)
    навести(низ, конец, (A + н * дл) - P[низ].head)

def корпус(поворот, наклон):
    for n in ('spine1', 'spine2', 'spine3'):
        M = P[n].matrix.copy(); h = M.translation.copy()
        R = Matrix.Rotation(math.radians(поворот / 3), 4, 'Z') @ Matrix.Rotation(math.radians(наклон / 3), 4, 'Y')
        P[n].matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ M
        bpy.context.view_layer.update()
def таз(вперёд, вверх):
    M = P['pelvis'].matrix.copy(); P['pelvis'].matrix = Matrix.Translation(Vector((вперёд * H, 0, вверх * H))) @ M
    bpy.context.view_layer.update()

# руки: (плечо, локоть) для правой; левая — зеркально по Y. Внутрь (к середине) у правой = +Y.
ПОЗЫ = {
    301: dict(наклон=8, таз=(0.0, -0.01), плечо=(0.55, -0.35, 0.25), локоть=(0.35, 0.75, 0.35), ноги=None),
    302: dict(наклон=-22, таз=(-0.02, 0.025), плечо=(-0.1, -0.25, 1.0), локоть=(-0.45, 0.45, 0.75), ноги=None),
    303: dict(наклон=float(__import__('os').environ.get('LEAN', '62')), таз=(0.09, -0.14), плечо=(0.6, -0.2, -0.8), локоть=(0.2, 0.45, -0.87),
              ноги=((0.6, 0.0, -0.8), (-0.35, 0.0, -0.94))),     # бедро вперёд-вниз, голень назад-вниз — присед
}
for f, п in ПОЗЫ.items():
    сброс()
    таз(*п['таз'])
    if п['ноги']:
        бедро, голень = п['ноги']
        for s, знак in (('left', 1), ('right', -1)):
            навести(f'{s}_hip', f'{s}_knee', (бедро[0], бедро[1] + знак * 0.12, бедро[2]))
            навести(f'{s}_knee', f'{s}_ankle', голень)
    корпус(0, п['наклон'])
    for s, знак in (('right', 1), ('left', -1)):
        пл = п['плечо']; лк = п['локоть']
        навести(f'{s}_shoulder', f'{s}_elbow', (пл[0], пл[1] * знак, пл[2]))
        навести(f'{s}_elbow', f'{s}_wrist', (лк[0], лк[1] * знак, лк[2]))
    if f == 303:
        # Лапы — в землю перед копытами (владелец: «удар не до земли»). Двухзвенная обратная кинематика:
        # ноги держат ступни на месте при приседе, руки тянутся в точку на земле, локти наружу-вверх.
        сброс()
        лод = {s_: P[f'{s_}_ankle'].head.copy() for s_ in ('left', 'right')}
        пол = min(P[n].head.z for n in ('left_foot', 'right_foot', 'left_ankle', 'right_ankle'))
        таз(0.06, -float(__import__('os').environ.get('CROUCH', '0.40')))
        for s_ in ('left', 'right'):
            ик(f'{s_}_hip', f'{s_}_knee', f'{s_}_ankle', лод[s_], Vector((1, 0, 0.2)))
        корпус(0, float(__import__('os').environ.get('LEAN', '90')))
        mid = (лод['left'] + лод['right']) / 2
        for s_, зн in (('right', -1), ('left', 1)):
            цель = Vector((mid.x + 0.36 * H, mid.y + зн * 0.04 * H, пол + 0.03 * H))
            ик(f'{s_}_shoulder', f'{s_}_elbow', f'{s_}_wrist', цель, Vector((-0.2, зн * 0.7, 0.6)))
        рука = (P['right_elbow'].head - P['right_shoulder'].head).length + (P['right_wrist'].head - P['right_elbow'].head).length
        print('плечо над полом', round((P['right_shoulder'].head.z - пол) / H, 3), 'рука', round(рука / H, 3), flush=True)
    for n in порядок:
        pb = P[n]
        if pb.rotation_mode != 'QUATERNION': pb.rotation_mode = 'QUATERNION'
        pb.keyframe_insert('rotation_quaternion', frame=f)
        if not ARM.data.bones[n].parent: pb.keyframe_insert('location', frame=f)
SC.frame_start, SC.frame_end = 301, 303
SC.frame_set(303)
пол = min(P[n].head.z for n in ('left_foot', 'right_foot', 'left_ankle', 'right_ankle'))
print('КИСТИ над полом в ударе:', round((P['left_wrist'].head.z - пол) / H, 3), round((P['right_wrist'].head.z - пол) / H, 3), '(доли роста)', flush=True)
bpy.ops.wm.save_as_mainfile(filepath=арг[0])
print('ГОТОВО стойка из кадра', лучший, flush=True)
