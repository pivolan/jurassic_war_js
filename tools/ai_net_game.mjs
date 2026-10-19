// Обученная сеть бойца — в настоящей партии (наше).
//
//   node tools/ai_net_game.mjs <веса.json> [--карты=100,…] [--племена=0,4,6] [--секунд=600] [--потоков=8]
//                              [--сеть-обоим] [--набор=out/ai/штаб1.json]
//
// До сих пор сеть жила только на арене: 89 сцен, один-три бойца, готовая роль сверху. Партия —
// другой мир: двадцать юнитов, роли меняются каждые несколько секунд, рядом свои дома и чужая
// армия. Шов для подключения уже был: штаб и так ведёт каждый отряд через `вестиОтряд` →
// `решение()` учителя, и достаточно подменить эту одну функцию на сеть (`задать(…, { бойСеть })`).
//
// Здесь я это и меряю: одинаковые штабы, одинаковые племена, одна сторона воюет сетью, другая —
// учителем. Места меняются местами. Если сеть в поле не лучше эвристики, значит арена мерила не
// то, и надо чинить сцены, а не радоваться таблицам по сценам.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const КОРЕНЬ = path.join(path.dirname(ЭТОТ), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const файл = process.argv.slice(2).find(a => !a.startsWith('--'));

if (!isMainThread) {
  const { движок, прогнать, сводка, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const { политикаСети } = await import('../reimpl/js/ai/policy_net.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  let сеть = null, набор = null;

  parentPort.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    if (з.весa || з.веса) {                       // веса приезжают один раз, разбор дорогой
      сеть = политикаСети(з.веса, { температура: 0 });
      набор = з.набор || null;
      return parentPort.postMessage('готов');
    }
    const итоги = з.задачи.map((t) => {
      const eng = движок(); const m = eng.m;
      loadMission(m, eng.files, t.карта, t.племя, 1);
      const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
      const A = цвета[t.местоA], B = цвета[t.местоB];
      if (A === undefined || B === undefined) return { ...t, исход: 'нет' };
      const места = [{ цвет: A, племя: t.племя, кто: 'компьютер' }, { цвет: B, племя: t.племя, кто: 'компьютер' }];
      расставить(eng, места, {});
      for (const [k, мес] of места.entries()) {
        m.w8(0x32aec + мес.цвет, 0);
        const сетью = k === 0 || t.обоим;
        Скрипт.задать(eng, мес.цвет, { уровень: 3, характер: 'ровный', бойСеть: сетью ? сеть : null,
                                       гены: набор?.гены || null, ручки: набор?.ручки || null, приёмы: набор?.приёмы || null });
      }
      const предел = Math.round(t.секунд * 1000 / ТИК_МС);
      const t0 = Date.now();
      const r = прогнать(eng, предел);
      const с = сводка(m);
      const вес = (з2) => з2 ? з2.бойцов + з2.зданий * 2 : 0;
      return { ...t, исход: r.победитель === A ? 'сеть' : r.победитель === B ? 'учитель' : 'ничья',
               перевес: (вес(с[A]) - вес(с[B])) / Math.max(1, вес(с[A]) + вес(с[B])),
               шагов: r.шагов, мс: Date.now() - t0 };
    });
    parentPort.postMessage(итоги);
  });
}

if (isMainThread) {
  if (!файл) { console.error('нужен файл весов, например out/ai/weights/ppo12b-….json'); process.exit(1); }
  const веса = JSON.parse(fs.readFileSync(файл, 'utf8'));
  const набор = арг.набор ? JSON.parse(fs.readFileSync(арг.набор, 'utf8')) : null;
  const карты = (арг.карты || '100,101,102,103,105,107,110,112').split(',').map(Number);
  const племена = (арг.племена || '0,4,6').split(',').map(Number);
  const секунд = +(арг.секунд || 600), потоков = Ядра.потоков(арг.потоков, 8);
  const обоим = !!арг['сеть-обоим'];

  const задачи = [];
  for (const карта of карты) for (const племя of племена) for (const [a, b] of [[0, 1], [1, 0]])
    задачи.push({ карта, племя, местоA: a, местоB: b, секунд, обоим });

  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  await Promise.all(потоки.map(w => занять(w, { веса, набор })));
  const куски = Array.from({ length: потоков }, (_, k) => задачи.filter((_, i) => i % потоков === k));
  const t0 = Date.now();
  const итоги = (await Promise.all(потоки.map((w, k) => занять(w, { задачи: куски[k] })))).flat();
  for (const w of потоки) w.postMessage('стоп');

  const счёт = { сеть: 0, учитель: 0, ничья: 0 };
  for (const и of итоги) счёт[и.исход] = (счёт[и.исход] || 0) + 1;
  const перевес = итоги.reduce((s, и) => s + (и.перевес || 0), 0) / итоги.length;
  console.log(`веса ${path.basename(файл)}${набор ? ' + штаб ' + path.basename(арг.набор) : ''}, партий ${итоги.length}` +
              ` (${карты.length} карт × ${племена.length} племён × 2 места), по ${секунд} с игры, ${((Date.now() - t0) / 1000).toFixed(0)} с реального`);
  console.log(`итог: сеть ${счёт.сеть}  учитель ${счёт.учитель}  ничьих ${счёт.ничья}; средний перевес по армии и домам ${(перевес * 100).toFixed(1)} %`);
  const поКартам = new Map();
  for (const и of итоги) { const з = поКартам.get(и.карта) || { сеть: 0, учитель: 0, ничья: 0 }; з[и.исход]++; поКартам.set(и.карта, з); }
  for (const [карта, з] of [...поКартам].sort((a, b) => a[0] - b[0]))
    console.log(`  карта ${карта}: сеть ${з.сеть}, учитель ${з.учитель}, ничьих ${з.ничья}`);
  process.exit(0);
}
