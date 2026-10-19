#!/usr/bin/env python3
"""Машинные копии таблиц экономики из pwar.img -> reimpl/data/economy_*.json.

Все адреса — в пространстве оригинала (база образа 0x10000, file_offset = addr − 0x10000).
Запуск: python3 tools/spec_dump_economy.py
"""
import os, sys, json, struct

_TOOLS = os.path.dirname(os.path.abspath(__file__))
JW = os.path.dirname(_TOOLS)
IMG = open(os.path.join(JW, 'pwar.img'), 'rb').read()
B = 0x10000
u8  = lambda a: IMG[a - B]
u16 = lambda a: struct.unpack_from('<H', IMG, a - B)[0]
i32 = lambda a: struct.unpack_from('<i', IMG, a - B)[0]
u32 = lambda a: struct.unpack_from('<I', IMG, a - B)[0]


def cstr(a):
    o = a - B
    e = IMG.find(b'\x00', o)
    return IMG[o:e].decode('latin1')


TYPE_NAME = [cstr(u32(0x41c48 + t * 4)) for t in range(40)]
ITEM_NAME = [cstr(u32(0x420b0 + i * 4)) for i in range(31)]
ITEM_NAME[30] = 'Foods'
STAT_OFF = [u32(0x30a9e + t * 4) for t in range(40)]

# --- 1. статы юнитов/зданий: 0x37654, 10 байт на тип
stats = []
for t in range(40):
    a = 0x37654 + STAT_OFF[t]
    stats.append({'type': t, 'name': TYPE_NAME[t], 'hpmax': u8(a), 'mag': u8(a + 1),
                  'mana': u8(a + 2), 'atk': u8(a + 3), 'def': u8(a + 4), 'spd': u8(a + 5),
                  'food': u16(a + 6)})

# --- 2. предметы: 0x30954, 10 байт на id
FLAG_SLOT = {2: 'weapon 0..2', 4: 'shield 3..5', 0x10: 'artifact 9..11'}
items = []
for i in range(31):
    a = 0x30954 + STAT_OFF[i]          # смещения те же (id*10)
    fl = u16(a + 8)
    slot = 'weapon 0..2' if fl & 2 else 'shield 3..5' if fl & 4 else \
           'artifact 9..11' if fl & 0x10 else 'consumable 6..8'
    items.append({'id': i, 'name': ITEM_NAME[i], 'hp': u8(a), 'mag': u8(a + 1), 'mana': u8(a + 2),
                  'atk': u8(a + 3), 'def': u8(a + 4), 'spd': u8(a + 5),
                  'price': u16(a + 6), 'flags': fl, 'slot_group': slot,
                  'tradeable': bool(fl & 8)})

# --- 3. цены/длительности заказов: 0x30eac (u32 еды/шаг) и 0x315ac (u8 шагов), 32 записи на здание
BLD_MENU_COUNT = [u32(0x4273c + k * 8) for k in range(14)]
BLD_MENU_COUNT[0] += 2                  # Sanctuary рисуется как 2 + 13 кнопок (0x26a5d)
BLD_MENU_SPR = [u32(0x42740 + k * 8) for k in range(14)]
SANCT = ['Constructor -> %s' % TYPE_NAME[26 + i] for i in range(14)] + ['Constructor (capture, +0x59=14)']
PRODUCES = {
    26: SANCT,
    27: ['Commoner', 'Muscle-man', 'Warrior'],
    28: [ITEM_NAME[i + 1] for i in range(14)],
    29: [ITEM_NAME[i + 1] for i in range(14)],
    30: ['выдать %d еды' % u32(0x37564 + i * 4) for i in range(4)],
    31: ['Elf'] * 4, 32: ['Wizard'] * 3, 33: ['Warlock'] * 3, 34: ['Ranger'] * 2,
    35: ['Velociraptor'] * 2, 36: ['Carrnotaurous'] * 2, 37: ['Rhamphorhynchus'] * 2,
    38: ['Triceratops'] * 2, 39: ['Diloposaurus'] * 2,
}
BONUS_TAB = {31: (0x375a4, 4), 32: (0x375c4, 3), 33: (0x375dc, 3), 34: (0x375f4, 2),
             35: (0x37604, 2), 36: (0x37614, 2), 37: (0x37624, 2), 38: (0x37634, 2), 39: (0x37644, 2)}
buildings = []
for k in range(14):
    t = k + 26
    n = BLD_MENU_COUNT[k]
    menu = []
    for idx in range(n):
        steps = u8(0x315ac + k * 32 + idx)
        per = u32(0x30eac + (k * 32 + idx) * 4)
        e = {'idx': idx, 'steps': steps, 'food_per_step': per, 'total': steps * per,
             'produces': PRODUCES[t][idx] if idx < len(PRODUCES[t]) else '?'}
        if t in BONUS_TAB and idx < BONUS_TAB[t][1]:
            a = BONUS_TAB[t][0] + idx * 8
            e['bonus'] = {'hp': u8(a), 'mag': u8(a + 1), 'atk_def': u8(a + 2), 'spd': u8(a + 3)}
        menu.append(e)
    nf = u32(0x3176c + k * 8)
    fp = u32(0x31770 + k * 8)
    buildings.append({
        'type': t, 'name': TYPE_NAME[t], 'hpmax': stats[t]['hpmax'],
        'sprite_w': u16(0x303b6 + t * 4), 'sprite_h': u16(0x303b8 + t * 4),
        'footprint_cells': nf,
        'footprint_px': [[i32(fp + j * 8), i32(fp + j * 8 + 4)] for j in range(nf)],
        'menu_count': n, 'menu_first_sprite': BLD_MENU_SPR[k],
        'menu_mask_slot0': u32(0x328a4),
        'menu': menu,
    })

# --- 4. цены арсенала (три разных механизма — см. notes/economy-spec.md §9)
armory = []
for idx in range(14):
    item = idx + 1
    make = u8(0x315ac + 2 * 32 + idx) * u32(0x30eac + (2 * 32 + idx) * 4)
    sell_order = ((u32(0x30eac + (2 * 32 + item) * 4) & 0xff) * u8(0x315ac + 2 * 32 + item)) & 0xffff
    armory.append({'menu_idx': idx, 'item_id': item, 'name': ITEM_NAME[item],
                   'build_cost': make,                       # производство предмета зданием
                   'sell_via_order': sell_order >> 1,        # приказ 0x51+n на арсенал (в еду юнита)
                   'panel_price': items[item]['price']})     # покупка/продажа в панели юнита

out = os.path.join(JW, 'reimpl', 'data')
os.makedirs(out, exist_ok=True)
for name, obj in (('economy_stats', {'addr': '0x37654 (10 байт на тип, индекс через 0x30a9e)', 'rows': stats}),
                  ('economy_items', {'addr': '0x30954 (10 байт на id)',
                                     'fields': '+0 HP, +1 MAG, +2 MANA, +3 ATK, +4 DEF, +5 SPD, +6 цена u16, +8 флаги u16',
                                     'rows': items}),
                  ('economy_buildings', {'addr': 'цена 0x30eac (u32) / шаги 0x315ac (u8), 32 на здание; '
                                                 'меню 0x4273c; футпринт 0x3176c/0x31770',
                                         'rows': buildings}),
                  ('economy_armory', {'note': 'три независимых цены на один предмет', 'rows': armory}),
                  ('economy_withdraw', {'addr': '0x37564', 'rows': [u32(0x37564 + i * 4) for i in range(4)]})):
    with open(os.path.join(out, name + '.json'), 'w') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print('записано', os.path.join(out, name + '.json'))
