#!/usr/bin/env python3
"""spec_check_ai.py — эмпирическая проверка notes/ai-spec.md.

Запуск из reimpl/:
    python3 ../tools/spec_check_ai.py traces/long_m2_t0 traces/long_m9_t3 ...
    python3 ../tools/spec_check_ai.py --no-emu traces/*        # только трассовые проверки

Что проверяется:
  A. ГСЧ 0x20469 / 0x204a6 — независимая реализация формулы из §3 спеки против эталона
     (unicorn) на случайных состояниях, включая случаи с ненулевым индексом таблицы 0x393ac.
  B. ГСЧ в живой игре — хук на 0x20469/0x204a6 во время настоящих N шагов: каждый вызов
     сверяется с формулой; попутно собирается гистограмма мест вызова и диапазонов.
  C. Периодичность фаз шага (0x13f4c/0x15f86/0x15634/0x1c370/0x15a0a/0x17728 и веток ИИ)
     — по номерам шагов, на которых сработал хук.
  F. (--long[=N]) Длинный прогон на эмуляторе БЕЗ файла трассы: «отвязка застрявших» 0x15a0a
     раз в 8192 шага и её эффект; форсированные сценарии волны атаки (1->4->1) и состояний 5/7.
  D. Трассы: приказ применяется только на тайле; отображение код приказа → состояние;
     таймер мёртвого юнита +0x4f; таймер простоя +0x2c в 0x38 и счётчик безделья +0x50;
     сброс +0x50 у зверей; регенерация раз в 16 шагов по счётчику [0x31b66].
"""
import sys, os
# каталог скрипта содержит dis.py, который перекрывает стандартный модуль dis (нужен unicorn)
sys.path[:] = [p for p in sys.path if os.path.abspath(p or '.') != os.path.dirname(os.path.abspath(__file__))]
import json, struct, collections, random, mmap

POOL, SZ, REC = 57600, 96, 57632
O = dict(TYPE=4, SLOT=5, OWNER=6, F07=7, F08=8, HPMAX=0x0c, HP=0x0e, SPD=0x12,
         STATE=0x2b, ATKCTR=0x2c, X=0x2f, Y=0x31, TARGET=0x33, DSTX=0x37, DSTY=0x39,
         DIR=0x3d, F43=0x43, ORDER=0x46, ANIM=0x4f, IDLE=0x50, F5B=0x5b, NEXT=0x60)

ok = collections.Counter()
bad = collections.Counter()
notes = []


def rep(name, good, wrong, extra=''):
    ok[name] += good
    bad[name] += wrong
    if extra:
        notes.append('    ' + extra)


# ---------------------------------------------------------------- A/B: ГСЧ
RNGTAB_RAW = None          # 32 байта от 0x393ac


def rng_tab(i):
    """dword по БАЙТОВОМУ смещению i (0..15) — в оригинале `mov eax,[eax+0x393ac]`, eax = q>>28."""
    return struct.unpack_from('<I', RNGTAB_RAW, i)[0]


def rand_raw(state, rng, step):
    """FUN_00020469: возвращает (остаток, новое состояние)."""
    if rng == 0:
        return 0, state
    e = (state + step) & 0xffffffff
    q, r = e // rng, e % rng
    state = (state + q) & 0xffffffff
    state ^= rng_tab(q >> 28)
    return r, state & 0xffffffff


