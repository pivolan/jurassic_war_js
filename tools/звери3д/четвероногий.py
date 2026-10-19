# Анимация четвероногого (бронтозавр и др.) по скелету Tripo quadruped — кости находим ПО ГЕОМЕТРИИ,
# а не по именам (у второй модели Tripo перепутал имена: шея звалась 0_Right_Limb, передние ноги — bone_10…).
#   blender -b -P четвероногий.py -- модель_rig.glb выход.blend
# Окружение: NECK=0.7 — укоротить шею (масштаб звеньев по длине), STEP_AMP=25 — размах шага в градусах.
# Кадры: 1..32 шаг (стойка — 1), 301–303 удар «мини-дыбы, вариант 3» (низко, длинный выпад, хвост — противовес),
#        401/402 падение на бок. Модель смотрит на +X, лево зверя — +Y.
import bpy, sys, math, os
from mathutils import Vector, Matrix
арг = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=арг[0])
SC = bpy.context.scene
ARM = [o for o in SC.objects if o.type == 'ARMATURE'][0]
for o in list(SC.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
P = ARM.pose.bones; B = ARM.data.bones
for pb in P: pb.rotation_mode = 'QUATERNION'
W = lambda b: ARM.matrix_world @ b.head_local          # голова кости в мире (покой)

# ---------- разбор скелета
корень = [b for b in B if b.parent is None][0]
листья = [b for b in B if not b.children]
пол = min(W(b).z for b in B)
ступни = [b for b in листья if W(b).z < пол + 0.04 * max(ARM.dimensions)]
def цепь_до_развилки(лист):
    ц = [лист]
    while ц[-1].parent and len(ц[-1].parent.children) == 1: ц.append(ц[-1].parent)
    return list(reversed(ц))
НОГИ = {}
for с in ступни:
    ц = цепь_до_развилки(с)
    if len(ц) < 2: continue
    перед = W(ц[0]).x > W(корень).x
    лево = W(с).y > W(корень).y
    ключ = ('П' if перед else 'З') + ('Л' if лево else 'П')
    if ключ not in НОГИ or len(ц) > len(НОГИ[ключ]): НОГИ[ключ] = ц
ноги_кости = {b.name for ц in НОГИ.values() for b in ц}
def путь(до):
    п = [до]
    while п[-1].parent: п.append(п[-1].parent)
    return list(reversed(п))
голова = max((b for b in листья if b.name not in ноги_кости), key=lambda b: W(b).x)
кончик = min((b for b in листья if b.name not in ноги_кости), key=lambda b: W(b).x)
плечи_x = min(W(НОГИ[k][0]).x for k in НОГИ if k[0] == 'П')
бёдра_x = max(W(НОГИ[k][0]).x for k in НОГИ if k[0] == 'З')
# шея — кости пути к голове ПОСЛЕ развилки передних ног (плечевого пояса), позвонки — до неё (без корня)
к_голове = [b.name for b in путь(голова) if b.name != корень.name]
пояс = НОГИ['ПЛ'][0].parent.name
i = к_голове.index(пояс) if пояс in к_голове else -1
ШЕЯ = к_голове[i + 1:]
ПОЗВОНКИ = к_голове[:i + 1]
ХВОСТ = [b.name for b in путь(кончик) if b.name != корень.name and b.name not in к_голове]   # общий ствол — не хвост
print('НОГИ', {k: [b.name for b in v] for k, v in НОГИ.items()}, flush=True)
print('ШЕЯ', ШЕЯ, 'ПОЗВОНКИ', ПОЗВОНКИ, 'ХВОСТ', ХВОСТ, flush=True)
assert len(НОГИ) == 4, 'не нашлись четыре ноги'

# ---------- укоротить шею (масштаб звеньев по длине, без наследования — голова своего размера)
К_ШЕИ = float(os.environ.get('NECK', '1'))
if К_ШЕИ != 1:
    for n in ШЕЯ:
        P[n].scale = (1, К_ШЕИ, 1); B[n].inherit_scale = 'NONE'
bpy.context.view_layer.update()
# шею приподнять у основания (NECK_UP градусов, кончик чуть вниз — голова смотрит вперёд)
ПОДЪЁМ = float(os.environ.get('NECK_UP', '0'))
if ПОДЪЁМ and ШЕЯ:
    for n, д in zip(ШЕЯ, (1.0, 0.4, -0.3, -0.6, -0.5)):
        M = P[n].matrix.copy(); h = M.translation.copy()
        P[n].matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(-ПОДЪЁМ * д), 4, 'Y') @ Matrix.Translation(-h) @ M
        bpy.context.view_layer.update()
