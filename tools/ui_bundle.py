#!/usr/bin/env python3
"""Компактный набор экранов оболочки: те записи пака 02, что нужны до старта миссии.

Полный `_PWAR02.TRS` — 9 МБ (3.6 МБ по сети), и до недавнего времени страница ждала его целиком,
прежде чем показать меню. Здесь собирается валидный TRS с тем же оглавлением на 716 записей, но
данные лежат только у нужных: колесо главного меню, экран сложности и базовый экран выбора клана.
Подсветка клана (записи 164..171 — те же 640x480 целиком, 1.2 МБ по сети) заменена вырезками
медальонов: их прямоугольники лежат в reimpl/data/ui_screens.json, вырезки добавляются записями
716..723 (716 + индекс племени).

Итог: ~250 КБ по сети вместо 3.6 МБ. Полный пак догружается позже, вместе с картами.

Запуск: python3 tools/ui_bundle.py
"""
import hashlib, json, struct, pathlib, gzip

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'PWAR' / '_PWAR02.TRS'
CAT = json.loads((ROOT / 'reimpl' / 'data' / 'ui_screens.json').read_text())
OUT = ROOT / 'out' / 'ui' / '_UI_BOOT.TRS'

KEEP = (list(range(0, 19))                              # анимация фона титульного экрана
        + list(range(19, 33))                           # колесо главного меню
        + list(range(154, 164)))                        # экран сложности и база выбора клана
PATCH_BASE = 716                                        # вырезки медальонов: 716 + племя


def load_trs(path):
    d = path.read_bytes()
    n, base = struct.unpack_from('<II', d, 8)
    ents = []
    for i in range(n):
        o = 0x20 + i * 16
        off, w, h = struct.unpack_from('<IHH', d, o)
        nxt = struct.unpack_from('<I', d, o + 16)[0] if i + 1 < n else len(d) - base
        ents.append({'w': w, 'h': h, 'data': d[base + off: base + nxt]})
    return ents


def main():
    ents = load_trs(SRC)
    ts = CAT['screens']['tribe_select']
    hi = ts['highlight_screens']                        # «племя» -> запись 164..171

    out = [{'w': 0, 'h': 0, 'data': b''} for _ in range(PATCH_BASE + 8)]
    for i in KEEP:
        out[i] = ents[i]

    # Вырезки: берём из подсвеченного экрана прямоугольник медальона (его же координаты — в каталоге)
    patches = {}
    for z in ts['hotspots']:
        if 'tribe' not in z:
            continue
        tribe = z['tribe']; src = ents[int(hi[str(tribe)])]['data']
        x, y, w, h = z['x'], z['y'], z['w'], z['h']
        px = b''.join(src[(y + r) * 640 + x: (y + r) * 640 + x + w] for r in range(h))
        out[PATCH_BASE + tribe] = {'w': w, 'h': h, 'data': px}
        patches[str(tribe)] = {'entry': PATCH_BASE + tribe, 'x': x, 'y': y, 'w': w, 'h': h}

    n = len(out)
    base = 0x20 + n * 16
    # Оглавление начинается с 0x20, поэтому заголовок дополняем нулями до 32 байт:
    # без этого всё съезжает ровно на одну запись.
    head = (b'TRS\x1a' + struct.pack('<III', n, n, base)).ljust(0x20, b'\x00')
    table, blob, off = b'', b'', 0
    for e in out:
        table += struct.pack('<IHHhhhh', off, e['w'], e['h'], 0, 0, 0, 0)
        blob += e['data']; off += len(e['data'])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(head + table + blob)
    (OUT.parent / (OUT.name + '.gz')).write_bytes(gzip.compress(OUT.read_bytes(), 9))
    ver = hashlib.md5(OUT.read_bytes()).hexdigest()[:8]

    # Координаты вырезок — рядом, чтобы оболочка знала, куда их класть
    (ROOT / 'reimpl' / 'data' / 'ui_boot.json').write_text(json.dumps({
        '_': 'Набор _UI_BOOT.TRS: записи те же, что в паке 02; 716+племя — вырезка подсвеченного '
             'медальона для экрана выбора клана (её позиция на экране — в x/y).',
        'file': '_UI_BOOT.TRS', 'url': f'_UI_BOOT.TRS?v={ver}', 'bytes': OUT.stat().st_size,
        'entries': KEEP, 'tribe_patch': patches,
    }, ensure_ascii=False, indent=1))

    print(f'{OUT}: {OUT.stat().st_size // 1024} КБ, gzip {(OUT.parent / (OUT.name + ".gz")).stat().st_size // 1024} КБ, '
          f'записей с данными {sum(1 for e in out if e["data"])}')


if __name__ == '__main__':
    main()