def check_rng(steps_per_game=600):
    global RNGTAB_RAW
    sys.path.insert(0, os.getcwd())
    import oracle
    from unicorn import UC_HOOK_CODE
    from unicorn.x86_const import UC_X86_REG_EDX, UC_X86_REG_ESP

    o = oracle.Oracle(); o.boot(); o.start(0, 0, 1)
    RNGTAB_RAW = o.mem(0x393ac, 32)

    # хуки ставятся ДО первого исполнения 0x20469: unicorn кэширует оттранслированные блоки
    # и хук, добавленный после, на уже выполнявшийся блок не действует.
    PHASE = {0x13f4c: 'orders 0x13f4c', 0x15f86: 'stats 0x15f86', 0x15634: 'ai 0x15634',
             0x1c370: 'items 0x1c370', 0x15a0a: 'unstick 0x15a0a', 0x17728: 'victory 0x17728',
             0x156ed: 'ai state1 0x156ed', 0x1572f: 'ai state4 0x1572f', 0x15b20: 'pick target 0x15b20',
             0x1580e: 'task atk 0x1580e', 0x15885: 'task def 0x15885', 0x18058: 'dead 0x18058'}
    hits = collections.defaultdict(list)
    sites = collections.Counter(); ranges = collections.Counter()
    pending = []
    armed = [False]
    stat = [0, 0]                                  # rng_good, rng_bad

    def hook(uc, addr, size, ud):
        if not armed[0]:
            return
        a = addr - oracle.RELOC
        if a in PHASE:
            hits[PHASE[a]].append(o.r32(0x31ab4))
            return
        if a == 0x20469:
            S = o.r32(0x31b5c); rng = o.r32(0x31b58); T = o.r32(0x31ab4)
            esp = uc.reg_read(UC_X86_REG_ESP)
            ret = struct.unpack('<I', uc.mem_read(esp, 4))[0] - oracle.RELOC
            pending.append(('raw', S, rng, T, ret)); sites['0x%x' % ret] += 1; ranges[rng] += 1
        elif a == 0x204a6:
            S = o.r32(0x393a4); rng = o.r32(0x393a8)
            T = struct.unpack('<I', uc.mem_read(0x46c, 4))[0]
            esp = uc.reg_read(UC_X86_REG_ESP)
            ret = struct.unpack('<I', uc.mem_read(esp, 4))[0] - oracle.RELOC
            pending.append(('tim', S, rng, T, ret)); sites['0x%x (0x204a6)' % ret] += 1
        else:                                             # точки ret обеих функций
            if not pending:
                return
            kind, S, rng, T, ret = pending.pop()
            r_emu = uc.reg_read(UC_X86_REG_EDX)
            S_emu = o.r32(0x31b5c) if kind == 'raw' else o.r32(0x393a4)
            r_py, S_py = rand_raw(S, rng, T)
            if (r_emu, S_emu) == (r_py, S_py):
                stat[0] += 1
            else:
                stat[1] += 1
                if stat[1] <= 3:
                    notes.append('    ГСЧ(живая игра) %s S=%08x rng=%d T=%x из 0x%x: эталон (%d,%08x) спека (%d,%08x)'
                                 % (kind, S, rng, T, ret, r_emu, S_emu, r_py, S_py))

    for addr in list(PHASE) + [0x20469, 0x20474, 0x204a5, 0x204a6, 0x204b1, 0x204dc]:
        o.mu.hook_add(UC_HOOK_CODE, hook, begin=oracle.RELOC + addr, end=oracle.RELOC + addr)

    # --- A. чистая функция на случайных состояниях
    random.seed(20260907)
    good = wrong = 0
    cases = []
    for _ in range(2000):
        cases.append((random.getrandbits(32), random.choice([1, 2, 3, 4, 5, 13, 20, 50, 54, 100, 200, 0x2710, 0]),
                      random.getrandbits(random.choice([8, 16, 20, 31]))))
    # прицельно: индекс таблицы 0x393ac != 0 возможен только при малом диапазоне
    for k in range(1, 16):
        cases.append((k * 0x10000000, 1, 0))
        cases.append(((k * 0x10000000) | 0x1234, 2, 0x100))
    for S, rng, T in cases:
        o.w32(0x31b5c, S); o.w32(0x31b58, rng); o.w32(0x31ab4, T)
        o.call(0x20469)
        r_emu = o.mu.reg_read(UC_X86_REG_EDX); S_emu = o.r32(0x31b5c)
        r_py, S_py = rand_raw(S, rng, T)
        if (r_emu, S_emu) == (r_py, S_py):
            good += 1
        else:
            wrong += 1
            if wrong <= 3:
                notes.append('    ГСЧ: S=%08x rng=%d step=%x -> эталон (%d,%08x) спека (%d,%08x)'
                             % (S, rng, T, r_emu, S_emu, r_py, S_py))
    rep('A. ГСЧ 0x20469 (формула)', good, wrong)

    # 0x204a6 — тот же расчёт, но состояние [0x393a4], модуль [0x393a8], «шаг» = таймер BIOS [0x46c]
    good = wrong = 0
    for _ in range(500):
        S = random.getrandbits(32); rng = random.choice([1, 2, 4, 13, 20]); T = random.getrandbits(16)
        o.w32(0x393a4, S); o.w32(0x393a8, rng)
        o.mu.mem_write(0x46c, struct.pack('<I', T))
        o.call(0x204a6)
        r_emu = o.mu.reg_read(UC_X86_REG_EDX); S_emu = o.r32(0x393a4)
        r_py, S_py = rand_raw(S, rng, T)
        good += (r_emu, S_emu) == (r_py, S_py)
        wrong += (r_emu, S_emu) != (r_py, S_py)
    rep('A. ГСЧ 0x204a6 (формула)', good, wrong)

    # --- B/C. живая игра под хуками (хуки уже стоят, включаем их)
    armed[0] = True

    for (mi, tr) in ((2, 0), (9, 3)):
        o.start(mi, tr, 1)
        hits.clear()
        o.step(steps_per_game)
        # C. периодичность
        for name, want in (('orders 0x13f4c', 1), ('stats 0x15f86', 1), ('ai 0x15634', 1)):
            s = hits.get(name, [])
            good = 1 if s == list(range(1, steps_per_game + 1)) else 0
            rep('C. m%d t%d: %s каждый шаг' % (mi, tr, name), good, 1 - good)
        for name, mod in (('items 0x1c370', 128), ('ai state1 0x156ed', 32),
                          ('ai state4 0x1572f', 32), ('task atk 0x1580e', 16), ('task def 0x15885', 16)):
            s = hits.get(name, [])
            wrong = sum(1 for k in s if k % mod)
            rep('C. m%d t%d: %s только на кратных %d' % (mi, tr, name, mod), len(s) - wrong, wrong)
        s = hits.get('items 0x1c370', [])
        exp = list(range(128, steps_per_game + 1, 128))
        rep('C. m%d t%d: 0x1c370 ровно раз в 128 шагов' % (mi, tr), 1 if s == exp else 0, 0 if s == exp else 1)
        s = hits.get('victory 0x17728', [])
        wrong = sum(1 for k in s if k % 32)
        rep('C. m%d t%d: 0x17728 на шагах, кратных 32' % (mi, tr), len(s) - wrong, wrong)
        rep('C. m%d t%d: 0x15a0a (раз в 8192) не вызывался за %d шагов' % (mi, tr, steps_per_game),
            1 if not hits.get('unstick 0x15a0a') else 0, 0 if not hits.get('unstick 0x15a0a') else 1)
    armed[0] = False
    rep('B. ГСЧ в живой игре (все вызовы)', stat[0], stat[1])

    # --- E. отложенный приказ ждёт ровного тайла (в готовых трассах такой случай не встречается)
    o.start(0, 0, 1)
    unit = 0
    for i, rec in o.units():
        if rec[0x5b] & 1 or rec[4] != 1:
            continue
        unit = i
        break
    if unit:
        x = o.r16(oracle.UNITS + unit + 0x2f); y = o.r16(oracle.UNITS + unit + 0x31)
        o.order(0x0f, unit=unit, x=(x + 0x180) & 0xffe0, y=y & 0xffe0)
        o.step(1)
        good = wrong = 0
        waited = 0
        for _ in range(60):                      # ждём, пока юнит окажется между тайлами
            o.step(1)
            if (o.r16(oracle.UNITS + unit + 0x2f) & 0x1f) or (o.r16(oracle.UNITS + unit + 0x31) & 0x1f):
                break
        o.order(0x2f, unit=unit)                 # приказ «отдых» посреди тайла
        o.step(1)
        for _ in range(40):
            offtile = (o.r16(oracle.UNITS + unit + 0x2f) & 0x1f) or (o.r16(oracle.UNITS + unit + 0x31) & 0x1f)
            order = o.r8(oracle.UNITS + unit + 0x46)
            if offtile:
                good += 1 if order == 0x2f else 0
                wrong += 0 if order == 0x2f else 1
                waited += 1
            else:
                # шаг, на котором юнит встал ровно на тайл, приказ ещё не применён —
                # проверка выравнивания делается В НАЧАЛЕ следующего шага
                o.step(1)
                order = o.r8(oracle.UNITS + unit + 0x46)
                st = o.r8(oracle.UNITS + unit + 0x2b)
                # приказ 0x2f снят и превращён в состояние 0x2f -> 0x20 (обработчик 0x18e0b);
                # у здорового юнита 0x163e4 -> 0x16508 -> 0x1a34c тут же ставит новый приказ 0x3f
                okv = order != 0x2f and st == 0x20
                good += 1 if okv else 0
                wrong += 0 if okv else 1
                break
            o.step(1)
        rep('E. приказ вне тайла ждёт (%d шагов ожидания)' % waited, good, wrong)
    notes.append('    места вызова ГСЧ: ' + ', '.join('%s×%d' % (k, v) for k, v in sites.most_common(12)))
    notes.append('    диапазоны ГСЧ: ' + ', '.join('%d×%d' % (k, v) for k, v in ranges.most_common(12)))


