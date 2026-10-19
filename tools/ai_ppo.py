#!/usr/bin/env python3
"""RL поверх behavior cloning: PPO на аренах (наше).

  python3 tools/ai_ppo.py <старт.json> --имя ppo [--итераций 40] [--эпизодов 1600] [--lr 3e-4] ...

Цикл: node tools/ai_rollout.mjs гоняет эпизоды текущими весами (16 потоков, сеть на JS) →
здесь GAE + несколько эпох PPO → веса обратно в JSON → следующая итерация. Каждая итерация
пишет строку в out/ai/logs/ppo-<имя>.log; итоговые веса — out/ai/weights/<имя>-<дата>.json.
Регуляризация к учителю (--kl-учитель): штраф за уход распределения от меток учителя, чтобы
сеть не забыла всё, что умела, пока ищет лучшее; к концу обучения его можно опускать до нуля.
"""
import sys, os
_tools = os.path.dirname(os.path.abspath(__file__))
sys.path = [p for p in sys.path if os.path.abspath(p or '.') != _tools] + [_tools]
import json, time, argparse, datetime, subprocess, shutil
import numpy as np, torch, torch.nn.functional as F
import ai_net
from ai_train_bc import загрузить_датасет, КОРЕНЬ


def gae(r, v, следующий, γ, λ):
    """GAE по цепочкам записей (эпизод, юнит): у каждого бойца своя цепочка, конец — где нет следующей."""
    N = len(r); adv = np.zeros(N, np.float32)
    порядок = sorted(range(N), key=lambda i: -i)   # заглушка порядка, ниже пересчитывается
    # Обходим так, чтобы следующая запись цепочки была уже посчитана: с конца файла достаточно,
    # потому что следующая запись той же цепочки всегда лежит позже в файле.
    for i in range(N - 1, -1, -1):
        n = следующий[i]
        δ = r[i] + (γ * v[n] if n >= 0 else 0.0) - v[i]
        adv[i] = δ + (γ * λ * adv[n] if n >= 0 else 0.0)
    return adv, adv + v


# Потолок нагрузки. Просьба владельца: обучение не должно занимать больше 60% ядер, иначе на
# машине колом встаёт всё остальное. Ограничиваем и потоки torch, и потоки прогона (они гоняют
# node-партии), и заодно уходим в низкий приоритет — тогда любой интерактивный процесс отбирает
# время у нас мгновенно. Переопределить: JW_FREE=4 (оставить свободными четыре ядра),
# JW_THREADS=4 (жёстко столько), JW_NICE=0.
ЯДЕР = os.cpu_count() or 1
СВОБОДНЫХ = max(0, int(os.environ.get('JW_FREE', 1)))
ПОТОЛОК = max(1, ЯДЕР - СВОБОДНЫХ - 1)


def потоков(запрошено):
    """Сколько потоков брать: что попросили, но не выше потолка."""
    if os.environ.get('JW_THREADS'):
        return max(1, int(os.environ['JW_THREADS']))
    if запрошено > ПОТОЛОК:
        print(f'потоков {запрошено} → {ПОТОЛОК} (из {ЯДЕР} ядер {СВОБОДНЫХ} оставляем машине)', flush=True)
        return ПОТОЛОК
    return max(1, запрошено)


