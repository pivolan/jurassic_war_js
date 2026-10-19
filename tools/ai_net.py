"""Сеть одного юнита в torch и выгрузка её весов в JSON для js/ai/net.js (наше).

Архитектура должна совпадать с net.js один в один — проверяется tools/ai_netcheck.mjs.
"""
import json, os, datetime
import torch, torch.nn as nn, torch.nn.functional as F

# Размеры сети берём из JS, а не переписываем числами: они уже разъезжались один раз, когда у
# бойца появилось действие «бить дом» (действий стало 22, а вектор вырос до 67 — в него входит
# one-hot прошлого действия). Питон тогда молча ждал прежнюю форму и падал на загрузке весов.
def _размеры():
    import json, subprocess, os
    корень = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    код = ("import('" + корень + "/reimpl/js/ai/obs.js').then(async o => {"
           "const a = await import('" + корень + "/reimpl/js/ai/act.js');"
           "console.log(JSON.stringify([o.ОКНО, o.СЛОЁВ, o.ВЕКТОР, a.ЧИСЛО_ДЕЙСТВИЙ])); })")
    из = subprocess.run(['node', '-e', код], capture_output=True, text=True, timeout=60)
    if из.returncode != 0: raise RuntimeError('не удалось прочитать размеры сети из JS: ' + из.stderr.strip())
    return json.loads(из.stdout.strip().splitlines()[-1])

ОКНО, СЛОЁВ, ВЕКТОР, ДЕЙСТВИЙ = _размеры()


# Сеть ОТРЯДА: одна на всех, с головой на каждого бойца. Размеры обязаны совпадать с
# reimpl/js/ai/отряд.js — там же и описан замысел.
ОТРЯД_ОКНО, ОТРЯД_СЛОЁВ, ОТРЯД_ВЕКТОР, ОТРЯД_МЕСТ = 24, 6, 48, 4


class Отряд(nn.Module):
    """Одна сеть управляет всем отрядом: вход — вся сцена, выход — действие каждому бойцу.

    Владелец: «нейронка должна на выходе отдавать команду для четырёх этих юнитов… не четыре
    отдельных, а одна, но которая сразу всем управляет». Голов столько, сколько мест: голова k
    всегда отвечает за место k, поэтому порядок мест в эпизоде менять нельзя.
    """

    def __init__(self, к1=24, к2=48, к3=64, с=256, с2=192, мест=ОТРЯД_МЕСТ, действий=ДЕЙСТВИЙ):
        super().__init__()
        self.мест, self.действий = мест, действий
        self.c1 = nn.Conv2d(ОТРЯД_СЛОЁВ, к1, 3, padding=1)
        self.c2 = nn.Conv2d(к1, к2, 3, padding=1)
        self.c3 = nn.Conv2d(к2, к3, 3, padding=1)
        self.f1 = nn.Linear(к3 * 2 + ОТРЯД_ВЕКТОР, с)
        self.f2 = nn.Linear(с, с2)
        self.p = nn.Linear(с2, мест * действий)
        self.v = nn.Linear(с2, 1)

    def forward(self, окно, вектор):
        x = F.max_pool2d(F.relu(self.c1(окно)), 2)
        x = F.max_pool2d(F.relu(self.c2(x)), 2)
        x = F.relu(self.c3(x))
        сжат = torch.cat([x.amax(dim=(2, 3)), x.mean(dim=(2, 3))], 1)
        h = F.relu(self.f1(torch.cat([сжат, вектор], 1)))
        h = F.relu(self.f2(h))
        # [B, мест, действий] — по голове на место
        return self.p(h).view(-1, self.мест, self.действий), self.v(h).squeeze(1)

    def параметров(self):
        return sum(p.numel() for p in self.parameters())


