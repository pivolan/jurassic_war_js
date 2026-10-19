#!/usr/bin/env python3
"""spec_check_combat.py TRACE...  — независимая проверка notes/combat-spec.md.

Все формулы боя реализованы здесь ЗАНОВО по тексту спецификации; порт reimpl/js/port/combat.js
не импортируется. Берётся состояние пула юнитов на шаге k из трассы эталона (unicorn),
применяются формулы документа, результат сравнивается со шагом k+1.

Проверяется:
  1. кадры атаки (+0x2c) в состояниях 0x10/0x30, момент удара, счётчик перезарядки 0x12/0x32;
  2. досягаемость 0x1a051 (через наблюдаемый переход 0x10 → 0x12) и перезарядка 16 − SPD>>4;
  3. урон ближнего боя: база + таблица оружия по типу цели − таблица щита;
  4. снаряды: метательное оружие и маги — полная симуляция пула (Брезенхем, 8 подшагов, bbox);
  5. XP: +1 обоим при ударе, ценность жертвы убийце;
  6. рост статов после убийства (0x1ec47 люди / 0x1f20f звери);
  7. регенерация HP/маны раз в 16 шагов (еда за каждый 4-й HP, баг с маной) и ремонт зданий;
  8. таймеры оглушения +0x43;
  9. смерть: 0x6f → 0x60, счётчик трупа;
 10. поиск цели 0x1a526/0x1a531 по кольцам (сетка BI/MO восстанавливается из пула).

Запуск (из каталога reimpl):
    python3 ../tools/spec_check_combat.py traces/long_m1_t1 traces/long_m2_t0 ...
"""
import collections, json, os, struct, sys, zlib

# ------------------------------------------------------------------ образ и таблицы
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = open(os.path.join(HERE, '..', 'pwar.img'), 'rb').read()
BASE = 0x10000
def b8(a):   return IMG[a - BASE]
def u16(a):  return struct.unpack_from('<H', IMG, a - BASE)[0]
def i16a(a): return struct.unpack_from('<h', IMG, a - BASE)[0]
def u32(a):  return struct.unpack_from('<I', IMG, a - BASE)[0]

SPR_W = [u16(0x303b6 + 4 * t) for t in range(40)]
SPR_H = [u16(0x303b8 + 4 * t) for t in range(40)]
CEN_X = [u16(0x30456 + 4 * t) for t in range(40)]
CEN_Y = [u16(0x30458 + 4 * t) for t in range(40)]
RANGE = [u16(0x3055e + 4 * i) for i in range(11)]
RINGN = [u32(0x3058c + 4 * i) for i in range(17)]
SPIRAL = [(i16a(0x305d0 + 4 * i), i16a(0x305d2 + 4 * i)) for i in range(225)]
WBLK  = [u32(0x37af4 + 4 * i) for i in range(24)]
def wtab(wid, idx):
    base = WBLK[wid] if 0 <= wid < 24 and WBLK[wid] else 0x37b54
    return b8(base + idx)
MAGE_A = {5: 0x37990, 6: 0x379d7, 7: 0x37a1e, 8: 0x37a65}
MAGE_B = {5: 0x379b8, 6: 0x379ff, 7: 0x37a46, 8: 0x37a8d}
MAGE_KIND = {5: 0x18, 6: 0x20, 7: 0x28, 8: 0x30}
WPN_KIND  = {4: 0x3b, 5: 0x00, 6: 0x08, 7: 0x10}
PROJ_OFF = [(0, 0), (13, -4), (21, 1), (17, 8), (15, 14), (22, 15), (-7, 9), (-4, 2), (3, -4)]
DIR_STEP = [(i16a(0x30504 + 4 * d), i16a(0x30506 + 4 * d)) for d in range(9)]
OCT = [b8(0x304f6 + i) for i in range(16)]
CAP_PTR = [u32(0x30dd8 + 4 * p) for p in range(9)]      # 0..7 игроки, 8 — дикая природа
CAP_OFF = [u32(0x30dfc + 4 * t) for t in range(26)]
STATS = [(1, 'HPMAX', 0), (2, 'ATK', 4), (4, 'DEF', 6), (8, 'MAG', 2), (0x10, 'SPD', 8)]
BLD_N = [u32(0x3176c + 8 * k) for k in range(14)]       # число тайлов здания по (тип − 26)
BLD_P = [u32(0x31770 + 8 * k) for k in range(14)]
WAVE_D = [(i16a(0x37070 + 4 * d), i16a(0x37072 + 4 * d)) for d in range(9)]
WAVE_P = [u32(0x37094 + 4 * d) for d in range(9)]
WAVE_A, WAVE_B = 0x37aac, 0x37ad4

# ------------------------------------------------------------------ трасса
POOL, SZ, REC = 57600, 96, 57632
F = dict(TYPE=4, SLOT=5, OWNER=6, F07=7, F08=8, STAT0B=0x0b, HPMAX=0x0c, MAG=0x0d, HP=0x0e, ATK=0x0f,
         DEF=0x10, MANA=0x11, SPD=0x12, FOOD=0x13, WEAPON=0x15, SHIELD=0x16, INV=0x1b, XP=0x27,
         STATE=0x2b, ATKCTR=0x2c, X=0x2f, Y=0x31, TARGET=0x33, DIR=0x3d, FX43=0x43, GX=0x44, GY=0x45,
         ORDER=0x46, ORDARG=0x47, ANIM=0x4f, FLAGS50=0x50, STX=0x53, STY=0x54, FLAGS5B=0x5b,
         PREV=0x5c, NEXT=0x60)

