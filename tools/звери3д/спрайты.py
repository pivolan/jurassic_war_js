# Съёмка кадров для игры с анимированной модели.
#   blender -b клип.blend -P спрайты.py -- вид(ход|удар|стойка|смерть) папка [наклон]
# Камера ортографическая, смотрит на север под наклоном (по умолчанию 60° над горизонтом — так у зверей оригинала:
# у тираннозавра вид сверху вытянут вдоль тела, сбоку низкий). Масштаб у всех кадров один (ortho по росту модели
# в покое), центр — над тазом по горизонтали и на полу по высоте, поэтому кадры потом режутся по маске без сдвигов.
# Направления как в нарезке: 0 север (уходит от камеры), 1 СВ, 2 восток, 3 ЮВ, 4 юг (лицом к камере).
import bpy, sys, math, os
ТАЗ = os.environ.get('PELVIS', 'pelvis')   # корневая кость тела (у Tripo quadruped — tripo::Root)
from mathutils import Vector, Matrix
арг = sys.argv[sys.argv.index('--') + 1:]
ВИД, ПАПКА = арг[0], арг[1]
НАКЛОН = math.radians(float(арг[2]) if len(арг) > 2 else 60)
os.makedirs(ПАПКА, exist_ok=True)
SC = bpy.context.scene
ARM = [o for o in SC.objects if o.type == 'ARMATURE'][0]
меш = [o for o in SC.objects if o.type == 'MESH'][0]
SC.render.engine = 'BLENDER_EEVEE'
SC.render.resolution_x = SC.render.resolution_y = 512
SC.render.film_transparent = True
SC.view_settings.view_transform = 'Standard'
мир = bpy.data.worlds.new('w'); SC.world = мир; мир.use_nodes = True
мир.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1); мир.node_tree.nodes['Background'].inputs[1].default_value = 0.45
# свет сверху-справа, как у спрайтов игры (тень падает влево-вниз)
солнце = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); SC.collection.objects.link(солнце)
солнце.data.energy = 4.0; солнце.rotation_euler = (math.radians(35), math.radians(25), math.radians(20))
# ТЕНЬ — настоящая проекция тела на землю (владелец 04.10: «у человека ноги точно привязаны к тени, у демона тень
# ниже ступней — кажется, что парит»). Второй проход Cycles: модель невидима для камеры, но отбрасывает тень на
# плоскость-ловушку на уровне пола. Свет теневого прохода — сверху-справа-сзади, тень ложится влево-вниз, как у людей.
ТЕНЬ_СВЕТ = Vector((0.0, -0.08, -1.0)).normalized()    # солнце почти отвесно, как у людей: тень компактно под ногами, при зеркале не меняется
кам = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); SC.collection.objects.link(кам); SC.camera = кам

# модель в покое: рост и пол
сохр = SC.frame_current
ARM.data.pose_position = 'REST'; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); ev = меш.evaluated_get(dg)
zs = [(меш.matrix_world @ v.co).z for v in ev.data.vertices]
H = max(zs) - min(zs); ПОЛ = min(zs)
# длинные звери (бронтозавр): кадр по наибольшему размеру, не только по росту
все_т = [(меш.matrix_world @ v.co) for v in ev.data.vertices]
ДЛ = max(max(v.x for v in все_т) - min(v.x for v in все_т), max(v.y for v in все_т) - min(v.y for v in все_т))
H = max(H, ДЛ * 0.75)
ARM.data.pose_position = 'POSE'; bpy.context.view_layer.update()
кам.data.type = 'ORTHO'; кам.data.ortho_scale = H * 1.6; кам.data.clip_end = H * 50

def таз(): return ARM.matrix_world @ ARM.pose.bones[ТАЗ].head
def кость(n): return ARM.matrix_world @ ARM.pose.bones[n].head

# поворот модели на направление: модель смотрит на +X (восток); север = +Y
ПОВОРОТ = {0: 90, 1: 45, 2: 0, 3: -45, 4: -90}
исх_rot = ARM.rotation_euler.copy(); исх_loc = ARM.location.copy()

_пол = None
def теневой_проход(путь):
    global _пол
    if _пол is None:
        bpy.ops.mesh.primitive_plane_add(size=H * 20, location=(0, 0, ПОЛ))
        _пол = bpy.context.active_object; _пол.is_shadow_catcher = True
    _пол.location = (таз().x, таз().y, ПОЛ)
    сохр = (SC.render.engine, солнце.rotation_euler.copy(), солнце.data.angle)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = 8; SC.cycles.use_denoising = False; SC.cycles.device = 'CPU'
    солнце.rotation_euler = ТЕНЬ_СВЕТ.to_track_quat('-Z', 'Y').to_euler(); солнце.data.angle = math.radians(1)
    меш.visible_camera = False; _пол.hide_render = False
    SC.render.filepath = путь; bpy.ops.render.render(write_still=True)
    меш.visible_camera = True; _пол.hide_render = True
    SC.render.engine, солнце.rotation_euler, солнце.data.angle = сохр[0], сохр[1], сохр[2]