def отряд_в_json(сеть, имя, описание=''):
    т = lambda p: [round(float(x), 6) for x in p.detach().flatten().tolist()]
    return {
        'имя': имя, 'описание': описание, 'дата': datetime.datetime.now().isoformat(timespec='seconds'),
        'вид': 'отряд', 'окно': ОТРЯД_ОКНО, 'слоёв': ОТРЯД_СЛОЁВ, 'вектор': ОТРЯД_ВЕКТОР,
        'мест': сеть.мест, 'действий': сеть.действий,
        'слои': {
            'c1w': т(сеть.c1.weight), 'c1b': т(сеть.c1.bias), 'c2w': т(сеть.c2.weight), 'c2b': т(сеть.c2.bias),
            'c3w': т(сеть.c3.weight), 'c3b': т(сеть.c3.bias),
            'f1w': т(сеть.f1.weight), 'f1b': т(сеть.f1.bias), 'f2w': т(сеть.f2.weight), 'f2b': т(сеть.f2.bias),
            'pw': т(сеть.p.weight), 'pb': т(сеть.p.bias), 'vw': т(сеть.v.weight), 'vb': т(сеть.v.bias),
        },
    }


def отряд_сохранить(сеть, путь, имя, описание=''):
    with open(путь, 'w') as f:
        json.dump(отряд_в_json(сеть, имя, описание), f, ensure_ascii=False, separators=(',', ':'))


def отряд_загрузить(путь):
    with open(путь) as f:
        w = json.load(f)
    if w.get('вид') != 'отряд':
        raise ValueError('это не веса отряда: ' + str(w.get('вид')))
    с = w['слои']
    сеть = Отряд(len(с['c1b']), len(с['c2b']), len(с['c3b']), len(с['f1b']), len(с['f2b']), w['мест'], w['действий'])
    сл = dict(сеть.named_parameters())
    for имя, поле in [('c1w', 'c1.weight'), ('c1b', 'c1.bias'), ('c2w', 'c2.weight'), ('c2b', 'c2.bias'),
                      ('c3w', 'c3.weight'), ('c3b', 'c3.bias'), ('f1w', 'f1.weight'), ('f1b', 'f1.bias'),
                      ('f2w', 'f2.weight'), ('f2b', 'f2.bias'), ('pw', 'p.weight'), ('pb', 'p.bias'),
                      ('vw', 'v.weight'), ('vb', 'v.bias')]:
        with torch.no_grad():
            сл[поле].copy_(torch.tensor(с[имя], dtype=torch.float32).view_as(сл[поле]))
    return сеть


class Глубокая(nn.Module):
    """Сеть бойца побольше: три свёртки и две полносвязные, с раздельными головами.

    Просьба владельца: «дай нейронке интереснее структуру, чтобы она умнее была». Прежняя форма
    (две свёртки и один слой на 128) упиралась в потолок скриптового учителя и копировала его
    решение в решение. Здесь: 11→24→48→64 по каналам, затем СЖАТИЕ по каналам — максимум и
    среднее сразу, — и уже это идёт в 256→128. Сжатие вместо развёртки всей карты 64×4×4
    уменьшает вход полносвязного втрое при большем числе каналов: «что есть в окне» дают каналы,
    а «где именно» и так закодировано свёртками.

    Форма ДОЛЖНА совпадать байт в байт с прямым проходом в reimpl/js/ai/net.js (ветка «глубокая»).
    """

    def __init__(self, к1=24, к2=48, к3=64, с=256, с2=128):
        super().__init__()
        self.c1 = nn.Conv2d(СЛОЁВ, к1, 3, padding=1)
        self.c2 = nn.Conv2d(к1, к2, 3, padding=1)
        self.c3 = nn.Conv2d(к2, к3, 3, padding=1)
        self.f1 = nn.Linear(к3 * 2 + ВЕКТОР, с)
        self.f2 = nn.Linear(с, с2)
        self.p = nn.Linear(с2, ДЕЙСТВИЙ)
        self.v = nn.Linear(с2, 1)

    def forward(self, окно, вектор):
        x = F.max_pool2d(F.relu(self.c1(окно)), 2)
        x = F.max_pool2d(F.relu(self.c2(x)), 2)
        x = F.relu(self.c3(x))
        сжат = torch.cat([x.amax(dim=(2, 3)), x.mean(dim=(2, 3))], 1)
        h = F.relu(self.f1(torch.cat([сжат, вектор], 1)))
        h = F.relu(self.f2(h))
        return self.p(h), self.v(h).squeeze(1)

    def параметров(self):
        return sum(p.numel() for p in self.parameters())