class Snap:
    __slots__ = ('b', '_ord')
    def __init__(self, b): self.b = b; self._ord = None
    def u8(self, i, f):  return self.b[i + F[f]]
    def u16(self, i, f): return struct.unpack_from('<H', self.b, i + F[f])[0]
    def i16(self, i, f):
        v = self.u16(i, f); return v - 0x10000 if v & 0x8000 else v
    def u32(self, i, f): return struct.unpack_from('<I', self.b, i + F[f])[0]
    def inv(self, i, k): return self.b[i + F['INV'] + k]
    def chains(self):
        """Все цепочки двусвязных списков пула (активный + свободный)."""
        bypre = {}
        for j in range(0, POOL, SZ):
            if self.b[j + 4] == 0: continue
            bypre.setdefault(struct.unpack_from('<I', self.b, j + F['PREV'])[0], []).append(j)
        out = []
        for h in range(0, POOL, SZ):
            if self.b[h + 4] == 0: continue
            if struct.unpack_from('<I', self.b, h + F['PREV'])[0] != 0: continue
            i, c, seen = h, [], set()
            while i and i not in seen:
                seen.add(i); c.append(i)
                if i + F['NEXT'] + 4 <= POOL:            # последняя запись пула обрезана в дампе
                    i = struct.unpack_from('<I', self.b, i + F['NEXT'])[0]
                else:
                    nxt = [j for j in bypre.get(i, []) if j not in seen]
                    i = nxt[0] if len(nxt) == 1 else 0
            out.append(c)
        return out

    def set_order(self, o): self._ord = o

    def pick_order(self, prefer):
        """Активный список 0x31b6c: из всех цепочек берём наиболее совпадающую с предыдущим шагом."""
        cs = self.chains()
        if not cs:
            return sorted(i for i in range(0, POOL, SZ) if self.b[i + 4] != 0)
        return max(cs, key=lambda c: (len(set(c) & prefer), -len(c)))

    def order(self):
        if self._ord is None: self._ord = self.pick_order(set())
        return self._ord

# ------------------------------------------------------------------ формулы спецификации
def abs16(v):
    v &= 0xffff
    return (0x10000 - v) & 0xffff if v & 0x8000 else v

def base_dmg(atk, dfn):                                   # 0x1ea75
    d = atk - dfn
    if d < 0: d = 0
    return ((d >> 4) + (atk >> 5) + 1) & 0xff

def melee_dmg(s, a, t, atk=None, dfn=None):               # 0x1e934
    al = base_dmg(s.u8(a, 'ATK') if atk is None else atk, s.u8(t, 'DEF') if dfn is None else dfn)
    ws, wid = s.u8(a, 'WEAPON'), 0
    if ws != 0xff:
        wid = s.inv(a, ws)
        al = (al + wtab(wid, s.u8(t, 'TYPE'))) & 0xff
    sh = s.u8(t, 'SHIELD')
    if sh != 0xff:
        al = al - wtab(wid, 0x28 + s.inv(t, sh))
        if al <= 0: al = 1
    return al & 0xff, (wid if ws != 0xff else None)

def mage_dmg(s, a, t, atk=None):                          # 0x1e81c/0x1e862/0x1e8a8/0x1e8ee
    ty = s.u8(a, 'TYPE')
    al = base_dmg(s.u8(a, 'ATK') if atk is None else atk, s.u8(t, 'DEF'))
    al = (al + b8(MAGE_A[ty] + s.u8(t, 'TYPE'))) & 0xff
    sl = s.u8(t, 'SHIELD')                                # индекс — СЛОТ (3..5), а не id предмета
    if sl != 0xff:
        v = al - b8(MAGE_B[ty] + sl)
        al = 1 if v < 0 else v
    return al & 0xff

def in_reach(s, a, t, axy, txy):                          # 0x1a051
    if (axy[0] & 0x1f) or (axy[1] & 0x1f): return False
    ty = s.u8(a, 'TYPE')
    dx, bx = axy
    ax, cx = (dx + SPR_W[ty]) & 0xffff, (bx + SPR_H[ty]) & 0xffff
    idx = -1
    if ty < 5:
        ws = s.u8(a, 'WEAPON')
        if ws != 0xff:
            it = s.inv(a, ws)
            if it == 4: idx = s.u8(a, 'SPD') >> 6
            elif 5 <= it <= 7: idx = s.u8(a, 'SPD') >> 5
    elif ty <= 8: idx = s.u8(a, 'SPD') >> 5
    elif ty == 13: idx = 0
    if idx >= 0:
        r = RANGE[idx] if idx < len(RANGE) else 0
        dx = dx - r if dx >= r else 0
        bx = bx - r if bx >= r else 0
        ax = (ax + r) & 0xffff; cx = (cx + r) & 0xffff
    sgn = lambda v: v - 0x10000 if v & 0x8000 else v
    dx, ax, bx, cx = sgn(dx), sgn(ax), sgn(bx), sgn(cx)
    tt = s.u8(t, 'TYPE')
    x0, y0 = sgn(txy[0]), sgn(txy[1])
    x1 = sgn((txy[0] + SPR_W[tt]) & 0xffff)
    y1 = sgn((txy[1] + SPR_H[tt]) & 0xffff)
    ins = lambda x, y: not (x < dx or x > ax or y < bx or y > cx)
    return ins(x0, y0) or ins(x1, y0) or ins(x1, y1) or ins(x0, y1)

def refine_dir(al, ax, ay, tx, ty):                       # 0x1aa10
    if al in (2, 6): flip = False
    elif al in (4, 8): flip = True
    else: return al
    dx = abs16(tx - ax); by = abs16(ty - ay)
    if dx < by:
        by >>= 1
        if by < dx: return al
        al = al + 1 if flip else al - 1
        if flip and (al & 0xff) >= 9: al = 1
    else:
        dx >>= 1
        if dx <= by: return al
        al = al - 1 if flip else al + 1
    return al & 0xff

def dir_to(x, y, tx, ty):                                 # 0x1a95d
    e = 0
    if x != tx:
        e = 6 if x >= tx else 0
        e += 2
    if y != ty:
        e += 3 if y <= ty else 0
        e += 1
    return OCT[e]

# ------------------------------------------------------------------ снаряды
class Proj:
    __slots__ = ('kind', 'life', 'axis', 'dmg', 'src', 'tgt', 'x', 'y', 'ex', 'ey', 'dx', 'dy', 'sx', 'sy')