# ---------------------------------------------------------------- F: длинный прогон и форсированные сценарии
def check_long(nsteps=9000, mission=9, tribe=3):
    """Прогон на эмуляторе без файла трассы (10000 шагов x 57632 байта = 550 МБ на диск не нужны):
    хуки снимают всё необходимое прямо в памяти."""
    sys.path.insert(0, os.getcwd())
    import oracle
    from unicorn import UC_HOOK_CODE, UcError
    U = oracle.UNITS

    o = oracle.Oracle(); o.boot()
    hits = collections.defaultdict(list)
    expect = []                     # ожидаемый эффект 0x15a0a, снятый на входе в неё

    def units():
        out, i = [], o.r32(0x31b6c)
        while i:
            out.append((i, bytes(o.mem(U + i, 96))))
            i = o.r32(U + i + 0x60)
        return out

    def hook(uc, addr, size, ud):
        a = addr - oracle.RELOC
        hits[a].append(o.r32(0x31ab4))
        if a != 0x15a0a:
            return
        # §6.6: кого должна задеть отвязка
        human = o.r8(0x31b64)
        want = []
        for slot in range(7, -1, -1):
            if o.r8(0x32ae4 + slot) == human:
                continue
            st = o.r8(0x32aec + slot)
            if st == 0 or st == 5:
                continue
            owner = o.r8(0x32ae4 + slot)
            for i, r in units():
                if r[0x05] != slot or r[0x06] != owner or (r[0x5b] & 1):
                    continue
                if r[0x2b] == 0x60 or r[0x2b] == 0x6f or r[0x08] != 0:
                    continue
                if r[0x04] >= 0x18 or r[0x04] == 4:
                    continue
                if not (0x36 <= r[0x2b] <= 0x3f):
                    continue
                want.append((i, r[0x59], r[0x5a]))
        expect.append((o.r32(0x31ab4), want))

    for a in (0x15a0a, 0x15a3e, 0x156ed, 0x1572f, 0x157ab, 0x157d6, 0x157e1, 0x15b20, 0x15e82, 0x15ac6):
        o.mu.hook_add(UC_HOOK_CODE, hook, begin=oracle.RELOC + a, end=oracle.RELOC + a)

    # --- F1/F2: естественный прогон
    o.start(mission, tribe, 1)
    ai_slots = [s for s in range(8) if o.r8(0x32aec + s)]
    seen_states = collections.Counter(); transitions = collections.Counter()
    prev = bytes(o.mem(0x32aec, 8))
    checked_unstick = None
    for k in range(nsteps):
        expect.clear()
        o.step(1)
        if expect:                                   # на этом шаге сработала 0x15a0a
            step_no, want = expect[0]
            good = wrong = 0
            for i, sx, sy in want:
                r = bytes(o.mem(U + i, 96))
                okv = r[0x46] == 0x37 and r[0x44] == sx and r[0x45] == sy
                good += 1 if okv else 0
                wrong += 0 if okv else 1
            checked_unstick = (step_no, len(want))
            rep('F. отвязка 0x15a0a: приказ 0x37 и пост := точка спавна (шаг %d)' % step_no, good, wrong)
        cur = bytes(o.mem(0x32aec, 8))
        if cur != prev:
            for s in range(8):
                if cur[s] != prev[s]:
                    transitions[(s, prev[s], cur[s])] += 1
            prev = cur
        for s in ai_slots:
            seen_states[cur[s]] += 1

    got = hits.get(0x15a0a, [])
    want = [k for k in range(1, nsteps + 1) if (k & 0x1fff) == 0]
    rep('F. 0x15a0a ровно на шагах, кратных 8192 (%s)' % (got or 'ни разу'),
        1 if got == want else 0, 0 if got == want else 1)
    n15a3e = len([k for k in hits.get(0x15a3e, []) if k in want])
    exp15a3e = len([s for s in range(8) if o.r8(0x32ae4 + s) != o.r8(0x31b64) and o.r8(0x32aec + s) not in (0, 5)])
    rep('F. 0x15a3e вызвана по разу на каждый ИИ-слот (%d)' % exp15a3e,
        1 if n15a3e == exp15a3e else 0, 0 if n15a3e == exp15a3e else 1)
    notes.append('    m%d t%d, %d шагов: ИИ-слоты %s, состояния %s, переходы %s'
                 % (mission, tribe, nsteps, ai_slots, dict(seen_states), dict(transitions) or 'нет'))
    if checked_unstick:
        notes.append('    отвязка на шаге %d задела %d юнитов' % checked_unstick)

    # --- F3: форсированная волна атаки (порог занижен) на миссии 3, слот 1
    o.start(2, 0, 1)
    slot = 1
    hits.clear()
    o.w16(0x32c7c + slot * 2, 1)                     # порог 1 -> ближайший макро-такт уйдёт в атаку
    for _ in range(400):
        o.step(1)
        if o.r8(0x32aec + slot) == 4:
            break
    st4 = o.r8(0x32aec + slot) == 4
    rep('F. состояние ИИ 1 -> 4 при достижении порога', 1 if st4 else 0, 0 if st4 else 1)
    if st4:
        good = wrong = 0
        good += 1 if o.r16(0x32b7c + slot * 2) == 0 else 0; wrong += 0 if o.r16(0x32b7c + slot * 2) == 0 else 1
        good += 1 if o.r16(0x32bbc + slot * 2) == 0 else 0; wrong += 0 if o.r16(0x32bbc + slot * 2) == 0 else 1
        good += 1 if len(hits.get(0x15b20, [])) == 1 else 0; wrong += 0 if len(hits.get(0x15b20, [])) == 1 else 1
        task = bytes(o.mem(0x32c1c + slot * 10, 10))
        good += 1 if task[0] in (4, 0xc) else 0; wrong += 0 if task[0] in (4, 0xc) else 1
        rep('F. при переходе в 4: 0x32b7c=0, 0x32bbc=0, вызван 0x15b20, задача атаки заполнена', good, wrong)

        # завершение волны: «все ударные погибли»
        thr0 = o.r16(0x32c7c + slot * 2); made0 = o.r16(0x32b1c + slot * 2); cap = o.r16(0x32bac + slot * 2)
        o.w16(0x32b7c + slot * 2, made0)
        hits.clear()
        for _ in range(400):
            o.step(1)
            if o.r8(0x32aec + slot) == 1:
                break
        st1 = o.r8(0x32aec + slot) == 1
        rep('F. состояние ИИ 4 -> 1 по гибели всех ударных (0x32b7c >= 0x32b1c)', 1 if st1 else 0, 0 if st1 else 1)
        if st1:
            thr1 = o.r16(0x32c7c + slot * 2); made1 = o.r16(0x32b1c + slot * 2)
            reinforce = len(hits.get(0x15e82, [])) == 1 and made1 == made0 + 1 and thr1 == thr0
            raise_thr = len(hits.get(0x15e82, [])) == 0 and thr1 == min(thr0 + 100, cap) and made1 == made0
            rep('F. итог волны: подкрепление (0x32b1c++) ЛИБО порог += 100 с потолком 0x32bac',
                1 if (reinforce or raise_thr) else 0, 0 if (reinforce or raise_thr) else 1)
            notes.append('    волна: 0x15e82 %d раз, порог %d -> %d (потолок %d), создано %d -> %d'
                         % (len(hits.get(0x15e82, [])), thr0, thr1, cap, made0, made1))
            good = wrong = 0
            for i, r in units():
                if r[0x05] != slot or (r[0x5b] & 1) or r[0x08] not in (2,) or r[0x2b] in (0x60, 0x6f):
                    continue
                okv = r[0x46] == 0x0f and struct.unpack_from('<H', r, 0x4b)[0] == r[0x59] << 5 \
                      and struct.unpack_from('<H', r, 0x4d)[0] == r[0x5a] << 5
                good += 1 if okv else 0; wrong += 0 if okv else 1
            rep('F. 0x15ac6: всем ударным приказ 0x0f на точку спавна', good, wrong)

    # --- F4: макро-состояния 5 и 7
    o.start(2, 0, 1); hits.clear()
    o.w8(0x32aec + slot, 5)
    o.step(300)
    okv = o.r8(0x32aec + slot) == 1 and len(hits.get(0x157ab, [])) == 1 and len(hits.get(0x157d6, [])) >= 1
    rep('F. состояние 5: микро 0x157d6, затем макро 0x157ab -> состояние 1', 1 if okv else 0, 0 if okv else 1)

    o2 = oracle.Oracle(); o2.boot(); o2.start(2, 0, 1)
    o2.w8(0x32aec + slot, 7)
    crashed = False
    try:
        o2.step(300)
    except UcError:
        crashed = True
    rep('F. состояние 7: микро-таблица читает мусор -> вылет (воспроизводить не нужно)',
        1 if crashed else 0, 0 if crashed else 1)
    notes.append('    0x156b4 и 0x156d0 — по 7 записей подряд; индекс 7 в макро-таблице попадает на '
                 '0x156d0[0] = ret (безвредно), а в микро-таблице — на байты кода 0x156ec = 0x048b66c3')