def главное(арг):
    арг.потоков = потоков(арг.потоков); арг.потоков_прогона = потоков(арг.потоков_прогона)
    try: os.nice(int(os.environ.get('JW_NICE', 10)))
    except OSError: pass
    torch.manual_seed(арг.seed); np.random.seed(арг.seed); torch.set_num_threads(арг.потоков)
    раб = os.path.join(КОРЕНЬ, 'out/ai/data', 'ppo-' + арг.имя)
    # Живые прогоны: список для стенда мозгов в игре. Владелец: «там ведь каждая итерация
    # где-то сохраняется на диске — можно сразу делать доступной». Веса текущей итерации лежат
    # в <раб>/текущие.json и отдаются сайтом как /jw/ai/data/ppo-<имя>/текущие.json, но имя
    # прогона браузер сам не угадает — поэтому пишем его сюда.
    живые_путь = os.path.join(КОРЕНЬ, 'out/ai/data', 'живые.json')
    try:
        живые = json.load(open(живые_путь)) if os.path.exists(живые_путь) else []
    except Exception:
        живые = []
    живые = [з for з in живые if з.get('имя') != арг.имя]
    живые.append({'имя': арг.имя, 'папка': 'ppo-' + арг.имя, 'начат': datetime.datetime.now().isoformat(timespec='seconds'),
                  'прогон': арг.прогон})
    json.dump(живые, open(живые_путь, 'w'), ensure_ascii=False, indent=1)
    os.makedirs(раб, exist_ok=True); os.makedirs(os.path.join(КОРЕНЬ, 'out/ai/logs'), exist_ok=True)
    текущие = os.path.join(раб, 'текущие.json')
    shutil.copy(арг.старт, текущие)
    сеть = ai_net.загрузить(текущие)
    опт = torch.optim.Adam(сеть.parameters(), lr=арг.lr, eps=1e-5)
    лог = open(os.path.join(КОРЕНЬ, 'out/ai/logs', f'ppo-{арг.имя}.log'), 'a')
    def скажи(s):
        print(s, flush=True); лог.write(s + '\n'); лог.flush()
    скажи(f'# старт {арг.старт}; {vars(арг)}')
    история = []; лучший = (-9, None)
    t0 = time.time()
    for ит in range(1, арг.итераций + 1):
        tr = time.time()
        окр = dict(os.environ)
        if арг.награды:
            окр['AI_ПОДСКАЗКИ'] = арг.награды
        if арг.вес_сцен:
            окр['AI_ВЕС_СЦЕН'] = арг.вес_сцен
        вывод = subprocess.run(['node', os.path.join(КОРЕНЬ, арг.прогон), текущие, раб, str(арг.эпизодов), str(арг.потоков_прогона), str(арг.seed * 100 + ит), str(арг.температура)],
                               capture_output=True, text=True, cwd=КОРЕНЬ, env=окр)
        if вывод.returncode:
            скажи('прогон упал: ' + вывод.stderr[-2000:]); break
        сводка = json.loads(вывод.stdout.strip().splitlines()[-1])
        meta, д = загрузить_датасет(раб, арг.γ)
        N = len(д['награда'])
        части = sorted(f for f in os.listdir(раб) if f.endswith('.logp.f32'))
        logp0 = np.concatenate([np.fromfile(os.path.join(раб, f), np.float32) for f in части])
        v0 = np.concatenate([np.fromfile(os.path.join(раб, f.replace('logp', 'ценность')), np.float32) for f in части])
        adv, отдача = gae(д['награда'], v0, д['следующий'], арг.γ, арг.λ)
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)
        окна = torch.from_numpy(д['окна']); век = torch.from_numpy(д['векторы']); дей = torch.from_numpy(д['действие'].astype(np.int64))
        уч = torch.from_numpy(д['учитель'].astype(np.int64))
        logp0_t = torch.from_numpy(logp0); adv_t = torch.from_numpy(adv); отд_t = torch.from_numpy(отдача.astype(np.float32)); v0_t = torch.from_numpy(v0)
        kl_уч = арг.kl_учитель * max(0.0, 1 - (ит - 1) / max(1, арг.kl_спад)) if арг.kl_спад else арг.kl_учитель
        инд = np.arange(N); клип_доля = 0; kl = 0; энтропия = 0; шагов = 0
        for эп in range(арг.эпох):
            np.random.shuffle(инд)
            for i in range(0, N - арг.батч + 1, арг.батч):
                б = инд[i:i + арг.батч]
                л, v = сеть(окна[б].float() / 255, век[б])
                logp_all = F.log_softmax(л, 1)
                logp = logp_all.gather(1, дей[б, None]).squeeze(1)
                ratio = torch.exp(logp - logp0_t[б])
                a = adv_t[б]
                потеря_п = -torch.min(ratio * a, torch.clamp(ratio, 1 - арг.клип, 1 + арг.клип) * a).mean()
                v_клип = v0_t[б] + torch.clamp(v - v0_t[б], -арг.клип, арг.клип)
                потеря_v = 0.5 * torch.max((v - отд_t[б]) ** 2, (v_клип - отд_t[б]) ** 2).mean()
                энт = -(logp_all.exp() * logp_all).sum(1).mean()
                потеря = потеря_п + арг.vf * потеря_v - арг.энтропия * энт
                if kl_уч > 0:
                    потеря = потеря + kl_уч * F.nll_loss(logp_all, уч[б])
                опт.zero_grad(); потеря.backward(); torch.nn.utils.clip_grad_norm_(сеть.parameters(), 0.5); опт.step()
                with torch.no_grad():
                    клип_доля += ((ratio - 1).abs() > арг.клип).float().mean().item()
                    kl += (logp0_t[б] - logp).mean().item(); энтропия += энт.item(); шагов += 1
        ai_net.сохранить(сеть, текущие, арг.имя, f'ppo итерация {ит}')
        совп = float((д['учитель'] == д['действие']).mean())
        история.append(сводка['итог'])
        # На арене прогон отчитывается по ролям, на партиях (tools/ai_game_rollout.mjs) — по
        # победам и поражениям: ролей там нет, есть исход партии.
        роли = (' '.join(f'{р[:4]} {v:+.2f}' for р, v in sorted(сводка['поРолям'].items())) if 'поРолям' in сводка
                else f"побед {сводка.get('побед', 0)} поражений {сводка.get('поражений', 0)} ничьих {сводка.get('ничьих', 0)}")
        скажи(f'ит {ит:3d}: итог {сводка["итог"]:+.3f} [{роли}] совпадение с учителем {совп:.2f}; '
              f'kl {kl / шагов:.4f} клип {клип_доля / шагов:.2f} энтропия {энтропия / шагов:.2f} kl_уч {kl_уч:.3f}; '
              f'записей {N}, прогон {сводка["секунд"]:.0f} с, обучение {time.time() - tr - сводка["секунд"]:.0f} с, всего {(time.time() - t0) / 60:.1f} мин')
        if сводка['итог'] > лучший[0]:
            лучший = (сводка['итог'], ит); shutil.copy(текущие, os.path.join(раб, 'лучшие.json'))
        if арг.минут and (time.time() - t0) / 60 > арг.минут:
            скажи(f'время вышло ({арг.минут} мин), останавливаюсь'); break
    дата = datetime.datetime.now().strftime('%Y-%m-%d-%H%M')
    имя = f'{арг.имя}-{дата}'
    путь = os.path.join(КОРЕНЬ, 'out/ai/weights', имя + '.json')
    сеть.описание = ''
    w = json.load(open(текущие)); w['имя'] = имя; w['описание'] = f'PPO поверх {os.path.basename(арг.старт)}: {len(история)} итераций, итог на прогонах {история[-1]:+.3f} (старт {история[0]:+.3f})'
    json.dump(w, open(путь, 'w'), ensure_ascii=False, separators=(',', ':'))
    ai_net.оглавление(os.path.dirname(путь))
    with open(путь[:-5] + '.md', 'w') as f:
        f.write(f'# {имя}\n\nPPO на учебных аренах поверх `{os.path.basename(арг.старт)}`.\n\n'
                f'- итераций {len(история)}, по {арг.эпизодов} эпизодов (учебные сцены, вариации < 1000), температура {арг.температура}\n'
                f'- гиперпараметры: lr {арг.lr}, γ {арг.γ}, λ {арг.λ}, клип {арг.клип}, эпох {арг.эпох}, батч {арг.батч}, энтропия {арг.энтропия}, vf {арг.vf}, kl к учителю {арг.kl_учитель} (спад {арг.kl_спад} ит), seed {арг.seed}; подсказки {арг.награды or "по умолчанию"}\n'
                f'- средний итог на прогонах: старт {история[0]:+.3f} → конец {история[-1]:+.3f}, лучший {лучший[0]:+.3f} на итерации {лучший[1]} (out/ai/data/ppo-{арг.имя}/лучшие.json)\n'
                f'- время {(time.time() - t0) / 60:.1f} мин; лог out/ai/logs/ppo-{арг.имя}.log\n'
                f'\nОценка игрой — `node tools/ai_eval.mjs {путь}`.\n')
    скажи(f'веса → {путь}')


