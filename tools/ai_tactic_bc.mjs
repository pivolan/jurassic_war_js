// Стартовые веса тактика: клонирование поведения скриптового штаба (наше).
//
//   node tools/ai_tactic_bc.mjs [--карты=100,…] [--племена=0,…] [--секунд=600] [--эпох=20] [--имя=тактик-bc]
//
// Зачем клонировать заведомо простое правило. Эволюция со случайных весов первые десятки
// поколений тратит на то, чтобы вообще перестать делать глупости (уводить армию от дома, идти в
// лоб на вдвое сильнейшего). Дешевле начать с того, что уже как-то играет: пусть сеть сначала
// повторит нынешнее правило штаба («осанка атака → штурм, оборона → к дому, иначе охота»), а
// улучшать его будет отбор на партиях. Ровно так же делали для бойца: BC → PPO.
//
// Данные снимаются прямо в партии: играют два скриптовых штаба, а мы на каждом такте отряда
// записываем наблюдение тактика и то, что штаб в этот момент выбрал. Разметка честная — это
// решение самого правила, а не наша догадка о нём.
//
// Учим на месте, в JS: 638 весов, батч 256, обычный SGD с моментом. Тащить сюда torch не за чем.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const КОРЕНЬ = path.join(path.dirname(ЭТОТ), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));

const Т = await import('../reimpl/js/ai/tactic.js');

if (!isMainThread) {
  const { движок, прогнать, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');

  parentPort.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    const X = [], Y = [];
    for (const t of з.задачи) {
      const eng = движок(); const m = eng.m;
      loadMission(m, eng.files, t.карта, t.племя, 1);
      const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
      const места = [{ цвет: цвета[0], племя: t.племя, кто: 'компьютер' }, { цвет: цвета[1], племя: t.племя, кто: 'компьютер' }];
      if (места.some(мес => мес.цвет === undefined)) continue;
      расставить(eng, места, {});
      const штабы = места.map(мес => { m.w8(0x32aec + мес.цвет, 0); return Скрипт.задать(eng, мес.цвет, { уровень: 3, характер: 'ровный' }); });
      // Наблюдение и метку снимаем сами, на своём такте: лезть внутрь шага не нужно.
      Скрипт.записыватьТактика?.(null);
      прогнать(eng, Math.round(t.секунд * 1000 / ТИК_МС), { наШаге: (e, k) => {
        if (k % з.каждые) return;
        for (const с of штабы) {
          const о = Скрипт.осмотрДляТактика(e, с); if (!о) continue;
          const от = с.отряды.кулак; if (!от.length) continue;
          const вх = Т.наблюдать(e, с, о, от);
          const м = Скрипт.меткаТактика(с, о);
          X.push(Array.from(вх)); Y.push(м);
        }
      } });
    }
    parentPort.postMessage({ X, Y });
  });
}

