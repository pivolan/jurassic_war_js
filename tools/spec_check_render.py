#!/usr/bin/env python3
"""spec_check_render.py — независимая проверка утверждений notes/render-spec.md.

Ничего не импортирует из reimpl/js: все формулы заново написаны на Python по тексту спецификации
и сверяются либо с образом pwar.img, либо с КАДРАМИ ЭТАЛОНА (reimpl/traces/render_*), либо
с эталоном под unicorn (только раздел «рамка выделения», если unicorn установлен).

Запуск:  python3 tools/spec_check_render.py            — всё, что не требует unicorn
         python3 tools/spec_check_render.py --unicorn  — плюс сверка рамки выделения с эталоном
"""
import os, sys, json, zlib, struct

JW  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = open(os.path.join(JW, 'pwar.img'), 'rb').read(); IMGBASE = 0x10000
TR  = os.path.join(JW, 'reimpl', 'traces')
TRACES = ['render_m0_t0', 'render_m2_t0', 'render_m9_t3']

def i_u8(a):  return IMG[a-IMGBASE]
def i_u16(a): return struct.unpack_from('<H', IMG, a-IMGBASE)[0]
def i_i16(a): return struct.unpack_from('<h', IMG, a-IMGBASE)[0]
def i_u32(a): return struct.unpack_from('<I', IMG, a-IMGBASE)[0]
def i_i32(a): return struct.unpack_from('<i', IMG, a-IMGBASE)[0]

class Snap:
    """Снимок сегмента данных после старта миссии (reimpl/traces/<m>/snap0.bin.z)."""
    def __init__(self, name):
        d = os.path.join(TR, name.replace('render_', ''))
        ix = json.load(open(os.path.join(d, 'index.json'))); self.lo = ix['data_lo']
        self.d = zlib.decompress(open(os.path.join(d, 'snap0.bin.z'), 'rb').read())
    def u8(self, a):  return self.d[a-self.lo]
    def u16(self, a): return struct.unpack_from('<H', self.d, a-self.lo)[0]
    def i16(self, a): return struct.unpack_from('<h', self.d, a-self.lo)[0]
    def u32(self, a): return struct.unpack_from('<I', self.d, a-self.lo)[0]
    def i32(self, a): return struct.unpack_from('<i', self.d, a-self.lo)[0]
    def raw(self, a, n): return self.d[a-self.lo:a-self.lo+n]

def frame(name, k=0):
    """Кадр эталона: 640*480 индексов палитры + 768 байт палитры."""
    b = zlib.decompress(open(os.path.join(TR, name, 'frame_%04d.bin.z' % k), 'rb').read())
    return b[:640*480], b[640*480:]

RES = []   # (раздел, ok, всего, комментарий)
def report(sec, bad, total, note=''):
    RES.append((sec, bad, total, note))
    print('  %-58s %s  (%d проверок%s)' % (sec, 'OK' if bad == 0 else 'РАСХОЖДЕНИЙ %d' % bad, total, ', ' + note if note else ''))