if __name__ == '__main__':
    п = argparse.ArgumentParser()
    п.add_argument('старт'); п.add_argument('--имя', default='ppo')
    п.add_argument('--итераций', type=int, default=40); п.add_argument('--эпизодов', type=int, default=1600); п.add_argument('--минут', type=float, default=0)
    п.add_argument('--lr', type=float, default=3e-4); п.add_argument('--γ', type=float, default=0.99); п.add_argument('--λ', type=float, default=0.95)
    п.add_argument('--клип', type=float, default=0.2); п.add_argument('--эпох', type=int, default=3); п.add_argument('--батч', type=int, default=1024)
    п.add_argument('--энтропия', type=float, default=0.005); п.add_argument('--vf', type=float, default=0.5)
    п.add_argument('--kl-учитель', dest='kl_учитель', type=float, default=0.1); п.add_argument('--kl-спад', dest='kl_спад', type=int, default=0)
    п.add_argument('--температура', type=float, default=1.0); п.add_argument('--seed', type=int, default=1); п.add_argument('--потоков', type=int, default=12)
    п.add_argument('--потоков-прогона', dest='потоков_прогона', type=int, default=16)
    # Чем гонять эпизоды: сцены арены или настоящие партии против скриптового штаба
    # (tools/ai_game_rollout.mjs — тот же формат и тот же порядок доводов).
    п.add_argument('--прогон', default='tools/ai_rollout.mjs')
    п.add_argument('--вес-сцен', dest='вес_сцен', default='', help='JSON {имя сцены: вес} — чаще брать сцену в прогон')
    п.add_argument('--награды', default='', help='JSON с переопределением весов подсказок (js/ai/reward.js ПОДСКАЗКИ), напр. \'{"шаг":-0.002}\'')
    главное(п.parse_args())
