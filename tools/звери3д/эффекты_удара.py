# эффекты_удара.py <сырые_кадры> : огненные лапы, огненная дуга, трещины и пыль на кадрах удара «молот».
# Работает по сырым кадрам Blender (512 px), до перевода в игру, поэтому эффекты попадают в рамку кадра и якоря
# остаются верными. Точки берутся из якоря.json (спрайты.py пишет *_руки, *_кисти, *_земля для кадров удара).
# Размеры задаются в пикселях ИГРЫ и пересчитываются по росту стойки (38 px ≈ высота стойки в сыром кадре).
#   кадр 1 (замах) — горят сцепленные лапы; кадр 2 (удар) — горят лапы, огненная дуга от замаха до земли,
#   вспышка, трещины и пыль на земле (под телом).
import sys, os, json, math, random
from PIL import Image, ImageDraw
сыр = sys.argv[1]
РОСТ = float(os.environ.get('ROST', '38'))
я = json.load(open(os.path.join(сыр, 'якоря.json')))
bb = Image.open(os.path.join(сыр, 'стойка_4_0.png')).getbbox()
G = (bb[3] - bb[1]) / РОСТ                     # сырых px на пиксель игры
random.seed(18)

def огонь(слой, x, y, r):
    d = ImageDraw.Draw(слой)
    for рад, цв in ((r * 1.0, (170, 25, 5, 230)), (r * 0.72, (250, 110, 0, 245)), (r * 0.42, (255, 225, 70, 255))):
        d.ellipse((x - рад, y - рад, x + рад, y + рад), fill=цв)
    for k in range(4):                          # языки пламени вверх
        a = math.radians(-90 + random.uniform(-35, 35)); дл = r * random.uniform(1.2, 1.9)
        d.polygon([(x - r * 0.35, y), (x + r * 0.35, y), (x + math.cos(a) * дл, y + math.sin(a) * дл)], fill=(250, 120, 0, 235))

def дуга(слой, p0, p1, ширина):
    """Огненный след удара: толстая короткая «подкова» над лапами (последняя часть пути замах → удар)."""
    d = ImageDraw.Draw(слой)
    c = (p0[0] + (p1[0] - p0[0]) * 0.75, min(p0[1], p1[1]) - 3 * G)
    def точка(t): return ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1])
    ts = [0.55 + 0.45 * i / 16 for i in range(17)]           # только хвост пути — у самих лап
    for w, цв in ((ширина * 2.2, (170, 25, 5, 215)), (ширина * 1.5, (250, 110, 0, 235)), (ширина * 0.8, (255, 225, 70, 255))):
        for i in range(len(ts) - 1):
            ww = max(1, int(w * (0.3 + 0.7 * i / (len(ts) - 1))))
            d.line([точка(ts[i]), точка(ts[i + 1])], fill=цв, width=ww)
            r = ww / 2; x, y = точка(ts[i + 1]); d.ellipse((x - r, y - r, x + r, y + r), fill=цв)

def трещины(слой, x, y):
    """Раскалённые трещины: тёмный разлом с огненной серединой, 6 лучей от точки удара."""
    d = ImageDraw.Draw(слой)
    лучи = []
    for k in range(6):
        a = math.radians(k * 60 + random.uniform(-18, 18)); дл = random.uniform(8, 12) * G
        px, py = x, y; путь = [(px, py)]
        for шаг in range(4):
            aa = a + random.uniform(-0.45, 0.45); l = дл / 4
            px, py = px + math.cos(aa) * l, py + math.sin(aa) * l * 0.8; путь.append((px, py))
        лучи.append(путь)
    for путь in лучи: d.line(путь, fill=(25, 12, 6, 255), width=max(2, int(G * 2.0)), joint='curve')
    for путь in лучи: d.line(путь[:4], fill=(250, 110, 0, 255), width=max(1, int(G * 0.9)), joint='curve')
    r = 2.2 * G; d.ellipse((x - r, y - r * 0.8, x + r, y + r * 0.8), fill=(255, 200, 60, 255))

def пыль(слой, x, y):
    d = ImageDraw.Draw(слой)
    for k in range(7):
        a = math.radians(k * 51 + random.uniform(-10, 10)); р = random.uniform(6, 9) * G
        cx, cy = x + math.cos(a) * р, y + math.sin(a) * р * 0.6 - 1 * G
        rr = random.uniform(1.4, 2.4) * G
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(196, 176, 136, 215))

for д in range(5):
    for ф in (1, 2):
        имя = f'удар_{д}_{ф}'; путь = os.path.join(сыр, имя + '.png')
        тело = Image.open(путь).convert('RGBA')
        низ = Image.new('RGBA', тело.size, (0, 0, 0, 0)); верх = Image.new('RGBA', тело.size, (0, 0, 0, 0))
        if ф == 2:
            # Трещины и пыль на земле выключены (владелец 04.10: лапы до земли не достают, тень от взрыва есть —
            # «кажется, что парит»). Включить: GROUND=1.
            if os.environ.get('GROUND') == '1':
                gx, gy = я[имя + '_земля']
                трещины(низ, gx, gy); пыль(низ, gx, gy)
            дуга(верх, я[f'удар_{д}_1_руки'], я[имя + '_руки'], 2.2 * G)
        спиной = д in (0, 1)
        for кx, кy in я[имя + '_кисти']:
            огонь(верх, кx, кy, (2.4 if ф == 2 else 2.0) * G * (1.5 if спиной else 1))
        if спиной and имя + '_локти' in я:      # огонь вдоль предплечий: виден ниже полосы жизни
            for (лx, лy), (кx, кy) in zip(я[имя + '_локти'], я[имя + '_кисти']):
                for t in (0.25, 0.5, 0.75):
                    огонь(верх, лx + (кx - лx) * t, лy + (кy - лy) * t, 1.5 * G)
        out = Image.alpha_composite(Image.alpha_composite(низ, тело), верх)
        out.save(путь)
print('эффекты: готово, G =', round(G, 2))
