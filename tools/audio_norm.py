#!/usr/bin/env python3
"""Громкость озвучки под стандарт YouTube (наше).

  python3 tools/audio_norm.py out/audio/story/ru out/audio/jw_lore.mp3 [--уровень -14] [--проба]

Зачем. Озвучка рассказов генерировалась под вещательный уровень −23 LUFS (tools/tts_story.py), а
музыка в игре идёт на −16, и на телефоне голос звучал заметно тише всего остального. Приводим к
тому же уровню, к которому YouTube приводит любое загруженное видео: −14 LUFS при истинном пике
−1 dBTP.

Как. Два прохода `loudnorm`: сначала замер всей дорожки, потом приведение по замеру. Один проход
промахивается на пару децибел — фильтр в потоке не знает дорожку заранее. Перед нормализацией
лёгкая речевая компрессия: у синтеза большой запас по пикам, и без неё loudnorm упирается в
истинный пик задолго до нужной громкости. Та же цепочка, что в tools/say.py, — специально, чтобы
вся наша озвучка звучала одинаково.

Файлы правятся на месте; рядом с каждым кладётся `.bak` (снять флагом `--без-копии`).
"""
import argparse
import json
import os
import subprocess
import sys

# Тот же набор, что в tools/say.py: уровень YouTube и предварительная речевая компрессия.
ПИК, LRA = -1.0, 11.0
СЖАТИЕ = 'acompressor=threshold=-18dB:ratio=3:attack=5:release=120:makeup=2'
РАСШИРЕНИЯ = ('.mp3', '.m4a', '.ogg', '.opus', '.wav')


def замер(файл, уровень):
    цепь = f'{СЖАТИЕ},loudnorm=I={уровень}:TP={ПИК}:LRA={LRA}:print_format=json'
    p = subprocess.run(['ffmpeg', '-hide_banner', '-i', файл, '-af', цепь, '-f', 'null', '-'],
                       capture_output=True, text=True)
    i = p.stderr.rfind('{')
    if i < 0:
        raise RuntimeError('ffmpeg не отдал замер: ' + p.stderr[-200:])
    return json.loads(p.stderr[i:p.stderr.rfind('}') + 1])


def нормализовать(файл, уровень, копия=True):
    з = замер(файл, уровень)
    было = float(з['input_i'])
    цепь = (f"{СЖАТИЕ},loudnorm=I={уровень}:TP={ПИК}:LRA={LRA}"
            f":measured_I={з['input_i']}:measured_TP={з['input_tp']}"
            f":measured_LRA={з['input_lra']}:measured_thresh={з['input_thresh']}"
            f":offset={з['target_offset']}:linear=true:print_format=summary")
    корень, расш = os.path.splitext(файл)
    врем = корень + '.norm' + расш
    # Битрейт и частоту не поднимаем: исходники речи — 128k/44.1k, пересжимать выше смысла нет.
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', файл, '-af', цепь,
                    '-ar', '44100', '-b:a', '128k', врем], check=True)
    if копия and not os.path.exists(файл + '.bak'):
        os.replace(файл, файл + '.bak')
    os.replace(врем, файл)
    return было


def уровень_файла(файл):
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', файл,
                        '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
                       capture_output=True, text=True)
    for строка in reversed(p.stderr.splitlines()):
        if строка.strip().startswith('I:'):
            return float(строка.split()[1])
    return float('nan')


def собрать(пути):
    файлы = []
    for п in пути:
        if os.path.isdir(п):
            for корень, _, имена in os.walk(п):
                for и in sorted(имена):
                    if и.lower().endswith(РАСШИРЕНИЯ) and not и.endswith('.bak'):
                        файлы.append(os.path.join(корень, и))
        elif os.path.isfile(п):
            файлы.append(п)
    return файлы


def main():
    р = argparse.ArgumentParser()
    р.add_argument('пути', nargs='+')
    р.add_argument('--уровень', type=float, default=-14.0, help='целевая громкость, LUFS (по умолчанию уровень YouTube)')
    р.add_argument('--проба', action='store_true', help='только замерить, ничего не менять')
    р.add_argument('--без-копии', action='store_true')
    арг = р.parse_args()

    файлы = собрать(арг.пути)
    if not файлы:
        print('нечего обрабатывать'); return 1
    print(f'файлов: {len(файлы)}, цель {арг.уровень} LUFS, пик {ПИК} dBTP')
    сумма_до = сумма_после = 0.0
    for k, ф in enumerate(файлы, 1):
        if арг.проба:
            u = уровень_файла(ф); сумма_до += u
            print(f'  {k:3}/{len(файлы)}  {u:7.1f} LUFS  {os.path.relpath(ф)}')
            continue
        было = нормализовать(ф, арг.уровень, копия=not арг.без_копии)
        стало = уровень_файла(ф)
        сумма_до += было; сумма_после += стало
        if k % 20 == 0 or k == len(файлы):
            print(f'  {k:3}/{len(файлы)}  {было:6.1f} → {стало:6.1f} LUFS  {os.path.relpath(ф)}')
    n = len(файлы)
    if арг.проба:
        print(f'среднее {сумма_до / n:.1f} LUFS')
    else:
        print(f'среднее было {сумма_до / n:.1f} LUFS, стало {сумма_после / n:.1f} LUFS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
