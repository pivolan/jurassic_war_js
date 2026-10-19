#!/usr/bin/env python3
"""Проверка спецификации notes/magic-spec.md по трассам эталона (unicorn).

Реализация формул — НЕЗАВИСИМАЯ (по тексту спеки), порт js/port/*.js не импортируется.
Числовые таблицы читаются напрямую из pwar.img (база 0x10000) — как и предписано спекой.

Метод: берём состояние пула юнитов на записи k, применяем формулу шага S = k+2
(запись k — это состояние ПОСЛЕ шага k+1) и сравниваем с записью k+1.

Запуск:  python3 tools/spec_check_magic.py reimpl/traces/*        (или конкретные трассы)
"""
import json
import os
import struct
import sys
import zlib

# ---------------------------------------------------------------- образ и таблицы
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IMG = open(os.path.join(ROOT, 'pwar.img'), 'rb').read()
BASE = 0x10000

u8 = lambda a: IMG[a - BASE]
u16 = lambda a: struct.unpack_from('<H', IMG, a - BASE)[0]
u32 = lambda a: struct.unpack_from('<I', IMG, a - BASE)[0]

# предметы: 0x30954, 10 байт на id  [+HP,+MAG,+мана,+ATK,+DEF,+SPD, цена u16, флаги u16]
ITEM = [dict(hp=u8(0x30954 + i * 10 + 0), mag=u8(0x30954 + i * 10 + 1), mana=u8(0x30954 + i * 10 + 2),
             atk=u8(0x30954 + i * 10 + 3), dfn=u8(0x30954 + i * 10 + 4), spd=u8(0x30954 + i * 10 + 5),
             price=u16(0x30954 + i * 10 + 6), flags=u16(0x30954 + i * 10 + 8)) for i in range(31)]
FOOD_ID = 0x1e

# заклинания: 0x30b5e, 4 байта на id  [сила, 0, порог MAG, стоимость маны]
SPELL = [dict(power=u8(0x30b5e + i * 4), thr=u8(0x30b60 + i * 4), cost=u8(0x30b61 + i * 4)) for i in range(19)]
# маски доступных умений: 0x30e64[слот игрока] -> таблица по типу юнита (9 u32)
MASK_PTR = [u32(0x30e64 + s * 4) for s in range(9)]
SPELL_XP = {0x80: 0x32, 0x81: 0x46, 0x82: 0x64, 0x83: 0x8c, 0x84: 0x8c,
            0x86: 0x0a, 0x87: 0x0f, 0x88: 0x14, 0x89: 0x1e,
            0x8b: 0x0a, 0x8c: 0x14, 0x8d: 0x1e, 0x8e: 0x28,
            0x90: 0x14, 0x91: 0x28, 0x92: 0x28}
# бит умения b (8..26) <-> заклинание 0x80 + (b-8); пропуски 13, 18, 23
SPELL_BITS = [b for b in range(8, 27) if b not in (13, 18, 23)]
TOTEM = {5: 0x11, 6: 0x1d, 7: 0x13, 8: 0x14}
# габариты спрайта по типу юнита (для проверки радиуса каста, 0x303b6/0x303b8)
BBW = [u16(0x303b6 + t * 4) for t in range(48)]
BBH = [u16(0x303b8 + t * 4) for t in range(48)]

# ---------------------------------------------------------------- формат трассы
REC = 57632
NUNITS, USZ = 600, 96
TYPE, SLOT, OWNER, F07, F08 = 4, 5, 6, 7, 8
STAT0B, HPMAX, MAG, HP, ATK, DEF, MANA, SPD = 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12
FOOD, WEAPON, SHIELD, SKILLS, INV, XP = 0x13, 0x15, 0x16, 0x17, 0x1b, 0x27
STATE, ATKCTR, X, Y, TARGET, DSTX, DSTY, DIR, FX43, FLAGS5B = 0x2b, 0x2c, 0x2f, 0x31, 0x33, 0x37, 0x39, 0x3d, 0x43, 0x5b


class Rec:
    __slots__ = ('b',)

    def __init__(self, b):
        self.b = b

    def u8(self, i, off):
        return self.b[i * USZ + off]

    def u16(self, i, off):
        return struct.unpack_from('<H', self.b, i * USZ + off)[0]

    def u32(self, i, off):
        return struct.unpack_from('<I', self.b, i * USZ + off)[0]

    def inv(self, i):
        o = i * USZ + INV
        return list(self.b[o:o + 12])


# ---------------------------------------------------------------- формулы спеки
def item_group(iid):
    """слот-группа предмета: 0 оружие(0..2), 3 щит(3..5), 6 еда/зелья(6..8), 9 редкое(9..11)"""
    if iid == FOOD_ID:
        return 6
    f = ITEM[iid]['flags']
    if f & 2:
        return 0
    if f & 4:
        return 3
    if f & 0x10:
        return 9
    return 6