# ─────────────────────────────────────────────────────────────────────────────
# 1. Таблицы: значения в спецификации == pwar.img == память после старта миссии
# ─────────────────────────────────────────────────────────────────────────────
SPEC_TABLES = {
    'диспетчер отрисовки 0x250b0': (0x250b0, 'u32', 40,
        [0x25150] + [0x25151]*8 + [0x2540a]*15 + [0x254b6]*2 + [0x2550f]*14),
    'цвет рамки по владельцу 0x3054d': (0x3054d, 'u8', 9, [195,199,203,207,211,215,219,223,28]),
    'сдвиг командного цвета 0x30556': (0x30556, 'u8', 9, [0,4,8,12,16,20,24,28,64]),
    'цвет владельца на мини-карте 0x3e8a0': (0x3e8a0, 'u8', 10, [0,195,199,203,185,211,181,197,223,28]),
    'ширина спрайта по типу 0x303b6': (0x303b6, 'i16x4', 40, [0]+[32]*25+[96,64,96,96]+[64]*10),
    'высота спрайта по типу 0x303b8': (0x303b8, 'i16x4', 40, [0]+[32]*25+[64]*14),
    'центр X по типу 0x30456': (0x30456, 'i16x4', 40, [0]+[16]*25+[48,32,48,48]+[32]*10),
    'центр Y по типу 0x30458': (0x30458, 'i16x4', 40, [0]+[16]*25+[32]*14),
    'кадр смерти A 0x36f10': (0x36f10, 'u16x4', 26,
        [2297,2297,2301,2305,2309,2313,2317,2321,2325,2329,2333,2337,2341,2345,2349,2353,
         2357,2361,2365,2369,2373,2377,2381,2385,0,0]),
    'кадр смерти B 0x36f12': (0x36f12, 'u16x4', 26,
        [2389]*9 + [2397]*5 + [2405]*2 + [2397]*4 + [2413]*4 + [0,0]),
    'смещение по направлению, смерть A 0x36f70': (0x36f70, 'u16x4', 9, [0,0,0,2,2,2,2,0,0]),
    'смещение по направлению, смерть B 0x36f72': (0x36f72, 'u16x4', 9, [0,0,0,4,4,4,4,0,0]),
    'база кадров атаки 0x36e8c': (0x36e8c, 'u16', 24,
        [0,45,110,175,240,305,370,435,500,1710,1750,1790,1830,1870,1910,1950,1990,2030,2070,2110,2150,2190,2230,2270]),
    'фаза атаки, лук 0x36ef0': (0x36ef0, 'u16', 8, [3,3,0,0,1,1,2,2]),
    'фаза атаки, ближний бой 0x36f00': (0x36f00, 'u16', 8, [3,3,3,1,0,0,1,2]),
    'фаза атаки, звери 0x36ebc': (0x36ebc, 'u16', 8, [65516,65516,0,0,1,1,2,2]),
    'направление атаки, люди 0x36ecc': (0x36ecc, 'u16', 9, [0,0,4,8,12,16,12,8,4]),
    'направление атаки, звери 0x36ede': (0x36ede, 'u16', 9, [0,0,3,6,9,12,9,6,3]),
    'база спрайта-оверлея предмета 0x41650': (0x41650, 'u32', 25,
        [0,520,585,650,715,780,845,910,975,1040,1105,0,0,0,0,1170,1235,0,1300,0,0,1365,1430,1495,1560]),
    'вычитаемая база типа 0x416b4 (типы 1..3)': (0x416b4+4, 'u32', 3, [0,65,130]),
    'смещение кадра лука 0x416c4 (типы 1..3)': (0x416c4+4, 'u32', 3, [1580,1535,1490]),
    'спрайт стройплощадки 0x41894': (0x41894, 'u32', 14, [2433,2432,2433,2433]+[2432]*10),
    'сдвиг руин 0x418cc': (0x418cc, 'i16x2', 28, [32,0]*14),
}
def read_table(rd, addr, kind, n):
    if kind == 'u8':    return [rd.u8(addr+i) for i in range(n)]
    if kind == 'u16':   return [rd.u16(addr+i*2) for i in range(n)]
    if kind == 'u32':   return [rd.u32(addr+i*4) for i in range(n)]
    if kind == 'i16x2': return [rd.i16(addr+i*2) for i in range(n)]
    if kind == 'i16x4': return [rd.i16(addr+i*4) for i in range(n)]
    if kind == 'u16x4': return [rd.u16(addr+i*4) for i in range(n)]
    raise ValueError(kind)
class ImgRd:
    u8, u16, u32 = staticmethod(i_u8), staticmethod(i_u16), staticmethod(i_u32)
    i16, i32 = staticmethod(i_i16), staticmethod(i_i32)

