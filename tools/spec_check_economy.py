#!/usr/bin/env python3
"""Проверка спецификации экономики (notes/economy-spec.md) против эталона.

Все формулы ниже написаны заново по тексту спецификации: порт js/port/economy.js
не импортируется и не читается этим скриптом — только таблицы из pwar.img.

Два режима:
  * трассы (по умолчанию) — берём состояние на шаге k из трассы unicorn-эталона,
    применяем формулы, сравниваем с шагом k+1;
  * --scenarios — поднимаем эталон под unicorn, руками ставим заказы зданиям,
    прогоняем полный цикл производства/паузы/отмены/выдачи/гниения и сверяем
    каждый шаг (плюс явные проверки итоговых чисел из таблиц).

Запуск:
  python3 tools/spec_check_economy.py                       # все трассы
  python3 tools/spec_check_economy.py reimpl/traces/long_m5_t0
  python3 tools/spec_check_economy.py --scenarios           # сценарии на эталоне
  python3 tools/spec_check_economy.py --all                 # и то и другое
"""
import os, sys, struct, zlib

_TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path[:] = [p for p in sys.path if os.path.abspath(p or '.') != _TOOLS]  # tools/dis.py затеняет stdlib dis
JW = os.path.dirname(_TOOLS)
IMG = open(os.path.join(JW, 'pwar.img'), 'rb').read()
IMGBASE = 0x10000

# ---------------------------------------------------------------- таблицы из pwar.img
def g8(a):  return IMG[a - IMGBASE]
def g16(a): return struct.unpack_from('<H', IMG, a - IMGBASE)[0]
def g32(a): return struct.unpack_from('<I', IMG, a - IMGBASE)[0]

STAT_OFF   = [g32(0x30a9e + t * 4) for t in range(40)]                                  # тип -> смещение в блоке статов
HPMAX_T    = [g8(0x37654 + STAT_OFF[t]) for t in range(40)]
COST_STEPS = [[g8(0x315ac + k * 32 + i) for i in range(32)] for k in range(14)]          # длительность заказа, шагов
COST_FOOD  = [[g32(0x30eac + (k * 32 + i) * 4) for i in range(32)] for k in range(14)]   # еды за шаг
MENU_N     = [g32(0x4273c + k * 8) for k in range(14)]                                  # кнопок в меню здания
MENU_N[0] += 2                                                                          # Sanctuary: 2 + 13 (0x26a5d)
WITHDRAW   = [g32(0x37564 + i * 4) for i in range(4)]                                   # выдача склада

# ---------------------------------------------------------------- смещения полей
POOL_N, POOL_SZ = 600, 96
U_TYPE, U_SLOT, U_OWNER, U_F09, U_F0A = 0x04, 0x05, 0x06, 0x09, 0x0a
U_HPMAX, U_HP, U_FOOD, U_INV = 0x0c, 0x0e, 0x13, 0x1b
U_PAID, U_PERSTEP, U_GUEST = 0x1b, 0x1f, 0x23
U_STATE, U_ATKCTR, U_X, U_Y, U_TARGET = 0x2b, 0x2c, 0x2f, 0x31, 0x33
U_ORDER, U_ORDTGT, U_ANIM, U_F50, U_F51 = 0x46, 0x47, 0x4f, 0x50, 0x51
U_FLAGS5B, U_FX43, U_PREV, U_NEXT = 0x5b, 0x43, 0x5c, 0x60

ITEMS_BASE, ITEM_N, ITEM_SZ = 0xf4f34, 500, 16
I_TYPE, I_TX, I_TY, I_TIMER, I_QTY, I_PREV, I_NEXT = 0, 1, 2, 4, 6, 8, 12


class Rec:
    """Одна запись пула на конкретном шаге (только чтение)."""
    __slots__ = ('b', 'o')
    def __init__(self, b, i): self.b = b; self.o = i * POOL_SZ
    def u8(self, f):  return self.b[self.o + f]
    def u16(self, f): return struct.unpack_from('<H', self.b, self.o + f)[0]
    def i16(self, f): return struct.unpack_from('<h', self.b, self.o + f)[0]
    def u32(self, f): return struct.unpack_from('<I', self.b, self.o + f)[0]


def new_stats():
    return dict(food_ok=0, food_bad=0, bld_ok=0, bld_bad=0, regen_ok=0, regen_bad=0,
                item_ok=0, item_bad=0, table_ok=0, table_bad=0,
                prod_steps=0, ai_orders=0, dmg_skips=0)


