#!/usr/bin/env python3
"""Каталог ресурсов интерфейса Jurassic War.

Рендерит записи паков 01/02/03/09 в PNG (палитра .PAL — 768 байт, 8-битные RGB,
индекс 0 прозрачный) и собирает контактные листы для просмотра пачками.

Использование (из <project>/re/jw):
  python3 tools/ui_catalog.py all            # отрендерить всё в out/img/ui/
  python3 tools/ui_catalog.py sheets         # контактные листы
  python3 tools/ui_catalog.py grid 02 163    # запись с координатной сеткой
  python3 tools/ui_catalog.py crop 02 163 x y w h [scale]
  python3 tools/ui_catalog.py diff 02 284 293 ...   # попарное сравнение записей
  python3 tools/ui_catalog.py wheels         # собрать колёса меню + титульный экран
  python3 tools/ui_catalog.py json           # пересобрать reimpl/data/ui_screens.json
  python3 tools/ui_catalog.py overlay        # экраны с наложенными хотспотами (hs_*.png)

Полный прогон: all -> sheets -> wheels -> json -> overlay.
Разбор результатов — notes/ui-screens.md.
"""
import os, sys, glob, re, struct
# tools/ содержит dis.py, который перекрывает стандартный модуль dis (его тянет
# inspect при импорте numpy) — убираем каталог скрипта из sys.path.
_d = os.path.dirname(os.path.abspath(__file__))
if sys.path and os.path.abspath(sys.path[0] or '.') == _d:
    sys.path.pop(0)
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT  = os.path.join(ROOT, 'out', 'extract')
OUT  = os.path.join(ROOT, 'out', 'img', 'ui')

PAL_MAIN  = os.path.join(EXT, '01C', '004_MAIN.PAL')
PAL_SETUP = os.path.join(EXT, '01C', '006_SETUP.PAL')


def load_pal(path):
    """768 байт, по 3 байта на цвет, компоненты уже 8-битные (в DAC уходят >>2)."""
    d = open(path, 'rb').read()
    assert len(d) == 768, (path, len(d))
    return [tuple(d[i * 3:i * 3 + 3]) for i in range(256)]


def raw_to_img(data, w, h, pal, alpha0=True):
    im = Image.new('RGBA', (w, h))
    px = im.load()
    for y in range(h):
        row = data[y * w:(y + 1) * w]
        for x, v in enumerate(row):
            r, g, b = pal[v]
            px[x, y] = (r, g, b, 0 if (alpha0 and v == 0) else 255)
    return im


def on_black(im):
    bg = Image.new('RGBA', im.size, (0, 0, 0, 255))
    return Image.alpha_composite(bg, im).convert('RGB')


# ---------------------------------------------------------------- источники

def pack02_entries():
    """[(idx, w, h, path)] для пака 02 (TRS: сырые 8bpp, размер в имени)."""
    out = []
    for p in sorted(glob.glob(os.path.join(EXT, '02S', '*.raw'))):
        m = re.match(r'(\d+)_(\d+)x(\d+)\.raw$', os.path.basename(p))
        out.append((int(m.group(1)), int(m.group(2)), int(m.group(3)), p))
    return out


def read02(idx):
    for i, w, h, p in pack02_entries():
        if i == idx:
            return open(p, 'rb').read(), w, h
    raise KeyError(idx)


def scr_pairs(pack):
    """Пары .PAL/.SCR в паках 01/03 — полноэкранные 640x480 без заголовка."""
    res = []
    files = sorted(glob.glob(os.path.join(EXT, pack, '*')))
    byname = {os.path.basename(f): f for f in files}
    for name, f in byname.items():
        if name.endswith('.SCR'):
            base = name.split('_', 1)[1][:-4]
            pal = [g for n, g in byname.items() if n.endswith(base + '.PAL')]
            if pal:
                res.append((base, pal[0], f))
    return sorted(res)


def spr09():
    """Пары .PAL/.SPR пака 09: заголовок 12 байт (w,h,0,0)."""
    res = []
    files = sorted(glob.glob(os.path.join(EXT, '09C', '*')))
    for i, f in enumerate(files):
        if f.endswith('.SPR'):
            pal = files[i - 1]
            assert pal.endswith('.PAL'), pal
            res.append((os.path.basename(f)[:-4], pal, f))
    return res


def read_spr(path):
    d = open(path, 'rb').read()
    w, h = struct.unpack_from('<HH', d, 0)
    return d[12:12 + w * h], w, h


# ---------------------------------------------------------------- рендер

def render_all():
    os.makedirs(OUT, exist_ok=True)
    pal = load_pal(PAL_MAIN)

    # пак 02 — всё, палитра MAIN
    d02 = os.path.join(OUT, 'p02')
    os.makedirs(d02, exist_ok=True)
    for idx, w, h, p in pack02_entries():
        im = raw_to_img(open(p, 'rb').read(), w, h, pal)
        on_black(im).save(os.path.join(d02, f'{idx:04d}_{w}x{h}.png'))
    print('pack02:', len(pack02_entries()), 'entries ->', d02)

    # паки 01 и 03 — .SCR со своими палитрами
    for pack in ('01C', '03C'):
        dd = os.path.join(OUT, 'p' + pack[:2])
        os.makedirs(dd, exist_ok=True)
        for base, palf, scrf in scr_pairs(pack):
            p = load_pal(palf)
            d = open(scrf, 'rb').read()
            im = raw_to_img(d[:640 * 480], 640, 480, p, alpha0=False)
            on_black(im).save(os.path.join(dd, base + '.png'))
            print(' ', pack, base, len(d))

    # пак 09 — .SPR
    d09 = os.path.join(OUT, 'p09')
    os.makedirs(d09, exist_ok=True)
    seen = {}
    for base, palf, sprf in spr09():
        n = seen.get(base, 0); seen[base] = n + 1
        name = base if n == 0 else f'{base}_{n}'
        data, w, h = read_spr(sprf)
        im = raw_to_img(data, w, h, load_pal(palf), alpha0=False)
        on_black(im).save(os.path.join(d09, f'{name}_{w}x{h}.png'))
    print('pack09:', len(spr09()), 'screens ->', d09)


# ---------------------------------------------------------------- листы