def check_tables():
    bad = tot = 0
    snaps = [(t, Snap(t)) for t in TRACES]
    for name, (addr, kind, n, exp) in SPEC_TABLES.items():
        tot += 1
        got = read_table(ImgRd, addr, kind, n)
        if got != exp:
            bad += 1; print('    ! %s: образ %s != спецификация %s' % (name, got, exp))
            continue
        for tn, sn in snaps:                      # таблица не переписывается в рантайме
            if addr < sn.lo: continue             # (таблицы в сегменте кода в снимок не попадают)
            tot += 1
            g2 = read_table(sn, addr, kind, n)
            if g2 != exp: bad += 1; print('    ! %s в %s: %s' % (name, tn, g2))
    # таблица цветов полосы HP: 8 диапазонов
    tot += 1
    hp = [i_u8(0x3e3d8+i) for i in range(256)]
    exp = [102]*8 + [105]*8 + [123]*40 + [126]*40 + [113]*40 + [117]*40 + [24]*40 + [30]*40
    if hp != exp: bad += 1; print('    ! 0x3e3d8 (цвет полосы HP) не совпал')
    # прямоугольники кнопок
    for addr, n, first, last in ((0x30c64, 28, [616,456,640,480], [602,217,634,249]),
                                 (0x30d44, 17, [616,456,640,480], [602,408,634,440])):
        tot += 2
        if [i_i16(addr+k*2) for k in range(4)] != first: bad += 1; print('    ! 0x%x[0]' % addr)
        if [i_i16(addr+(n-1)*8+k*2) for k in range(4)] != last: bad += 1; print('    ! 0x%x[%d]' % (addr, n-1))
    # фигуры рамки выделения: 8 записей (dx,dy,len) + прямоугольник (dx,dy,w,h), шаг 0x70
    tot += 1
    shapes_ok = True
    for t in range(1, 40):
        p = i_u32(0x3d1b8 + t*4)
        if p != 0x3d258 + t*0x70: shapes_ok = False
        r = [[i_i32(p+k*12+j*4) for j in range(3)] for k in range(8)]
        rect = [i_i32(p+0x60+j*4) for j in range(4)]
        x0, y0, x1, y1, L = r[0][0], r[0][1], r[3][0], r[4][1], r[0][2]
        if L != 6 or r[0] != r[1] or rect != [x0, y0-7, x1-x0+1, 6]: shapes_ok = False
        if r[3] != [x1, y0, L] or r[4] != [x0, y1, L] or r[5] != [x0, y1-5, L] or r[7] != [x1, y1-5, L]: shapes_ok = False
    if not shapes_ok: bad += 1; print('    ! 0x3d1b8: фигуры не соответствуют описанной параметризации')
    report('1. Таблицы (pwar.img и память после старта миссии)', bad, tot)