база = {pb.name: pb.matrix.copy() for pb in P}
порядок = [b.name for b in B]
H = max(ARM.dimensions)

def сброс():
    for n in порядок: P[n].matrix = база[n]; bpy.context.view_layer.update()
def крутить(n, ось, градусы):
    M = P[n].matrix.copy(); h = M.translation.copy()
    P[n].matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(градусы), 4, ось) @ Matrix.Translation(-h) @ M
    bpy.context.view_layer.update()
def сдвиг(вперёд=0.0, вверх=0.0):
    M = P[корень.name].matrix.copy(); P[корень.name].matrix = Matrix.Translation(Vector((вперёд * H, 0, вверх * H))) @ M
    bpy.context.view_layer.update()
def ключ(f):
    for n in порядок:
        for путь_ in ('rotation_quaternion', 'location', 'scale'): P[n].keyframe_insert(путь_, frame=f)
def нога(k, вперёд, сгиб):          # + вперёд; + сгиб уводит ступню назад
    ц = НОГИ[k]; крутить(ц[0].name, 'Y', -вперёд)
    if len(ц) > 2: крутить(ц[1].name, 'Y', сгиб)
def шея(вверх):
    for n in ШЕЯ: крутить(n, 'Y', -вверх / len(ШЕЯ))
def хвост_дуга(вверх, вбок=0.0):
    доли = [0.5 + i for i in range(len(ХВОСТ))]; s = sum(доли)
    for n, д in zip(ХВОСТ, доли):
        крутить(n, 'Y', вверх * д / s)
        if вбок: крутить(n, 'Z', вбок * д / s)
def дыбы(угол):
    крутить(корень.name, 'Y', -угол * 0.6)
    for n in ПОЗВОНКИ: крутить(n, 'Y', -угол * 0.4 / max(1, len(ПОЗВОНКИ)))
    for k in ('ЗЛ', 'ЗП'): крутить(НОГИ[k][0].name, 'Y', угол * 0.6)
    if ХВОСТ: крутить(ХВОСТ[0], 'Y', угол * 0.45)

# ---------- шаг: иноходь, четверть цикла между ногами
АМП = float(os.environ.get('STEP_AMP', '25'))
ФАЗА = {'ЗЛ': 0.0, 'ПЛ': 0.25, 'ЗП': 0.5, 'ПП': 0.75}
for f in range(1, 33):
    сброс(); t = (f - 1) / 32
    for k, ф0 in ФАЗА.items():
        ф = 2 * math.pi * (t + ф0)
        нога(k, АМП * math.sin(ф), (25 if k[0] == 'З' else 18) * max(0.0, math.cos(ф)))
    шея(3 * math.sin(4 * math.pi * t))
    хвост_дуга(0, 8 * math.sin(2 * math.pi * t))
    ключ(f)

# ---------- удар: мини-дыбы, вариант 3 (низко, длинный выпад); хвост — противовес
УДАР = [dict(д=4, п=(8, -8)), dict(д=10, п=(18, -20), ш=5), dict(д=-4, п=(26, 0), с=0.08, ш=-15)]
for k, п in enumerate(УДАР):
    сброс()
    дыбы(п['д'])
    if п.get('с'): сдвиг(п['с'])
    if п.get('ш'): шея(п['ш'])
    for н in ('ПЛ', 'ПП'): нога(н, *п['п'])
    хвост_дуга(-п['д'] * 2.0 + п.get('с', 0) * 900, (0, 6, -8)[k])
    ключ(301 + k)

# ---------- смерть: на бок вокруг продольной оси
for f, угол in ((401, 40), (402, 85)):
    сброс(); крутить(корень.name, 'X', угол); ключ(f)

SC.frame_start, SC.frame_end = 1, 32
bpy.ops.wm.save_as_mainfile(filepath=арг[1])
print('ГОТОВО', flush=True)