def proj_new(s, kind, a, t, dmg, d, axy, txy):            # 0x1b730
    p = Proj()
    p.dmg = dmg; p.src = a; p.tgt = t
    p.life = ((RANGE[s.u8(a, 'SPD') >> 5] + 0x28) & 0xffff) >> 1
    ox, oy = PROJ_OFF[d] if 0 <= d < 9 else (0, 0)
    p.x = (axy[0] + ox) & 0xffff
    p.y = (axy[1] + oy) & 0xffff
    p.kind = (kind + d) & 0xff
    dd = dir_to(axy[0], axy[1], txy[0], txy[1])
    p.sx = DIR_STEP[dd][0] * 2
    p.sy = DIR_STEP[dd][1] * 2
    tt = s.u8(t, 'TYPE')
    ax = abs16(CEN_X[tt] + txy[0] - p.x)
    ay = abs16(CEN_Y[tt] + txy[1] - p.y)
    p.ex, p.ey, p.dx, p.dy = ax, ay, ax, ay
    p.axis = 1 if ax < ay else 0
    return p

def proj_move(p):                                         # 0x1ad4f
    if p.axis:
        p.y = (p.y + p.sy) & 0xffff
        ax = (p.ex + p.dx) & 0xffff
        if not (p.ey > ax):
            ax = (ax - p.dy) & 0xffff
            p.x = (p.x + p.sx) & 0xffff
        p.ex = ax
    else:
        p.x = (p.x + p.sx) & 0xffff
        ax = (p.ey + p.dy) & 0xffff
        if not (p.ex > ax):
            p.y = (p.y + p.sy) & 0xffff
            ax = (ax - p.dx) & 0xffff
        p.ey = ax