# ---------------------------------------------------------------- D: трассы
def live_set(rec):
    """Индексы записей пула, реально стоящих в двусвязном списке живых (голова [0x31b6c] в трассу
    не пишется, поэтому восстанавливаем её: у головы +0x5c == 0 и на неё никто не ссылается через +0x60)."""
    targets = set()
    for i in range(0, POOL, SZ):
        if rec[i + O['TYPE']] == 0:
            continue
        nx = struct.unpack_from('<I', rec, i + O['NEXT'])[0]
        if nx:
            targets.add(nx)
    best = set()
    for h in range(0, POOL, SZ):
        if rec[h + O['TYPE']] == 0 or h in targets:
            continue
        if struct.unpack_from('<I', rec, h + 0x5c)[0] != 0:
            continue
        seen, i = [], h
        while i and 0 <= i < POOL and i % SZ == 0 and i not in seen and len(seen) <= POOL // SZ:
            seen.append(i)
            i = struct.unpack_from('<I', rec, i + O['NEXT'])[0]
        if i == 0 and len(seen) > len(best):
            best = set(seen)
    return best


def check_traces(dirs):
    order2state = collections.Counter()
    for d in dirs:
        ix = json.load(open(os.path.join(d, 'index.json')))
        n = ix['steps']
        f = open(os.path.join(d, 'steps.bin'), 'rb')
        mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        tag = os.path.basename(d)

        g_tile = b_tile = 0                     # приказ применён только на тайле
        g_keep = b_keep = 0                     # не на тайле — приказ сохранён
        g_anim = b_anim = 0                     # +0x4f мёртвого +1 за шаг
        g_idle = b_idle = 0                     # +0x2c в 0x38 убывает на 1
        g_new = b_new = 0                       # новый таймер простоя в [5,24] и +0x50 += 1
        g_rst = b_rst = 0                       # сброс +0x50 у зверя
        regen = collections.Counter()

        prev = mm[0:REC]
        live = live_set(prev)
        for k in range(1, n):
            cur = mm[k * REC:(k + 1) * REC]
            S = k + 1                            # номер игрового шага, приведшего к записи k
            if k % 64 == 0:
                live = live_set(prev)            # список меняется при создании/удалении юнитов
            for i in sorted(live):
                t = prev[i + O['TYPE']]
                if t == 0 or cur[i + O['TYPE']] != t:
                    continue
                dead = prev[i + O['F5B']] & 1
                aligned = (prev[i + O['X']] & 0x1f) == 0 and (prev[i + O['Y']] & 0x1f) == 0
                # --- приказ применяется только на тайле
                o0 = prev[i + O['ORDER']]
                if not dead and o0 != 0xff and t < 0x1a:
                    o1 = cur[i + O['ORDER']]
                    if o1 == 0xff:
                        order2state[(o0, cur[i + O['STATE']])] += 1
                        if aligned:
                            g_tile += 1
                        else:
                            b_tile += 1
                    elif not aligned:
                        if o1 == o0:
                            g_keep += 1
                        else:
                            b_keep += 1
                # --- таймер мёртвого юнита
                if dead and (cur[i + O['F5B']] & 1):
                    a0 = struct.unpack_from('<H', prev, i + O['ANIM'])[0]
                    a1 = struct.unpack_from('<H', cur, i + O['ANIM'])[0]
                    if a0 != 0xffff and a1 != 0xffff and a1 != 0:
                        if a1 in (a0, (a0 + 1) & 0xffff):
                            g_anim += 1
                        else:
                            b_anim += 1
                # --- таймер простоя в состоянии 0x38 (оглушённые юниты обработчик не вызывают)
                if (not dead and prev[i + O['STATE']] == 0x38 and cur[i + O['STATE']] == 0x38
                        and prev[i + O['F43']] == 0 and cur[i + O['F43']] == 0):
                    c0, c1 = prev[i + O['ATKCTR']], cur[i + O['ATKCTR']]
                    if c0 > 1:
                        if c1 == c0 - 1:
                            g_idle += 1
                        else:
                            b_idle += 1
                    elif c0 == 1:
                        fl0, fl1 = prev[i + O['IDLE']], cur[i + O['IDLE']]
                        if cur[i + O['ORDER']] == 0x33:
                            # нашёл цель (0x1a526 -> 0x19fdf): выдан приказ 0x33, таймер обнулён
                            g_new += 1 if c1 == 0 and fl1 == fl0 else 0
                            b_new += 0 if c1 == 0 and fl1 == fl0 else 1
                        else:
                            birds = t == 0x0b             # летающие: фиксированный интервал 0x10
                            okv = (c1 == 0x10) if birds else (5 <= c1 <= 24)
                            if okv and fl1 == ((fl0 + 1) & 0xff):
                                g_new += 1
                            else:
                                b_new += 1
                # --- зверь сбрасывает счётчик безделья на тайле
                if not dead and 0x0e <= t <= 0x17 and prev[i + O['IDLE']] >= 0x0e and aligned:
                    if cur[i + O['IDLE']] == 0:
                        g_rst += 1
                    else:
                        b_rst += 1
                # --- регенерация 0x18ab2/0x18847: +1 HP (исключаем другие источники +1 HP —
                # отдых 0x2x со своим счётчиком на 32 шага и лечение в состояниях магии >= 0x80)
                st0 = prev[i + O['STATE']]
                if (not dead and cur[i + O['HP']] == prev[i + O['HP']] + 1
                        and (st0 >> 4) != 2 and st0 < 0x80):
                    regen[S % 16] += 1
            prev = cur
        mm.close(); f.close()

        rep('D. %s: приказ применён только на тайле' % tag, g_tile, b_tile)
        rep('D. %s: вне тайла приказ сохраняется' % tag, g_keep, b_keep)
        rep('D. %s: +0x4f мёртвого не более +1 за шаг' % tag, g_anim, b_anim)
        rep('D. %s: +0x2c в 0x38 убывает на 1' % tag, g_idle, b_idle)
        rep('D. %s: новый таймер простоя rand(20)+5, +0x50 += 1' % tag, g_new, b_new)
        rep('D. %s: зверь сбрасывает +0x50 при >= 14' % tag, g_rst, b_rst)
        if regen:
            top, cnt = regen.most_common(1)[0]
            rep('D. %s: регенерация +1 HP в одной фазе mod 16 (фаза %d)' % (tag, top),
                cnt, sum(regen.values()) - cnt)
    notes.append('    код приказа -> состояние на следующем шаге: '
                 + ', '.join('0x%02x->0x%02x×%d' % (o, s, c) for (o, s), c in sorted(order2state.items())))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    use_emu = '--no-emu' not in sys.argv
    nsteps = 600
    for a in sys.argv[1:]:
        if a.startswith('--steps='):
            nsteps = int(a.split('=')[1])
    if use_emu:
        check_rng(nsteps)
    if any(a.startswith('--long') for a in sys.argv[1:]):
        ln = 9000
        for a in sys.argv[1:]:
            if a.startswith('--long='):
                ln = int(a.split('=')[1])
        check_long(ln)
    if args:
        check_traces(args)

    print('проверка: совпало / не совпало')
    for name in ok:
        print('  %-62s %8d / %d' % (name, ok[name], bad[name]))
    for n in notes:
        print(n)
    tot_ok, tot_bad = sum(ok.values()), sum(bad.values())
    print('ИТОГО совпало %d, не совпало %d  →  %s'
          % (tot_ok, tot_bad, 'СПЕЦИФИКАЦИЯ ПОДТВЕРЖДЕНА' if tot_bad == 0 else 'ЕСТЬ РАСХОЖДЕНИЯ'))
    return 0 if tot_bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