# ─────────────────────────────────────────────────────────────────────────────
# 2. Раскладка мини-карты (FUN_00024564) — независимая реализация
# ─────────────────────────────────────────────────────────────────────────────
def minimap_layout(mapW, mapH, flags):
    lx = [0]*256; ly = [0]*256
    if not (flags & 4):                                   # 1 пиксель на тайл
        for i in range(mapW): lx[i] = (i-0x34) & 0xff
        for i in range(0x34):  lx[i] = 0
        st = mapW-0x44 if mapW >= 0x44 else 0
        v  = (mapW-0x78) & 0xff if mapW >= 0x78 else 0
        for k in range(0x44): lx[(st+k) & 0xff] = v
        for i in range(mapH): ly[i] = (i-0x35) & 0xff
        for i in range(0x35):  ly[i] = 0
        st = mapH-0x43 if mapH >= 0x43 else 0
        v  = (mapH-0x78) & 0xff if mapH >= 0x78 else 0
        for k in range(0x43): ly[(st+k) & 0xff] = v
        x, w = 0x204, 0x78
        if mapW < 0x78: w = mapW; x = (0x78-mapW)//2 + 0x204 if flags & 1 else 0x27c-w
        y, h = 4, 0x78
        if mapH < 0x78:
            h = mapH
            if flags & 1: y = (0x78-mapH)//2 + 4
    else:                                                 # 2×2 пикселя на тайл
        for i in range(mapW): lx[i] = (i-0x16) & 0xff
        for i in range(0x16):  lx[i] = 0
        st = (mapW-0x26) & 0xff
        v  = (mapW-0x3c) & 0xff if mapW >= 0x3c else 0
        for k in range(0x26): lx[(st+k) & 0xff] = v
        for i in range(mapH): ly[i] = (i-0x16) & 0xff
        for i in range(0x16):  ly[i] = 0
        st = (mapH-0x25) & 0xff
        v  = (mapH-0x3c) & 0xff if mapH >= 0x3c else 0
        for k in range(0x25): ly[(st+k) & 0xff] = v
        x, w = 0x204, 0x78
        if mapW < 0x3c: w = mapW*2; x = (0x78-2*mapW)//2 + 0x204 if flags & 1 else 0x27c-w
        y, h = 4, 0x78
        if mapH < 0x3c:
            h = mapH*2
            if flags & 1: y = (0x78-2*mapH)//2 + 4
    return lx, ly, x, y, w, h

def check_layout():
    bad = tot = 0
    for t in TRACES:
        s = Snap(t); mw, mh, fl = s.u32(0x31af8), s.u32(0x31afc), s.u8(0x31ae0)
        lx, ly, x, y, w, h = minimap_layout(mw, mh, fl)
        tot += 3
        if (x, y, w, h) != (s.u32(0x30388), s.u32(0x3038c), s.u32(0x30390), s.u32(0x30394)):
            bad += 1; print('    ! %s: прямоугольник мини-карты' % t)
        if lx[:mw] != [s.u8(0x3e6f0+i) for i in range(mw)]: bad += 1; print('    ! %s: 0x3e6f0' % t)
        if ly[:mh] != [s.u8(0x3e7f0+i) for i in range(mh)]: bad += 1; print('    ! %s: 0x3e7f0' % t)
    report('2. Раскладка мини-карты 0x24564 (обе кратности)', bad, tot,
           'карты 48x48, 72x72 (2x2) и 180x150 (1x1)')

# ─────────────────────────────────────────────────────────────────────────────
# 3. Мини-карта: независимая отрисовка против кадра эталона
# ─────────────────────────────────────────────────────────────────────────────
def draw_minimap(s, fb):
    BI, MO, BG = 0x10ce74, 0x117e74, 0xf6e74
    fl = s.u8(0x31ae0)
    if not (fl & 1) and not (fl & 8): return
    camx, camy = s.u32(0x31ae8), s.u32(0x31aec)
    ox, oy = s.u8(0x3e6f0 + (camx >> 5)), s.u8(0x3e7f0 + (camy >> 5))
    mx, my, w, h = s.u32(0x30388), s.u32(0x3038c), s.u32(0x30390), s.u32(0x30394)
    vw, vh = s.u32(0x31af0), s.u32(0x31af4)
    cell0 = (oy << 8) | ox
    redraw = (fl & 1) or (fl & 2)
    def color(cell):
        if not (s.u8(BI+cell) & 1): return 0xff, False
        o = s.u8(MO+cell) >> 4
        if o == 0: o = s.u8(BI+cell) >> 2
        if o == 0: return s.u8(0x3e8aa + (s.u16(BG+cell*2) & 0x7ff)), False
        return s.u8(0x3e8a0 + o), True
    dark = lambda v: s.u8(0x44f80 + v)
    if not (fl & 4):                                 # 1 пиксель на тайл
        for r in range(h):
            for c in range(w):
                d = (my+r)*640 + mx + c
                col, unit = color(cell0 + r*0x100 + c)
                fb[d] = col if (redraw or unit) else dark(fb[d])
        px, py = mx + (camx >> 5) - ox, my + (camy >> 5) - oy
        for i in range(vw): fb[py*640+px+i] = 0x12; fb[(py+14)*640+px+i] = 0x12
        for r in range(15):  fb[(py+r)*640+px] = 0x12; fb[(py+r)*640+px+vw-1] = 0x12
    else:                                            # 2x2 пикселя на тайл
        for r in range(h >> 1):
            for c in range(w >> 1):
                d = (my+2*r)*640 + mx + 2*c
                col, unit = color(cell0 + r*0x100 + c)
                for o in (0, 1, 640, 641):
                    fb[d+o] = col if (redraw or unit) else dark(fb[d+o])
        px, py = mx + ((camx >> 5) - ox)*2, my + ((camy >> 5) - oy)*2
        for i in range(vw*2): fb[py*640+px+i] = 0x12; fb[(py+vh*2-1)*640+px+i] = 0x12
        for r in range(vh*2):  fb[(py+r)*640+px] = 0x12; fb[(py+r)*640+px+vw*2-1] = 0x12
    for i in range(w+2):                             # рамка вокруг мини-карты
        fb[(my-1)*640+mx-1+i] = 0xf7; fb[(my+h)*640+mx-1+i] = 0xf7
    for r in range(h):
        fb[(my+r)*640+mx-1] = 0xf7; fb[(my+r)*640+mx+w] = 0xf7

