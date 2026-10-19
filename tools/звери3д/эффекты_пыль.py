# эффекты_пыль.py <сырые_кадры> [рост_для_масштаба] : клубы пыли вокруг ступней в кадре удара (удар_д_2).
# Пыль кладётся отдельным слоем <кадр>_пыль.png: в_игру.py переводит её в индекс 64, а блиттер игры рисует его
# полупрозрачно — смешивает землю под пикселем с песочным (scene.js, лутПыли), как тень затемняет.
# Точки ступней — из якоря.json (*_кисти пишет спрайты.py; для бронтозавра HANDS = передние ступни).
import sys, os, json, math, random
from PIL import Image, ImageDraw
сыр = sys.argv[1]
я = json.load(open(os.path.join(сыр, 'якоря.json')))
bb = Image.open(os.path.join(сыр, 'стойка_2_0.png')).getbbox()
ДЛИНА = float(sys.argv[2]) if len(sys.argv) > 2 else 125.0
G = (bb[2] - bb[0]) / ДЛИНА                       # сырых px на пиксель игры (по длине стойки в профиль)
random.seed(15)
for д in range(5):
    имя = f'удар_{д}_2'; путь = os.path.join(сыр, имя + '.png')
    if not os.path.exists(путь) or имя + '_кисти' not in я: continue
    тело = Image.open(путь)
    слой = Image.new('RGBA', тело.size, (0, 0, 0, 0)); d = ImageDraw.Draw(слой)
    for кx, кy in я[имя + '_кисти']:
        for k in range(9):
            a = math.radians(k * 40 + random.uniform(-15, 15)); р = random.uniform(7, 14) * G
            cx, cy = кx + math.cos(a) * р, кy + math.sin(a) * р * 0.55 - 1 * G
            rr = random.uniform(3.0, 5.0) * G
            d.ellipse((cx - rr, cy - rr * 0.8, cx + rr, cy + rr * 0.8), fill=(255, 255, 255, 230))
    слой.save(os.path.join(сыр, имя + '_пыль.png'))
print('пыль: готово, G =', round(G, 2))
