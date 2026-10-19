# лист.py <кадры> <вид: удар|ход|смерть> <выход.png> : лист для глаз владельца.
# По вертикали — направления (С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ), по горизонтали — время (кадры анимации по порядку).
# Первый столбец — стойка этого направления. Кадры в игровом размере ×3, с подписями. Зеркальные направления
# (ЮЗ, З, СЗ) — отражения ЮВ, В, СВ, как их рисует игра.
import sys
from PIL import Image, ImageDraw
import numpy as np
K, ВИД, ВЫХ = sys.argv[1].rstrip('/') + '/', sys.argv[2], sys.argv[3]
Z, ЯЧ, ЛЕВ, ВЕРХ = 3, 80, 40, 18
ДИР = [('С', 0, 0), ('СВ', 1, 0), ('В', 2, 0), ('ЮВ', 3, 0), ('Ю', 4, 0), ('ЮЗ', 3, 1), ('З', 2, 1), ('СЗ', 1, 1)]
def кадр(имя, з):
    p = Image.open(K + имя + '.png'); a = np.array(p); im = p.convert('RGBA')
    rgba = np.array(im); rgba[a == 0, 3] = 0; rgba[a == 1] = (0, 0, 0, 110)           # тень полупрозрачной
    rgba[a == 64] = (200, 180, 140, 140)                                                # пыль — как её смешает игра
    im = Image.fromarray(rgba)
    return im.transpose(Image.FLIP_LEFT_RIGHT) if з else im
if ВИД == 'удар': столбцы = [('стойка', 'стойка_{д}_0'), ('1 подготовка', 'удар_{д}_0'), ('2 замах', 'удар_{д}_1'), ('3 УДАР (урон)', 'удар_{д}_2')]
elif ВИД == 'ход': столбцы = [('стойка', 'стойка_{д}_0')] + [(f'шаг {i + 1}', f'ход_{{д}}_{i}') for i in range(4)]
else: столбцы = [('стойка', 'стойка_{д}_0'), ('падает', 'смерть_{д}_0'), ('лежит', 'смерть_{д}_1')]
строки = ДИР if ВИД != 'смерть' else [('С', 0, 0), ('Ю', 4, 0)]
import glob as _g
ЯЧ = max(ЯЧ, max(max(Image.open(f).size) for f in _g.glob(K + '*.png')) + 12)   # клетка по самому большому кадру
W = ЛЕВ + len(столбцы) * ЯЧ; H = ВЕРХ + len(строки) * ЯЧ
лист = Image.new('RGBA', (W, H), (52, 92, 40, 255)); d = ImageDraw.Draw(лист)
from PIL import ImageFont
try: шрифт = ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', 9)
except OSError: шрифт = None
for c, (подп, _) in enumerate(столбцы): d.text((ЛЕВ + c * ЯЧ + 4, 3), подп, fill=(255, 255, 210, 255), font=шрифт)
for r, (имя_н, д, з) in enumerate(строки):
    d.text((6, ВЕРХ + r * ЯЧ + ЯЧ // 2 - 6), имя_н, fill=(255, 255, 210, 255), font=шрифт)
    for c, (_, шаблон) in enumerate(столбцы):
        im = кадр(шаблон.format(д=д), з)
        x = ЛЕВ + c * ЯЧ + (ЯЧ - im.width) // 2; y = ВЕРХ + r * ЯЧ + ЯЧ - 8 - im.height
        лист.alpha_composite(im, (x, y))
    d.line((0, ВЕРХ + (r + 1) * ЯЧ - 1, W, ВЕРХ + (r + 1) * ЯЧ - 1), fill=(35, 65, 28, 255))
for c in range(len(столбцы) + 1): d.line((ЛЕВ + c * ЯЧ, 0, ЛЕВ + c * ЯЧ, H), fill=(35, 65, 28, 255))
лист.resize((W * Z, H * Z), Image.NEAREST).convert('RGB').save(ВЫХ)
print('лист', ВЫХ, W * Z, H * Z)
