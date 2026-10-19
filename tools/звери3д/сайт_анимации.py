# Анимированные WebP новых зверей для сайта (out/site/new_beasts): ходьба и удар, на траве, ×3.
#   python3 tools/звери3д/сайт_анимации.py
import os
from PIL import Image
import numpy as np
ВЫХ = 'out/site/new_beasts'
ЗВЕРИ = {'daemon': 'out/новые_звери/демон_3д/кадры_v8', 'brontosaurus': 'out/новые_звери/бронтоА_3д/кадры'}
def кадр(п, зерк=False):
    p = Image.open(п); a = np.array(p); rgba = np.array(p.convert('RGBA')); rgba[a == 0, 3] = 0; rgba[a == 1] = (0, 0, 0, 100)
    im = Image.fromarray(rgba); return im.transpose(Image.FLIP_LEFT_RIGHT) if зерк else im
for имя, К in ЗВЕРИ.items():
    for вид, посл, д in (('walk', [f'ход_{{д}}_{i}' for i in range(4)], 3), ('attack', ['стойка_{д}_0', 'удар_{д}_0', 'удар_{д}_1', 'удар_{д}_2'], 3)):
        ims = [кадр(f'{К}/{n.format(д=д)}.png') for n in посл]
        W = max(i.width for i in ims) + 16; H = max(i.height for i in ims) + 12
        out = []
        for im in ims:
            f = Image.new('RGBA', (W, H), (58, 96, 44, 255)); f.alpha_composite(im, ((W - im.width) // 2, H - 6 - im.height))
            out.append(f.resize((W * 3, H * 3), Image.NEAREST))
        длит = [220] * len(out) if вид == 'walk' else [400, 160, 160, 300]
        out[0].save(f'{ВЫХ}/{имя}-{вид}.webp', save_all=True, append_images=out[1:], duration=длит, loop=0, lossless=True)
        print(имя, вид, out[0].size)