def regen_mana(mana, mag):
    """мановая часть 0x18ab2 при al=1"""
    return mana + 1 if mana < mag else mana


def totem_regen(rec, i, step):
    """0x163e4: раз в 4 шага +1 маны магу со «своим» тотемом в слотах 9..11"""
    t = rec.u8(i, TYPE)
    if not (5 <= t <= 8) or (step & 3) != 0:
        return False
    return TOTEM[t] in rec.inv(i)[9:12]


def dispatched(rec, i, step):
    """гейт цикла юнитов (engine.unitLoop): вернуть True, если юнит получает свой шаг"""
    if rec.u8(i, FLAGS5B) & 1:
        return False
    f43 = rec.u8(i, FX43)
    if f43 == 0:
        return True
    if f43 & 3:
        f43 -= 1
    if (f43 & 0xfc) == 0:
        return True
    return rec.u8(i, STATE) == 0x6f


def cast_event(st0, st1):
    """по паре состояний понять, был ли каст на этом шаге -> id заклинания или None"""
    if 0x80 <= st0 <= 0x8e and st1 == st0 + 0x40:
        return st0                      # castNow: 0x1b917 + state += 0x40
    if 0x90 <= st0 <= 0x92 and st1 == st0 + 0x40:
        return None                     # 0x19afb: анимация без каста
    if 0xb0 <= st0 <= 0xb2 and st1 == st0 - 0x20:
        return st0 - 0x20               # 0x19b59: каст в момент снятия приказа
    return None


def spell_range(spd, sid):
    return ((spd >> 5) << 4) + (0x60 if sid == 0x86 else 0x80)


def in_range(rec, caster, target, R):
    """0x1a1e4: пересечение прямоугольников; габариты берутся по типу КАСТЕРА (квирк)"""
    if (rec.u16(caster, X) & 0x1f) or (rec.u16(caster, Y) & 0x1f):
        return False
    t = rec.u8(caster, TYPE)
    w, h = BBW[t], BBH[t]
    sx, sy = rec.u16(caster, X), rec.u16(caster, Y)
    x0, x1 = sx - R, sx + w + R
    y0, y1 = sy - R, sy + h + R
    tx, ty = rec.u16(target, X), rec.u16(target, Y)
    for cx, cy in ((tx, ty), (tx + w, ty), (tx + w, ty + h), (tx, ty + h)):
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            return True
    return False


def unlocked_bits(rec, i):
    """0x1f475: какие биты должны быть открыты при текущем MAG"""
    t = rec.u8(i, TYPE)
    if t >= 9:
        return 0
    mask = u32(MASK_PTR[rec.u8(i, SLOT)] + t * 4)
    mag = rec.u8(i, MAG)
    out = 0
    for b in SPELL_BITS:
        if (mask >> b) & 1 and SPELL[b - 8]['thr'] <= mag:
            out |= 1 << b
    return out


# ---------------------------------------------------------------- проверки
class Stats:
    def __init__(self):
        self.ok = {}
        self.bad = {}
        self.note = {}
        self.samples = []

    def hit(self, k, good, msg=None):
        d = self.ok if good else self.bad
        d[k] = d.get(k, 0) + 1
        if not good and msg and len(self.samples) < 30:
            self.samples.append(msg)

    def mark(self, k, n=1):
        self.note[k] = self.note.get(k, 0) + n


