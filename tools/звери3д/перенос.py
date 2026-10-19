# Перенос мокапа (BVH Bandai Namco, CC BY-NC 4.0) на скелет демона из Customuse (52 кости, имена как в SMPL).
#   blender -b -P перенос.py -- модель_rig.glb клип.bvh начало(кадр|auto) длина выход.blend [шаг]
# Способ тот же, что у робота K-01 (отдельный проект): вращение кости
# цели D(t) = R_src(t) · R_src(c)⁻¹ · A_src(c) · A_tgt⁻¹, где A — «анатомический» кадр кости (ось кости + опорная
# ось тела) в кадре калибровки c. Так не нужны ни поза покоя источника, ни одинаковые пропорции.
# Кости цели без пары (пальцы, лишний позвонок, носок) едут жёстко за родителем.
import bpy, sys, math, os, statistics
from mathutils import Vector, Matrix

арг = sys.argv[sys.argv.index('--') + 1:]
МОДЕЛЬ, BVH, START, LEN, ВЫХОД = арг[0], арг[1], арг[2], int(арг[3]), арг[4]
ШАГ = int(арг[5]) if len(арг) > 5 else 1
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=МОДЕЛЬ)
ARM = [o for o in SC.objects if o.type == 'ARMATURE'][0]
for o in list(SC.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
AW = ARM.matrix_world.copy()

# пары «кость источника → кость цели» и сустав, куда смотрит кость цели (для её оси)
ПАРЫ = {'Hips': 'pelvis', 'Spine': 'spine1', 'Chest': 'spine3', 'Neck': 'neck', 'Head': 'head'}
for sd, s in (('L', 'left'), ('R', 'right')):
    ПАРЫ.update({f'Shoulder_{sd}': f'{s}_collar', f'UpperArm_{sd}': f'{s}_shoulder', f'LowerArm_{sd}': f'{s}_elbow',
                 f'Hand_{sd}': f'{s}_wrist', f'UpperLeg_{sd}': f'{s}_hip', f'LowerLeg_{sd}': f'{s}_knee', f'Foot_{sd}': f'{s}_ankle'})
КУДА = {'pelvis': 'spine1', 'spine1': 'spine2', 'spine2': 'spine3', 'spine3': 'neck', 'neck': 'head', 'head': None}
for s in ('left', 'right'):
    КУДА.update({f'{s}_collar': f'{s}_shoulder', f'{s}_shoulder': f'{s}_elbow', f'{s}_elbow': f'{s}_wrist', f'{s}_wrist': f'{s}_middle1',
                 f'{s}_hip': f'{s}_knee', f'{s}_knee': f'{s}_ankle', f'{s}_ankle': f'{s}_foot'})
ЗА = {'spine2': 'spine1'}            # своя пара не нужна: поворачивается как указанная кость
ИСТ = list(ПАРЫ)
ЦЕЛЬ = {v: k for k, v in ПАРЫ.items()}
РУКИ = {'Shoulder', 'UpperArm', 'LowerArm', 'Hand'}
REF = {b: ('fwd' if b.split('_')[0] in РУКИ else 'left') for b in ИСТ}

REST = {b.name: b.matrix_local.copy() for b in ARM.data.bones}
J0 = {n: (AW @ REST[n]).translation for n in REST}      # суставы цели в покое, мир
up_t = (J0['neck'] - J0['pelvis']).normalized()
left_t = (J0['left_hip'] - J0['right_hip']); left_t = (left_t - up_t * left_t.dot(up_t)).normalized()
fwd_t = left_t.cross(up_t).normalized()
print('цель: вперёд', tuple(round(x, 2) for x in fwd_t), 'влево', tuple(round(x, 2) for x in left_t), flush=True)

def кадр(d, ref):
    y = d.normalized(); x = (ref - y * y.dot(ref)).normalized(); z = x.cross(y)
    return Matrix((x, y, z)).transposed()

def ось_цели(n):
    к = КУДА.get(n)
    if к: return J0[к] - J0[n]
    # у головы ребёнка-сустава нет, а своя ось кости в файле Customuse смотрит куда попало — берём «вверх по шее»
    if n == 'head': return J0['head'] - J0['neck']
    return (AW.to_3x3() @ REST[n].to_3x3()) @ Vector((0, 1, 0))

A_t = {}
for b in ИСТ:
    n = ПАРЫ[b]
    A_t[b] = кадр(ось_цели(n), fwd_t if REF[b] == 'fwd' else left_t)

# ---------- источник ----------
bpy.ops.import_anim.bvh(filepath=BVH, global_scale=0.01, use_fps_scale=False, update_scene_fps=False, update_scene_duration=False)
SRC = bpy.context.active_object
NF = int(SRC.animation_data.action.frame_range[1]) // ШАГ

def взять(i):
    SC.frame_set(1 + (i - 1) * ШАГ)
    raw = {}
    for pb in SRC.pose.bones:
        M = SRC.matrix_world @ pb.matrix
        raw[pb.name] = (M.to_3x3().normalized(), M.translation.copy(), (SRC.matrix_world @ pb.tail).copy())
    return {b: raw[b] for b in ИСТ}

if START == 'auto':
    pos = []
    for f in range(1, NF + 1):
        st = взять(f); pos.append([st[n][1] for n in ('Hand_L', 'Hand_R', 'Foot_L', 'Foot_R')])
    en = [sum((pos[i][k] - pos[i - 1][k]).length for k in range(4)) for i in range(1, len(pos))]
    best, c0 = -1, 30
    for s0 in range(30, max(31, len(en) - LEN), 5):
        e = sum(en[s0:s0 + LEN])
        if e > best: best, c0 = e, s0
    START = c0 + 1
START = int(START); LEN = min(LEN, NF - START + 1)
print('окно', START, LEN, 'из', NF, flush=True)
FR = [взять(f) for f in range(START, START + LEN)]

c = FR[0]
lr = c['UpperLeg_L'][1] - c['UpperLeg_R'][1]
G = Matrix.Rotation(math.atan2(left_t.y, left_t.x) - math.atan2(lr.y, lr.x), 3, 'Z')
for st in FR:
    for n in st:
        R, h, t = st[n]; st[n] = (G @ R, G @ h, G @ t)

def оси_ист(st):
    lh = (st['UpperLeg_L'][1] - st['UpperLeg_R'][1]).normalized()
    lc = (st['UpperArm_L'][1] - st['UpperArm_R'][1]).normalized()
    up = (st['Neck'][1] - st['Hips'][1]).normalized()
    return lh, lc, up
def кадры_ист(st):
    lh, lc, up = оси_ист(st); fwd = lc.cross(up).normalized(); out = {}
    for b in ИСТ:
        R, h, t = st[b]
        ref = fwd if REF[b] == 'fwd' else (lh if b in ('Hips', 'Spine') or 'Leg' in b or 'Foot' in b else lc)
        out[b] = кадр(t - h, ref)
    return out
A_s = кадры_ист(FR[0])
C = {b: FR[0][b][0].inverted() @ A_s[b] @ A_t[b].inverted() for b in ИСТ}

ноги_ист = sum((c[f'{b}_L'][2] - c[f'{b}_L'][1]).length for b in ('UpperLeg', 'LowerLeg'))
ноги_цели = (J0['left_knee'] - J0['left_hip']).length + (J0['left_ankle'] - J0['left_knee']).length
k = ноги_цели / ноги_ист
r0 = FR[0]['Hips'][1]
таз0 = J0['pelvis']
print('масштаб', round(k, 3), flush=True)

# мировые повороты костей цели (только вращение, мир)
RW = {n: (AW.to_3x3() @ REST[n].to_3x3()).normalized() for n in REST}
порядок = [b.name for b in ARM.data.bones]          # родители раньше детей
for pb in ARM.pose.bones: pb.rotation_mode = 'QUATERNION'
пред = {}
низ = []
# РАЗМАХ (env STRIDE, 0..1): в игре юнит за цикл шага (8 тактов) проходит ровно 32 px, а естественная походка
# на нашем росте даёт 51–63 px — копыта скользят, «скачет». Сжимаем размах ног и рук к среднему положению за клип
# (сферическая интерполяция поворотов), путь таза — так же. 0.55 даёт ~32 px.
РАЗМАХ = float(os.environ.get('STRIDE', '1'))
СЖИМАТЬ = [b for b in ИСТ if any(k in b for k in ('UpperLeg', 'LowerLeg', 'Foot', 'UpperArm', 'LowerArm', 'Hand'))]
if РАЗМАХ < 1:
    from mathutils import Quaternion
    for b in СЖИМАТЬ:
        qs = [st[b][0].to_quaternion() for st in FR]
        ср = qs[0].copy()
        for q in qs[1:]:
            if ср.dot(q) < 0: q = -q
        acc = [0.0, 0.0, 0.0, 0.0]
        for q in qs:
            if q.dot(qs[0]) < 0: q = -q
            for j in range(4): acc[j] += q[j]
        ср = Quaternion(acc).normalized()
        for st, q in zip(FR, qs):
            R, h, t = st[b]
            st[b] = (ср.slerp(q, РАЗМАХ).to_matrix(), h, t)
for i, st in enumerate(FR):
    M = {}
    for n in порядок:
        b = ARM.data.bones[n]; p = b.parent.name if b.parent else None
        if n in ЦЕЛЬ:
            sb = ЦЕЛЬ[n]; D = st[sb][0] @ C[sb]
            rot = D @ RW[n]
        elif n in ЗА and ЗА[n] in M:
            # поворачивается так же, как кость-образец относительно покоя
            o = ЗА[n]; rot = (M[o].to_3x3() @ RW[o].inverted()) @ RW[n]
        else:
            rot = None
        if p is None:
            r = st['Hips'][1]
            pos = Vector((таз0.x + (r.x - r0.x) * k * РАЗМАХ, таз0.y + (r.y - r0.y) * k * РАЗМАХ, таз0.z + (r.z - r0.z) * k))
            M[n] = Matrix.Translation(pos) @ (rot or RW[n]).to_4x4()
        else:
            мест = REST[p].inverted() @ REST[n]           # где кость сидит на родителе
            базa = M[p] @ (AW @ REST[p]).inverted() @ (AW @ REST[n])
            if rot is None: M[n] = базa
            else: M[n] = Matrix.Translation(базa.translation) @ rot.to_4x4()
    # пол: самая низкая точка копыт
    низ.append(min(M[n].translation.z for n in ('left_foot', 'right_foot', 'left_ankle', 'right_ankle')))
    for n in порядок:
        b = ARM.data.bones[n]; p = b.parent.name if b.parent else None
        Mw = AW.inverted() @ M[n]                          # в пространство арматуры
        Rn = REST[n]
        basis = Rn.inverted() @ Mw if p is None else (REST[p].inverted() @ Rn).inverted() @ (AW.inverted() @ M[p]).inverted() @ Mw
        loc, q, _ = basis.decompose()
        if n in пред: q.make_compatible(пред[n])
        пред[n] = q
        pb = ARM.pose.bones[n]
        pb.rotation_quaternion = q; pb.keyframe_insert('rotation_quaternion', frame=i + 1)
        if p is None:
            pb.location = loc; pb.keyframe_insert('location', frame=i + 1)
# прижать к полу: медианный сдвиг до самых низких кадров
пол0 = min(J0[n].z for n in ('left_foot', 'right_foot', 'left_ankle', 'right_ankle'))
сдвиг = пол0 - statistics.median(sorted(низ)[:max(1, len(низ) // 3)])
pb = ARM.pose.bones['pelvis']
for fc in ARM.animation_data.action.fcurves if hasattr(ARM.animation_data.action, 'fcurves') else []:
    pass
print('сдвиг пола', round(сдвиг, 3), flush=True)
ARM.location.z += сдвиг
bpy.data.objects.remove(SRC)
SC.frame_start, SC.frame_end = 1, len(FR)
SC.render.fps = 30
bpy.ops.wm.save_as_mainfile(filepath=ВЫХОД)
print('ГОТОВО', ВЫХОД, len(FR), flush=True)
