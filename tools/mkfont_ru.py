#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Кириллические глифы для шрифта оригинала (FE0816RD, 8x16, 8 бит на пиксель).

Оригинальный шрифт двухцветный: основной штрих — значение 3..4, справа и снизу от него
лежит «тень» значением 1 (цвет пикселя = значение + [0x4700c] − 1, то есть 0xf8..0xfb).
Мы повторяем ту же манеру: берём готовую растровую кириллицу GNU Unifont (она нарисована
ровно под клетку 8x16) и достраиваем тень.

Русский текст рисуется своей кодировкой: коды 0x80..0xff — таблица RU_CHARS ниже. Так
надписи целиком идут одним набором глифов, а латинские шрифты оригинала остаются нетронутыми.

    tools/mkfont_ru.py  →  reimpl/data/font_ru.json
"""
import json, os
from PIL import Image, ImageFont, ImageDraw

UNIFONT = '/usr/share/fonts/opentype/unifont/unifont.otf'
OUT = os.path.join(os.path.dirname(__file__), '..', 'reimpl', 'data', 'font_ru.json')

# Что кладём в коды 0x80..0xff. Кириллица, цифры, знаки — всё, чем набран русский текст.
RU_CHARS = (
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
    '0123456789'
    ' .,:;!?—–-()«»“”"\'/…+*%№'
)
assert len(RU_CHARS) == len(set(RU_CHARS)), 'повторы в таблице символов'
assert len(RU_CHARS) <= 128, f'символов {len(RU_CHARS)}, а кодов только 128'

W, H = 8, 16          # клетка шрифта 1
INK, SHADOW = 4, 1    # значения байт: основной штрих и тень

def bitmap(ch, font):
    """1-битная маска символа в клетке 8x16, поднятая под базовую линию оригинала."""
    img = Image.new('L', (16, 24), 0)
    ImageDraw.Draw(img).text((0, 0), ch, font=font, fill=255)
    px = img.load()
    return [[1 if px[x, y] > 127 else 0 for x in range(16)] for y in range(24)]

def trim(rows):
    ys = [y for y, r in enumerate(rows) if any(r)]
    xs = [x for x in range(len(rows[0])) if any(r[x] for r in rows)]
    if not ys: return [], 0, 0, 0, 0
    return rows, min(ys), max(ys), min(xs), max(xs)

def main():
    font = ImageFont.truetype(UNIFONT, 16)
    # базовая линия оригинала: заглавные стоят на строке 12, строчные тоже, хвосты уходят до 15
    ref = bitmap('H', font)
    _, ry0, ry1, _, _ = trim(ref)
    ry1 = ry1                                  # низ заглавной у Unifont
    shift = 12 - ry1                           # совместить с базовой линией оригинала (строка 12)

    glyphs, widths, codes = [], [], {}
    for i, ch in enumerate(RU_CHARS):
        code = 0x80 + i
        codes[ch] = code
        rows = bitmap(ch, font)
        cell = [[0] * W for _ in range(H)]
        for y in range(24):
            ty = y + shift
            if not (0 <= ty < H): continue
            for x in range(min(W, 16)):
                if rows[y][x]: cell[ty][x] = INK
        # тень: справа и снизу от штриха, по пустым местам
        out = [row[:] for row in cell]
        for y in range(H):
            for x in range(W):
                if cell[y][x] != INK: continue
                for dx, dy in ((1, 0), (0, 1), (1, 1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and cell[ny][nx] == 0 and out[ny][nx] == 0:
                        out[ny][nx] = SHADOW
        ink_x = [x for x in range(W) for y in range(H) if out[y][x]]
        adv = (max(ink_x) + 2) if ink_x else 4          # пробел и знаки — по своей ширине
        if ch == ' ': adv = 5
        widths.append(adv)
        glyphs.append(''.join(''.join(str(v) for v in row) for row in out))

    data = {'_': 'Кириллица для шрифта 1 оригинала. Коды 0x80+i соответствуют chars[i]; '
                 'glyph — 16 строк по 8 цифр (значение байта 0/1/4).',
            'source': 'GNU Unifont 16px + тень в манере оригинала',
            'cell': [W, H], 'first': 0x80, 'chars': RU_CHARS,
            'widths': widths, 'glyphs': glyphs}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f'символов {len(RU_CHARS)}, сдвиг базовой линии {shift}, файл {os.path.abspath(OUT)}')

main()