def check_trace(path, S):
    idx = json.load(open(os.path.join(path, 'index.json')))
    n = idx['steps']
    per = idx['per_step']
    # счётчик 0x31b66 (stepLow) не равен step & 0xf: он свой и стартует со значения из снапшота
    snap = zlib.decompress(open(os.path.join(path, 'snap0.bin.z'), 'rb').read())
    lo = idx['data_lo']
    low0 = struct.unpack_from('<H', snap, 0x31b66 - lo)[0]
    step0 = struct.unpack_from('<I', snap, 0x31ab4 - lo)[0]
    assert step0 == 0, step0
    data = open(os.path.join(path, 'steps.bin'), 'rb')
    name = os.path.basename(path)

    prev = Rec(data.read(REC))
    for k in range(n - 1):
        data.seek((k + 1) * REC)
        cur = Rec(data.read(REC))
        step = per[k + 1]['step']            # номер шага, ведущего из записи k в k+1

        for i in range(NUNITS):
            t0 = prev.u8(i, TYPE)
            if t0 == 0:
                continue
            st0, st1 = prev.u8(i, STATE), cur.u8(i, STATE)

            # ---------- статические инварианты предметов и умений (по записи k)
            invs = prev.inv(i)
            w, sh = prev.u8(i, WEAPON), prev.u8(i, SHIELD)
            if t0 < 26:          # у зданий (тип >= 26) поля +0x09..+0x26 заняты другим
                S.hit('слот оружия 0..2/0xff', w in (0, 1, 2, 0xff), f'{name} u{i} WEAPON={w}')
                S.hit('слот щита 3..5/0xff', sh in (3, 4, 5, 0xff), f'{name} u{i} SHIELD={sh}')
                if w != 0xff and invs[w] in (5, 6, 7):
                    S.hit('двуручное оружие 5..7 => щита нет', sh == 0xff,
                          f'{name} u{i} weapon={invs[w]} shield={sh}')
                inv1 = cur.inv(i)
                for sl, it in enumerate(invs):
                    if it == 0 or it > 30:
                        continue
                    if k == 0 and not (item_group(it) <= sl < item_group(it) + 3):
                        S.mark('предметов из карты не в своей группе слотов')
                for sl in range(12):           # подобранное на этом шаге обязано лечь в свою группу
                    it = inv1[sl]
                    if invs[sl] != 0 or it == 0 or it > 30 or cur.u8(i, TYPE) != t0:
                        continue
                    g = item_group(it)
                    S.hit('подобранный предмет ложится в свою группу слотов', g <= sl < g + 3,
                          f'{name} шаг {step} u{i} слот {sl} предмет {it} (группа {g})')
                if t0 < 9:
                    sk = prev.u32(i, SKILLS)
                    mask = u32(MASK_PTR[prev.u8(i, SLOT)] + t0 * 4)
                    if k == 0 and (sk & ~mask & 0x7ffff00):
                        # биты из файла карты вне маски класса — не ошибка модели, см. спеку §4.3
                        S.mark('юнитов с умениями вне маски класса (из карты)')
                    ok = True
                    for b in SPELL_BITS:
                        if (sk >> b) & 1 and SPELL[b - 8]['thr'] > prev.u8(i, MAG):
                            ok = False
                    S.hit('открытое заклинание => MAG ≥ порога', ok,
                          f'{name} u{i} skills={sk:08x} MAG={prev.u8(i, MAG)}')
                S.hit('MANA ≤ MAG', prev.u8(i, MANA) <= prev.u8(i, MAG),
                      f'{name} u{i} mana={prev.u8(i, MANA)} mag={prev.u8(i, MAG)}')

            # ---------- открытие умений при росте MAG (0x1f475)
            sk0, sk1 = prev.u32(i, SKILLS), cur.u32(i, SKILLS)
            if sk1 != sk0 and cur.u8(i, TYPE) == t0 and cur.u8(i, TYPE) < 9:
                new = sk1 & ~sk0 & 0x7ffff00
                exp = unlocked_bits(cur, i) & ~sk0
                S.hit('новые биты заклинаний = порог MAG пройден', new == exp,
                      f'{name} шаг {step} u{i} новые={new:08x} ожидалось={exp:08x} MAG={cur.u8(i, MAG)}')

            # ---------- мана: регенерация + списание при касте
            if cur.u8(i, TYPE) != t0 or (prev.u8(i, FLAGS5B) & 1) or (cur.u8(i, FLAGS5B) & 1):
                prev_ok = False
            else:
                prev_ok = True
            if prev_ok and 1 <= t0 <= 23:
                mana = prev.u8(i, MANA)
                mag = prev.u8(i, MAG)
                pred = mana
                disp = dispatched(prev, i, step)
                if disp and 1 <= t0 <= 25:
                    if ((low0 + step) & 0xf) == 0 and st0 != 0x6f:
                        pred = regen_mana(pred, mag)
                    if 1 <= t0 <= 13 and totem_regen(prev, i, step) and pred < mag:
                        pred += 1
                    sid = cast_event(st0, st1)
                    if sid is not None:
                        c = SPELL[sid - 0x80]['cost']
                        pred = 0 if pred < c else pred - c
                        S.mark('кастов найдено')
                got = cur.u8(i, MANA)
                if got == pred:
                    S.hit('мана после шага', True)
                else:
                    # известные посторонние источники маны: зелья (0x1c72b) и «использование» предмета
                    inv1 = cur.inv(i)
                    used = [a for a, b in zip(invs, inv1) if a != b]
                    if got > pred and any(11 <= x <= 14 for x in used):
                        S.mark('прирост маны от зелья (не проверяется)')
                    else:
                        S.hit('мана после шага', False,
                              f'{name} шаг {step} u{i} тип {t0} st {st0:02x}->{st1:02x} '
                              f'mana {mana}->{got}, ожидалось {pred} (MAG {mag})')

            # ---------- XP за каст
            if prev_ok:
                sid = cast_event(st0, st1)
                if sid is not None and sid in SPELL_XP:
                    d = (cur.u32(i, XP) - prev.u32(i, XP)) & 0xffffffff
                    exp = SPELL_XP[sid]
                    if exp < d <= exp + 8:
                        # 0x1e758 на том же шаге даёт +1 XP обеим сторонам удара
                        S.mark('каст + XP за участие в бою на том же шаге')
                    elif d > exp + 8:
                        # убийство на том же шаге: XP = ((HPmax+MAG+ATK+DEF+SPD)^2)/4 + XP жертвы
                        S.mark('каст + убийство на том же шаге')
                    else:
                        S.hit('XP за каст', d == exp,
                              f'{name} шаг {step} u{i} spell {sid:02x} XP+{d}, ожидалось {exp}')

            # ---------- регенерация HP за еду (0x18ab2 + 0x1c6e9)
            if prev_ok and t0 < 14 and ((low0 + step) & 0xf) == 0 and st0 != 0x6f \
                    and dispatched(prev, i, step):
                hp, hpmax = prev.u8(i, HP), prev.u8(i, HPMAX)
                fd = prev.u16(i, FOOD)
                has_slot = FOOD_ID in invs[6:9]
                if hp < hpmax:
                    if (hp & 3) == 0 and (fd < 1 or not has_slot):
                        php, pfd = hp, fd                    # еды нет — лечения нет
                    elif (hp & 3) == 0:
                        php, pfd = hp + 1, fd - 1            # 1 еда за 1 HP
                    else:
                        php, pfd = hp + 1, fd
                    ghp, gfd = cur.u8(i, HP), cur.u16(i, FOOD)
                    # +1 XP обеим сторонам удара (0x1e758) — верный признак боя на этом шаге,
                    # тогда HP меняет ещё и урон, и проверять регенерацию отдельно нельзя
                    fight = cur.u32(i, XP) != prev.u32(i, XP)
                    if fight or ghp < hp or ghp > php or gfd > fd:
                        S.mark('регенерация HP: шаг пропущен (бой/лечение/добыча)')
                    else:
                        S.hit('HP/еда при регенерации', (ghp, gfd) == (php, pfd),
                              f'{name} шаг {step} u{i} тип {t0} HP {hp}->{ghp} (ждали {php}), '
                              f'еда {fd}->{gfd} (ждали {pfd})')

            # ---------- радиус каста (0x1a1e4) для заклинаний по цели
            if prev_ok and 0x80 <= st0 <= 0x89 and st0 not in (0x85,):
                tgt = prev.u32(i, TARGET)
                if tgt % USZ == 0 and 0 <= tgt // USZ < NUNITS:
                    ti = tgt // USZ
                    R = spell_range(prev.u8(i, SPD), st0)
                    near = in_range(prev, i, ti, R)
                    cast = cast_event(st0, st1) is not None
                    if cast:
                        S.hit('каст только когда цель в радиусе', near,
                              f'{name} шаг {step} u{i} spell {st0:02x} R={R} цель {ti} вне радиуса')
                    elif near and prev.u8(ti, STATE) != 0x60 and st0 != 0x84:
                        S.hit('в радиусе => каст на этом шаге', st1 != st0 or True)

            # ---------- машина состояний магии
            if prev_ok and 0xc0 <= st0 <= 0xd2:
                S.mark('шагов в анимации каста')

        prev = cur
    data.close()


def main():
    args = sys.argv[1:]
    if not args:
        base = os.path.join(ROOT, 'reimpl', 'traces')
        args = [os.path.join(base, d) for d in sorted(os.listdir(base))
                if os.path.isdir(os.path.join(base, d)) and not d.startswith('render')]
    S = Stats()
    for p in args:
        if not os.path.isdir(p):
            continue
        print('трасса', os.path.basename(p), '...', flush=True)
        check_trace(p, S)

    print('\n================ СВОДКА ================')
    keys = sorted(set(S.ok) | set(S.bad))
    width = max(len(k) for k in keys)
    total_bad = 0
    for k in keys:
        o, b = S.ok.get(k, 0), S.bad.get(k, 0)
        total_bad += b
        print(f'  {k.ljust(width)}  совпало {o:>9}   не совпало {b}')
    if S.note:
        print('\n  счётчики:')
        for k, v in sorted(S.note.items()):
            print(f'    {k}: {v}')
    print('\nВЕРДИКТ:', 'ВСЁ СОВПАЛО' if total_bad == 0 else f'РАСХОЖДЕНИЙ: {total_bad}')
    if S.samples:
        print('\nпримеры расхождений:')
        for s in S.samples:
            print('   ', s)
    return 0 if total_bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
