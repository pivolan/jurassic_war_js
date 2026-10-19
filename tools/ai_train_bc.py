#!/usr/bin/env python3
"""Behavior cloning: учим сеть повторять скриптового учителя по датасету tools/ai_dataset.mjs (наше).

  python3 tools/ai_train_bc.py <датасет> [--имя bc] [--эпох 8] [--lr 1e-3] [--батч 512] [--вал 8]

Метка — решение учителя. Голова ценности заодно учится на дисконтированную отдачу (γ=0.99):
так у PPO с первого шага есть не случайный критик. Валидация — по последним `--вал` вариациям
каждой сцены (их в обучение не берём); проверочные сцены в датасете отсутствуют вовсе.
Веса → out/ai/weights/<имя>-<дата>.json (+ .md с описанием), лог → out/ai/logs/.
"""
import sys, os
# В tools/ лежит dis.py, который затеняет стандартный модуль dis (его тянет numpy через inspect):
# убираем tools/ из начала пути и добавляем в конец — стандартная библиотека тогда первее.
_tools = os.path.dirname(os.path.abspath(__file__))
sys.path = [p for p in sys.path if os.path.abspath(p or '.') != _tools] + [_tools]
import glob, json, time, argparse, datetime
import numpy as np, torch, torch.nn.functional as F
import ai_net

КОРЕНЬ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
ДЕЙСТВИЯ = ['идти ↑', 'идти ↗', 'идти →', 'идти ↘', 'идти ↓', 'идти ↙', 'идти ←', 'идти ↖',
            'к цели', 'бить ближнего', 'бить слабейшего', 'отойти', 'держать', 'подобрать', 'уснуть', 'стрелять', 'бить цель',
            'бить раненого', 'бить мага', 'защитить своего', 'ничего']