def check_minimap():
    bad = tot = 0
    for t in TRACES:
        s = Snap(t); px, _ = frame(t, 0)
        fb = bytearray(px)                            # берём кадр эталона и перерисовываем мини-карту поверх
        draw_minimap(s, fb)
        mx, my, w, h = s.u32(0x30388), s.u32(0x3038c), s.u32(0x30390), s.u32(0x30394)
        for y in range(my-1, my+h+1):
            for x in range(mx-1, mx+w+1):
                tot += 1
                if fb[y*640+x] != px[y*640+x]: bad += 1
    report('3. Мини-карта 0x24843 против кадра эталона', bad, tot, 'кадр 0 трёх трасс')

# ─────────────────────────────────────────────────────────────────────────────
# 4. Слой тайлов + туман против кадра эталона (только клетки, не закрытые спрайтами)
# ─────────────────────────────────────────────────────────────────────────────
def check_tiles():
    bad = tot = 0
    for t in TRACES:
        s = Snap(t); px, _ = frame(t, 0)
        BI, BG, TILES = 0x10ce74, 0xf6e74, 0x49b2c
        camx, camy = s.u32(0x31ae8), s.u32(0x31aec)
        tw, th = s.u32(0x31af0), s.u32(0x31af4)
        # клетки, где заведомо ничего не рисуется поверх: нет юнитов/предметов/декораций в радиусе 4 тайлов
        busy = set()
        i = s.u32(0x31b6c)
        while i:
            ux, uy = s.u16(0xe4400+i+0x2f) >> 5, s.u16(0xe4400+i+0x31) >> 5
            for dy in range(-4, 5):
                for dx in range(-4, 5): busy.add((ux+dx, uy+dy))
            i = s.u32(0xe4400+i+0x60)
        it = s.u32(0x31b7c)
        while it:
            ix, iy = s.u8(0xf4f34+it+1), s.u8(0xf4f34+it+2)
            for dy in range(-2, 3):
                for dx in range(-2, 3): busy.add((ix+dx, iy+dy))
            it = s.u32(0xf4f34+it+0xc)
        for ty in range(th):
            for tx in range(tw):
                gx, gy = (camx >> 5) + tx, (camy >> 5) + ty
                if (gx, gy) in busy: continue
                cell = (gy << 8) | gx
                bgv = s.u16(BG + cell*2)
                if bgv & 0xf800: continue                       # крупная декорация поверх тайла
                # код тумана (0x24446)
                if s.u8(BI+cell) & 1: code = 0xf
                else:
                    code = 0
                    if cell and (s.u8(BI+cell-1) & 1): code = 8
                    if cell < 0xafff and (s.u8(BI+cell+1) & 1): code += 2
                    if cell >= 0x100 and (s.u8(BI+cell-0x100) & 1): code += 1
                    if cell < 0xaf00 and (s.u8(BI+cell+0x100) & 1): code += 4
                base = TILES + (bgv & 0x7ff)*0x400
                fog  = None if code == 0xf else TILES + code*0x400
                for row in range(32):
                    src = s.raw(base + row*32, 32)
                    if fog is not None:
                        f = s.raw(fog + row*32, 32); src = bytes(a | b for a, b in zip(src, f))
                    d = (ty*32+row)*640 + tx*32
                    tot += 32
                    for k in range(32):
                        if px[d+k] != src[k]: bad += 1
    report('4. Слой тайлов 0x242d4 + туман 0x2438e против кадра эталона', bad, tot,
           'только клетки без спрайтов рядом')