# ---------------------------------------------------------------- модель по спецификации
def unit_order(pool):
    """Порядок обхода живых юнитов = связный список +0x5c/+0x60 (голова: PREV==0)."""
    live = [i for i in range(POOL_N)
            if (pool[i * POOL_SZ + U_FLAGS5B] & 1) == 0 and pool[i * POOL_SZ + U_TYPE] != 0]
    heads = [i for i in live if struct.unpack_from('<I', pool, i * POOL_SZ + U_PREV)[0] == 0]
    if len(heads) != 1:
        return sorted(live)
    order, i, seen = [], heads[0] * POOL_SZ, set()
    while i and i not in seen:
        seen.add(i); order.append(i // POOL_SZ)
        i = struct.unpack_from('<I', pool, i + U_NEXT)[0]
    return order


def skipped_by_fx43(u):
    """Гейт +0x43 из главного цикла: юнит с ненулевым счётчиком может не получить шаг."""
    f43 = u.u8(U_FX43)
    if f43 == 0:
        return False
    v = (f43 - 1) if (f43 & 3) else f43
    return (v & 0xfc) != 0 and u.u8(U_STATE) != 0x6f


def carry_reached(u, t):
    """«Дошли ли» до цели переноса (0x1954f), ветка целей-зданий."""
    tt = t.u8(U_TYPE)
    sx, sy, tx, ty = u.i16(U_X), u.i16(U_Y), t.i16(U_X), t.i16(U_Y)
    if tt == 0x1e:                                    # склад: прямоугольник −32..+64 / −32..+64
        return tx - 0x20 <= sx <= tx + 0x40 and ty - 0x20 <= sy <= ty + 0x40
    if tt in (0x1c, 0x1d):                            # арсенал: −32..+96 / −32..+64
        return tx - 0x20 <= sx <= tx + 0x60 and ty - 0x20 <= sy <= ty + 0x40
    return None


def predict(pool, food_in, nstore, step_low):
    """Еда игроков и поля зданий на следующем шаге. Возвращает (food, {i: поля}, флаги)."""
    food = list(food_in)
    bld, unknown = {}, set()
    for i in unit_order(pool):
        u = Rec(pool, i)
        t = u.u8(U_TYPE)
        if skipped_by_fx43(u):
            continue

        # ---------------- здания (0x186b3) --------------------------------------------
        if t >= 0x1a:
            k = t - 0x1a
            state, target = u.u8(U_STATE), u.u32(U_TARGET)
            if u.u8(U_ORDER) != 0xff:                       # отложенный приказ применяется тут же
                state, target = u.u8(U_ORDER), u.u32(U_ORDTGT)
            own, f50 = u.u8(U_OWNER), u.u8(U_F50)
            exp = {'f50': f50, 'f09': u.u8(U_F09), 'f0a': u.u8(U_F0A),
                   'paid': u.u32(U_PAID), 'perstep': u.u32(U_PERSTEP),
                   'hp': u.u8(U_HP), 'f51': u.u8(U_F51), 'state': state}
            hi = state >> 4
            if hi == 6:                                     # гибель
                if state == 0x6f and t == 0x1e:             # склад теряет свою долю еды
                    share = food[own] // (nstore[own] + 1)
                    food[own] -= share
                    nstore[own] -= 1
                    unknown.add('storage_death')
                exp = None
            elif hi == 7:                                   # 0x7f заказ / 0x7e отмена
                if state == 0x7f:
                    if f50 & 4:
                        exp.update(f50=f50 & ~4, state=0)   # снятие паузы
                    else:
                        idx = target & 0x1f
                        exp.update(f0a=0, f09=COST_STEPS[k][idx], perstep=COST_FOOD[k][idx],
                                   paid=0, state=0, f50=1)
                elif state == 0x7e:
                    if not (f50 & 4):
                        exp.update(f50=f50 | 4, state=0)    # первый 0x7e = пауза
                    else:
                        food[own] += u.u32(U_PAID)          # второй = отмена с возвратом
                        exp.update(f50=f50 & 0xfa, state=0)
                else:
                    exp.update(state=0)
            elif f50 != 0 and not (f50 & 4):
                if f50 & 1:                                 # производство: оплата по шагам
                    per = u.u32(U_PERSTEP)
                    if food[own] < per:
                        exp.update(f50=f50 | 4, state=0)    # нет еды -> пауза
                    else:
                        food[own] -= per
                        exp.update(paid=u.u32(U_PAID) + per, f0a=(u.u8(U_F0A) + 1) & 0xff)
                        if u.u8(U_F09) > exp['f0a']:
                            if step_low == 0 and u.u8(U_HP) < u.u8(U_HPMAX):
                                exp['hp'] = u.u8(U_HP) + 1  # ремонт идёт параллельно
                        else:
                            exp['f50'] = 0
                            if t == 0x1e:                   # склад: выдача еды кучкой
                                food[own] -= min(WITHDRAW[target & 3], food[own])
                            unknown.add('spawn')
                elif f50 & 2:                               # стройка
                    exp.update(hp=(u.u8(U_HP) + 1) & 0xff, f51=(u.u8(U_F51) + 1) & 0xff)
                    if exp['f51'] >= u.u8(U_HPMAX):
                        exp['f50'] = 0
                elif step_low == 0 and u.u8(U_HP) < u.u8(U_HPMAX):
                    exp['hp'] = u.u8(U_HP) + 1
            elif step_low == 0 and u.u8(U_HP) < u.u8(U_HPMAX):
                exp['hp'] = u.u8(U_HP) + 1                  # самопочинка раз в 16 шагов
            if exp is not None:
                bld[i] = exp
            continue

        # ---------------- носильщик сдаёт еду на склад (0x19229) ----------------------
        st = u.u8(U_STATE)
        if 0x50 <= st <= 0x5f and u.u32(U_TARGET):
            tr = Rec(pool, u.u32(U_TARGET) // POOL_SZ)
            if tr.u8(U_TYPE) == 0x1e and (tr.u8(U_FLAGS5B) & 1) == 0 and tr.u8(U_STATE) != 0x60:
                slot = u.u8(U_F51) if st == 0x50 else (st - 0x51) & 0xff
                if st == 0x50 and ((u.u16(U_X) & 0x1f) or (u.u16(U_Y) & 0x1f)):
                    continue                                # ещё едет
                if carry_reached(u, tr) and u.u8(U_INV + slot) == 0x1e:
                    give = u.u16(U_FOOD)
                    if give > 0x32:
                        give -= 0x32                        # 50 единиц носильщик оставляет себе
                    food[tr.u8(U_OWNER)] += give
    return food, bld, unknown


def predict_items(items, live_ids, rot_tick):
    """Гниение (0x1c370). Возвращает {id: (таймер, количество, удалён)} для живых записей."""
    out = {}
    for i in live_ids:
        o = i * ITEM_SZ
        t = items[o + I_TYPE]
        timer = struct.unpack_from('<H', items, o + I_TIMER)[0]
        qty = struct.unpack_from('<H', items, o + I_QTY)[0]
        gone = False
        if rot_tick:
            if t == 0x1e:                                   # еда: −1 к количеству, удаление при 0
                qty = (qty - 1) & 0xffff
                gone = qty == 0
            elif t < 0x0f:                                  # прочие предметы: таймер 25 «тиков»
                timer = (timer - 1) & 0xffff
                if timer == 0:
                    qty = (qty - 1) & 0xffff
                    gone = qty == 0
        out[i] = (timer, qty, gone)
    return out


# ---------------------------------------------------------------- сверка последовательности
def damage_map(states):
    """Шаги, где юнит терял HP: там бой перемешан с регенерацией/ремонтом."""
    dmg = {}
    for k in range(len(states) - 1):
        a, b = states[k][0], states[k + 1][0]
        for i in range(POOL_N):
            o = i * POOL_SZ
            if a[o + U_TYPE] == b[o + U_TYPE] and b[o + U_HP] < a[o + U_HP]:
                dmg.setdefault(i, set()).add(k)
    return dmg


def recently_damaged(dmg, i, k, w=16):
    s = dmg.get(i)
    return s is not None and any(x in s for x in range(k - w, k + w + 1))


def check_sequence(states, sl_first, nstore0, tag, stats, bad, first_step=2):
    """states = [(pool, food), ...]; sl_first = 0x31b66 во время шага, давшего states[1]."""
    nstore = list(nstore0)
    dmg = damage_map(states)
    for k in range(len(states) - 1):
        pool, food = states[k]
        npool, nfood = states[k + 1]
        gstep = first_step + k
        step_low = (sl_first + k) & 0xf
        pf, bexp, unknown = predict(pool, food, nstore, step_low)

        for p in range(8):
            if pf[p] == nfood[p]:
                stats['food_ok'] += 1
            else:
                stats['food_bad'] += 1
                bad.append('%s шаг %d: еда[%d] ожидали %d, в эталоне %d (%s)'
                           % (tag, gstep, p, pf[p], nfood[p], ','.join(sorted(unknown)) or '-'))

        for i, e in bexp.items():
            pre, v = Rec(pool, i), Rec(npool, i)
            if v.u8(U_FLAGS5B) & 1 or v.u8(U_TYPE) != pre.u8(U_TYPE):
                continue                                    # запись удалена/сменила тип
            got = {'f50': v.u8(U_F50), 'f09': v.u8(U_F09), 'f0a': v.u8(U_F0A),
                   'paid': v.u32(U_PAID), 'perstep': v.u32(U_PERSTEP),
                   'hp': v.u8(U_HP), 'f51': v.u8(U_F51), 'state': v.u8(U_STATE)}
            if 'spawn' in unknown and pre.u8(U_F50) & 1:
                keys = ['f50']                              # после спавна поля пишет производитель
            else:
                keys = ['f50', 'f09', 'f0a', 'paid', 'perstep', 'hp', 'f51', 'state']
                if (pre.u8(U_F50) & 1) == 0 and (v.u8(U_F50) & 1) \
                        and pre.u8(U_STATE) != 0x7f and pre.u8(U_ORDER) != 0x7f:
                    stats['ai_orders'] += 1                 # ИИ вписал 0x7f посреди того же шага
                    continue
                if recently_damaged(dmg, i, k):
                    keys.remove('hp'); stats['dmg_skips'] += 1
                if v.u8(U_STATE) in (0x6f, 0x60) and e['state'] not in (0x6f, 0x60):
                    keys.remove('state'); stats['dmg_skips'] += 1
            for key in keys:
                if got[key] == e[key]:
                    stats['bld_ok'] += 1
                else:
                    stats['bld_bad'] += 1
                    bad.append('%s шаг %d: здание #%d поле %s ожидали %d, в эталоне %d'
                               % (tag, gstep, i, key, e[key], got[key]))
            if pre.u8(U_F50) & 1 and not (pre.u8(U_F50) & 4):
                stats['prod_steps'] += 1

        # --- регенерация/питание людей и ручных динозавров (0x18ab2), раз в 16 шагов
        if step_low == 0:
            for i in unit_order(pool):
                u, v = Rec(pool, i), Rec(npool, i)
                t = u.u8(U_TYPE)
                if not (1 <= t < 0x0e) or u.u8(U_STATE) in (0x6f, 0x60):
                    continue
                if v.u8(U_TYPE) != t or (v.u8(U_FLAGS5B) & 1) or skipped_by_fx43(u):
                    continue
                if recently_damaged(dmg, i, k):
                    stats['dmg_skips'] += 1
                    continue
                hp, hpmax = u.u8(U_HP), u.u8(U_HPMAX)
                if hp >= hpmax:
                    continue
                has_food = u.u16(U_FOOD) >= 1 and any(u.u8(U_INV + d) == 0x1e for d in (6, 7, 8))
                if hp & 3:
                    exp_hp, exp_food = hp + 1, u.u16(U_FOOD)          # «бесплатные» 3 HP из 4
                elif has_food:
                    exp_hp, exp_food = hp + 1, u.u16(U_FOOD) - 1      # каждый 4-й HP стоит 1 еды
                else:
                    exp_hp, exp_food = hp, u.u16(U_FOOD)              # нет еды — нет лечения
                if v.u16(U_FOOD) != u.u16(U_FOOD) and v.u16(U_FOOD) != exp_food:
                    continue                                          # еду изменил другой обработчик
                if v.u8(U_HP) == min(exp_hp, hpmax) and v.u16(U_FOOD) == exp_food:
                    stats['regen_ok'] += 1
                else:
                    stats['regen_bad'] += 1
                    bad.append('%s шаг %d: регенерация #%d HP %d->%d (ждали %d), еда %d->%d (ждали %d)'
                               % (tag, gstep, i, hp, v.u8(U_HP), exp_hp,
                                  u.u16(U_FOOD), v.u16(U_FOOD), exp_food))


# ---------------------------------------------------------------- режим трасс
def load_trace(path):
    raw = open(os.path.join(path, 'steps.bin'), 'rb').read()
    rec = POOL_N * POOL_SZ + 32
    states = [(raw[k * rec:k * rec + POOL_N * POOL_SZ],
               list(struct.unpack_from('<8I', raw, k * rec + POOL_N * POOL_SZ)))
              for k in range(len(raw) // rec)]
    snap = zlib.decompress(open(os.path.join(path, 'snap0.bin.z'), 'rb').read())
    sl0 = struct.unpack_from('<H', snap, 0x31b66 - 0x30000)[0]
    nstore = list(struct.unpack_from('<8I', snap, 0x31c48 - 0x30000))
    return states, sl0, nstore


def run_traces(paths, stats, bad):
    for p in paths:
        st, b = new_stats(), []
        states, sl0, nstore = load_trace(p)
        check_sequence(states, (sl0 + 2) & 0xf, nstore, os.path.basename(p), st, b, first_step=2)
        for kk in stats:
            stats[kk] += st[kk]
        bad += b
        print('  %-22s еда %6d/%-6d  здания %7d/%-7d  регенерация %5d/%-5d  шагов производства %d'
              % (os.path.basename(p), st['food_ok'], st['food_ok'] + st['food_bad'],
                 st['bld_ok'], st['bld_ok'] + st['bld_bad'],
                 st['regen_ok'], st['regen_ok'] + st['regen_bad'], st['prod_steps']))


# ---------------------------------------------------------------- режим сценариев
BNAME = {26: 'Sanctuary', 27: 'Barracks', 28: 'Armory', 29: 'Armory2', 30: 'Food-storage',
         31: 'Elf tr.', 32: 'Wizard tr.', 33: 'Warlock tr.', 34: 'Ranger tr.', 35: 'Velociraptor tr.',
         36: 'Carnotaurus tr.', 37: 'Rhamphorhynchus tr.', 38: 'Triceratops tr.', 39: 'Dilophosaurus tr.'}
FOOD_ADDR, NSTORE_ADDR, UNITS_ADDR = 0x31c28, 0x31c48, 0xe4400


def _oracle(mission, tribe=0):
    sys.path.insert(0, os.path.join(JW, 'reimpl'))
    import oracle
    o = oracle.Oracle(); o.boot(); o.start(mission, tribe, 1)
    return o


def _state(o):
    return o.mem(UNITS_ADDR, POOL_N * POOL_SZ), o.food()


def _find_building(o, own, btype):
    pool = o.mem(UNITS_ADDR, POOL_N * POOL_SZ)
    for i in range(POOL_N):
        r = Rec(pool, i)
        if r.u8(U_FLAGS5B) & 1 or r.u8(U_TYPE) != btype or r.u8(U_OWNER) != own:
            continue
        if r.u8(U_F50) or r.u8(U_STATE) >= 0x60:
            continue
        return i
    return None


def _globals(o):
    """(stepLow на ближайшем шаге, номер этого шага, склады по игрокам)."""
    return (o.r16(0x31b66) + 1) & 0xf, o.r16(0x31ab4) + 1, [o.r32(NSTORE_ADDR + p * 4) for p in range(8)]


def _ai_off(o):
    """Выключить ИИ: он вписывает заказы прямо в [+0x2b] и мешает чистому сценарию."""
    for s in range(8):
        o.w8(0x32aec + s, 0)


def scen_production(o, i, btype, idx, stats, bad, cap=300):
    """Полный цикл заказа: списание еды по шагам + спавн ровно на шаге COST_STEPS."""
    k = btype - 0x1a
    steps, per = COST_STEPS[k][idx], COST_FOOD[k][idx]
    tag = 'prod %s idx%d' % (BNAME[btype], idx)
    base = UNITS_ADDR + i * POOL_SZ
    o.w32(FOOD_ADDR, 900000)                                   # еды заведомо хватает
    o.w8(base + U_STATE, 0x7f); o.w32(base + U_TARGET, idx); o.w32(base + U_GUEST, 0)
    sl0, step0, nstore = _globals(o)
    states = [_state(o)]
    food_before = o.food()[0]
    full = steps + 3 <= cap
    for _ in range(min(steps + 3, cap)):
        o.step(1); states.append(_state(o))
    check_sequence(states, sl0, nstore, tag, stats, bad, first_step=step0)
    if full:                                                   # явная проверка итоговой цены
        spent = food_before - o.food()[0]
        want = steps * per
        if btype == 0x1e:
            want += min(WITHDRAW[idx & 3], 900000 - want)      # склад ещё и выдал еду
        if spent == want:
            stats['table_ok'] += 1
        else:
            stats['table_bad'] += 1
            bad.append('%s: списано %d, по таблице %d' % (tag, spent, want))


def scen_pause_cancel(o, i, btype, idx, stats, bad):
    """Пауза «нет еды» -> снятие паузы 0x7f -> пауза 0x7e -> отмена 0x7e с возвратом.

    Ручные правки памяти между шагами разрывают последовательность, поэтому каждый отрезок
    сверяется отдельным вызовом check_sequence.
    """
    k = btype - 0x1a
    per = COST_FOOD[k][idx]
    base = UNITS_ADDR + i * POOL_SZ
    tag = 'pause/cancel %s idx%d' % (BNAME[btype], idx)

    def segment(n):
        sl, step0, nstore = _globals(o)
        states = [_state(o)]
        for _ in range(n):
            o.step(1); states.append(_state(o))
        check_sequence(states, sl, nstore, tag, stats, bad, first_step=step0)

    o.w32(FOOD_ADDR, per * 5)
    o.w8(base + U_STATE, 0x7f); o.w32(base + U_TARGET, idx); o.w32(base + U_GUEST, 0)
    segment(8)                                                 # еда кончится -> пауза
    paused = o.r8(base + U_F50) & 4
    paid_at_pause = o.r32(base + U_PAID)

    o.w32(FOOD_ADDR, 900000)
    o.w8(base + U_STATE, 0x7f)                                 # снять паузу
    segment(3)
    running = (o.r8(base + U_F50) & 5) == 1

    o.w8(base + U_STATE, 0x7e)                                 # первый 0x7e = пауза
    segment(1)
    paused2 = o.r8(base + U_F50) & 4
    food_before, paid2 = o.food()[0], o.r32(base + U_PAID)

    o.w8(base + U_STATE, 0x7e)                                 # второй 0x7e = отмена с возвратом
    segment(1)
    refunded = o.food()[0] - food_before

    for name, ok in (('пауза при нехватке еды', bool(paused)),
                     ('снятие паузы приказом 0x7f', running),
                     ('0x7e при работе = пауза', bool(paused2)),
                     ('возврат равен уплаченному', refunded == paid2),
                     ('уплачено кратно цене шага', paid_at_pause % per == 0)):
        if ok:
            stats['table_ok'] += 1
        else:
            stats['table_bad'] += 1
            bad.append('%s: не выполнено «%s»' % (tag, name))


def _item_ids(o):
    out, it = [], o.r32(0x31b7c)
    while it:
        out.append(it // ITEM_SZ); it = o.r32(ITEMS_BASE + it + I_NEXT)
    return out


def scen_withdraw(o, i, stats, bad):
    """Склад: выдача 10/100/1000/10000 и кучка-предмет с этим количеством."""
    base = UNITS_ADDR + i * POOL_SZ
    for idx in range(4):
        want = WITHDRAW[idx]
        o.w32(FOOD_ADDR, want + 12345)
        o.w8(base + U_STATE, 0x7f); o.w32(base + U_TARGET, idx); o.w32(base + U_GUEST, 0)
        before = o.food()[0]
        o.step(COST_STEPS[4][idx] + 2)
        spent = before - o.food()[0]
        got = any(o.r8(ITEMS_BASE + j * ITEM_SZ + I_TYPE) == 0x1e
                  and o.r16(ITEMS_BASE + j * ITEM_SZ + I_QTY) == want for j in _item_ids(o))
        if spent == want and got:
            stats['table_ok'] += 1
        else:
            stats['table_bad'] += 1
            bad.append('выдача idx%d: списано %d (ждали %d), кучка найдена: %s' % (idx, spent, want, got))
        if want > 1:                                           # вариант «еды меньше, чем в таблице»
            o.w32(FOOD_ADDR, want // 2)
            o.w8(base + U_STATE, 0x7f); o.w32(base + U_TARGET, idx); o.w32(base + U_GUEST, 0)
            before = o.food()[0]
            o.step(COST_STEPS[4][idx] + 2)
            if before - o.food()[0] == want // 2 and o.food()[0] == 0:
                stats['table_ok'] += 1
            else:
                stats['table_bad'] += 1
                bad.append('выдача idx%d при нехватке: списано %d' % (idx, before - o.food()[0]))


def scen_rot(o, stats, bad, ticks=25):
    """Гниение: раз в 128 шагов еда −1 к количеству, прочие предметы −1 к таймеру (старт 25)."""
    for _ in range(ticks):
        while (o.r16(0x31ab4) + 1) & 0x7f:                     # доходим до границы 128 шагов
            o.step(1)
        items = o.mem(ITEMS_BASE, ITEM_N * ITEM_SZ)
        exp = predict_items(items, _item_ids(o), True)
        o.step(1)
        after = o.mem(ITEMS_BASE, ITEM_N * ITEM_SZ)
        now = set(_item_ids(o))
        for i, (timer, qty, gone) in exp.items():
            off = i * ITEM_SZ
            if gone:
                ok = i not in now
            else:
                ok = (i in now and struct.unpack_from('<H', after, off + I_TIMER)[0] == timer
                      and struct.unpack_from('<H', after, off + I_QTY)[0] == qty)
            if ok:
                stats['item_ok'] += 1
            else:
                stats['item_bad'] += 1
                bad.append('гниение: предмет #%d тип %d ждали (t=%d, q=%d, gone=%s), стало (t=%d, q=%d, есть=%s)'
                           % (i, items[off + I_TYPE], timer, qty, gone,
                              struct.unpack_from('<H', after, off + I_TIMER)[0],
                              struct.unpack_from('<H', after, off + I_QTY)[0], i in now))


def _place(o, i, x, y):
    base = UNITS_ADDR + i * POOL_SZ
    o.w16(base + U_X, x); o.w16(base + U_Y, y)


def _find_unit(o, own, lo=1, hi=9):
    pool = o.mem(UNITS_ADDR, POOL_N * POOL_SZ)
    for i in range(POOL_N):
        r = Rec(pool, i)
        if r.u8(U_FLAGS5B) & 1 or r.u8(U_OWNER) != own or not (lo <= r.u8(U_TYPE) < hi):
            continue
        if r.u8(U_STATE) >= 0x60:
            continue
        return i
    return None


def scen_carry(o, stats, bad):
    """Сдача еды на склад (оставить 50) и продажа предмета в арсенале (цена/2 в еду юнита)."""
    st = _find_building(o, 0, 30)
    ar = _find_building(o, 0, 28)
    for amount, keep in ((1000, 50), (51, 50), (50, 0), (30, 0), (1, 0)):
        i = _find_unit(o, 0)
        if i is None or st is None:
            return
        b = UNITS_ADDR + i * POOL_SZ
        sb = UNITS_ADDR + st * POOL_SZ
        _place(o, i, o.r16(sb + U_X), o.r16(sb + U_Y))
        o.w8(b + U_ORDER, 0xff); o.w8(b + U_INV + 6, 0x1e); o.w16(b + U_FOOD, amount)
        o.w8(b + U_STATE, 0x50); o.w8(b + U_F51, 6); o.w32(b + U_TARGET, st * POOL_SZ)
        o.w8(b + U_FX43, 0)
        before = o.food()[0]
        o.step(1)
        gave, left = o.food()[0] - before, o.r16(b + U_FOOD)
        want = amount - keep
        slot_ok = (o.r8(b + U_INV + 6) == (0x1e if keep else 0))
        if gave == want and left == keep and slot_ok:
            stats['table_ok'] += 1
        else:
            stats['table_bad'] += 1
            bad.append('сдача %d на склад: отдал %d (ждали %d), осталось %d (ждали %d), слот %s'
                       % (amount, gave, want, left, keep, o.r8(b + U_INV + 6)))
    if ar is None:
        return
    for item in (1, 2, 8, 14):
        i = _find_unit(o, 0)
        b = UNITS_ADDR + i * POOL_SZ
        ab = UNITS_ADDR + ar * POOL_SZ
        _place(o, i, o.r16(ab + U_X), o.r16(ab + U_Y))
        o.w8(b + U_ORDER, 0xff); o.w8(b + U_INV + 0, item); o.w16(b + U_FOOD, 0)
        o.w8(b + U_INV + 6, 0x1e); o.w8(b + 0x15, 0xff); o.w8(b + 0x16, 0xff)
        o.w8(b + U_STATE, 0x51); o.w32(b + U_TARGET, ar * POOL_SZ); o.w8(b + U_FX43, 0)
        o.step(1)
        want = ((COST_FOOD[2][item] & 0xff) * COST_STEPS[2][item] & 0xffff) >> 1
        if o.r16(b + U_FOOD) == want and o.r8(b + U_INV + 0) == 0:
            stats['table_ok'] += 1
        else:
            stats['table_bad'] += 1
            bad.append('продажа предмета %d в арсенале: получено %d (ждали %d), слот %d'
                       % (item, o.r16(b + U_FOOD), want, o.r8(b + U_INV + 0)))


def scen_build(o, stats, bad):
    """Sanctuary -> Constructor -> превращение в здание -> прогресс стройки по 1 HP за шаг."""
    sc = _find_building(o, 0, 26)
    if sc is None:
        return
    base = UNITS_ADDR + sc * POOL_SZ
    idx = 4                                                   # вид здания 4 = Food-storage
    o.w32(FOOD_ADDR, 900000)
    o.w8(base + U_STATE, 0x7f); o.w32(base + U_TARGET, idx); o.w32(base + U_GUEST, 0)
    o.step(COST_STEPS[0][idx] + 3)
    pool = o.mem(UNITS_ADDR, POOL_N * POOL_SZ)
    con = None
    for i in range(POOL_N):
        r = Rec(pool, i)
        if not (r.u8(U_FLAGS5B) & 1) and r.u8(U_TYPE) == 4 and r.u8(U_OWNER) == 0 and r.u8(0x59) == idx:
            con = i
    if con is None:
        stats['table_bad'] += 1; bad.append('Sanctuary idx4 не выдал Constructor'); return
    stats['table_ok'] += 1
    b = UNITS_ADDR + con * POOL_SZ
    x, y = o.r16(b + U_X) & 0xffe0, o.r16(b + U_Y) & 0xffe0
    _place(o, con, x, y)
    o.w16(b + 0x37, x); o.w16(b + 0x39, y)                    # цель = текущая точка -> «прибыл»
    o.w8(b + U_STATE, 0); o.w8(b + U_ORDER, 0xff); o.w8(b + U_ANIM, 1); o.w8(b + U_FX43, 0)
    food_unit = o.r16(b + U_FOOD)
    ns_before = o.r32(NSTORE_ADDR)
    o.step(1)
    btype = o.r8(b + U_TYPE)
    checks = [('конструктор стал зданием %d' % (idx + 26), btype == idx + 26),
              ('FLAGS50 = 2 (стройка)', o.r8(b + U_F50) == 2),
              ('HP = 0, прогресс = 0', o.r8(b + U_HP) == 0 and o.r8(b + U_F51) == 0),
              ('HPMAX по таблице', o.r8(b + U_HPMAX) == HPMAX_T[idx + 26]),
              ('склад учтён в 0x31c48', o.r32(NSTORE_ADDR) == ns_before + 1),
              ('еда конструктора выпала кучкой',
               any(o.r8(ITEMS_BASE + j * ITEM_SZ + I_TYPE) == 0x1e
                   and o.r16(ITEMS_BASE + j * ITEM_SZ + I_QTY) == food_unit for j in _item_ids(o)))]
    for name, ok in checks:
        if ok:
            stats['table_ok'] += 1
        else:
            stats['table_bad'] += 1
            bad.append('стройка: не выполнено «%s»' % name)
    sl0, step0, nstore = _globals(o)
    states = [_state(o)]
    for _ in range(HPMAX_T[idx + 26] + 3):
        o.step(1); states.append(_state(o))
    check_sequence(states, sl0, nstore, 'build %d' % (idx + 26), stats, bad, first_step=step0)
    if o.r8(b + U_F50) == 0 and o.r8(b + U_HP) >= HPMAX_T[idx + 26] - 1:
        stats['table_ok'] += 1
    else:
        stats['table_bad'] += 1
        bad.append('стройка не завершилась: f50=%d HP=%d' % (o.r8(b + U_F50), o.r8(b + U_HP)))


def run_scenarios(stats, bad):
    plan = [(9, 26), (9, 27), (9, 28), (9, 30), (9, 31), (9, 38), (9, 39), (8, 35)]
    for mission, btype in plan:
        o = _oracle(mission); _ai_off(o)
        k = btype - 0x1a
        done = 0
        for idx in range(min(MENU_N[k], 4)):
            i = _find_building(o, 0, btype)
            if i is None:
                o = _oracle(mission); _ai_off(o); i = _find_building(o, 0, btype)
            if i is None:
                bad.append('нет свободного здания типа %d у игрока 0 в миссии %d' % (btype, mission))
                stats['table_bad'] += 1
                break
            scen_production(o, i, btype, idx, stats, bad)
            done += 1
        print('  %-20s (миссия %d): пунктов меню проверено %d' % (BNAME[btype], mission, done))
    o = _oracle(9); _ai_off(o); i = _find_building(o, 0, 27)
    if i is not None:
        scen_pause_cancel(o, i, 27, 1, stats, bad)
    o = _oracle(9); _ai_off(o); i = _find_building(o, 0, 30)
    if i is not None:
        scen_withdraw(o, i, stats, bad)
    print('  пауза / отмена с возвратом / выдача склада: проверено')
    o = _oracle(9); _ai_off(o)
    scen_carry(o, stats, bad)
    print('  сдача еды на склад и продажа в арсенале: проверено')
    o = _oracle(9); _ai_off(o)
    scen_build(o, stats, bad)
    print('  постройка здания конструктором: проверено')
    o = _oracle(9)
    o.step(300)                                                # чтобы на земле появились предметы
    scen_rot(o, stats, bad)
    print('  гниение предметов: сверок %d' % stats['item_ok'])


# ---------------------------------------------------------------- main
def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    do_scen = '--scenarios' in flags or '--all' in flags
    do_tr = (not do_scen) or ('--all' in flags) or bool(args)
    stats, bad = new_stats(), []
    if do_tr:
        if not args:
            tr = os.path.join(JW, 'reimpl', 'traces')
            args = [os.path.join(tr, d) for d in sorted(os.listdir(tr))
                    if os.path.exists(os.path.join(tr, d, 'steps.bin'))]
        print('== трассы эталона ==')
        run_traces(args, stats, bad)
    if do_scen:
        print('== сценарии на эталоне (unicorn) ==')
        run_scenarios(stats, bad)
    print()
    print('еда игроков       %8d / %d' % (stats['food_ok'], stats['food_ok'] + stats['food_bad']))
    print('поля зданий       %8d / %d' % (stats['bld_ok'], stats['bld_ok'] + stats['bld_bad']))
    print('регенерация/еда   %8d / %d' % (stats['regen_ok'], stats['regen_ok'] + stats['regen_bad']))
    print('гниение предметов %8d / %d' % (stats['item_ok'], stats['item_ok'] + stats['item_bad']))
    print('итоговые числа    %8d / %d' % (stats['table_ok'], stats['table_ok'] + stats['table_bad']))
    print('(шагов производства %d, заказов ИИ пропущено %d, пропусков из-за боя %d)'
          % (stats['prod_steps'], stats['ai_orders'], stats['dmg_skips']))
    n_bad = sum(v for k, v in stats.items() if k.endswith('_bad'))
    n_ok = sum(v for k, v in stats.items() if k.endswith('_ok'))
    for line in bad[:25]:
        print('  !', line)
    if len(bad) > 25:
        print('  ... ещё %d' % (len(bad) - 25))
    print()
    print('ВЕРДИКТ: %d сверок, расхождений %d — %s'
          % (n_ok + n_bad, n_bad, 'ОК' if n_bad == 0 else 'ЕСТЬ РАСХОЖДЕНИЯ'))
    return 0 if n_bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
