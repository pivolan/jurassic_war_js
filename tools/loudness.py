#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Одинаковая громкость у всей озвучки.

    tools/loudness.py en ru pl          # привести к эталону
    tools/loudness.py out/audio/jw_lore.mp3    # можно и отдельным файлом или каталогом
    tools/loudness.py --target -23 ru   # свой уровень
    tools/loudness.py --show en ru pl   # только замерить, ничего не трогая

Зачем. Английские дорожки пишет ElevenLabs, русские и польские — Gemini, и на слух английские
звучат заметно плотнее. По приборам разницы почти нет (интегральная громкость -23 LUFS против
-22, средний уровень у русских даже выше), значит дело не в усилении, а в подаче: Gemini читает
мягко и дышаще, отдаёт 24 кГц (выше 12 кГц ничего нет), а ElevenLabs — 44.1 кГц с плотной
компрессией. Поэтому русским и польским мы, кроме нормализации, добавляем лёгкую компрессию и
подъём присутствия: тогда при одинаковом уровне они и на слух равны английским.

Оригиналы перед первой правкой складываются в out/audio/story/raw/<язык>/ — вернуть можно всегда.
"""
import argparse, json, os, re, shutil, subprocess, sys

КОРЕНЬ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', 'audio', 'story')
ЭТАЛОН = -23.0          # интегральная громкость английских дорожек, LUFS
ПИК = -3.0              # их же истинный пик, dBTP
LRA = 9.0
# Что добавляем «мягким» дорожкам Gemini, чтобы они звучали так же плотно, как английские.
ПЛОТНЕЕ = 'acompressor=threshold=-26dB:ratio=3:attack=15:release=250,highshelf=f=3200:g=3'


def замер(файл, цель, пик, плотнее=False):
    """Замер обязательно с той же цепочкой, что пойдёт в дело: компрессор меняет уровень, и
    если мерить до него, а нормализовать после, файл выйдет тише ровно на работу компрессора."""
    цепь = (ПЛОТНЕЕ + ',' if плотнее else '') + f'loudnorm=I={цель}:TP={пик}:LRA={LRA}:print_format=json'
    p = subprocess.run(['ffmpeg', '-hide_banner', '-i', файл, '-af', цепь, '-f', 'null', '-'],
                       capture_output=True, text=True)
    s = p.stderr
    i = s.rfind('{')
    if i < 0:
        raise RuntimeError('ffmpeg не отдал замер: ' + s[-200:])
    return json.loads(s[i:s.rfind('}') + 1])


def битрейт(файл):
    v = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=bit_rate', '-of', 'csv=p=0', файл],
                       capture_output=True, text=True).stdout.strip()
    return max(80_000, min(160_000, int(v or 96_000)))


def обработать(файл, цель, пик, плотнее, сухой):
    if сухой:
        было = float(замер(файл, цель, пик)['input_i'])
        return было, было
    # Источник правды — исходник в raw/: так повторный запуск не накручивает обработку поверх обработки.
    сырой = os.path.join(os.path.dirname(файл), '..', 'raw', os.path.basename(os.path.dirname(файл)))
    os.makedirs(сырой, exist_ok=True)
    копия = os.path.join(сырой, os.path.basename(файл))
    if not os.path.exists(копия):
        shutil.copy2(файл, копия)
    м = замер(копия, цель, пик, плотнее)
    было = float(замер(копия, цель, пик)['input_i'])
    цепь = (ПЛОТНЕЕ + ',' if плотнее else '') + (
        f"loudnorm=I={цель}:TP={пик}:LRA={LRA}:measured_I={м['input_i']}:measured_TP={м['input_tp']}:"
        f"measured_LRA={м['input_lra']}:measured_thresh={м['input_thresh']}:offset={м['target_offset']}:linear=true")
    врем = файл + '.tmp.mp3'
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', копия, '-af', цепь,
                    '-ar', '44100', '-b:a', str(битрейт(файл)), врем], check=True)
    os.replace(врем, файл)
    стало = float(замер(файл, цель, пик)['input_i'])
    return было, стало


def main():
    p = argparse.ArgumentParser()
    p.add_argument('языки', nargs='+')
    p.add_argument('--target', type=float, default=ЭТАЛОН)
    p.add_argument('--tp', type=float, default=ПИК)
    p.add_argument('--show', action='store_true', help='только замерить')
    a = p.parse_args()
    for язык in a.языки:
        # Аргумент — либо язык озвучки (каталог out/audio/story/<язык>), либо путь к файлу/каталогу.
        if os.path.isfile(язык):
            каталог, файлы = os.path.dirname(язык) or '.', [os.path.basename(язык)]
        elif os.path.isdir(язык):
            каталог, файлы = язык, sorted(f for f in os.listdir(язык) if f.endswith('.mp3'))
        else:
            каталог = os.path.join(КОРЕНЬ, язык)
            файлы = sorted(f for f in os.listdir(каталог) if f.endswith('.mp3'))
        плотнее = язык != 'en'                       # английские и так плотные
        было, стало = [], []
        for k, имя in enumerate(файлы, 1):
            b, s = обработать(os.path.join(каталог, имя), a.target, a.tp, плотнее, a.show)
            было.append(b); стало.append(s)
            if k % 20 == 0 or k == len(файлы):
                print(f'  {язык}: {k}/{len(файлы)}', flush=True)
        сред = lambda v: sorted(v)[len(v) // 2]
        print(f'{язык}: {len(файлы)} файлов, было {сред(было):+.1f} LUFS (разброс {min(было):+.1f}…{max(было):+.1f}), '
              f'стало {сред(стало):+.1f} (разброс {min(стало):+.1f}…{max(стало):+.1f})', flush=True)


main()
