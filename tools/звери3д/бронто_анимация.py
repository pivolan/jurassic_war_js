# Анимация бронтозавра кодом (мокапа четвероногих нет). Скелет Tripo quadruped:
#   tripo::Root → Spine_0..4 → Head_0..5 (шея и голова); передние ноги 0_Left/Right_Limb_0..2 (от Spine_2),
#   задние 1_Left/Right_Limb_0..3 (от Root); хвост bone_18, bone_19, Tail_0..2, bone_23. Модель смотрит на +X.
#   blender -b -P бронто_анимация.py -- бронто_rig.glb выход.blend
# Кадры: 1..32 — цикл шага (стойка — кадр 1); 301 подготовка, 302 на задних лапах, 303 удар передними;
#        401/402 — падение на бок. Шаг: иноходь (ЗЛ, ПЛ, ЗП, ПП со сдвигом в четверть цикла), размах
#        под 32 px игры за цикл (на 125 px длины: 0.26 длины за цикл → ±19° у бедра/плеча).
import bpy, sys, math, os
from mathutils import Vector, Matrix, Euler, Quaternion
арг = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=арг[0])
SC = bpy.context.scene
ARM = [o for o in SC.objects if o.type == 'ARMATURE'][0]
for o in list(SC.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
P = ARM.pose.bones
for pb in P: pb.rotation_mode = 'QUATERNION'
T = lambda n: 'tripo::' + n
АМП = math.radians(float(os.environ.get('STEP_AMP', '19')))
ПЕРИОД = 32

def мир_ось(pb, ось_мира):
    """Ось мира → в локальные оси кости (для поворота pose-кости вокруг мировой оси)."""
    M = (ARM.matrix_world @ pb.bone.matrix_local).to_3x3().normalized()
    return (M.inverted() @ Vector(ось_мира)).normalized()
def повернуть(n, ось_мира, угол):
    pb = P[n]; q = Quaternion(мир_ось(pb, ось_мира), угол)
    pb.rotation_quaternion = pb.rotation_quaternion @ q
def сброс():
    for pb in P: pb.rotation_quaternion = Quaternion(); pb.location = Vector()
def ключ(f):
    for pb in P:
        pb.keyframe_insert('rotation_quaternion', frame=f)
        pb.keyframe_insert('location', frame=f)

Y = (0, 1, 0); Z = (0, 0, 1); X = (1, 0, 0)
НОГИ = {  # имя ноги: (бедро/плечо, колено/локоть, фаза)
    'ЗЛ': (T('1_Left_Limb_0'), T('1_Left_Limb_1'), 0.0),
    'ПЛ': (T('0_Left_Limb_0'), T('0_Left_Limb_1'), 0.25),
    'ЗП': (T('1_Right_Limb_0'), T('1_Right_Limb_1'), 0.5),
    'ПП': (T('0_Right_Limb_0'), T('0_Right_Limb_1'), 0.75),
}
# ---- шаг
for f in range(1, ПЕРИОД + 1):
    сброс()
    t = (f - 1) / ПЕРИОД
    for имя, (верх, низ, фаза) in НОГИ.items():
        ф = 2 * math.pi * (t + фаза)
        повернуть(верх, Y, АМП * math.sin(ф))                        # маятник вперёд-назад (вокруг поперечной оси)
        подъём = max(0.0, math.cos(ф))                              # перенос ноги — сгиб в колене/локте
        повернуть(низ, Y, (-1 if имя[0] == 'З' else 1) * math.radians(25) * подъём)
    # тело чуть качается, шея и хвост — волной
    P[T('Root')].location = Vector((0, 0, 0)) + Vector((0, 0.0, 0))
    for k, n in enumerate(('Head_0', 'Head_1', 'Head_2')):
        повернуть(T(n), Z, math.radians(3) * math.sin(2 * math.pi * (2 * t) + k * 0.5))
    for k, n in enumerate(('Tail_0', 'Tail_1', 'Tail_2')):
        повернуть(T(n), Z, math.radians(6) * math.sin(2 * math.pi * t + k * 0.7))
    ключ(f)

# ---- удар: на задние лапы и вниз передними
опора = ((ARM.matrix_world @ P[T('1_Left_Limb_0')].bone.head_local) + (ARM.matrix_world @ P[T('1_Right_Limb_0')].bone.head_local)) / 2
def дыбы(угол, передние, шея, выпад=0.0, локоть=0.6):
    """Поднять корпус вокруг поперечной оси через бёдра (угол > 0 — нос вверх), задние ноги держат землю."""
    сброс()
    q = Quaternion(мир_ось(P[T('Root')], Y), -math.radians(угол))
    P[T('Root')].rotation_quaternion = q
    # поворот корня вокруг его головы; сдвинем так, чтобы бёдра остались на месте
    bpy.context.view_layer.update()
    после = ((ARM.matrix_world @ P[T('1_Left_Limb_0')].head) + (ARM.matrix_world @ P[T('1_Right_Limb_0')].head)) / 2
    сдвиг_мир = опора - после + Vector((выпад, 0, 0))          # выпад: всё тело вперёд (длина модели ~1)
    P[T('Root')].location = (ARM.matrix_world.to_3x3() @ P[T('Root')].bone.matrix_local.to_3x3()).inverted() @ сдвиг_мир
    for n in ('1_Left_Limb_0', '1_Right_Limb_0'):
        повернуть(T(n), Y, math.radians(угол) - math.atan2(выпад, 0.25))   # задние ноги вертикально; при выпаде — отставлены назад
    for n in ('0_Left_Limb_0', '0_Right_Limb_0'):
        повернуть(T(n), Y, math.radians(передние))                   # передние: + вперёд
    for n in ('0_Left_Limb_1', '0_Right_Limb_1'):
        повернуть(T(n), Y, math.radians(-передние * локоть))
    for n in ('Head_0', 'Head_1'):
        повернуть(T(n), Y, -math.radians(шея))                        # + шея вверх
# 303 — топот С ВЫПАДОМ (владелец: «топать вперёд, а не под себя»): тело вперёд, передние лапы далеко впереди,
# почти прямые, нос вниз.
УДАР = {301: (14, 20, 5, 0.0, 0.6), 302: (42, 50, 15, -0.02, 0.6), 303: (-8, -38, -15, 0.12, 0.15)}   # поворот вокруг +Y с плюсом уводит ступню назад — вперёд это минус
for f, (у, п, ш, вып, лок) in УДАР.items():
    дыбы(у, п, ш, вып, лок); ключ(f)

# ---- смерть: на бок (вокруг продольной оси через стопы левой стороны)
for f, угол in ((401, 40), (402, 85)):
    сброс()
    P[T('Root')].rotation_quaternion = Quaternion(мир_ось(P[T('Root')], X), math.radians(угол))
    ключ(f)

SC.frame_start, SC.frame_end = 1, ПЕРИОД
bpy.ops.wm.save_as_mainfile(filepath=арг[1])
print('ГОТОВО', flush=True)