def _font(sz=13):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def contact_sheet(items, path, cols=6, cell=200, label_h=18, scale_up=True):
    """items = [(подпись, PIL.Image)]"""
    f = _font(12)
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * (cell + label_h)), (24, 24, 30))
    dr = ImageDraw.Draw(sheet)
    for n, (lab, im) in enumerate(items):
        cx, cy = (n % cols) * cell, (n // cols) * (cell + label_h)
        k = min((cell - 4) / im.width, (cell - 4) / im.height)
        if not scale_up:
            k = min(k, 1.0)
        t = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.NEAREST)
        sheet.paste(t, (cx + (cell - t.width) // 2, cy + label_h + (cell - label_h - t.height) // 2))
        dr.rectangle([cx, cy, cx + cell - 1, cy + cell + label_h - 1], outline=(70, 70, 90))
        dr.text((cx + 3, cy + 2), lab, font=f, fill=(255, 220, 120))
    sheet.save(path)
    return path


def make_sheets():
    os.makedirs(OUT, exist_ok=True)
    pal = load_pal(PAL_MAIN)
    ent = pack02_entries()
    items = []
    for idx, w, h, p in ent:
        im = on_black(raw_to_img(open(p, 'rb').read(), w, h, pal))
        items.append((f'{idx} {w}x{h}', im))
    per = 48
    for s in range(0, len(items), per):
        chunk = items[s:s + per]
        n0 = ent[s][0]; n1 = ent[min(s + per, len(ent)) - 1][0]
        contact_sheet(chunk, os.path.join(OUT, f'sheet02_{n0:04d}_{n1:04d}.png'), cols=8, cell=190)
        print('sheet', n0, n1)


# ---------------------------------------------------------------- сетка/кроп

def grid(pack, idx, step=20, scale=1, big=100):
    if pack == '02':
        data, w, h = read02(int(idx))
        pal = load_pal(PAL_MAIN)
        name = f'grid02_{int(idx):04d}'
    else:
        raise SystemExit('grid: только пак 02')
    im = on_black(raw_to_img(data, w, h, pal)).convert('RGB')
    if scale != 1:
        im = im.resize((w * scale, h * scale), Image.NEAREST)
    dr = ImageDraw.Draw(im, 'RGBA')
    f = _font(11)
    for x in range(0, w + 1, step):
        c = (255, 60, 60, 200) if x % big == 0 else (0, 220, 255, 90)
        dr.line([(x * scale, 0), (x * scale, h * scale)], fill=c)
        if x % big == 0:
            dr.text((x * scale + 2, 2), str(x), font=f, fill=(255, 255, 0))
    for y in range(0, h + 1, step):
        c = (255, 60, 60, 200) if y % big == 0 else (0, 220, 255, 90)
        dr.line([(0, y * scale), (w * scale, y * scale)], fill=c)
        if y % big == 0:
            dr.text((2, y * scale + 2), str(y), font=f, fill=(255, 255, 0))
    p = os.path.join(OUT, f'{name}_s{scale}.png')
    im.save(p); print(p, im.size)


def crop(pack, idx, x, y, w, h, scale=3, step=10):
    data, W, H = read02(int(idx))
    im = on_black(raw_to_img(data, W, H, load_pal(PAL_MAIN))).convert('RGB')
    x, y, w, h, scale = int(x), int(y), int(w), int(h), int(scale)
    im = im.crop((x, y, x + w, y + h)).resize((w * scale, h * scale), Image.NEAREST)
    dr = ImageDraw.Draw(im, 'RGBA'); f = _font(11)
    for gx in range(0, w + 1, int(step)):
        dr.line([(gx * scale, 0), (gx * scale, h * scale)], fill=(0, 220, 255, 110))
        dr.text((gx * scale + 2, 2), str(x + gx), font=f, fill=(255, 255, 0))
    for gy in range(0, h + 1, int(step)):
        dr.line([(0, gy * scale), (w * scale, gy * scale)], fill=(0, 220, 255, 110))
        dr.text((2, gy * scale + 2), str(y + gy), font=f, fill=(255, 255, 0))
    p = os.path.join(OUT, f'crop02_{int(idx):04d}_{x}_{y}_{w}_{h}.png')
    im.save(p); print(p, im.size)


def diff(idxs):
    """Побайтовое сравнение записей пака 02 (одинаковые ли картинки)."""
    idxs = [int(i) for i in idxs]
    base, w, h = read02(idxs[0])
    for i in idxs[1:]:
        d, w2, h2 = read02(i)
        if (w, h) != (w2, h2):
            print(f'{idxs[0]} vs {i}: разный размер {w}x{h} / {w2}x{h2}'); continue
        n = sum(1 for a, b in zip(base, d) if a != b)
        print(f'{idxs[0]} vs {i}: {n} различных пикселей из {w*h} ({100.0*n/(w*h):.1f}%)')


# ================================================================ анализ
# Ниже — то, чем восстанавливалась разметка (см. notes/ui-screens.md).
# Ключевое наблюдение: спрайты меню в паке 02 — не «сектора», а ПРЯМОУГОЛЬНЫЕ
# куски готовой картинки колеса, захватывающие и кусочки соседних секторов.
# Поэтому соседние куски в перекрытии совпадают ПОБАЙТОВО, и колесо собирается
# однозначно (weld_pair/weld_all). А кликабельная зона сектора = множество
# пикселей, которыми «обычный» кусок отличается от «подсвеченного» (highlight_mask).

def _np02(idx):
    data, w, h = read02(int(idx))
    return np.frombuffer(data, dtype=np.uint8).reshape(h, w)


def weld_pair(A, B, minov=150):
    """Смещение B относительно A, при котором в перекрытии все пиксели равны.
    Возвращает (dx, dy, overlap) или None."""
    ha, wa = A.shape; hb, wb = B.shape; best = None
    for dy in range(-hb + 1, ha):
        ya0, ya1 = max(0, dy), min(ha, dy + hb)
        if ya1 <= ya0: continue
        for dx in range(-wb + 1, wa):
            xa0, xa1 = max(0, dx), min(wa, dx + wb)
            if xa1 <= xa0: continue
            sa = A[ya0:ya1, xa0:xa1]; sb = B[ya0 - dy:ya1 - dy, xa0 - dx:xa1 - dx]
            m = (sa > 0) & (sb > 0); ov = int(m.sum())
            if ov < minov: continue
            if int((sa[m] == sb[m]).sum()) == ov and (best is None or ov > best[2]):
                best = (dx, dy, ov)
    return best


def weld_all(ids, minov=150):
    """Собрать список записей пака 02 в одну картинку. -> (canvas, {id:(x,y)})"""
    imgs = {i: _np02(i) for i in ids}
    pos = {ids[0]: (0, 0)}; todo = set(ids[1:])
    progress = True
    while todo and progress:
        progress = False
        for j in list(todo):
            for i in list(pos):
                d = weld_pair(imgs[i], imgs[j], minov)
                if d:
                    pos[j] = (pos[i][0] + d[0], pos[i][1] + d[1]); todo.discard(j)
                    progress = True; break
    if todo:
        raise RuntimeError('не приварились: %s' % sorted(todo))
    x0 = min(p[0] for p in pos.values()); y0 = min(p[1] for p in pos.values())
    x1 = max(pos[i][0] + imgs[i].shape[1] for i in pos)
    y1 = max(pos[i][1] + imgs[i].shape[0] for i in pos)
    cv = np.zeros((y1 - y0, x1 - x0), np.uint8)
    for i in pos:
        a = imgs[i]; ox, oy = pos[i][0] - x0, pos[i][1] - y0
        m = a > 0; cv[oy:oy + a.shape[0], ox:ox + a.shape[1]][m] = a[m]
    return cv, {i: (pos[i][0] - x0, pos[i][1] - y0) for i in pos}


def fit_circle(mask):
    """МНК-окружность по границе маски -> (cx, cy, r)."""
    from scipy import ndimage
    b = mask & ~ndimage.binary_erosion(mask)
    ys, xs = np.nonzero(b)
    A = np.c_[xs, ys, np.ones(len(xs))]; rhs = xs.astype(float) ** 2 + ys.astype(float) ** 2
    sol, *_ = np.linalg.lstsq(A, rhs, rcond=None)
    cx, cy = sol[0] / 2, sol[1] / 2
    return float(cx), float(cy), float(np.sqrt(sol[2] + cx * cx + cy * cy))


def highlight_mask(idx):
    """Зона, которой запись idx (обычная) отличается от idx+1 (подсвеченной)."""
    from scipy import ndimage
    a, b = _np02(idx), _np02(idx + 1)
    ch = (a != b) & (a > 0)
    ch = ndimage.binary_opening(ch, np.ones((3, 3)))
    ch = ndimage.binary_closing(ch, np.ones((5, 5)))
    lab, n = ndimage.label(ch)
    if n == 0: return None
    sz = ndimage.sum(ch, lab, range(1, n + 1))
    return ndimage.binary_fill_holes(lab == int(np.argmax(sz)) + 1)


def wheel_report(pair_ids, origin, extra=()):
    """Геометрия колеса: центр/радиус на экране + сектора (bbox и полярные границы)."""
    cv, rel = weld_all(list(pair_ids) + list(extra))
    lcx, lcy, R = fit_circle(cv > 0)
    cx, cy = lcx + origin[0], lcy + origin[1]
    out = {'x': origin[0], 'y': origin[1], 'w': int(cv.shape[1]), 'h': int(cv.shape[0]),
           'cx': round(cx, 1), 'cy': round(cy, 1), 'r': round(R, 1), 'items': {}}
    for i in pair_ids:
        reg = highlight_mask(i)
        ys, xs = np.nonzero(reg)
        ox, oy = rel[i][0] + origin[0], rel[i][1] + origin[1]
        gx, gy = xs + ox, ys + oy
        ang = np.degrees(np.arctan2(-(gy - cy), gx - cx)); rad = np.hypot(gx - cx, gy - cy)
        s = np.sort(ang); g = np.diff(s)
        if len(g) and g.max() > 30:
            j = int(np.argmax(g)); s = np.r_[s[j + 1:] - 360, s[:j + 1]]
        out['items'][i] = {'patch': [int(ox), int(oy), int(_np02(i).shape[1]), int(_np02(i).shape[0])],
                           'bbox': [int(gx.min()), int(gy.min()), int(gx.max() - gx.min() + 1), int(gy.max() - gy.min() + 1)],
                           'r0': round(float(np.percentile(rad, 0.7)), 1),
                           'r1': round(float(np.percentile(rad, 99.3)), 1),
                           'a0': round(float(np.percentile(s, 0.7)), 1),
                           'a1': round(float(np.percentile(s, 99.3)), 1)}
    for i in extra:
        a = _np02(i); out['items'][i] = {'patch': [rel[i][0] + origin[0], rel[i][1] + origin[1],
                                                   int(a.shape[1]), int(a.shape[0])]}
    return out, cv, rel


def locate(screen, sprite, nsamp=1500):
    """Точное (по индексам палитры) место спрайта на экране. -> (score, x, y)."""
    H, W = screen.shape; h, w = sprite.shape
    ys, xs = np.nonzero(sprite)
    k = np.linspace(0, len(ys) - 1, min(nsamp, len(ys))).astype(int)
    sy, sx = ys[k], xs[k]; sv = sprite[sy, sx].astype(np.int16)
    n = len(sy); cols = sx[:, None] + np.arange(W - w + 1)[None, :]
    S = screen.astype(np.int16); best = (0.0, 0, 0)
    for oy in range(H - h + 1):
        vals = S[oy + sy][np.arange(n)[:, None], cols]
        sc = (vals == sv[:, None]).mean(0); i = int(sc.argmax())
        if sc[i] > best[0]: best = (float(sc[i]), i, oy)
    return best


def cmd_wheels():
    """Собрать все колёса меню в out/img/ui/ и напечатать геометрию."""
    os.makedirs(OUT, exist_ok=True)
    pal = load_pal(PAL_MAIN)
    jobs = [('wheel_main_menu', [19, 21, 23, 25, 27, 29, 31], (207, 188), ()),
            ('wheel_difficulty', [155, 157, 159, 161], (207, 188), (154,)),
            ('wheel_ingame_tribe0', [172, 174, 176, 178, 180, 182, 184], (143, 100), ())]
    for name, pids, org, extra in jobs:
        rep, cv, rel = wheel_report(pids, org, extra)
        on_black(raw_to_img(cv.tobytes(), cv.shape[1], cv.shape[0], pal)).save(
            os.path.join(OUT, name + '.png'))
        print(name, {k: v for k, v in rep.items() if k != 'items'})
        for k, v in rep['items'].items(): print('   ', k, v)
    # титульный экран целиком: MAIN.SCR + колесо
    scr = np.frombuffer(open(os.path.join(EXT, '01C', '005_MAIN.SCR'), 'rb').read()[:640 * 480],
                        np.uint8).reshape(480, 640).copy()
    cv, _ = weld_all([19, 21, 23, 25, 27, 29, 31])
    m = cv > 0; scr[188:188 + cv.shape[0], 207:207 + cv.shape[1]][m] = cv[m]
    on_black(raw_to_img(scr.tobytes(), 640, 480, pal, alpha0=False)).save(
        os.path.join(OUT, 'title_with_menu.png'))
    print('title_with_menu.png')




def cmd_json():
    """Собрать reimpl/data/ui_screens.json (всё, что ниже, — результат разбора картинок)."""
    import json
    OUT = os.path.join(ROOT, "reimpl", "data", "ui_screens.json")
    TRIBES = ["Tyrano", "Kanoose", "Romack", "Masai", "Moospell", "Koomba", "Radumba", "Koaka"]


    def wheel(pids, org, names, extra=()):
        rep, cv, rel = wheel_report(pids, org, extra)
        hs = []
        for i in pids:
            it = rep['items'][i]
            x, y, w, h = it['bbox']
            hs.append({"id": names[i][0], "label": names[i][1],
                       "kind": "sector",
                       "x": x, "y": y, "w": w, "h": h,
                       "r0": it['r0'], "r1": it['r1'], "a0": it['a0'], "a1": it['a1'],
                       "sprite_normal": i, "sprite_over": i + 1,
                       "sprite_xy": it['patch'][:2], "sprite_wh": it['patch'][2:]})
        return rep, hs


    def rect(id_, label, x, y, w, h, **kw):
        d = {"id": id_, "label": label, "x": x, "y": y, "w": w, "h": h}
        d.update({k: v for k, v in kw.items() if v is not None}); return d


    data = {}
    data["_"] = ("Каталог экранов и элементов интерфейса Jurassic War (V1.05E). "
                 "Координаты — пиксели экрана 640x480, начало в левом верхнем углу. "
                 "Ссылки на ресурсы: pack — номер архива _PWARnn.TR?, entry — индекс записи "
                 "(как в out/extract/<пак>/). Разметка снята по самим картинкам, "
                 "метод и точность описаны в notes/ui-screens.md.")
    data["_generated_by"] = "python3 tools/ui_catalog.py json"
    data["screen"] = [640, 480]
    data["tribes"] = {
        "_": "Внутренняя нумерация племён 0..7 (строки 'Tribe of ...' @0x31a95 в pwar.img). "
             "Ей же следуют семейства по 8 записей в паке 02 и блоки по 19 записей в паке 05.",
        "names": TRIBES,
    }
    data["palettes"] = {
        "_": "Файлы .PAL — 768 байт, по 3 байта на цвет, компоненты УЖЕ 8-битные (в DAC уходят >>2, "
             "домножать на 255/63 не надо). Индекс 0 в спрайтах пака 02 — прозрачный.",
        "MAIN": {"pack": "01C", "entry": 4, "used_by": "весь пак 02, MAIN.SCR, игра"},
        "SETUP": {"pack": "01C", "entry": 6, "used_by": "SETUP.SCR (фон SETUP.EXE)"},
        "LOGOTRIC": {"pack": "01C", "entry": 9},
        "LOGOSKC": {"pack": "01C", "entry": 11},
        "HELP1": {"pack": "03C", "entry": 0, "used_by": "HELP1.SCR и HELP2.SCR (палитры совпадают байт в байт)"},
        "HELP2": {"pack": "03C", "entry": 2},
        "HELP3": {"pack": "03C", "entry": 4},
        "story_win": {"_": "у каждого экрана пака 09 своя палитра — запись непосредственно перед .SPR"},
    }

    screens = {}

    # ---------------------------------------------------------------- логотипы и загрузка
    screens["logo_tric"] = {
        "_": "Логотип разработчика T.R.I.C. (Tranquil Revolt In Computer). Полноэкранная картинка.",
        "name": "TRIC logo", "pack": "01C", "entry": 10, "palette_entry": 9,
        "size": [640, 480], "format": "SCR (сырые 640x480 8bpp, без заголовка)",
        "hotspots": [], "advance": "по клику/клавише или по таймеру (код не реверсили)"}
    screens["logo_skc"] = {
        "_": "Логотип издателя SKC Softland.",
        "name": "SKC Softland logo", "pack": "01C", "entry": 12, "palette_entry": 11,
        "size": [640, 480], "format": "SCR", "hotspots": [],
        "advance": "по клику/клавише или по таймеру"}
    screens["loading"] = {
        "_": "Титульный фон с надписью Loading... в красном круге. Тот же файл служит фоном "
             "главного меню: колесо меню перекрывает круг целиком.",
        "name": "Loading screen", "pack": "01C", "entry": 5, "palette_entry": 4,
        "size": [640, 480], "format": "SCR", "hotspots": []}
    screens["setup_bg"] = {
        "_": "Фон внешней утилиты SETUP.EXE. В самой игре не показывается.",
        "name": "SETUP.EXE background", "pack": "01C", "entry": 7, "palette_entry": 6,
        "size": [640, 480], "format": "SCR", "hotspots": []}

    # ---------------------------------------------------------------- главное меню
    names_main = {19: ("multiplayer_game", "Multiplayer Game"), 21: ("load_game", "Load"),
                  23: ("quit", "Quit"), 25: ("replay_introduction", "Replay Introduction"),
                  27: ("option", "Option"), 29: ("new_game", "New"), 31: ("help", "Help")}
    rep_main, hs_main = wheel([19, 21, 23, 25, 27, 29, 31], (207, 188), names_main)
    screens["title_menu"] = {
        "_": "Главное меню. Фон — MAIN.SCR (пак 01, запись 5), поверх него в (207,188) рисуется "
             "колесо из 7 кусков пака 02 (записи 19..32: чётная — обычная, нечётная — подсвеченная). "
             "Плюс 4 анимированных участка фона (см. animations). Колесо ровно накрывает красный круг "
             "с надписью Loading... . Проверено: собранная композиция пиксель в пиксель повторяет "
             "кадр ref/video/frames/f_0018.jpg (там русская пиратка, геометрия та же).",
        "name": "Main menu", "background": {"pack": "01C", "entry": 5}, "palette": "MAIN",
        "size": [640, 480],
        "wheel": {"x": rep_main['x'], "y": rep_main['y'], "w": rep_main['w'], "h": rep_main['h'],
                  "cx": rep_main['cx'], "cy": rep_main['cy'], "r_outer": rep_main['r'],
                  "r_hub": 34.0,
                  "_": "Хит-тест: dist(cx,cy) <= 34 -> центр (Help); 34..111 -> сектор по углу. "
                       "Угол в градусах, 0 = вправо, против часовой стрелки (экранный y вниз).",
                  "sector_bounds_deg": [-40.5, -1.9, 40.0, 140.0, 181.9, 220.5]},
        "hotspots": hs_main,
        "animations": [
            {"id": "anim_head", "x": 482, "y": 132, "w": 35, "h": 29, "pack": "02S",
             "entries": [0, 1, 2, 3, 4], "_": "морда динозавра справа вверху, 5 кадров (0 = фон)"},
            {"id": "anim_neck", "x": 476, "y": 254, "w": 19, "h": 54, "pack": "02S",
             "entries": [5, 6, 7, 8, 9], "_": "узкая полоса на шее/лапе, 5 кадров"},
            {"id": "anim_body", "x": 489, "y": 307, "w": 117, "h": 127, "pack": "02S",
             "entries": [10, 11, 12, 13, 14], "_": "тело/хвост динозавра, 5 кадров"},
            {"id": "anim_petro", "x": 131, "y": 102, "w": 110, "h": 116, "pack": "02S",
             "entries": [15, 16, 17, 18], "_": "красная наскальная роспись слева, 4 кадра"}],
        "footer_text": {"_": "«Tranquil Revolt In Computer 1996» и версия 1.05 запечены в MAIN.SCR"}}

    # ---------------------------------------------------------------- выбор сложности
    names_diff = {155: ("easy", "EASY"), 157: ("medium", "MEDIUM"),
                  159: ("hard", "HARD"), 161: ("cancel", "CANCEL")}
    rep_diff, hs_diff = wheel([155, 157, 159, 161], (207, 188), names_diff, extra=(154,))
    screens["difficulty"] = {
        "_": "Выбор сложности. Такое же колесо на том же месте (207,188), центр и радиус совпадают "
             "с главным меню. Верхняя половина — статичная плашка «Choose Game Difficulty» (запись 154), "
             "нижняя разбита на 3 сектора по 72 градуса, в центре CANCEL.",
        "name": "Choose Game Difficulty", "background": {"pack": "01C", "entry": 5}, "palette": "MAIN",
        "size": [640, 480],
        "wheel": {"x": rep_diff['x'], "y": rep_diff['y'], "w": rep_diff['w'], "h": rep_diff['h'],
                  "cx": rep_diff['cx'], "cy": rep_diff['cy'], "r_outer": rep_diff['r'], "r_hub": 34.0,
                  "sector_bounds_deg": [18.0, -54.0, -125.0, -198.0],
                  "static_banner": {"pack": "02S", "entry": 154, "x": 207, "y": 188, "w": 225, "h": 81}},
        "hotspots": hs_diff}

    # ---------------------------------------------------------------- выбор клана
    tribe_hs = [
        (164, 1, "kanoose", "Kanoose", 33, 17, 133, 125),
        (165, 7, "koaka", "Koaka", 246, 19, 95, 94),
        (166, 6, "radumba", "Radumba", 447, 16, 117, 115),
        (167, 2, "romack", "Romack", 94, 196, 106, 102),
        (168, 0, "tyrano", "Tyrano", 283, 168, 124, 122),
        (169, 3, "masai", "Masai", 490, 193, 121, 115),
        (170, 4, "moospell", "Moospell", 54, 331, 121, 120),
        (171, 5, "koomba", "Koomba", 304, 345, 111, 107)]
    hs = []
    for ent, tid, id_, lab, x, y, w, h in tribe_hs:
        hs.append(rect(id_, lab, x, y, w, h, kind="ellipse",
                       cx=x + w // 2, cy=y + h // 2, rx=w // 2, ry=h // 2,
                       tribe=tid, screen_variant=ent,
                       _="запись %d — тот же экран с подсвеченным (красным) медальоном" % ent))
    hs.append(rect("select", "SELECT", 455, 394, 78, 66, kind="ellipse", cx=494, cy=427, rx=39, ry=33,
                   _="координаты сняты на глаз по сетке, +-2 px"))
    hs.append(rect("cancel", "CANCEL", 541, 394, 78, 66, kind="ellipse", cx=580, cy=427, rx=39, ry=33,
                   _="координаты сняты на глаз по сетке, +-2 px"))
    screens["tribe_select"] = {
        "_": "Выбор клана: 8 каменных медальонов с именами. Запись 163 — никто не выбран; "
             "записи 164..171 — тот же экран целиком, но один медальон красный. "
             "Прямоугольники медальонов получены как область различия 163 и 164..171 "
             "(точно, до пикселя). Соответствие «позиция на экране -> номер племени» — "
             "по подписям на картинке и порядку строк 'Tribe of ...' в pwar.img.",
        "name": "Tribe select", "pack": "02S", "entry": 163, "palette": "MAIN", "size": [640, 480],
        "highlight_screens": {str(t): e for e, t, *_ in tribe_hs},
        "hotspots": hs}

    # ---------------------------------------------------------------- мультиплеер
    screens["multiplayer"] = {
        "_": "Экран выбора типа сетевой игры. Четыре круглые кнопки — отдельные записи пака 02 "
             "(чётная = обычная, нечётная = подсвеченная), позиции найдены точным совпадением "
             "индексов палитры внутри записи 33.",
        "name": "Multiplayer Game", "pack": "02S", "entry": 33, "palette": "MAIN", "size": [640, 480],
        "hotspots": [
            rect("com_setting", "Com Setting", 115, 127, 100, 100, kind="ellipse", cx=165, cy=177, rx=45, ry=45,
                 sprite_normal=34, sprite_over=35),
            rect("null_modem", "Null Modem", 327, 179, 102, 100, kind="ellipse", cx=378, cy=229, rx=45, ry=45,
                 sprite_normal=36, sprite_over=37),
            rect("modem", "Modem", 149, 323, 105, 104, kind="ellipse", cx=201, cy=375, rx=47, ry=47,
                 sprite_normal=38, sprite_over=39),
            rect("previous", "Previous", 435, 287, 103, 103, kind="ellipse", cx=486, cy=338, rx=46, ry=46,
                 sprite_normal=40, sprite_over=41)]}

    # ---------------------------------------------------------------- модем
    hs = []
    for k, e in enumerate(range(43, 48)):
        hs.append(rect("com_info_%d" % k, "Com & Info row %d" % k, 118, 96 + 19 * k, 263, 19, sprite_normal=e))
    for k, e in enumerate(range(48, 53)):
        hs.append(rect("baud_rate_%d" % k, "Baud Rate row %d" % k, 413, 96 + 19 * k, 102, 19, sprite_normal=e))
    for k, e in enumerate(range(53, 56)):
        hs.append(rect("init_string_%d" % k, "Modem INIT String row %d" % k, 118, 234 + 19 * k, 398, 19, sprite_normal=e))
    for k, e in enumerate(range(56, 59)):
        hs.append(rect("call_waiting_%d" % k, "Modem Call Waiting String row %d" % k, 118, 337 + 19 * k, 288, 19, sprite_normal=e))
    hs += [rect("tone", "TONE", 428, 340, 95, 23, sprite_normal=59, sprite_over=60),
           rect("pulse", "PULSE", 428, 368, 95, 22, sprite_normal=61, sprite_over=62),
           rect("save", "SAVE", 173, 411, 63, 28, sprite_normal=63, sprite_over=64),
           rect("default", "DEFAULT", 287, 412, 74, 27, sprite_normal=65, sprite_over=66),
           rect("ok", "OK", 406, 412, 65, 27, sprite_normal=67, sprite_over=68)]
    screens["modem_setup"] = {
        "_": "Настройки модема. Строки-«поля» (263x19, 102x19, 398x19, 288x19) — это подсвечиваемые "
             "полосы списков, по 5/5/3/3 штуки; позиции точные (совпадение индексов).",
        "name": "Modem setup", "pack": "02S", "entry": 42, "palette": "MAIN", "size": [640, 480],
        "hotspots": hs}

    # ---------------------------------------------------------------- телефонная книга
    hs = []
    ys = [140 + 20 * k for k in range(10)]
    for k, e in enumerate(range(70, 80)):
        w, h = (127, 119) if e == 77 else (127, 19)
        hs.append(rect("name_%d" % k, "Name row %d" % k, 136, ys[k], w, h, sprite_normal=e,
                       _=("запись 77 нарисована высотой 119 вместо 19 — артефакт исходников, "
                          "по месту совпадает точно") if e == 77 else None))
    for k, e in enumerate(range(80, 90)):
        w, h = (227, 119) if e == 87 else (227, 19)
        hs.append(rect("phone_%d" % k, "Phone no row %d" % k, 277, ys[k], w, h, sprite_normal=e,
                       _=("запись 87 нарисована высотой 119 вместо 19") if e == 87 else None))
    hs += [rect("dialing", "DIALING", 141, 357, 81, 27, sprite_normal=90, sprite_over=91),
           rect("receive", "RECEIVE", 230, 357, 81, 27, sprite_normal=92, sprite_over=93),
           rect("save", "SAVE", 346, 357, 66, 27, sprite_normal=94, sprite_over=95),
           rect("cancel", "CANCEL", 420, 357, 77, 27, sprite_normal=96, sprite_over=97)]
    screens["phone_list"] = {
        "_": "Телефонная книга для игры по модему: 10 строк «имя» + 10 строк «номер» + 4 кнопки.",
        "name": "Phone list", "pack": "02S", "entry": 69, "palette": "MAIN", "size": [640, 480],
        "hotspots": [x for x in hs]}

    # ---------------------------------------------------------------- сетевая партия
    hs = [rect("mode_opponent", "OPPONENT", 60, 116, 103, 20, sprite_normal=99, sprite_over=100),
          rect("mode_company", "COMPANY", 60, 141, 103, 20, sprite_normal=101, sprite_over=102),
          rect("name_host", "HOST name field", 250, 116, 127, 21, sprite_normal=103),
          rect("name_sub", "SUB name field", 250, 141, 127, 20, sprite_normal=104)]
    for row, (base, tag) in enumerate([(105, "host"), (113, "sub"), (121, "ai")]):
        yy = [116, 140, 165][row]
        for k in range(8):
            hs.append(rect("group_%s_%d" % (tag, k + 1), "Group Select %s %d" % (tag.upper(), k + 1),
                           394 + 24 * k, yy, 20, 20, sprite_normal=base + k))
    hs += [rect("start_unit", "START UNIT value", 168, 191, 59, 19, sprite_normal=129),
           rect("food", "FOOD value", 345, 191, 67, 19, sprite_normal=130),
           rect("event", "EVENT ON/OFF", 523, 191, 59, 19, sprite_on=131, sprite_off=132)]
    for k, e in enumerate(range(133, 138)):
        hs.append(rect("map_row_%d" % k, "Select Map row %d" % k, 71, 243 + 19 * k, 498, 19, sprite_normal=e))
    hs += [rect("message", "MESSAGE", 98, 351, 72, 22, sprite_normal=138, sprite_over=139),
           rect("start", "START", 239, 351, 73, 22, sprite_normal=140, sprite_over=141),
           rect("cancel", "CANCEL", 373, 351, 72, 22, sprite_normal=142, sprite_over=143),
           rect("scroll_up", "scroll up", 502, 351, 23, 22, sprite_normal=144, sprite_over=145),
           rect("scroll_down", "scroll down", 537, 351, 23, 22, sprite_normal=146, sprite_over=147)]
    for k, e in enumerate(range(148, 152)):
        hs.append(rect("chat_row_%d" % k, "message log row %d" % k, 71, 385 + 19 * k, 498, 19, sprite_normal=e))
    screens["mp_game_control"] = {
        "_": "Экран настройки сетевой партии. Надпись «(You are HOST)» запечена в картинке; "
             "запись 152 «(You are SUB)» (150x23) — её замена для ведомого, точное место не найдено "
             "(текст HOST занимает примерно 420,64..570,86).",
        "name": "Multiplayer Game Control", "pack": "02S", "entry": 98, "palette": "MAIN",
        "size": [640, 480],
        "hotspots": hs,
        "extras": [{"id": "you_are_sub", "pack": "02S", "entry": 152, "w": 150, "h": 23,
                    "x_approx": 420, "y_approx": 64, "_": "позиция приблизительная (+-6 px)"}]}

    # ---------------------------------------------------------------- игровое меню (колесо)
    names_ig = {172: ("save_game", "Save Game"), 174: ("load_game", "Load Game"),
                176: ("exit", "Exit"), 178: ("restart_scenario", "Restart Scenario"),
                180: ("option", "Option"), 182: ("pause", "Pause"), 184: ("center", "череп (закрыть)")}
    rep_ig, hs_ig = wheel([172, 174, 176, 178, 180, 182, 184], (143, 100), names_ig)
    for h_ in hs_ig:
        h_["tribe_stride"] = 14
    screens["ingame_menu"] = {
        "_": "Игровое меню — колесо поверх карты. Скин зависит от племени игрока: 8 семейств по 14 "
             "записей, база = 172 + племя*14, внутри пары (обычная, подсвеченная). "
             "Положение колеса на экране снято с картинки-подсказки (запись 153) сопоставлением "
             "яркости, точность +-3 px; относительная геометрия секторов точная. "
             "ВНИМАНИЕ: на картинке 153 левый верхний сектор подписан «New Game», а в спрайтах "
             "пака 02 на этом месте «Pause» — картинка-подсказка отстала от игры.",
        "name": "In-game menu wheel", "pack": "02S", "entry_base": 172, "tribe_stride": 14,
        "palette": "MAIN",
        "wheel": {"x": rep_ig['x'], "y": rep_ig['y'], "w": rep_ig['w'], "h": rep_ig['h'],
                  "cx": rep_ig['cx'], "cy": rep_ig['cy'], "r_outer": rep_ig['r'], "r_hub": 34.0,
                  "pos_accuracy_px": 3,
                  "sector_bounds_deg": [-41.0, -2.0, 59.0, 120.5, 182.0, 221.0]},
        "hotspots": hs_ig,
        "entry_layout": {"_": "смещения внутри блока племени",
                         "save_game": [0, 1], "load_game": [2, 3], "exit": [4, 5],
                         "restart_scenario": [6, 7], "option": [8, 9], "pause": [10, 11],
                         "center_skull": [12, 13]}}

    # ---------------------------------------------------------------- страницы помощи
    screens["help_menu_page"] = {
        "_": "Страница помощи: скриншот геймплея с колесом игрового меню и стрелками листания внизу. "
             "Стрелки и надпись «help menu» запечены в картинке; отдельных спрайтов для них в паке 02 "
             "нет, поэтому как они рисуются на HELP1..3 — не выяснено.",
        "name": "Help: game menu", "pack": "02S", "entry": 153, "palette": "MAIN", "size": [640, 480],
        "hotspots": [rect("prev", "стрелка влево", 124, 440, 90, 24,
                          _="снято на глаз по сетке, +-3 px"),
                     rect("next", "стрелка вправо", 300, 439, 92, 27,
                          _="снято на глаз по сетке, +-3 px")]}
    for n, (ent, palent) in enumerate([(1, 0), (3, 2), (5, 4)], start=1):
        screens["help_%d" % n] = {
            "_": "Страница помощи %d: слева текст, справа копия боковой панели с пронумерованными "
                 "элементами. Стрелок листания в картинке нет." % n,
            "name": "Help page %d" % n, "pack": "03C", "entry": ent, "palette_entry": palent,
            "size": [640, 480], "format": "SCR", "hotspots": []}

    # ---------------------------------------------------------------- пак 09
    ok_hs = [rect("ok", "OK", 531, 431, 64, 39,
                  _="плашка OK одинакова на всех экранах пака 09; сама надпись занимает 551..575 x 441..457")]
    story = []
    for k in range(12):
        story.append({"stage": k + 1, "pack": "09C", "entry": 15 + k * 2, "palette_entry": 14 + k * 2,
                      "name": "ST-%02d" % (k + 1)})
    screens["story"] = {
        "_": "Сюжетный экран перед миссией: щит-череп с картинкой стадии и кнопкой OK. "
             "Запись = 14 + стадия*2 (.PAL), +1 (.SPR). Формат .SPR: заголовок 12 байт "
             "(u16 w, u16 h, u32 0, u32 0), далее w*h байт.",
        "name": "Story screen", "size": [640, 480], "variants": story, "hotspots": ok_hs}
    screens["group_end"] = {
        "_": "Экран после миссии (вождь у костра). 8 одинаковых копий GRPEND1 — по одной на племя "
             "(записи 39,41,43,45,47,49,51,53; палитра — предыдущая запись). Картинки идентичны, "
             "различаются только палитрами.",
        "name": "GRPEND1", "size": [640, 480],
        "variants": [{"tribe": t, "pack": "09C", "entry": 39 + t * 2, "palette_entry": 38 + t * 2}
                     for t in range(8)],
        "hotspots": ok_hs}
    screens["win"] = {
        "_": "Экран победы стадии там, где нет FLI-ролика (в паке 11 на этом месте NULLDAT). "
             "Стадии 2,4,6,7,8,9,10.",
        "name": "WIN screens", "size": [640, 480],
        "variants": [{"stage": s, "pack": "09C", "entry": e, "palette_entry": e - 1, "name": n}
                     for s, e, n in [(2, 57, "WIN02"), (4, 61, "WIN04"), (6, 65, "WIN06"),
                                     (7, 67, "WIN07"), (8, 69, "WIN08"), (9, 71, "WIN09"),
                                     (10, 73, "WIN10")]],
        "hotspots": ok_hs}
    screens["defeat"] = {
        "_": "Экран поражения.", "name": "DEFEAT", "pack": "09C", "entry": 79, "palette_entry": 78,
        "size": [640, 480], "hotspots": ok_hs}

    data["screens"] = screens

    # ---------------------------------------------------------------- семейства диалогов
    fam = {}
    fam["_"] = ("Диалоги и полосы кнопок, у которых есть по одному варианту на племя. "
                "База = entry_base + племя*stride. Внутри блока порядок записей фиксирован. "
                "Координаты кнопок — ЛОКАЛЬНЫЕ, от левого верхнего угла окна; проверены точным "
                "совпадением индексов внутри картинки окна и одинаковы у всех восьми племён. "
                "Куда окно ставится на экране — в данных не записано; поле screen_xy_guess — "
                "центрирование на 640x480, это ГИПОТЕЗА.")
    fam["load_dialog"] = {
        "_": "Окно Load Game: заголовок, список сейвов, кнопки.",
        "entry_base": 284, "stride": 9, "size": [238, 218], "screen_xy_guess": [201, 131],
        "entries": {"window": 0, "load": [1, 2], "cancel": [3, 4], "page_up": [5, 6], "page_down": [7, 8]},
        "hotspots": [rect("load", "Load", 21, 196, 49, 19),
                     rect("cancel", "Cancel", 112, 196, 48, 19),
                     rect("page_up", "страница вверх", 184, 196, 19, 18),
                     rect("page_down", "страница вниз", 207, 196, 19, 17),
                     rect("list", "список слотов", 12, 34, 214, 152,
                          rows=7, _="7 строк на страницу — из io-formats.md (шаг страницы слотов 7); "
                                    "разбиение на строки в картинке не нарисовано")]}
    fam["save_dialog"] = {
        "_": "Окно Save Game: то же плюс кнопка Delete.",
        "entry_base": 356, "stride": 11, "size": [238, 218], "screen_xy_guess": [201, 131],
        "entries": {"window": 0, "save": [1, 2], "delete": [3, 4], "cancel": [5, 6],
                    "page_up": [7, 8], "page_down": [9, 10]},
        "hotspots": [rect("save", "Save", 10, 195, 49, 19),
                     rect("delete", "Delete", 69, 195, 48, 19),
                     rect("cancel", "Cancel", 127, 195, 49, 19),
                     rect("page_up", "страница вверх", 186, 195, 19, 19),
                     rect("page_down", "страница вниз", 209, 195, 19, 19),
                     rect("list", "список слотов", 12, 34, 214, 152, rows=7)]}
    fam["game_option"] = {
        "_": "Окно Game Option: четыре ползунка и кнопка перехода в Sound Controls. "
             "Запись 5 в блоке — движок ползунка 1x10.",
        "entry_base": 444, "stride": 6, "size": [312, 156], "screen_xy": [162, 179],
        "entries": {"window": 0, "sound_controls": [1, 2], "ok": [3, 4], "slider_knob": 5},
        "hotspots": [rect("ok", "OK", 254, 9, 36, 20),
                     rect("sound_controls", "Sound Controls", 81, 130, 151, 21),
                     rect("game_speed", "Game Speed", 166, 34, 128, 11, kind="slider"),
                     rect("scroll_speed", "Scroll Speed", 166, 59, 128, 11, kind="slider"),
                     rect("scroll_auto_speed", "Scroll Auto Speed", 166, 83, 128, 11, kind="slider"),
                     rect("mouse_sensitive", "Mouse Sensitive", 166, 109, 128, 10, kind="slider")],
        "_sliders": "экранные прямоугольники виджетов прошиты в образе (записи по 32 байта "
                    "с 0x397f3: тип, x1, y1, x2, y2, спрайт, спрайт-подсветка); отсюда же "
                    "получен левый верхний угол окна"}
    fam["sound_controls"] = {
        "_": "Окно Sound Controls: громкость музыки и эффектов, список треков (пак 07), "
             "управление проигрывателем. Запись 15 в блоке — движок ползунка 5x10.",
        "entry_base": 492, "stride": 16, "size": [312, 237], "screen_xy": [162, 153],
        "entries": {"window": 0, "stop": [1, 2], "play": [3, 4], "shuffle": [5, 6], "repeat": [7, 8],
                    "ok": [9, 10], "page_up": [11, 12], "page_down": [13, 14], "slider_knob": 15},
        "hotspots": [rect("ok", "OK", 254, 7, 34, 21),
                     rect("music_volume", "Music Volume", 166, 35, 128, 11, kind="slider"),
                     rect("sound_volume", "Sound Volume", 166, 62, 123, 11, kind="slider"),
                     rect("playlist", "список треков", 22, 92, 268, 102),
                     rect("stop", "стоп", 22, 208, 24, 21),
                     rect("play", "играть", 59, 208, 31, 21),
                     rect("shuffle", "Shuffle", 110, 208, 70, 21),
                     rect("repeat", "Repeat", 192, 208, 70, 21),
                     rect("page_up", "список вверх", 271, 202, 22, 16),
                     rect("page_down", "список вниз", 271, 218, 22, 15)],
        "_widgets": "как и у game_option, прямоугольники сняты с записей образа (с 0x39924)"}
    fam["ok_cancel_bar"] = {
        "_": "Полоса кнопок OK / CANCEL (167x35) — по одной на племя.",
        "entry_base": 636, "stride": 5, "size": [167, 35],
        "entries": {"bar": 0, "ok": [1, 2], "cancel": [3, 4]},
        "hotspots": [rect("ok", "OK", 10, 5, 71, 28), rect("cancel", "CANCEL", 88, 5, 70, 28)]}
    fam["yes_no_bar"] = {
        "_": "Полоса кнопок YES / NO (167x35) — подтверждения «RESTART GAME ?» / «EXIT GAME ?» "
             "(строки в pwar.img @0x3383a..).",
        "entry_base": 676, "stride": 5, "size": [167, 35],
        "entries": {"bar": 0, "yes": [1, 2], "no": [3, 4]},
        "hotspots": [rect("yes", "YES", 10, 6, 71, 27), rect("no", "NO", 88, 6, 70, 27)]}
    fam["message_plate"] = {
        "_": "Пустая каменная плашка 283x68 — фон под текст сообщения/вопроса. Кнопок на ней нет; "
             "вероятно под неё подкладывается yes_no_bar или ok_cancel_bar, но это не проверено.",
        "entry_base": 620, "stride": 1, "size": [283, 68], "entries": {"plate": 0}, "hotspots": []}
    fam["big_panel"] = {
        "_": "Пустая каменная панель 392x229 — фон под длинный текст. Назначение точно не установлено; "
             "правдоподобно — окно текста брифинга (FUN_00014c90, высота строки 22 px: 229/22 ~ 10 строк).",
        "entry_base": 628, "stride": 1, "size": [392, 229], "entries": {"panel": 0}, "hotspots": []}
    data["families"] = fam

    # ---------------------------------------------------------------- переходы
    data["flow"] = {
        "_": "Связи между экранами. confidence: proven — видно в данных/видео; likely — следует из "
             "подписей и логики; guess — предположение.",
        "edges": [
            {"from": "logo_tric", "on": "any", "to": "logo_skc", "confidence": "guess"},
            {"from": "logo_skc", "on": "any", "to": "title_menu", "confidence": "guess"},
            {"from": "title_menu", "on": "new_game", "to": "difficulty", "confidence": "likely"},
            {"from": "difficulty", "on": "easy|medium|hard", "to": "tribe_select", "confidence": "likely"},
            {"from": "difficulty", "on": "cancel", "to": "title_menu", "confidence": "likely"},
            {"from": "tribe_select", "on": "select", "to": "story", "confidence": "likely"},
            {"from": "tribe_select", "on": "cancel", "to": "title_menu", "confidence": "likely"},
            {"from": "story", "on": "ok", "to": "briefing_text", "confidence": "likely",
             "_": "текст брифинга — запись 80 + стадия*8 + племя пака 09 (T{S}_{G}.TXT)"},
            {"from": "title_menu", "on": "multiplayer_game", "to": "multiplayer", "confidence": "proven"},
            {"from": "multiplayer", "on": "com_setting", "to": "modem_setup", "confidence": "likely"},
            {"from": "multiplayer", "on": "modem", "to": "phone_list", "confidence": "likely"},
            {"from": "multiplayer", "on": "null_modem", "to": "mp_game_control", "confidence": "likely"},
            {"from": "multiplayer", "on": "previous", "to": "title_menu", "confidence": "proven"},
            {"from": "phone_list", "on": "dialing|receive", "to": "mp_game_control", "confidence": "guess"},
            {"from": "mp_game_control", "on": "start", "to": "game", "confidence": "likely"},
            {"from": "mp_game_control", "on": "cancel", "to": "multiplayer", "confidence": "likely"},
            {"from": "title_menu", "on": "load_game", "to": "load_dialog", "confidence": "likely"},
            {"from": "title_menu", "on": "option", "to": "game_option", "confidence": "likely"},
            {"from": "title_menu", "on": "help", "to": "help_menu_page", "confidence": "likely"},
            {"from": "help_menu_page", "on": "next", "to": "help_1", "confidence": "likely"},
            {"from": "help_1", "on": "next", "to": "help_2", "confidence": "likely"},
            {"from": "help_2", "on": "next", "to": "help_3", "confidence": "likely"},
            {"from": "title_menu", "on": "replay_introduction", "to": "intro_fli", "confidence": "proven",
             "_": "пак 11, запись 0 — WIN00-EN.FLI"},
            {"from": "title_menu", "on": "quit", "to": "yes_no_bar", "confidence": "likely"},
            {"from": "game", "on": "MENU", "to": "ingame_menu", "confidence": "proven"},
            {"from": "ingame_menu", "on": "save_game", "to": "save_dialog", "confidence": "proven"},
            {"from": "ingame_menu", "on": "load_game", "to": "load_dialog", "confidence": "proven"},
            {"from": "ingame_menu", "on": "option", "to": "game_option", "confidence": "proven"},
            {"from": "ingame_menu", "on": "restart_scenario", "to": "yes_no_bar", "confidence": "likely"},
            {"from": "ingame_menu", "on": "exit", "to": "yes_no_bar", "confidence": "likely"},
            {"from": "ingame_menu", "on": "pause", "to": "game", "confidence": "guess"},
            {"from": "ingame_menu", "on": "center", "to": "game", "confidence": "guess",
             "_": "центр — череп; вероятно «закрыть меню»"},
            {"from": "game_option", "on": "sound_controls", "to": "sound_controls", "confidence": "proven"},
            {"from": "game", "on": "victory", "to": "win|group_end", "confidence": "proven"},
            {"from": "game", "on": "defeat", "to": "defeat", "confidence": "proven"}]}

    data["unidentified"] = {
        "_": "Что осталось неопознанным или непроверенным.",
        "items": [
            "Экранные координаты всех всплывающих окон (load/save/option/sound/подтверждения) — "
            "в картинках их нет, код меню не реверсили. В JSON стоит screen_xy_guess (центрирование).",
            "Назначение пустой панели 392x229 (записи 628..635) — предположительно окно брифинга.",
            "Как связаны плашка 283x68 и полосы кнопок 167x35 (кто внутри кого).",
            "Точное место надписи «(You are SUB)» (запись 152) на экране 98.",
            "Как рисуются стрелки листания на страницах HELP1..3 пака 03 — отдельных спрайтов нет.",
            "Записи 77 (127x119) и 87 (227x119) в телефонной книге нарисованы выше, чем строка списка; "
            "по месту совпадают точно, зачем такая высота — неясно.",
            "Расхождение: на картинке-подсказке 153 сектор подписан «New Game», в спрайтах — «Pause».",
            "Положение игрового колеса на экране снято с картинки 153 (точность +-3 px), "
            "а не из кода."]}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('written', OUT, os.path.getsize(OUT), 'bytes')


def cmd_overlay():
    """Нарисовать хотспоты из reimpl/data/ui_screens.json поверх экранов -> out/img/ui/hs_*.png."""
    import json
    d = json.load(open(os.path.join(ROOT, 'reimpl', 'data', 'ui_screens.json'), encoding='utf-8'))
    pal = load_pal(PAL_MAIN)
    os.makedirs(OUT, exist_ok=True)
    bgs = {'title_menu': ('title', None), 'difficulty': ('title', None),
           'tribe_select': ('02', 163), 'multiplayer': ('02', 33), 'modem_setup': ('02', 42),
           'phone_list': ('02', 69), 'mp_game_control': ('02', 98), 'ingame_menu': ('02', 153)}
    f = _font(11)
    for key, (kind, ent) in bgs.items():
        sc = d['screens'][key]
        if kind == 'title':
            raw = np.frombuffer(open(os.path.join(EXT, '01C', '005_MAIN.SCR'), 'rb').read()[:640 * 480],
                                np.uint8).reshape(480, 640).copy()
            ids = [19, 21, 23, 25, 27, 29, 31] if key == 'title_menu' else [154, 155, 157, 159, 161]
            cv, _r = weld_all(ids)
            m = cv > 0
            raw[188:188 + cv.shape[0], 207:207 + cv.shape[1]][m] = cv[m]
        else:
            raw = _np02(ent)
            if key == 'ingame_menu':
                cv, _r = weld_all([172, 174, 176, 178, 180, 182, 184])
                m = cv > 0
                raw = raw.copy(); raw[100:100 + cv.shape[0], 143:143 + cv.shape[1]][m] = cv[m]
        im = on_black(raw_to_img(raw.tobytes(), raw.shape[1], raw.shape[0], pal, alpha0=False)).convert('RGB')
        dr = ImageDraw.Draw(im, 'RGBA')
        for hs in sc['hotspots']:
            x, y, w, h = hs['x'], hs['y'], hs['w'], hs['h']
            dr.rectangle([x, y, x + w - 1, y + h - 1], outline=(0, 255, 0, 255))
            dr.text((x + 2, y + 1), hs['id'], font=f, fill=(255, 255, 0))
        wh = sc.get('wheel')
        if wh:
            dr.ellipse([wh['cx'] - wh['r_outer'], wh['cy'] - wh['r_outer'],
                        wh['cx'] + wh['r_outer'], wh['cy'] + wh['r_outer']], outline=(255, 0, 255, 255))
            dr.ellipse([wh['cx'] - wh['r_hub'], wh['cy'] - wh['r_hub'],
                        wh['cx'] + wh['r_hub'], wh['cy'] + wh['r_hub']], outline=(255, 0, 255, 255))
            for a in wh['sector_bounds_deg']:
                import math
                ax = math.radians(a)
                dr.line([wh['cx'] + wh['r_hub'] * math.cos(ax), wh['cy'] - wh['r_hub'] * math.sin(ax),
                         wh['cx'] + wh['r_outer'] * math.cos(ax), wh['cy'] - wh['r_outer'] * math.sin(ax)],
                        fill=(255, 0, 255, 255))
        im.save(os.path.join(OUT, 'hs_%s.png' % key))
        print('hs_%s.png' % key)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if cmd == 'all':
        render_all()
    elif cmd == 'sheets':
        make_sheets()
    elif cmd == 'grid':
        grid(sys.argv[2], sys.argv[3], *[int(a) for a in sys.argv[4:]])
    elif cmd == 'crop':
        crop(*sys.argv[2:])
    elif cmd == 'diff':
        diff(sys.argv[2:])
    elif cmd == 'wheels':
        cmd_wheels()
    elif cmd == 'json':
        cmd_json()
    elif cmd == 'overlay':
        cmd_overlay()
    else:
        print(__doc__)
