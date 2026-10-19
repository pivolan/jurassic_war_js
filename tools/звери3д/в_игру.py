# в_игру.py <сырые> <выход> <рост_стойки_юг>: кадры Blender (RGBA 512) → спрайты игры в палитре MAIN.PAL.
# Один масштаб на все кадры (по росту стойки с юга), обрезка по альфе, индекс 0 — прозрачно.
# Цвета 0xc0..0xdf и 0/1 не берём: это игровые служебные (тень — индекс 1, циклящиеся цвета).
import sys, os, glob
sys.path.append('tools'); import trc
import numpy as np
from PIL import Image, ImageEnhance
сыр, вых, рост_арг = sys.argv[1], sys.argv[2], sys.argv[3]
# Рендер выходит тусклым (кожа ~ (92,40,47)), и ближайшим в палитре оказывался коричневый, а не красный.
# Спрайты оригинала яркие и насыщенные — поднимаем насыщенность и яркость до перевода в палитру.
НАСЫЩ = float(os.environ.get('SAT', '1.7')); ЯРК = float(os.environ.get('BRI', '1.25'))
os.makedirs(вых, exist_ok=True)
_, e = trc.load('PWAR/_PWAR01.TRC'); pal = list(trc.get(e, 'MAIN.PAL')['data'])
P = np.array(pal, dtype=np.int32).reshape(256, 3)
можно = [i for i in range(2, 256) if not (0xc0 <= i < 0xe0) and i != 64]; Pm = P[можно]
ПЫЛЬ = 64            # особый индекс: блиттер смешивает землю с песочным (scene.js); слой — файл *_пыль.png
# рост: число — высота стойки с юга (демон 38); «w:125» — длина стойки в профиль (бронтозавр, чуть длиннее рекса)
if рост_арг.startswith('w:'):
    эталон = Image.open(f'{сыр}/стойка_2_0.png'); bb = эталон.getbbox(); k = float(рост_арг[2:]) / (bb[2] - bb[0])
else:
    эталон = Image.open(f'{сыр}/стойка_4_0.png'); bb = эталон.getbbox(); k = float(рост_арг) / (bb[3] - bb[1])
print('масштаб', round(k, 4))
import json
сырые_якоря = json.load(open(f'{сыр}/якоря.json')) if os.path.exists(f'{сыр}/якоря.json') else {}
якоря = {}
for f in sorted(glob.glob(f'{сыр}/*.png')):
    if f.endswith('_тень.png') or f.endswith('_пыль.png'): continue
    im = Image.open(f).convert('RGBA')
    # тень из теневого прохода (спрайты.py): кадр берём по общей рамке тела и тени
    тп = f[:-4] + '_тень.png'
    тень_im = Image.open(тп).convert('RGBA') if os.path.exists(тп) else None
    пп = f[:-4] + '_пыль.png'
    пыль_im = Image.open(пп).convert('RGBA') if os.path.exists(пп) else None
    рамки = [im.getbbox()]
    for слой in (тень_im, пыль_im):
        if слой is not None:
            bx = Image.fromarray(((np.array(слой)[:, :, 3] > 70) * 255).astype(np.uint8)).getbbox()
            if bx: рамки.append(bx)
    bb = (min(r[0] for r in рамки), min(r[1] for r in рамки), max(r[2] for r in рамки), max(r[3] for r in рамки))
    c = im.crop(bb)
    w, h = max(1, round(c.width * k)), max(1, round(c.height * k))
    c = c.resize((w, h), Image.LANCZOS)
    альфа = c.getchannel('A')
    c = ImageEnhance.Brightness(ImageEnhance.Color(c.convert('RGB')).enhance(НАСЫЩ)).enhance(ЯРК).convert('RGBA'); c.putalpha(альфа)
    a = np.array(c).astype(int); маска = a[:, :, 3] > 110
    rgb = a[:, :, :3].reshape(-1, 3)
    d = ((rgb[:, None, :] - Pm[None, :, :]) ** 2).sum(2); idx = np.array(можно)[d.argmin(1)].reshape(h, w)
    idx[~маска] = 0

    if тень_im is not None:   # тень — индекс 1: блиттер затемняет под ним землю, как у всех юнитов игры
        тм = np.array(тень_im.crop(bb).resize((w, h), Image.LANCZOS))[:, :, 3] > 90
        idx[тм & ~маска] = 1
    if пыль_im is not None:   # пыль — индекс 64: полупрозрачное осветление земли (scene.js, лутПыли)
        пм = np.array(пыль_im.crop(bb).resize((w, h), Image.LANCZOS))[:, :, 3] > 90
        idx[пм & ~маска] = ПЫЛЬ
    q = Image.fromarray(idx.astype(np.uint8), 'P'); q.putpalette(pal)
    q.save(os.path.join(вых, os.path.basename(f)))
    имя = os.path.basename(f)[:-4]; я = сырые_якоря.get(имя)
    if я: якоря[имя] = [round((я[0] - bb[0]) * k, 1), round((я[1] - bb[1]) * k, 1)]   # точка земли под тазом в кадре игры
json.dump(якоря, open(os.path.join(вых, 'якоря.json'), 'w'), ensure_ascii=False, indent=0)
print('кадров', len([x for x in glob.glob(f'{вых}/*.png')]))
