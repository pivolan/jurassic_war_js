#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Польские буквы с диакритикой для шрифта оригинала (FE0816RD, 8x16, 8 бит на пиксель).

В отличие от кириллицы, тут почти всё уже есть: латиница в шрифте своя, родная. Не хватает
восемнадцати букв — ą ć ę ł ń ó ś ź ż и заглавных. Поэтому мы не рисуем их заново чужим
шрифтом, а **берём готовый глиф базовой буквы из самого шрифта игры и дорисовываем знак**:
акут, точку, огонэк или перечёркивание. Штрих ставим значением 4, а справа-снизу тень 1 —
ровно так нарисованы глифы оригинала, поэтому дописанные буквы неотличимы от родных.

    tools/mkfont_pl.py  →  reimpl/data/font_pl.json  (нужен снимок движка: там лежит шрифт)
"""
import json, os, zlib

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))
СНИМОК = os.path.join(ЗДЕСЬ, '..', 'reimpl', 'data', 'boot_snap.bin.z')
ВЫХОД = os.path.join(ЗДЕСЬ, '..', 'reimpl', 'data', 'font_pl.json')
DATA_LO = 0x30000
FONTS = 0x46f14
FSTRIDE = 0x1c
W, H = 8, 16
INK, SHADOW = 4, 1

# буква → (базовая буква, знак). Знаки: acute — акут, dot — точка, ogonek — хвостик, stroke — черта.
ПОЛЬСКИЕ = [
    ('ą', 'a', 'ogonek'), ('ć', 'c', 'acute'), ('ę', 'e', 'ogonek'), ('ł', 'l', 'stroke'),
    ('ń', 'n', 'acute'), ('ó', 'o', 'acute'), ('ś', 's', 'acute'), ('ź', 'z', 'acute'),
    ('ż', 'z', 'dot'),
    ('Ą', 'A', 'ogonek'), ('Ć', 'C', 'acute'), ('Ę', 'E', 'ogonek'), ('Ł', 'L', 'stroke'),
    ('Ń', 'N', 'acute'), ('Ó', 'O', 'acute'), ('Ś', 'S', 'acute'), ('Ź', 'Z', 'acute'),
    ('Ż', 'Z', 'dot'),
    # знаки, которых в шрифте нет, а в тексте они нужны: длинное тире и многоточие
    ('„', '"', None), ('”', '"', None), ('—', '-', 'dash'), ('–', '-', 'dash'), ('…', '.', 'ellipsis'),
]


def читать_шрифт():
    сырой = zlib.decompress(open(СНИМОК, 'rb').read())
    mem = bytearray(0x6483c0)
    mem[DATA_LO:DATA_LO + len(сырой)] = сырой
    u16 = lambda a: mem[a] | (mem[a + 1] << 8)
    u32 = lambda a: mem[a] | (mem[a + 1] << 8) | (mem[a + 2] << 16) | (mem[a + 3] << 24)
    e = FONTS + 1 * FSTRIDE
    база = u32(e + 0xc)
    if база >= 0x110000:                      # указатели в снимке сдвинуты на +0x100000
        база -= 0x100000
    гsz, rowb, doff = u32(e + 0x10), u32(e + 0x14), u32(e + 0x18)
    ширины = list(mem[база:база + 256])
    def глиф(c):
        p = база + doff + c * гsz
        return [list(mem[p + y * rowb: p + y * rowb + W]) for y in range(H)]
    return глиф, ширины


def границы(g):
    ys = [y for y in range(H) if any(g[y])]
    xs = [x for x in range(W) if any(g[y][x] for y in range(H))]
    return (min(ys), max(ys), min(xs), max(xs)) if ys and xs else (0, 0, 0, 0)


def тень(g):
    """Достроить тень значением 1 справа и снизу от штриха — манера оригинала."""
    out = [row[:] for row in g]
    for y in range(H):
        for x in range(W):
            if g[y][x] != INK:
                continue
            for dx, dy in ((1, 0), (0, 1), (1, 1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and g[ny][nx] == 0 and out[ny][nx] == 0:
                    out[ny][nx] = SHADOW
    return out


def собрать(g, знак):
    y0, y1, x0, x1 = границы(g)
    out = [row[:] for row in g]
    if знак is None:
        return out
    cx = (x0 + x1) // 2
    if знак == 'acute':                       # косая чёрточка над буквой
        top = max(0, y0 - 3)
        for k in range(3):
            y, x = top + k, cx - 1 + (2 - k)
            if 0 <= y < H and 0 <= x < W:
                out[y][x] = INK
    elif знак == 'dot':                       # точка над буквой
        y = max(0, y0 - 3)
        out[y][cx] = INK
        if y + 1 < H:
            out[y + 1][cx] = INK
    elif знак == 'ogonek':                    # хвостик под буквой справа
        y = min(H - 1, y1 + 1)
        x = min(W - 1, x1 - 1)
        out[y][x] = INK
        if y + 1 < H:
            out[y + 1][max(0, x - 1)] = INK
    elif знак == 'dash':                      # длинное тире: удлиняем чёрточку на всю клетку
        y = (y0 + y1) // 2
        for x in range(0, W - 1):
            out[y][x] = INK
    elif знак == 'ellipsis':                  # многоточие: три точки в ряд
        y = y1
        for x in (0, 2, 4):
            if x < W:
                out[y][x] = INK
    elif знак == 'stroke':                    # перечёркивание l/L наискось
        y = (y0 + y1) // 2
        for x in range(max(0, x0 - 1), min(W, x1 + 2)):
            out[y][x] = INK
    return out


def main():
    глиф, ширины = читать_шрифт()
    chars, widths, glyphs = '', [], []
    for буква, база, знак in ПОЛЬСКИЕ:
        g = глиф(ord(база))
        # оставляем только штрих: тень пересоберём после дорисовки знака
        только_штрих = [[INK if v not in (0, SHADOW) else 0 for v in row] for row in g]
        собранный = тень(собрать(только_штрих, знак))
        chars += буква
        widths.append(ширины[ord(база)])
        glyphs.append(''.join(''.join(str(v) for v in row) for row in собранный))
    data = {'_': 'Польские буквы для шрифта 1 оригинала: базовый глиф игры плюс дорисованный знак. '
                 'Коды 0x80+i соответствуют chars[i]; glyph — 16 строк по 8 цифр (0/1/4).',
            'source': 'глифы самого шрифта FE0816RD + диакритика',
            'cell': [W, H], 'first': 0x80, 'chars': chars, 'widths': widths, 'glyphs': glyphs}
    json.dump(data, open(ВЫХОД, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'букв {len(chars)}, файл {os.path.abspath(ВЫХОД)}')


main()
