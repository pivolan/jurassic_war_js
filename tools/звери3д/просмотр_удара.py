# просмотр_удара.py <кадры> : удар во всех 8 направлениях в игровом размере ×3 (gif + лист трёх фаз)
import sys
from PIL import Image
import numpy as np
K = sys.argv[1].rstrip('/') + '/'
def кадр(имя, з=False):
    p = Image.open(K + имя + '.png'); im = p.convert('RGBA'); im.putalpha(Image.fromarray(((np.array(p) > 0) * 255).astype(np.uint8)))
    return im.transpose(Image.FLIP_LEFT_RIGHT) if з else im
ДИР = [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0), (3, 1), (2, 1), (1, 1)]
fr = []
for t in range(12):
    f = Image.new('RGBA', (8 * 70, 80), (52, 92, 40, 255))
    for c, (д, з) in enumerate(ДИР):
        ф = t % 4; имя = f'удар_{д}_{ф}' if ф < 3 else f'стойка_{д}_0'
        im = кадр(имя, з); f.alpha_composite(im, (c * 70 + (70 - im.width) // 2, 78 - im.height))
    fr.append(f.resize((f.width * 3, f.height * 3), Image.NEAREST).convert('RGB'))
fr[0].save(K + '../удар.gif', save_all=True, append_images=fr[1:], duration=180, loop=0)
big = Image.new('RGB', (fr[0].width, fr[0].height * 3))
for k in range(3): big.paste(fr[k], (0, k * fr[0].height))
big.save(K + '../удар_кадры.png')