# ------------------------------------------------------------------ модель одного шага
class Sim:
    def __init__(self, s, stepno, ctx):
        self.s, self.stepno, self.ctx = s, stepno, ctx
        self.hp, self.xp, self.stat = {}, {}, {}
        self.ctr, self.state = {}, {}
        self.dead, self.dirty = set(), set()
        self.found, self.damaged, self.ordered = {}, set(), set()
        self.pos = {}
        self.newp = []

    def gethp(self, i): return self.hp.get(i, self.s.u8(i, 'HP'))
    def getxp(self, i): return self.xp.get(i, self.s.u32(i, 'XP'))
    def get(self, i, f): return self.stat.get((i, f), self.s.u8(i, f))

    # ---------------- урон
    def apply_damage(self, src, tgt, al, cur):
        s = self.s
        if s.u8(tgt, 'FLAGS5B') & 1: return
        self.damaged.add(tgt)                             # 0x19fdf может выдать приказ 0x33
        hp = self.gethp(tgt)
        nv = hp - al
        self.hp[tgt] = nv & 0xff
        dead = nv <= 0
        if s.u8(tgt, 'TYPE') >= 0x1a and not dead:
            half = s.u8(tgt, 'HPMAX') >> 1
            if hp >= half and (nv & 0xff) < half:
                h2 = nv & 0xff
                self.hp[tgt] = (h2 - 2) & 0xff
                dead = h2 < 2
        if dead: self.death(src, tgt, cur)

    def death(self, src, tgt, cur):                       # 0x1ebdc
        s = self.s
        self.hp[tgt] = 0
        if s.u8(tgt, 'STATE') in (0x6f, 0x60) or tgt in self.dead: return
        self.dead.add(tgt)
        # если очередь жертвы в списке ещё не подошла, она в этом же шаге станет 0x60 (0x19693)
        if self.pos.get(tgt, 10 ** 9) > cur:
            self.state[tgt] = 0x60; self.ctr[tgt] = 0     # 0x19693 обнуляет счётчик кадра
        else:
            self.state[tgt] = 0x6f; self.ctr.pop(tgt, None)
        if s.u8(tgt, 'TYPE') >= 0x1a: return
        v = (self.get(tgt, 'HPMAX') + self.get(tgt, 'MAG') + self.get(tgt, 'ATK') +
             self.get(tgt, 'DEF') + self.get(tgt, 'SPD')) & 0xffff
        self.xp[src] = (self.getxp(src) + ((v * v) >> 2) + self.getxp(tgt)) & 0xffffffff
        ty = s.u8(src, 'TYPE')
        if ty < 0x0e: self.grow(src, human=True)
        elif ty < 0x18: self.grow(src, human=False)
        else: self.dirty.add(src)
        if ty == 1:                                       # 0x1f6fe: смена класса Commoner
            if self.get(src, 'HPMAX') >= 0x46: self.stat[(src, 'TYPE')] = 2
            elif self.get(src, 'ATK') >= 0x46: self.stat[(src, 'TYPE')] = 3

    # ---------------- рост статов
    def caps(self, i):
        s = self.s
        t = s.u8(i, 'TYPE')
        if t >= 26: return None
        b = CAP_PTR[s.u8(i, 'SLOT')] + CAP_OFF[t]
        return {'HPMAX': u16(b), 'MAG': u16(b + 2), 'ATK': u16(b + 4), 'DEF': u16(b + 6), 'SPD': u16(b + 8)}

    def grow(self, i, human):
        caps = self.caps(i)
        if caps is None: self.dirty.add(i); return
        g = {f: self.get(i, f) for _m, f, _c in STATS}
        if human: self._grow_human(i, caps, g)
        else: self._grow_beast(i, caps, g)

    def _one(self, i, f, cap, ecx, ebx, g):
        """Общий блок: пропорциональная доля, потолок, цена. → (ecx, выросло?)"""
        ax = ((ecx * cap) // ebx) & 0xffff if ebx else 0
        if g[f] >= ax: return ecx, 0
        cur = self.get(i, f)
        if (cap & 0xff) <= cur: return ecx, -1              # −1 = «упёрлись в потолок»
        cost = (((cur * cur) & 0xffff) >> 1) + 10
        if self.getxp(i) < cost: return ecx, 0
        self.stat[(i, f)] = cur + 1
        g[f] += 1
        self.xp[i] = self.getxp(i) - cost
        return ecx + 1, 1

    def _grow_human(self, i, caps, g):                    # 0x1ec47
        grow = self.s.u8(i, 'STAT0B')
        def sums(first):
            ecx = ebx = n = 0
            for mask, f, _c in STATS:
                has = (grow & mask) != 0
                if has if first else (not has):
                    ecx += g[f]; ebx += caps[f]; n += 1
            return ecx & 0xffff, ebx & 0xffff, n
        def chain(ecx, ebx, first):
            got = 0
            for k in range(5):
                mask, f, _c = STATS[k]
                has = (grow & mask) != 0
                if (not has) if first else has: continue
                ecx, r = self._one(i, f, caps[f], ecx, ebx, g)
                if r > 0: got += 1
                if r < 0 and not first:                   # 0x1f009: прыжок в first-цепочку
                    for j in range(k + 1, 5):
                        m2, f2, _c2 = STATS[j]
                        if (grow & m2) == 0: continue
                        ecx, r2 = self._one(i, f2, caps[f2], ecx, ebx, g)
                        if r2 > 0: got += 1
                    return True, ecx, got
            return False, ecx, got
        ecx, ebx, n = sums(True)
        first_loop = n != 0 and ecx < ebx
        marker = n if first_loop else 0
        if first_loop: ecx += n
        guard = 0
        while True:
            guard += 1
            if guard > 100: self.dirty.add(i); return
            if first_loop:
                while True:
                    _sw, ecx, got = chain(ecx, ebx, True)
                    if got == 0: break
            if marker >= 1: return
            ecx2, ebx2, n2 = sums(False)
            if n2 == 0 or ecx2 >= ebx2: return
            ecx, ebx = ecx2 + n2, ebx2
            while True:
                sw, ecx, got = chain(ecx, ebx, False)
                if sw: first_loop = got != 0; break
                if got == 0: return

    def _grow_beast(self, i, caps, g):                    # 0x1f20f
        ecx = (g['HPMAX'] + g['ATK'] + g['DEF'] + g['SPD']) & 0xffff
        ebx = caps['SPD']                                 # оригинал: mov bx — только потолок SPD
        if ecx >= ebx: return
        ecx += 4
        guard = 0
        while True:
            guard += 1
            if guard > 100: self.dirty.add(i); return
            got = 0
            for f in ('HPMAX', 'ATK', 'DEF', 'SPD'):
                ecx, r = self._one(i, f, caps[f], ecx, ebx, g)
                if r > 0: got += 1
            if got == 0: return

# ------------------------------------------------------------------ сетки и поиск цели
def stamp(bi, mo, s, i, on):
    t = s.u8(i, 'TYPE')
    c = (s.u8(i, 'STY') << 8) + s.u8(i, 'STX')
    if t == 0x0b:
        mo[c] = (mo[c] & 0x0f) | ((((s.u8(i, 'OWNER') + 1) << 4) & 0xff) if on else 0)
    else:
        bi[c] = (bi[c] & 3) | ((((s.u8(i, 'OWNER') + 1) << 2) & 0xff) if on else 0)

def stamp_building(bi, s, i):
    t = s.u8(i, 'TYPE'); k = t - 0x1a
    if not (0 <= k < len(BLD_N)): return
    x, y = s.u16(i, 'X'), s.u16(i, 'Y')
    for j in range(BLD_N[k]):
        c = ((((y + u32(BLD_P[k] + j * 8 + 4)) >> 5) & 0xff) << 8) + (((x + u32(BLD_P[k] + j * 8)) >> 5) & 0xff)
        bi[c] = (bi[c] & 3) | (((s.u8(i, 'OWNER') + 1) << 2) & 0xff)

def gone(s, i):
    return (s.u8(i, 'FLAGS5B') & 1) != 0 or s.u8(i, 'STATE') in (0x60, 0x6f)

def grid_one(bi, mo, prev, cur, i):
    """Отпечаток одного юнита: 0x1e56d/0x1a3db ставят, 0x1e5cc/0x1a42c снимают (клетка +0x53/+0x54)."""
    if cur.b[i + 4] == 0: return
    if cur.u8(i, 'TYPE') >= 26:
        if cur.u8(i, 'OWNER') != prev.u8(i, 'OWNER'): stamp_building(bi, cur, i)
        return
    pg, cg = gone(prev, i), gone(cur, i)
    pc = (prev.u8(i, 'STY') << 8) + prev.u8(i, 'STX')
    cc = (cur.u8(i, 'STY') << 8) + cur.u8(i, 'STX')
    if not pg and (cg or pc != cc): stamp(bi, mo, prev, i, False)
    if not cg and (pg or pc != cc): stamp(bi, mo, cur, i, True)

def update_grids(bi, mo, prev, cur, only=None):
    for i in range(0, POOL, SZ):
        if only is not None and i in only: continue
        grid_one(bi, mo, prev, cur, i)

def unit_on_tile(s, tx, ty, view):                        # 0x1a692
    for i in s.order():
        v = view(i)                                       # запись «на момент хода ищущего»
        if v.u8(i, 'FLAGS5B') & 1: continue
        if v.u8(i, 'STATE') == 0x6f or v.u8(i, 'ORDER') == 0x6f: continue
        if (v.u16(i, 'X') >> 5) != tx or (v.u16(i, 'Y') >> 5) != ty: continue
        return i
    return 0

def find_target(s, ctx, i, ring, view):                         # 0x1a526 / 0x1a531
    bi, mo = ctx['bi'], ctx['mo']
    own = s.u8(i, 'OWNER')
    n = RINGN[ring] if ring < len(RINGN) else 0
    for k in range(1, n):
        dx = (s.u8(i, 'GX') + SPIRAL[k][0]) & 0xffff
        if dx >= ctx['mapW']: continue
        ty = (s.u8(i, 'GY') + SPIRAL[k][1]) & 0xffff
        if ty >= ctx['mapH']: continue
        gi = dx + (ty << 8)
        ok = False
        v = bi[gi]
        if v & 0xfc: ok = own != (((v >> 2) - 1) & 0xff)
        else:
            v = mo[gi]
            if v & 0xf0: ok = own != (((v >> 4) - 1) & 0xff)
        if not ok: continue
        e = unit_on_tile(s, dx, ty, view)
        if e == 0: continue
        v = view(e)
        if v.u8(e, 'STATE') == 0x60: continue
        if v.u8(e, 'OWNER') == own:
            if v.u8(e, 'STATE') in (0x10, 0x30):
                e2 = v.u32(e, 'TARGET')
                if e2 % SZ == 0 and e2 < POOL and view(e2).u8(e2, 'STATE') != 0x60: return e2
        else:
            if own >= 8: return e
            if ctx['ai'][own] >= 1: return e
            if v.u8(e, 'TYPE') < 0x1a: return e
    return 0

# ------------------------------------------------------------------ шаг
def run_step(s, nx, stepno, projs, ctx, cnt):
    """s — снимок k, nx — снимок k+1 (позиции юнитов, которые уже отработали в этом шаге)."""
    sim = Sim(s, stepno, ctx)
    order = s.order()
    for idx, i in enumerate(order): sim.pos[i] = idx
    moved = set()                                         # юниты, уже отработавшие в этом шаге
    def xy(i):
        src = nx if i in moved else s
        return src.u16(i, 'X'), src.u16(i, 'Y')
    def view(i):                                          # запись юнита на момент текущего хода
        return nx if i in moved else s
    def advance(i):                                       # юнит отработал: позиция и отпечаток новые
        moved.add(i)
        grid_one(ctx['bi'], ctx['mo'], s, nx, i)
    regen = (stepno & 0xf) == 0
    for cur, i in enumerate(order):
        if s.u8(i, 'FLAGS5B') & 1: advance(i); continue    # запись вне игры (0x18058)
        if i in sim.dead: advance(i); continue             # убит раньше в этом же шаге → 0x19693
        ty = s.u8(i, 'TYPE')
        st = s.u8(i, 'STATE')
        f43 = s.u8(i, 'FX43')
        if f43 and not ((f43 & 3) != 0 and ((f43 - 1) & 0xfc) == 0):
            advance(i); continue                        # оглушён — обработчик не вызывается
        if ty >= 26:                                      # 0x186b3 — здания
            f50 = s.u8(i, 'FLAGS50')
            if st >= 0x60: sim.dirty.add(i)                # разрушенное здание: 0x6x — своя ветка
            elif f50 == 0 or (f50 & 4):
                if regen and sim.gethp(i) < s.u8(i, 'HPMAX'): sim.hp[i] = sim.gethp(i) + 1
            else:
                sim.dirty.add(i)
            advance(i); continue
        if ty >= 24:                                      # 0x18568 — растения
            if regen: do_regen(sim, s, i)
            else:
                e = find_target(s, ctx, i, 4 if ty == 24 else 3, view)
                if e: sim.apply_damage(i, e, 1, cur); cnt['урон растения'] += 1
            advance(i); continue
        if regen: do_regen(sim, s, i)
        tgt_override = None
        ordv = s.u8(i, 'ORDER')                           # 0x18154/0x184c8: отложенный приказ на тайле
        if ordv != 0xff and (s.u16(i, 'X') & 0x1f) == 0 and (s.u16(i, 'Y') & 0x1f) == 0:
            hi = ordv >> 4
            if hi == 0x0f or (hi == 0x0e and ordv != 0xe0) or ordv == 0x6f:
                sim.dirty.add(i); advance(i); continue
            st = ordv
            sim.ordered.add(i)
            tgt_override = s.u32(i, 'ORDARG')
        if st in (0x10, 0x12, 0x30, 0x32):                # цель мертва? (проверяется до всего)
            tq = s.u32(i, 'TARGET') if tgt_override is None else tgt_override
            if tq and tq % SZ == 0 and tq < POOL and (s.u8(tq, 'STATE') in (0x60, 0x6f) or tq in sim.dead):
                if (s.u16(i, 'X') & 0x1f) == 0 and (s.u16(i, 'Y') & 0x1f) == 0:
                    advance(i); continue                  # 0x1a34c/0x1a354: приказ «домой», счётчик не трогаем
                if st in (0x12, 0x32):
                    c = (s.u8(i, 'ATKCTR') - 1) & 0xff
                    sim.ctr[i] = c
                    if c == 0: sim.state[i] = 0x11 if st == 0x12 else 0x31
                    else: sim.state[i] = st
                advance(i); continue
        if st in (0x12, 0x32):
            c = (s.u8(i, 'ATKCTR') - 1) & 0xff
            sim.ctr[i] = c
            if c == 0: sim.state[i] = 0x11 if st == 0x12 else 0x31
            else: sim.state[i] = st
            advance(i); continue
        if st == 0x1f:                                    # 0x18dc4: старт атаки → 0x11
            sim.state[i] = 0x11; sim.dirty.add(i); advance(i); continue
        if st == 0x38 and s.u8(i, 'ATKCTR') == 1:         # 0x18e89: счётчик дошёл до нуля — ищем цель
            e = find_target(s, ctx, i, (s.u8(i, 'SPD') >> 5) + 1, view)
            if e and s.u8(e, 'OWNER') == s.u8(i, 'OWNER'): e = 0   # 0x19fdf: свой — приказа нет
            sim.found[i] = e
        if st not in (0x10, 0x30):
            advance(i); continue
        t = s.u32(i, 'TARGET') if tgt_override is None else tgt_override
        if t % SZ or t == 0 or t >= POOL:
            sim.dirty.add(i); advance(i); continue
        if s.u8(t, 'STATE') in (0x60, 0x6f) or t in sim.dead:
            advance(i); continue
        axy, txy = xy(i), xy(t)
        if not in_reach(s, i, t, axy, txy):
            sim.state[i] = 0x12 if st == 0x10 else 0x32
            sim.ctr[i] = (0x10 - (s.u8(i, 'SPD') >> 4)) & 0xff
            cnt['вне досягаемости → перезарядка'] += 1
            advance(i); continue
        # направление на цель считается ЗАНОВО перед ударом (0x1a95d + 0x1aa10)
        tt = s.u8(t, 'TYPE')
        dx = (txy[0] + CEN_X[tt]) & 0xffe0
        by = (txy[1] + CEN_Y[tt]) & 0xffe0
        d = refine_dir(dir_to(axy[0], axy[1], dx, by), axy[0], axy[1], dx, by)
        sim.state[i] = st
        hit = False
        c = s.u8(i, 'ATKCTR')
        if ty < 9:
            c = (c + 1) & 0xff
            if c > 7: c = 0; hit = True
        else:
            hit = (c == 6)
            c = (c + 1) & 0xff
            if c > 7:
                c = 2
                if ty == 0x0d: sim.state[i] = 0x12; c = 8
        sim.ctr[i] = c
        advance(i)
        if not hit: continue
        sim.xp[i] = (sim.getxp(i) + 1) & 0xffffffff       # 0x1e758: +1 XP обоим
        sim.xp[t] = (sim.getxp(t) + 1) & 0xffffffff
        if ty in MAGE_A:
            sim.newp.append(proj_new(s, MAGE_KIND[ty], i, t, mage_dmg(s, i, t), d, axy, txy))
            cnt['снаряд мага создан'] += 1
        elif ty == 0x0d:
            p = Proj(); p.kind = 0x44; p.life = 0xff; p.axis = d & 0xff
            p.dmg = 0; p.src = i; p.tgt = t
            p.x = p.ex = axy[0]; p.y = p.ey = axy[1]
            p.dx = p.dy = p.sx = p.sy = 0
            sim.newp.append(p); cnt['плевок создан'] += 1
        else:
            al, wid = melee_dmg(s, i, t)
            if wid in WPN_KIND:
                sim.newp.append(proj_new(s, WPN_KIND[wid], i, t, al, d, axy, txy))
                cnt['снаряд оружия создан'] += 1
            else:
                sim.apply_damage(i, t, al, cur)
                cnt['удар ближнего боя'] += 1
        if ty < 0x0e and sim.gethp(i) < (s.u8(i, 'HPMAX') >> 1):   # 0x1c72b — автозелье
            for k in (6, 7, 8):
                if 0x0b <= s.inv(i, k) <= 0x0e: sim.dirty.add(i); break
    # ---- фаза 0x1ab4c: снаряды летят после всех юнитов, позиции уже новые
    update_grids(ctx['bi'], ctx['mo'], s, nx, only=moved)  # остальные записи пула (мёртвые, респавн)
    alive = []
    for p in list(reversed(sim.newp)) + projs:   # 0x1c2a4 кладёт новый снаряд в ГОЛОВУ списка
        if step_proj(nx, sim, p, cnt): alive.append(p)
    projs[:] = alive
    return sim

def do_regen(sim, s, i):                                  # 0x18ab2, al = 1
    if s.u8(i, 'STATE') == 0x6f: return
    hpm = s.u8(i, 'HPMAX')
    hp = sim.gethp(i)
    if hp < hpm:
        heal = True
        if s.u8(i, 'TYPE') < 0x0e and (hp & 3) == 0:      # каждый 4-й HP — за 1 еду
            if s.u16(i, 'FOOD') < 1 or not any(s.inv(i, k) == 0x1e for k in (6, 7, 8)):
                heal = False
        if heal:
            v = hp + 1
            if v > 0xff: v = 0xff
            if v > hpm: v = hpm
            sim.hp[i] = v
    mag = s.u8(i, 'MAG')
    mana = sim.get(i, 'MANA')
    if mana < mag:
        v = mana + 1
        if v > 0xff: v = 0xff
        sim.stat[(i, 'MANA')] = v
        if v > mag: sim.hp[i] = mag                       # баг оригинала: пишет в HP

def step_proj(s, sim, p, cnt):
    if p.kind == 0x44: return step_spit(s, sim, p, cnt)
    if p.kind in (0, 0x39, 0x3b): return True             # обработчик-заглушка 0x1ab80
    for _ in range(8):                                    # 0x1ad3c: 8 подшагов
        p.life = (p.life - 1) & 0xff
        if p.life == 0: cnt['снаряд промахнулся'] += 1; return False
        proj_move(p)
        if p.dmg:
            t = p.tgt
            dx, bx = s.u16(t, 'X'), s.u16(t, 'Y')
            if p.x >= dx and p.y >= bx:
                tt = s.u8(t, 'TYPE')
                if p.x <= ((dx + SPR_W[tt]) & 0xffff) and p.y <= ((bx + SPR_H[tt]) & 0xffff):
                    p.life = 0x0c
                    al = p.dmg; p.dmg = 0
                    sim.apply_damage(p.src, t, al, 10 ** 9)
                    cnt['попадание снаряда'] += 1
    return True

def step_spit(s, sim, p, cnt):                            # 0x1aef4
    p.life = (p.life + 1) & 0xff
    if p.life >= 0x0a:
        t = p.tgt
        if t and t % SZ == 0 and t < POOL:
            sim.apply_damage(p.src, t, base_dmg(s.u8(p.src, 'ATK'), s.u8(t, 'DEF')), 10 ** 9)
            cnt['плевок: финальный урон'] += 1
        return False
    d = p.axis
    if not (1 <= d <= 8): return False
    p.x = (p.x + WAVE_D[d][0]) & 0xffff
    p.y = (p.y + WAVE_D[d][1]) & 0xffff
    if p.life > 6: return True
    q = WAVE_P[d] + 8 * p.life
    dx = (p.ex + i16a(q)) & 0xffff
    bx = (p.ey + i16a(q + 2)) & 0xffff
    red = b8(q + 4)
    for e in s.order():
        if (s.u16(e, 'X') & 0xffe0) != dx or (s.u16(e, 'Y') & 0xffe0) != bx: continue
        if e == p.tgt: continue
        if s.u8(e, 'STATE') in (0x60, 0x6f): continue
        al = (base_dmg(s.u8(p.src, 'ATK'), s.u8(e, 'DEF')) + b8(WAVE_A + s.u8(e, 'TYPE'))) & 0xff
        sl = s.u8(e, 'SHIELD')
        if sl != 0xff:
            v = al - b8(WAVE_B + sl)
            if v < 0: return True                         # ветка «щит блокирует» (в оригинале мертва)
            al = v
        v = al - red
        sim.apply_damage(p.src, e, v if v > 0 else 1, 10 ** 9)
        cnt['плевок: урон волной'] += 1
        break
    return True

# ------------------------------------------------------------------ прогон трассы
def check(trace, cnt, bad):
    ix = json.load(open(os.path.join(trace, 'index.json')))
    data = open(os.path.join(trace, 'steps.bin'), 'rb').read()
    snap0 = zlib.decompress(open(os.path.join(trace, 'snap0.bin.z'), 'rb').read())
    LO = 0x30000
    step_low0 = struct.unpack_from('<H', snap0, 0x31b66 - LO)[0]
    ctx = {'mapW': struct.unpack_from('<I', snap0, 0x31af8 - LO)[0],
           'mapH': struct.unpack_from('<I', snap0, 0x31afc - LO)[0],
           'ai': [snap0[0x32aec - LO + j] for j in range(9)]}
    n = ix['steps']
    projs = []
    magic_until = -1
    BIA, MOA = 0x10ce74, 0x117e74
    bi = bytearray(snap0[BIA - LO:BIA - LO + 45056])
    mo = bytearray(snap0[MOA - LO:MOA - LO + 45056])
    ctx['bi'], ctx['mo'] = bi, mo
    s0 = Snap(snap0[0xe4400 - LO:0xe4400 - LO + POOL])
    head0 = struct.unpack_from('<I', snap0, 0x31b6c - LO)[0]
    for c in s0.chains():
        if c and c[0] == head0: s0.set_order(c); break
    live = set(s0.order())
    update_grids(bi, mo, s0, Snap(data[0:POOL]))
    for k in range(n - 1):
        a = Snap(data[k * REC:k * REC + POOL])
        b = Snap(data[(k + 1) * REC:(k + 1) * REC + POOL])
        a.set_order(a.pick_order(live)); live = set(a.order())
        b.set_order(b.pick_order(live))
        step_low = (step_low0 + k + 2) & 0xf              # шаг между снимками k и k+1
        stepno = ix['per_step'][k + 1]['step']
        if any(a.u8(i, 'STATE') >= 0x80 for i in a.order()): magic_until = k + 260
        sim = run_step(a, b, step_low, projs, ctx, cnt)
        magic = k <= magic_until
        for i in a.order():
            if a.u8(i, 'FLAGS5B') & 1: continue
            same_type = a.b[i + 4] == b.b[i + 4]
            nst = b.u8(i, 'STATE')
            spell = nst >= 0x80 or (magic and nst in (0x6f, 0x60) and sim.state.get(i) != nst)
            if spell and (i in sim.ctr or i in sim.state): cnt['пропущено: приказ магии'] += 1
            if i in sim.ctr and i not in sim.dirty and same_type and not spell:
                chk(cnt, bad, 'кадр атаки / перезарядка (+0x2c)', sim.ctr[i], b.u8(i, 'ATKCTR'),
                    (trace, k, i, hex(a.u8(i, 'STATE'))))
            if i in sim.state and not spell:
                chk(cnt, bad, 'переход состояния боя', hex(sim.state[i]), hex(nst),
                    (trace, k, i, hex(a.u8(i, 'STATE'))))
            if i in sim.dirty: continue
            exp = sim.hp.get(i)
            got = b.u8(i, 'HP')
            if exp is None:
                if got != a.u8(i, 'HP'):
                    if magic: cnt['пропущено: активна магия'] += 1
                    else: bad['HP не должен был измениться'].append(
                        (trace, k, i, 'тип %d сост %s' % (a.u8(i, 'TYPE'), hex(a.u8(i, 'STATE'))), a.u8(i, 'HP'), got))
                else: cnt['HP без изменений'] += 1
            elif exp == got: cnt['HP после урона / регенерации'] += 1
            elif magic: cnt['пропущено: активна магия'] += 1
            else: bad['HP после урона / регенерации'].append(
                (trace, k, i, 'тип %d сост %s' % (a.u8(i, 'TYPE'), hex(a.u8(i, 'STATE'))), exp, got))
            if i in sim.xp:
                if sim.xp[i] == b.u32(i, 'XP'): cnt['XP'] += 1
                elif magic: cnt['пропущено: активна магия'] += 1
                else: bad['XP'].append((trace, k, i, hex(a.u8(i, 'STATE')), sim.xp[i], b.u32(i, 'XP')))
            for f in ('HPMAX', 'ATK', 'DEF', 'MAG', 'SPD', 'MANA', 'TYPE'):
                if (i, f) in sim.stat:
                    chk(cnt, bad, 'рост стата / мана / класс', sim.stat[(i, f)], b.u8(i, f), (trace, k, i, f))
            # --- таймер оглушения
            f43 = a.u8(i, 'FX43')
            if f43:
                v = f43
                if (v & 3) != 0: v -= 1
                if (v & 0xfc) != 0 and (stepno & 3) == 0: v -= 4
                if (v & 0xfc) != 0 and a.u8(i, 'STATE') == 0x6f: v = 0
                got = b.u8(i, 'FX43')
                if got in (v, 0): cnt['таймер оглушения (+0x43)'] += 1
                else: bad['таймер оглушения (+0x43)'].append((trace, k, i, f43, v, got))
            # --- трупы
            st = a.u8(i, 'STATE')
            beast_ai = (0x0e <= a.u8(i, 'TYPE') < 0x18 and a.u8(i, 'FLAGS50') >= 0x0e
                        and (a.u16(i, 'X') & 0x1f) == 0 and (a.u16(i, 'Y') & 0x1f) == 0)
            if st == 0x6f and i not in sim.state and i not in sim.ordered and not beast_ai:
                chk(cnt, bad, 'смерть: 0x6f → 0x60', 0x60, b.u8(i, 'STATE'), (trace, k, i, 'труп'))
            elif st == 0x60 and a.u8(i, 'ATKCTR') < 0xc0 and (b.b[i + 0x5b] & 1) == 0:
                chk(cnt, bad, 'счётчик трупа', (a.u8(i, 'ATKCTR') + 1) & 0xff, b.u8(i, 'ATKCTR'),
                    (trace, k, i, 'труп'))
        # --- поиск цели (0x1a526) — предсказание сделано внутри run_step
        for i, e in sim.found.items():
            if a.u8(i, 'FX43') or a.u8(i, 'TYPE') >= 24: continue
            if i in sim.damaged:                          # приказ мог прийти от ответа на удар
                cnt['поиск цели: пропущено (получил урон)'] += 1; continue
            got = b.u32(i, 'ORDARG') if b.u8(i, 'ORDER') == 0x33 else 0
            if e == 0 and b.u8(i, 'ORDER') != 0x33: cnt['поиск цели: никого (совпало)'] += 1
            elif e and got == e: cnt['поиск цели: цель найдена (совпало)'] += 1
            else: bad['поиск цели'].append((trace, k, i, e, got or b.u8(i, 'ORDER')))

def chk(cnt, bad, key, exp, got, info):
    if exp == got: cnt[key] += 1
    else: bad[key].append(info + (exp, got))

# ------------------------------------------------------------------ проверка по снимкам функций
# cases/* — байт-точные снимки эталона (память до вызова + список изменённых байт после).
# Здесь проверяются обработчики снарядов 0x1ad3c (полёт) и 0x1aef4 (волна плевка):
# движение по Брезенхему, попадание в bbox и урон считаются заново по спецификации.
DSEG_LO, UNITS_A, PROJ_A = 0x30000, 0xe4400, 0xf2504

def check_cases(root, cnt, bad):
    import glob
    for d in sorted(glob.glob(os.path.join(root, '*', 'case.json'))):
        c = json.load(open(d))
        if c['fn'] not in (0x1ad3c, 0x1aef4): continue
        mem = bytearray(zlib.decompress(open(os.path.join(os.path.dirname(d), 'pre.bin.z'), 'rb').read()))
        name = os.path.basename(os.path.dirname(d))
        esi = c['regs_in']['esi']
        got = {a: v for a, _o, v in c['diff']}
        my = case_proj(mem, esi, c['fn'])
        rng = list(range(PROJ_A + esi, PROJ_A + esi + 0x1c))          # запись снаряда без указателей списка
        if my.get('hp_addr') is not None: rng.append(my['hp_addr'])
        ok = True
        for a in rng:
            exp = my['mem'][a - DSEG_LO]
            ref = got.get(a, mem[a - DSEG_LO])
            if exp != ref:
                ok = False
                bad['снаряды: снимок функции'].append((name, hex(c['fn']), hex(a), exp, ref))
        if ok: cnt['снаряды: снимок функции (совпало)'] += 1

def case_proj(mem, esi, fn):
    """Независимая реализация 0x1ad3c / 0x1aef4 поверх сырой памяти снимка."""
    m = bytearray(mem)
    P = PROJ_A + esi
    g8 = lambda a: m[a - DSEG_LO]
    g16 = lambda a: struct.unpack_from('<H', m, a - DSEG_LO)[0]
    g32 = lambda a: struct.unpack_from('<I', m, a - DSEG_LO)[0]
    s8 = lambda a, v: m.__setitem__(a - DSEG_LO, v & 0xff)
    s16 = lambda a, v: struct.pack_into('<H', m, a - DSEG_LO, v & 0xffff)
    hp_addr = None
    def hit_box():
        nonlocal hp_addr
        if g8(P + 3) == 0: return False
        t = g32(P + 8); tb = UNITS_A + t
        dx, bx = g16(tb + 0x2f), g16(tb + 0x31)
        if g16(P + 0xc) < dx or g16(P + 0xe) < bx: return False
        tt = g8(tb + 4)
        if g16(P + 0xc) > ((dx + SPR_W[tt]) & 0xffff): return False
        if g16(P + 0xe) > ((bx + SPR_H[tt]) & 0xffff): return False
        al = g8(P + 3)
        s8(P + 1, 0x0c); s8(P + 3, 0)
        hp = g8(tb + 0x0e); s8(tb + 0x0e, hp - al); hp_addr = tb + 0x0e
        return True
    if fn == 0x1ad3c:
        for _ in range(8):
            life = (g8(P + 1) - 1) & 0xff
            s8(P + 1, life)
            if life == 0: break                            # снаряд освобождается (список не проверяем)
            # движение по Брезенхему
            if g8(P + 2):
                s16(P + 0xe, g16(P + 0xe) + g16(P + 0x1a))
                ax = (g16(P + 0x10) + g16(P + 0x14)) & 0xffff
                if not (g16(P + 0x12) > ax):
                    ax = (ax - g16(P + 0x16)) & 0xffff
                    s16(P + 0xc, g16(P + 0xc) + g16(P + 0x18))
                s16(P + 0x10, ax)
            else:
                s16(P + 0xc, g16(P + 0xc) + g16(P + 0x18))
                ax = (g16(P + 0x12) + g16(P + 0x16)) & 0xffff
                if not (g16(P + 0x10) > ax):
                    s16(P + 0xe, g16(P + 0xe) + g16(P + 0x1a))
                    ax = (ax - g16(P + 0x14)) & 0xffff
                s16(P + 0x12, ax)
            hit_box()
    else:                                                  # 0x1aef4 — волна плевка
        s8(P + 1, g8(P + 1) + 1)
        if g8(P + 1) >= 0x0a:
            src, t = g32(P + 4), g32(P + 8)
            al = base_dmg(g8(UNITS_A + src + 0x0f), g8(UNITS_A + t + 0x10))
            hp = g8(UNITS_A + t + 0x0e); s8(UNITS_A + t + 0x0e, hp - al); hp_addr = UNITS_A + t + 0x0e
        else:
            d = g8(P + 2)
            s16(P + 0xc, g16(P + 0xc) + WAVE_D[d][0])
            s16(P + 0xe, g16(P + 0xe) + WAVE_D[d][1])
    return {'mem': m, 'hp_addr': hp_addr}

def main():
    traces = sys.argv[1:]
    if traces and traces[0] == '--cases':
        cnt = collections.Counter(); bad = collections.defaultdict(list)
        check_cases(traces[1], cnt, bad)
        for k, v in sorted(cnt.items()): print('  %-38s %8d' % (k, v))
        for k, v in sorted(bad.items()):
            print('  %-38s %8d' % (k, len(v)))
            for x in v[:8]: print('       ', x)
        n = sum(len(v) for v in bad.values())
        print('ИТОГО снимков совпало %d, расхождений %d' % (sum(cnt.values()), n))
        return 0 if n == 0 else 1
    if not traces:
        print(__doc__); return 2
    cnt = collections.Counter(); bad = collections.defaultdict(list)
    for t in traces:
        check(t, cnt, bad)
        print('  трасса %-28s готово' % t)
    print('\n== совпало ==')
    for k, v in sorted(cnt.items()): print('  %-38s %8d' % (k, v))
    print('\n== расхождения ==')
    total = 0
    for k, v in sorted(bad.items()):
        total += len(v)
        print('  %-38s %8d' % (k, len(v)))
        for x in v[:5]: print('       ', x)
    if not bad: print('  нет')
    ok = sum(v for k, v in cnt.items() if not k.startswith('пропущено'))
    print('\nИТОГО совпало %d, расхождений %d  →  %s' %
          (ok, total, 'СПЕЦИФИКАЦИЯ ПОДТВЕРЖДЕНА' if total == 0 else 'ЕСТЬ РАСХОЖДЕНИЯ'))
    return 0 if total == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