if (isMainThread) {
  const карты = (арг.карты || '100,101,102,103,105,107,110,112').split(',').map(Number);
  const племена = (арг.племена || '0,1,4,6').split(',').map(Number);
  const секунд = +(арг.секунд || 600), потоков = Ядра.потоков(арг.потоков, 8), каждые = +(арг.каждые || 24);
  const эпох = +(арг.эпох || 25), имя = арг.имя || 'тактик-bc';

  const задачи = [];
  for (const карта of карты) for (const племя of племена) задачи.push({ карта, племя, секунд });
  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  const куски = Array.from({ length: потоков }, (_, k) => задачи.filter((_, i) => i % потоков === k));
  const t0 = Date.now();
  const части = await Promise.all(потоки.map((w, k) => занять(w, { задачи: куски[k], каждые })));
  for (const w of потоки) w.postMessage('стоп');
  const X = части.flatMap(ч => ч.X), Y = части.flatMap(ч => ч.Y);
  console.log(`собрано ${X.length} решений из ${задачи.length} партий за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  const счёт = {};
  for (const y of Y) { const k = `${Т.РОЛИ[y[0]]}/${Т.ЦЕЛИ[y[1]]}/${Т.ВЕСА[y[2]]}`; счёт[k] = (счёт[k] || 0) + 1; }
  console.log('что делает штаб: ' + Object.entries(счёт).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${(n * 100 / Y.length).toFixed(0)}%`).join(', '));

  // ---- обучение: три softmax-головы, общий скрытый слой
  const сеть = Т.случайная(12345);
  const группы = [[0, Т.РОЛИ.length], [Т.РОЛИ.length, Т.РОЛИ.length + Т.ЦЕЛИ.length], [Т.РОЛИ.length + Т.ЦЕЛИ.length, Т.ВЫХОД]];
  const скр = new Float32Array(Т.СКРЫТЫХ), вых = new Float32Array(Т.ВЫХОД);
  const gw1 = new Float32Array(сеть.w1.length), gb1 = new Float32Array(Т.СКРЫТЫХ);
  const gw2 = new Float32Array(сеть.w2.length), gb2 = new Float32Array(Т.ВЫХОД);
  const mw1 = new Float32Array(сеть.w1.length), mb1 = new Float32Array(Т.СКРЫТЫХ);
  const mw2 = new Float32Array(сеть.w2.length), mb2 = new Float32Array(Т.ВЫХОД);
  const lr = +(арг.шаг || 0.05), момент = 0.9, батч = 256;
  let порядок = X.map((_, i) => i);
  let сид = 7; const сл = () => { сид = (сид * 1103515245 + 12345) & 0x7fffffff; return сид / 0x80000000; };

  for (let эпоха = 1; эпоха <= эпох; эпоха++) {
    for (let i = порядок.length - 1; i > 0; i--) { const j = (сл() * (i + 1)) | 0; [порядок[i], порядок[j]] = [порядок[j], порядок[i]]; }
    let потеря = 0, верно = 0, n = 0;
    for (let б = 0; б < порядок.length; б += батч) {
      gw1.fill(0); gb1.fill(0); gw2.fill(0); gb2.fill(0);
      const конец = Math.min(порядок.length, б + батч);
      for (let k = б; k < конец; k++) {
        const idx = порядок[k], вх = X[idx], y = Y[idx];
        Т.вперёд(сеть, вх, скр, вых);
        const дВых = new Float32Array(Т.ВЫХОД);
        группы.forEach(([от, до], гр) => {
          let макс = -Infinity; for (let a = от; a < до; a++) if (вых[a] > макс) макс = вых[a];
          let сум = 0; const p = new Float64Array(до - от);
          for (let a = от; a < до; a++) { p[a - от] = Math.exp(вых[a] - макс); сум += p[a - от]; }
          for (let a = от; a < до; a++) p[a - от] /= сум;
          потеря -= Math.log(Math.max(1e-9, p[y[гр]]));
          let лучш = 0; for (let a = 1; a < до - от; a++) if (p[a] > p[лучш]) лучш = a;
          if (лучш === y[гр]) верно++;
          for (let a = от; a < до; a++) дВых[a] = p[a - от] - (a - от === y[гр] ? 1 : 0);
        });
        n++;
        const дСкр = new Float32Array(Т.СКРЫТЫХ);
        for (let a = 0; a < Т.ВЫХОД; a++) {
          const g = дВых[a]; if (!g) continue; gb2[a] += g; const б2 = a * Т.СКРЫТЫХ;
          for (let j = 0; j < Т.СКРЫТЫХ; j++) { gw2[б2 + j] += g * скр[j]; дСкр[j] += g * сеть.w2[б2 + j]; }
        }
        for (let j = 0; j < Т.СКРЫТЫХ; j++) {
          if (скр[j] <= 0) continue; const g = дСкр[j]; if (!g) continue;
          gb1[j] += g; const б1 = j * Т.ВХОД;
          for (let i2 = 0; i2 < Т.ВХОД; i2++) gw1[б1 + i2] += g * вх[i2];
        }
      }
      const мас = lr / Math.max(1, конец - б);
      for (let i2 = 0; i2 < сеть.w1.length; i2++) { mw1[i2] = момент * mw1[i2] - мас * gw1[i2]; сеть.w1[i2] += mw1[i2]; }
      for (let i2 = 0; i2 < Т.СКРЫТЫХ; i2++) { mb1[i2] = момент * mb1[i2] - мас * gb1[i2]; сеть.b1[i2] += mb1[i2]; }
      for (let i2 = 0; i2 < сеть.w2.length; i2++) { mw2[i2] = момент * mw2[i2] - мас * gw2[i2]; сеть.w2[i2] += mw2[i2]; }
      for (let i2 = 0; i2 < Т.ВЫХОД; i2++) { mb2[i2] = момент * mb2[i2] - мас * gb2[i2]; сеть.b2[i2] += mb2[i2]; }
    }
    console.log(`эпоха ${эпоха}: потеря ${(потеря / Math.max(1, n)).toFixed(4)}, совпадение по головам ${(верно / Math.max(1, n * 3) * 100).toFixed(1)} %`);
  }

  fs.mkdirSync(path.join(КОРЕНЬ, 'out/ai/weights'), { recursive: true });
  const файл = path.join(КОРЕНЬ, 'out/ai/weights', `${имя}.json`);
  fs.writeFileSync(файл, JSON.stringify({ имя, вход: Т.ВХОД, скрытых: Т.СКРЫТЫХ, выход: Т.ВЫХОД, решений: X.length,
    w1: [...сеть.w1], b1: [...сеть.b1], w2: [...сеть.w2], b2: [...сеть.b2] }));
  console.log('веса тактика: ' + файл);
  process.exit(0);
}