def снять(f, д, имя, центр=None, доп=None, падение=None):
    SC.frame_set(f)
    ARM.matrix_world = Matrix.LocRotScale(исх_loc, исх_rot, None)
    bpy.context.view_layer.update()            # иначе matrix_world и таз — от прошлого кадра
    p0 = таз()
    # поворачиваем вокруг вертикали через таз
    R = Matrix.Rotation(math.radians(ПОВОРОТ[д]), 4, 'Z')
    T = Matrix.Translation(Vector((p0.x, p0.y, 0))) @ R @ Matrix.Translation(Vector((-p0.x, -p0.y, 0)))
    if падение is not None and падение != 'готово':
        # навзничь: поворот вокруг оси Y (поперёк взгляда +X) через точку между копытами, со сдвигом назад
        # Лицом к камере (юг) — падает вперёд, ничком: навзничь от камеры сверху он выглядел бы стоящим.
        угол, j = падение
        вперёд_пад = д == 4
        знак = 1 if вперёд_пад else -1
        стопы = Vector((p0.x, p0.y, ПОЛ))
        доп = Matrix.Translation(Vector((знак * H * 0.12 * (j + 1), 0, 0))) @ Matrix.Translation(стопы) @ Matrix.Rotation(math.radians(знак * угол), 4, 'Y') @ Matrix.Translation(-стопы)
    if доп is not None: T = T @ доп
    ARM.matrix_world = T @ Matrix.LocRotScale(исх_loc, исх_rot, None)
    bpy.context.view_layer.update()
    ц = Vector((p0.x, p0.y, ПОЛ + H * 0.3)) if центр is None else центр
    if падение is not None:      # лежащее тело уезжает от таза — центр кадра по самому телу
        dg = bpy.context.evaluated_depsgraph_get(); ev = меш.evaluated_get(dg)
        тчк = [меш.matrix_world @ v.co for v in ev.data.vertices]
        ц = Vector(tuple((min(t[i] for t in тчк) + max(t[i] for t in тчк)) / 2 for i in range(3)))
    д_кам = H * 6
    кам.location = ц + Vector((0, -math.cos(НАКЛОН) * д_кам, math.sin(НАКЛОН) * д_кам))
    кам.rotation_euler = (math.radians(90) - НАКЛОН, 0, 0)
    SC.render.filepath = os.path.join(ПАПКА, имя + '.png')
    bpy.ops.render.render(write_still=True)
    if os.environ.get('NO_SHADOW') != '1':
        теневой_проход(os.path.join(ПАПКА, имя + '_тень.png'))
    # якорь: куда на картинке ложится точка земли под тазом (центр камеры минус 0.3H по вертикали, вид под НАКЛОН)
    import json
    пикс = SC.render.resolution_x / кам.data.ortho_scale
    if падение is None:
        земля = Vector((ц.x if центр is None else центр.x, ц.y if центр is None else центр.y, ПОЛ))
        # экранные координаты точки «земля» относительно центра кадра: сдвиг по Y мира виден как sin, по Z — как cos
        dx = (земля.x - ц.x) * пикс
        dy = ((ц.z - земля.z) * math.cos(НАКЛОН) - (земля.y - ц.y) * math.sin(НАКЛОН)) * пикс
        я = [SC.render.resolution_x / 2 + dx, SC.render.resolution_y / 2 + dy]
    else:
        я = None
    путь = os.path.join(ПАПКА, 'якоря.json')
    все = json.load(open(путь)) if os.path.exists(путь) else {}
    все[имя] = я
    # для эффектов удара (огонь, трещины): где на картинке лапы и точка земли под ними
    def экран(W):
        return [SC.render.resolution_x / 2 + (W.x - ц.x) * пикс,
                SC.render.resolution_y / 2 - ((W.z - ц.z) * math.cos(НАКЛОН) + (W.y - ц.y) * math.sin(НАКЛОН)) * пикс]
    if имя.startswith('удар'):
        КИСТИ = os.environ.get('HANDS', 'left_wrist,right_wrist').split(',')
        ЛОКТИ = os.environ.get('ELBOWS', 'left_elbow,right_elbow').split(',')
        руки = sum((ARM.matrix_world @ ARM.pose.bones[n].head for n in КИСТИ), Vector()) / len(КИСТИ)
        кисти = [экран(ARM.matrix_world @ ARM.pose.bones[n].head) for n in КИСТИ]
        все[имя + '_руки'] = экран(руки); все[имя + '_кисти'] = кисти
        все[имя + '_локти'] = [экран(ARM.matrix_world @ ARM.pose.bones[n].head) for n in ЛОКТИ]
        все[имя + '_земля'] = экран(Vector((руки.x, руки.y, ПОЛ)))
        все[имя + '_пикс'] = пикс / 1.0 * H / 100
    json.dump(все, open(путь, 'w'), ensure_ascii=False, indent=0)