# ─────────────────────────────────────────────────────────────────────────────
# 5. Шрифт: независимый растеризатор против надписи «FOODS=N» в кадре эталона
# ─────────────────────────────────────────────────────────────────────────────
def load_font(idx):
    b = open(os.path.join(JW, 'PWAR', '_PWAR01.TRC'), 'rb').read()
    base = struct.unpack_from('<I', b, 12)[0]
    o = 0x20 + idx*32; off, size = struct.unpack_from('<II', b, o+12)
    return b[base+off:base+off+size]

def draw_text(fb, font, gsz, rowb, doff, fh, fw, x, y, text, col, clipx1):
    for ch in text:
        c = ord(ch)
        w = font[c]; gw = min(w, fw)
        src = c*gsz + doff
        for r in range(fh):
            yy = y + r
            if yy < 0 or yy >= 480: continue
            for k in range(gw):
                xx = x + k
                if xx < 0 or xx > clipx1 or xx >= 640: continue
                p = font[src + r*rowb + k]
                if p: fb[yy*640+xx] = (p + col - 1) & 0xff
        x += w
    return x

def check_text():
    bad = tot = 0; note = []
    fnt = load_font(1)                      # FE0816RD.FNT (шрифт 1, текущий в 0x2572f): 256 ширин + глифы 8x16
    for t in TRACES:
        s = Snap(t); px, _ = frame(t, 0)
        pl = s.u16(0x31b64)
        if s.u32(0x31c48 + pl*4) == 0: continue      # счётчик еды в этом кадре не рисуется
        food = s.u32(0x31c28 + pl*4)
        text = 'FOODS=' + str(food)
        fb = bytearray(px)
        x1 = draw_text(fb, fnt, 128, 8, 256, 16, 8, 0x104, 0, text, 0xf8, s.u32(0x46ffc))
        for y in range(0, 16):
            for x in range(0x104, x1+1):
                tot += 1
                if fb[y*640+x] != px[y*640+x]: bad += 1
        note.append('%s: "%s"' % (t, text))
    report('5. Шрифт 8x16 и правило «цвет = уровень + база − 1»', bad, tot, '; '.join(note) or 'нет кадров с текстом')

