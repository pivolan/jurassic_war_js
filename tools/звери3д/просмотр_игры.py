# просмотр_игры.py <кадры> <выход.gif>: 8 направлений × (ходьба, удар, смерть) на траве, ×3 — для глаз владельца
import sys
from PIL import Image
import numpy as np
K, ВЫХ = sys.argv[1].rstrip('/') + '/', sys.argv[2]
def кадр(имя, зерк=False):
    p = Image.open(K + имя + '.png'); im = p.convert('RGBA')
    im.putalpha(Image.fromarray(((np.array(p) > 0) * 255).astype(np.uint8)))
    return im.transpose(Image.FLIP_LEFT_RIGHT) if зерк else im
ДИР = [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0), (3, 1), (2, 1), (1, 1)]
ЯЧ, Z = 100, 3
кадры = []
for t in range(16):
    f = Image.new('RGBA', (ЯЧ * 8, ЯЧ * 3), (52, 92, 40, 255))
    for c, (д, з) in enumerate(ДИР):
        уд = (t // 2) % 4; см = (t // 4) % 4
        for r, имя in enumerate((f'ход_{д}_{t % 4}', f'удар_{д}_{уд}' if уд < 3 else f'стойка_{д}_0',
                                 f'смерть_{0 if д in (0, 1, 2) else 4}_{см}' if см < 2 else f'стойка_{д}_0')):
            im = кадр(имя, з)
            f.alpha_composite(im, (c * ЯЧ + (ЯЧ - im.width) // 2, r * ЯЧ + ЯЧ - 6 - im.height))
    кадры.append(f.resize((f.width * Z, f.height * Z), Image.NEAREST).convert('RGB'))
кадры[0].save(ВЫХ, save_all=True, append_images=кадры[1:], duration=160, loop=0)
кадры[0].save(ВЫХ.replace('.gif', '_кадр.png'))
print('ok', кадры[0].size)