f0, f1 = SC.frame_start, SC.frame_end
вперёд = Vector((1, 0, 0))
def вынос(f, n):  # насколько точка ушла вперёд от таза (в осях модели до поворота)
    SC.frame_set(f); return (кость(n) - таз()).dot(вперёд)

if ВИД == 'ход' and os.environ.get('WALK_FRAMES'):      # анимация кодом (бронтозавр): кадры заданы
    for д in range(5):
        for j, f in enumerate(map(int, os.environ['WALK_FRAMES'].split(','))): снять(f, д, f'ход_{д}_{j}')
elif ВИД == 'стойка' and os.environ.get('STAND_FRAME'):
    for д in range(5): снять(int(os.environ['STAND_FRAME']), д, f'стойка_{д}_0')
elif ВИД == 'смерть' and os.environ.get('DEATH_FRAMES'):  # падение уже в анимации — центр по телу
    for д in (0, 4):
        for j, f in enumerate(map(int, os.environ['DEATH_FRAMES'].split(','))): снять(f, д, f'смерть_{д}_{j}', падение='готово')
elif ВИД in ('ход', 'стойка'):
    # цикл шага: моменты, когда левое копыто дальше всего впереди
    d = [вынос(f, 'left_ankle') - вынос(f, 'right_ankle') for f in range(f0, f1 + 1)]
    пики = [i for i in range(1, len(d) - 1) if d[i] >= d[i - 1] and d[i] >= d[i + 1] and d[i] > 0.3 * max(d)]
    if len(пики) >= 2: t0, P = пики[0], пики[1] - пики[0]
    else: t0, P = 0, len(d) - 1
    print('цикл: начало', t0 + f0, 'длина', P, 'пики', [p + f0 for p in пики], flush=True)
    if ВИД == 'ход':
        кадры = [f0 + t0 + round(P * j / 4) for j in range(4)]
        for д in range(5):
            for j, f in enumerate(кадры): снять(f, д, f'ход_{д}_{j}')
    else:
        # стойка: внутри цикла, где копыта ближе всего друг к другу
        fs = list(range(f0 + t0, f0 + t0 + P))
        f = min(fs, key=lambda f: abs(вынос(f, 'left_ankle') - вынос(f, 'right_ankle')))
        for д in range(5): снять(f, д, f'стойка_{д}_0')
elif ВИД == 'удар':
    # пик удара — когда кисть дальше всего впереди; замах — за треть до пика, возврат — после
    if not os.environ.get('ATTACK_FRAMES'):
        руки = [(max(вынос(f, 'right_wrist'), вынос(f, 'left_wrist')), f) for f in range(f0, f1 + 1)]
        пик = max(руки)[1]
        замах = min((r for r in руки if r[1] < пик), default=руки[0])[1]
        возврат = min(f1, пик + max(2, (пик - замах) // 2))
    else:
        замах = пик = возврат = 0
    if os.environ.get('ATTACK_FRAMES'):     # ручной удар (удар_лапой.py): кадры известны заранее
        замах, пик, возврат = map(int, os.environ['ATTACK_FRAMES'].split(','))
    print('удар: замах', замах, 'пик', пик, 'возврат', возврат, flush=True)
    SC.frame_set(замах); ARM.matrix_world = Matrix.LocRotScale(исх_loc, исх_rot, None); bpy.context.view_layer.update()
    п0 = таз(); центр_удара = Vector((п0.x, п0.y, ПОЛ + H * 0.3))
    for д in range(5):
        for j, f in enumerate((замах, пик, возврат)): снять(f, д, f'удар_{д}_{j}', центр=центр_удара)
elif ВИД == 'смерть':
    # падение навзничь из стойки: поворот всего тела назад вокруг оси через копыта
    f = f0
    SC.frame_set(f)
    for д in (0, 4):
        for j, угол in enumerate((40, 80)):
            снять(f, д, f'смерть_{д}_{j}', падение=(угол, j))
print('ГОТОВО', ВИД, flush=True)