def загрузить_датасет(папка, γ=0.99):
    meta = json.load(open(os.path.join(папка, 'meta.json')))
    П = meta['слоёв'] * meta['окно'] ** 2
    части = sorted(glob.glob(os.path.join(папка, 'part-*.окна.u8')))
    ок, век, уч, дей, нагр, кон, сц, вар, реж, юн, эпи = [], [], [], [], [], [], [], [], [], [], []
    for p in части:
        б = p[:-len('окна.u8')]
        ок.append(np.fromfile(p, np.uint8)); век.append(np.fromfile(б + 'векторы.f32', np.float32))
        уч.append(np.fromfile(б + 'учитель.u8', np.uint8)); дей.append(np.fromfile(б + 'действие.u8', np.uint8))
        нагр.append(np.fromfile(б + 'награда.f32', np.float32)); кон.append(np.fromfile(б + 'конец.u8', np.uint8))
        сц.append(np.fromfile(б + 'сцена.u16', np.uint16)); вар.append(np.fromfile(б + 'вариация.u16', np.uint16))
        реж.append(np.fromfile(б + 'режим.u8', np.uint8))
        юн.append(np.fromfile(б + 'юнит.u16', np.uint16).astype(np.int64) + len(юн) * 100000)
        эпи.append(np.fromfile(б + 'эпизод.u32', np.uint32).astype(np.int64) + len(эпи) * 10000000)
    д = dict(окна=np.concatenate(ок).reshape(-1, meta['слоёв'], meta['окно'], meta['окно']),
             векторы=np.concatenate(век).reshape(-1, meta['вектор']),
             учитель=np.concatenate(уч), действие=np.concatenate(дей), награда=np.concatenate(нагр),
             конец=np.concatenate(кон), сцена=np.concatenate(сц), вариация=np.concatenate(вар), режим=np.concatenate(реж),
             юнит=np.concatenate(юн), эпизод=np.concatenate(эпи))
    # Цепочки: несколько своих бойцов в одном эпизоде пишут записи вперемешку, у каждого — своя
    # цепочка (эпизод, юнит). `следующий[i]` — индекс следующей записи той же цепочки или −1.
    ключ = д['эпизод'] * 4096 + (д['юнит'] % 100000 // 96 % 4096)
    порядок = np.lexsort((np.arange(len(ключ)), ключ))
    следующий = np.full(len(ключ), -1, np.int64)
    for a, b in zip(порядок[:-1], порядок[1:]):
        if ключ[a] == ключ[b]: следующий[a] = b
    д['следующий'] = следующий
    # Дисконтированная отдача — по цепочкам, с конца.
    r = д['награда']; G = np.zeros_like(r)
    for i in порядок[::-1]:
        G[i] = r[i] + (γ * G[следующий[i]] if следующий[i] >= 0 else 0.0)
    д['отдача'] = G.astype(np.float32)
    return meta, д


def обучить(арг):
    папка = os.path.join(КОРЕНЬ, 'out/ai/data', арг.датасет)
    meta, д = загрузить_датасет(папка)
    N = len(д['учитель'])
    # Датасет с арены делится по вариациям сцены; датасет из партий (tools/ai_game_data.mjs)
    # вариаций не знает — там в это поле пишется «племя × место», и отложить надо целые партии,
    # иначе соседние кадры одной партии попадут и в обучение, и в проверку.
    if 'вариаций' in meta:
        вал = д['вариация'] >= (meta['вариаций'] - арг.вал)
    else:
        эп = np.unique(д['эпизод'])
        отлож = set(эп[::max(2, int(round(len(эп) / max(1, арг.вал * 4))))].tolist())
        вал = np.isin(д['эпизод'], list(отлож))
    тр = ~вал
    print(f'записей {N}: обучение {тр.sum()}, валидация {вал.sum()}; сцен {len(set(д["сцена"].tolist()))}')
    torch.manual_seed(арг.seed); np.random.seed(арг.seed)
    torch.set_num_threads(арг.потоков)
    сеть = ai_net.Сеть(арг.к1, арг.к2, арг.скрытый)
    print(f'параметров {сеть.параметров()}')
    опт = torch.optim.Adam(сеть.parameters(), lr=арг.lr, weight_decay=1e-5)
    шагов = арг.эпох * (тр.sum() // арг.батч)
    план = torch.optim.lr_scheduler.CosineAnnealingLR(опт, шагов)
    окна_т = torch.from_numpy(д['окна']); век_т = torch.from_numpy(д['векторы'])
    уч_т = torch.from_numpy(д['учитель'].astype(np.int64)); отд_т = torch.from_numpy(д['отдача'])
    инд_тр = np.nonzero(тр)[0]; инд_вал = np.nonzero(вал)[0]
    # Веса классов: редкие направления иначе тонут в «бить ближнего». Сглаженная обратная частота.
    част = np.bincount(д['учитель'][тр], minlength=ai_net.ДЕЙСТВИЙ).astype(np.float64) + 50
    веса_кл = torch.tensor((част.sum() / част) ** 0.5, dtype=torch.float32); веса_кл /= веса_кл.mean()

    def батч(инд):
        return окна_т[инд].float() / 255, век_т[инд], уч_т[инд], отд_т[инд]

    def оценить(инд):
        сеть.eval(); верно = 0; потеря = 0; по_кл = np.zeros((ai_net.ДЕЙСТВИЙ, 2))
        with torch.no_grad():
            for i in range(0, len(инд), 4096):
                о, в, у, G = батч(инд[i:i + 4096])
                л, _ = сеть(о, в)
                потеря += F.cross_entropy(л, у, reduction='sum').item()
                п = л.argmax(1)
                верно += (п == у).sum().item()
                for a in range(ai_net.ДЕЙСТВИЙ):
                    м = у == a; по_кл[a, 0] += (п[м] == a).sum().item(); по_кл[a, 1] += м.sum().item()
        сеть.train()
        return верно / len(инд), потеря / len(инд), по_кл

    лог = open(os.path.join(КОРЕНЬ, 'out/ai/logs', f'bc-{арг.имя}.log'), 'w')
    def скажи(s):
        print(s); лог.write(s + '\n'); лог.flush()
    t0 = time.time(); шаг = 0
    for эп in range(арг.эпох):
        np.random.shuffle(инд_тр); сум = 0; n = 0
        for i in range(0, len(инд_тр) - арг.батч + 1, арг.батч):
            о, в, у, G = батч(инд_тр[i:i + арг.батч])
            л, v = сеть(о, в)
            потеря = F.cross_entropy(л, у, weight=веса_кл if арг.веса_классов else None) + 0.5 * F.mse_loss(v, G)
            опт.zero_grad(); потеря.backward(); torch.nn.utils.clip_grad_norm_(сеть.parameters(), 1.0); опт.step(); план.step()
            сум += потеря.item(); n += 1; шаг += 1
        тт, тп, _ = оценить(инд_тр[:20000]); вт, вп, по_кл = оценить(инд_вал)
        скажи(f'эпоха {эп + 1}/{арг.эпох}: потеря {сум / n:.3f}; точность обучение {тт:.3f} (CE {тп:.3f}), валидация {вт:.3f} (CE {вп:.3f}); {time.time() - t0:.0f} с')
    вт, вп, по_кл = оценить(инд_вал)
    полнота = {ДЕЙСТВИЯ[a]: (по_кл[a, 0] / по_кл[a, 1] if по_кл[a, 1] else None, int(по_кл[a, 1])) for a in range(ai_net.ДЕЙСТВИЙ)}
    скажи('полнота по действиям (валидация): ' + ', '.join(f'{k} {v[0]:.2f}/{v[1]}' for k, v in полнота.items() if v[0] is not None))

    дата = datetime.datetime.now().strftime('%Y-%m-%d-%H%M')
    имя = f'{арг.имя}-{дата}'
    путь = os.path.join(КОРЕНЬ, 'out/ai/weights', имя + '.json')
    описание = f'behavior cloning на {арг.датасет}: точность на валидации {вт:.3f}'
    ai_net.сохранить(сеть, путь, имя, описание)
    with open(путь[:-5] + '.md', 'w') as f:
        f.write(f'# {имя}\n\nBehavior cloning на скриптовом учителе.\n\n'
                f'- датасет: `out/ai/data/{арг.датасет}` — {N} записей, {meta.get("эпизодов", meta.get("партий", "?"))} эпизодов, {len(set(д["сцена"].tolist()))} сцен/карт, '
                f'{meta["вариаций"]} вариаций, режимы: {", ".join(р["имя"] for р in meta["режимы"])}\n'
                f'- сеть: свёртки {арг.к1}/{арг.к2}, скрытый {арг.скрытый}, параметров {сеть.параметров()}\n'
                f'- обучение: {арг.эпох} эпох, батч {арг.батч}, Adam lr {арг.lr} (косинус), веса классов {"да" if арг.веса_классов else "нет"}, seed {арг.seed}, {time.time() - t0:.0f} с\n'
                f'- валидация (последние {арг.вал} вариаций): точность {вт:.3f}, CE {вп:.3f}\n'
                f'- полнота по действиям: ' + ', '.join(f'{k} {v[0]:.2f} ({v[1]})' for k, v in полнота.items() if v[0] is not None) + '\n'
                f'\nОценка игрой — `node tools/ai_eval.mjs {путь}`.\n')
    скажи(f'веса → {путь}')
    return путь


if __name__ == '__main__':
    п = argparse.ArgumentParser()
    п.add_argument('датасет'); п.add_argument('--имя', default='bc'); п.add_argument('--эпох', type=int, default=8)
    п.add_argument('--lr', type=float, default=1e-3); п.add_argument('--батч', type=int, default=512); п.add_argument('--вал', type=int, default=8)
    п.add_argument('--к1', type=int, default=16); п.add_argument('--к2', type=int, default=32); п.add_argument('--скрытый', type=int, default=128)
    п.add_argument('--seed', type=int, default=1); п.add_argument('--потоков', type=int, default=12)
    п.add_argument('--веса-классов', dest='веса_классов', action='store_true')
    обучить(п.parse_args())