# ─────────────────────────────────────────────────────────────────────────────
# 6. Рамка выделения и полоса HP против эталона под unicorn (--unicorn)
# ─────────────────────────────────────────────────────────────────────────────
def sel_pixels(rd, u, x, y, col, VW, VH):
    """Независимая реализация 0x23f44 по спецификации: множество (x,y)->цвет."""
    out = {}
    def put(px_, py_, c):
        if 0 <= px_ < VW and 0 <= py_ < VH: out[(px_, py_)] = c
    p = rd.u32(0x3d1b8 + u['type']*4)
    rec = [[rd.i32(p+k*12+j*4) for j in range(3)] for k in range(8)]
    rect = [rd.i32(p+0x60+j*4) for j in range(4)]
    for c in range(4):
        hx, hy, hl = rec[2*c]; vx, vy, vl = rec[2*c+1]
        if 0 <= y+hy < VH:
            for k in range(hl): put(x+hx+k, y+hy, col)
        if 0 <= x+vx < VW:
            for k in range(vl): put(x+vx, y+vy+k, col)
    rx, ry, rw, rh = x+rect[0], y+rect[1], rect[2], rect[3]
    for k in range(rw): put(rx+k, ry, col); put(rx+k, ry+rh-1, col)
    for k in range(rh): put(rx, ry+k, col); put(rx+rw-1, ry+k, col)
    by = ry + 1
    if not (0 <= by < 480) or u['hpmax'] == 0: return out
    n = (((rw - 2) * u['hp']) & 0xffff) // u['hpmax'] & 0xff
    if n == 0: return out
    hc = rd.u8(0x3e3d8 + u['hp'])
    for k in range(1, n+1):
        for r in range(4): put(rx+k, by+r, hc)
    return out