class Сеть(nn.Module):
    def __init__(self, к1=16, к2=32, с=128):
        super().__init__()
        self.c1 = nn.Conv2d(СЛОЁВ, к1, 3, padding=1)
        self.c2 = nn.Conv2d(к1, к2, 3, padding=1)
        self.f1 = nn.Linear(к2 * (ОКНО // 4) ** 2 + ВЕКТОР, с)
        self.p = nn.Linear(с, ДЕЙСТВИЙ)
        self.v = nn.Linear(с, 1)

    def forward(self, окно, вектор):
        x = F.max_pool2d(F.relu(self.c1(окно)), 2)
        x = F.max_pool2d(F.relu(self.c2(x)), 2)
        h = F.relu(self.f1(torch.cat([x.flatten(1), вектор], 1)))
        return self.p(h), self.v(h).squeeze(1)

    def параметров(self):
        return sum(p.numel() for p in self.parameters())


def в_json(сеть, имя, описание=''):
    т = lambda p: [round(float(x), 6) for x in p.detach().flatten().tolist()]
    слои = {
        'c1w': т(сеть.c1.weight), 'c1b': т(сеть.c1.bias), 'c2w': т(сеть.c2.weight), 'c2b': т(сеть.c2.bias),
        'f1w': т(сеть.f1.weight), 'f1b': т(сеть.f1.bias), 'pw': т(сеть.p.weight), 'pb': т(сеть.p.bias),
        'vw': т(сеть.v.weight), 'vb': т(сеть.v.bias),
    }
    # Третья свёртка и второй полносвязный — признак глубокой формы; по ним её и узнаёт
    # reimpl/js/ai/net.js. Старые веса без них грузятся прежней веткой.
    if hasattr(сеть, 'c3'):
        слои['c3w'] = т(сеть.c3.weight); слои['c3b'] = т(сеть.c3.bias)
        слои['f2w'] = т(сеть.f2.weight); слои['f2b'] = т(сеть.f2.bias)
    return {
        'имя': имя, 'описание': описание, 'дата': datetime.datetime.now().isoformat(timespec='seconds'),
        'окно': ОКНО, 'слоёв': СЛОЁВ, 'вектор': ВЕКТОР, 'действий': ДЕЙСТВИЙ,
        'вид': 'глубокая' if hasattr(сеть, 'c3') else 'простая',
        'слои': слои,
    }


def сохранить(сеть, путь, имя, описание=''):
    with open(путь, 'w') as f:
        json.dump(в_json(сеть, имя, описание), f, ensure_ascii=False, separators=(',', ':'))
    if os.path.basename(os.path.dirname(os.path.abspath(путь))) == 'weights':
        оглавление(os.path.dirname(os.path.abspath(путь)))


def оглавление(папка):
    """index.json со списком весов — его читает стенд web/arena.html (через ссылку /jw/ai/weights/)."""
    список = []
    for f in sorted(os.listdir(папка)):
        if not f.endswith('.json') or f == 'index.json':
            continue
        try:
            with open(os.path.join(папка, f)) as h:
                w = json.load(h)
            список.append({'файл': f, 'имя': w.get('имя', f[:-5]), 'описание': w.get('описание', ''), 'дата': w.get('дата', ''),
                           'вектор': w.get('вектор'), 'действий': w.get('действий')})
        except Exception as e:
            print('оглавление: пропускаю', f, e)
    with open(os.path.join(папка, 'index.json'), 'w') as h:
        json.dump(список, h, ensure_ascii=False, indent=1)
    return список


def перенести(старый_путь, карта_вектора, карта_действий, карта_слоёв=None):
    """Веса старой формы в новую: столбцы вектора и строки действий переставляются по картам
    (индекс в новой сети → индекс в старой или None). Новые входы получают нулевые веса, новое
    действие — нулевые веса и смещение −2 (редко, пока не выучится). Так PPO стартует не с нуля,
    когда наблюдение или набор действий подросли."""
    with open(старый_путь) as f:
        w = json.load(f)
    с = w['слои']; к1, к2, ск = len(с['c1b']), len(с['c2b']), len(с['f1b'])
    сеть = Сеть(к1, к2, ск)
    окно = к2 * (ОКНО // 4) ** 2
    ст_вектор = w['вектор']; ст_д = w['действий']
    f1 = torch.tensor(с['f1w']).view(ск, окно + ст_вектор)
    pw = torch.tensor(с['pw']).view(ст_д, ск); pb = torch.tensor(с['pb'])
    with torch.no_grad():
        for имя, p in [('c1b', сеть.c1.bias), ('c2w', сеть.c2.weight), ('c2b', сеть.c2.bias),
                       ('f1b', сеть.f1.bias), ('vw', сеть.v.weight), ('vb', сеть.v.bias)]:
            p.copy_(torch.tensor(с[имя], dtype=torch.float32).view_as(p))
        c1 = torch.tensor(с['c1w']).view(к1, w['слоёв'], 3, 3)
        сеть.c1.weight.zero_()
        for нов, ст in enumerate(карта_слоёв or list(range(w['слоёв']))):
            if ст is not None: сеть.c1.weight[:, нов] = c1[:, ст]
        сеть.f1.weight.zero_(); сеть.f1.weight[:, :окно] = f1[:, :окно]
        for нов, ст in enumerate(карта_вектора):
            if ст is not None: сеть.f1.weight[:, окно + нов] = f1[:, окно + ст]
        сеть.p.weight.zero_(); сеть.p.bias.fill_(-2.0)
        for нов, ст in enumerate(карта_действий):
            if ст is not None: сеть.p.weight[нов] = pw[ст]; сеть.p.bias[нов] = pb[ст]
    return сеть


def загрузить(путь):
    with open(путь) as f:
        w = json.load(f)
    с = w['слои']
    поля = [('c1w', 'c1.weight'), ('c1b', 'c1.bias'), ('c2w', 'c2.weight'), ('c2b', 'c2.bias'),
            ('f1w', 'f1.weight'), ('f1b', 'f1.bias'), ('pw', 'p.weight'), ('pb', 'p.bias'),
            ('vw', 'v.weight'), ('vb', 'v.bias')]
    if 'c3w' in с:                      # глубокая форма: три свёртки и две полносвязные
        сеть = Глубокая(len(с['c1b']), len(с['c2b']), len(с['c3b']), len(с['f1b']), len(с['f2b']))
        поля += [('c3w', 'c3.weight'), ('c3b', 'c3.bias'), ('f2w', 'f2.weight'), ('f2b', 'f2.bias')]
    else:
        сеть = Сеть(len(с['c1b']), len(с['c2b']), len(с['f1b']))
    сл = dict(сеть.named_parameters())
    with torch.no_grad():
        for имя, поле in поля:
            сл[поле].copy_(torch.tensor(с[имя], dtype=torch.float32).view_as(сл[поле]))
    return сеть


def новая_глубокая(путь, имя='глубокая'):
    """Свежая глубокая сеть со случайными весами — с неё начинается обучение новой формы."""
    сеть = Глубокая()
    сохранить(сеть, путь, имя, f'новая глубокая сеть, параметров {сеть.параметров()}')
    return сеть