def _selection_cases():
    """Гоняет эталон под unicorn: для каждого случая обнуляет кадровый буфер, вызывает 0x23f44
    и возвращает МНОЖЕСТВО НАРИСОВАННЫХ пикселей (цвет 0 в рамке/полосе не встречается,
    поэтому «ненулевое» == «нарисованное»). Случаи синтетические: поля юнита пишутся в одну и ту же
    запись пула, чтобы порт можно было поставить в точно такие же условия."""
    here = os.path.dirname(os.path.abspath(__file__))          # tools/dis.py затеняет стандартный модуль dis
    sys.path[:] = [q for q in sys.path if os.path.abspath(q or '.') != here]
    sys.path.insert(0, os.path.join(JW, 'reimpl'))
    argv, sys.argv = sys.argv, [sys.argv[0]]
    import oracle, render_oracle
    sys.argv = argv
    UN, FB, SLOT = 0xe4400, 0x1235f4, 96 * 3
    cases, expected = [], []
    for mission, tribe in ((0, 0), (9, 3)):
        o = render_oracle.RenderOracle(); o.boot(); o.start(mission, tribe, 1); o.w8(oracle.G['norender'], 0)
        camx, camy = o.r32(0x31ae8), o.r32(0x31aec)
        vw, vh, local = o.r32(0x488c4), o.r32(0x488c8), o.r8(0x31b64)
        i = o.r32(0x31b6c); pool = []
        while i:
            pool.append(dict(type=o.r8(UN+i+4), owner=o.r8(UN+i+6), hp=o.r8(UN+i+0x0e),
                             hpmax=o.r8(UN+i+0x0c), x=o.r16(UN+i+0x2f), y=o.r16(UN+i+0x31)))
            i = o.r32(UN+i+0x60)
        for u in pool:
            if not (camx-100 <= u['x'] < camx+512 and camy-100 <= u['y'] < camy+480): continue
            for lead in (0, 1):
                c = dict(u, lead=lead, local=local, camx=camx, camy=camy, vw=vw, vh=vh,
                         mission=mission)
                o.mu.mem_write(oracle.A(UN+SLOT), b'\0'*96)
                o.w8(UN+SLOT+4, c['type']); o.w8(UN+SLOT+6, c['owner']); o.w8(UN+SLOT+7, 0x80)
                o.w8(UN+SLOT+0x0c, c['hpmax']); o.w8(UN+SLOT+0x0e, c['hp'])
                o.w16(UN+SLOT+0x2f, c['x']); o.w16(UN+SLOT+0x31, c['y'])
                o.w8(0x31b64, local); o.w32(0x31adc, SLOT if lead else 0)
                o.mu.mem_write(oracle.A(FB), b'\0'*(640*480))
                o.call(0x23f44, esi=SLOT)
                B = o.mem(FB, 640*480)
                expected.append({(k % 640, k // 640): B[k] for k in range(640*480) if B[k]})
                cases.append(c)
    return cases, expected

def check_selection():
    """Раздел 6: независимая модель §7 против эталона. Раздел 7: сам порт против эталона."""
    try:
        cases, expected = _selection_cases()
    except Exception as e:
        print('  6-7. Рамка выделения: unicorn/oracle недоступны (%s) — пропущено' % e); return
    bad = 0
    for c, exp in zip(cases, expected):
        col = 0xfc if (c['local'] == c['owner'] and c['lead']) else i_u8(0x3054d + c['owner'])
        got = sel_pixels(ImgRd, c, c['x']-c['camx'], c['y']-c['camy'], col, c['vw'], c['vh'])
        if got != exp:
            bad += 1
            print('    ! модель, миссия %d тип %d lead=%d: ожидалось %d пикселей, посчитано %d'
                  % (c['mission'], c['type'], c['lead'], len(exp), len(got)))
    report('6. Рамка выделения и полоса HP 0x23f44 — модель §7 (эталон unicorn)', bad, len(cases),
           'миссии 0 и 9, все видимые юниты, «лидер» и «не лидер»')
    check_selection_port(cases, expected)

def check_selection_port(cases, expected):
    """Раздел 7: прогоняет РЕАЛИЗАЦИЮ ПОРТА (reimpl/js/render/scene.js) на тех же случаях.
    Render-трассы эту ветку не покрывают (в них ни один юнит не выделен), поэтому проверяем отдельно."""
    import subprocess, tempfile, shutil
    node = shutil.which('node')
    if not node:
        print('  7. Порт на 0x23f44: node не найден — пропущено'); return
    d = tempfile.mkdtemp()
    cj, oj = os.path.join(d, 'cases.json'), os.path.join(d, 'out.json')
    snap = os.path.join(TR, 'm0_t0', 'snap0.bin.z')
    lo = json.load(open(os.path.join(TR, 'm0_t0', 'index.json')))['data_lo']
    json.dump({'snapshot': snap, 'data_lo': lo, 'cases': cases}, open(cj, 'w'))
    helper = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'spec_check_render_port.mjs')
    r = subprocess.run([node, helper, cj, oj], capture_output=True, text=True)
    if r.returncode != 0:                                   # сломанный помощник не должен выглядеть «зелёным»
        print(r.stderr[-2000:])
        report('7. Порт reimpl/js/render/scene.js на 0x23f44 (эталон unicorn)', 1, 1, 'node вернул ошибку')
        return
    got_all = json.load(open(oj)); shutil.rmtree(d, ignore_errors=True)
    bad = 0
    for c, exp, px in zip(cases, expected, got_all):
        got = {(x, y): v for x, y, v in px}
        if got != exp:
            bad += 1
            if bad <= 3:
                print('    ! порт, миссия %d тип %d lead=%d: эталон %d пикселей, порт %d, различий %d'
                      % (c['mission'], c['type'], c['lead'], len(exp), len(got),
                         len(set(exp.items()) ^ set(got.items()))))
    report('7. Порт reimpl/js/render/scene.js на 0x23f44 (эталон unicorn)', bad, len(cases),
           'ветка, не покрытая render-трассами')

# ─────────────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print('spec_check_render.py — проверка notes/render-spec.md\n')
    check_tables(); check_layout(); check_minimap(); check_tiles(); check_text()
    if '--unicorn' in sys.argv: check_selection()
    else: print('  6-7. Рамка выделения 0x23f44 (модель и порт): запустите с --unicorn')
    print()
    tb = sum(r[1] for r in RES); tt = sum(r[2] for r in RES)
    print('ИТОГО: %d проверок, расхождений %d  →  %s' % (tt, tb, 'СПЕЦИФИКАЦИЯ ПОДТВЕРЖДЕНА' if tb == 0 else 'ЕСТЬ РАСХОЖДЕНИЯ'))
    sys.exit(1 if tb else 0)
