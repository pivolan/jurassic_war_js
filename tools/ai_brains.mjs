// Турнир мозгов (наше): скрипт против сети бойца, сети тактика и обеих сразу.
//
//   node tools/ai_brains.mjs [--карты=100,…] [--племена=0,4,6] [--секунд=600] [--потоков=16]
//                            [--боец=out/ai/weights/ppo12b-….json] [--тактик=out/ai/weights/тактик-bc.json]
//
// Зачем. Слои учились по отдельности и на своих стендах: боец — на 89 сценах арены, тактик —
// клонированием решений штаба. Вопрос, ради которого всё затевалось, один: становится ли от них
// сильнее живая партия. Здесь каждая пара мозгов играет друг против друга на одних и тех же
// картах, за одинаковые племена и с обменом местами — и разница видна не по ощущениям, а числом.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const КОРЕНЬ = path.join(path.dirname(ЭТОТ), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));

const МОЗГИ = ['скрипт', 'боец', 'тактик', 'обе'];

if (!isMainThread) {
  const { движок, прогнать, сводка, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const { политикаСети } = await import('../reimpl/js/ai/policy_net.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  let боец = null, тактик = null;

  const мозгам = (вид) => вид === 'боец' ? { бойСеть: боец } : вид === 'тактик' ? { тактик }
                      : вид === 'обе' ? { бойСеть: боец, тактик } : {};

  parentPort.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    if (з.веса) {
      боец = политикаСети(JSON.parse(fs.readFileSync(з.веса.боец, 'utf8')), { температура: 0 });
      const т = JSON.parse(fs.readFileSync(з.веса.тактик, 'utf8'));
      тактик = { w1: Float32Array.from(т.w1), b1: Float32Array.from(т.b1), w2: Float32Array.from(т.w2), b2: Float32Array.from(т.b2) };
      return parentPort.postMessage('готов');
    }
    const итоги = з.задачи.map((t) => {
      try {
        const eng = движок(); const m = eng.m;
        loadMission(m, eng.files, t.карта, t.племя, 1);
        const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
        const A = цвета[t.местоA], B = цвета[t.местоB];
        if (A === undefined || B === undefined) return { ...t, исход: 'нет' };
        расставить(eng, [{ цвет: A, племя: t.племя, кто: 'компьютер' }, { цвет: B, племя: t.племя, кто: 'компьютер' }], {});
        m.w8(0x32aec + A, 0); Скрипт.задать(eng, A, { уровень: 3, характер: 'ровный', ...мозгам(t.A) });
        m.w8(0x32aec + B, 0); Скрипт.задать(eng, B, { уровень: 3, характер: 'ровный', ...мозгам(t.B) });
        const предел = Math.round(t.секунд * 1000 / ТИК_МС);
        const r = прогнать(eng, предел);
        const с = сводка(m); const вес = (з2) => з2 ? з2.бойцов + з2.зданий * 2 : 0;
        return { ...t, исход: r.победитель === A ? 'A' : r.победитель === B ? 'B' : '-',
                 перевес: (вес(с[A]) - вес(с[B])) / Math.max(1, вес(с[A]) + вес(с[B])), шагов: r.шагов };
      } catch (e) { return { ...t, исход: 'ошибка', ошибка: String(e.message).slice(0, 120) }; }
    });
    parentPort.postMessage(итоги);
  });
}

if (isMainThread) {
  const карты = (арг.карты || '100,101,102,105,110,112').split(',').map(Number);
  const племена = (арг.племена || '0,4,6').split(',').map(Number);
  const секунд = +(арг.секунд || 600), потоков = Ядра.потоков(арг.потоков, 16);
  const веса = {
    боец: арг.боец || КОРЕНЬ + 'out/ai/weights/ppo12b-2026-09-11-1346.json',
    тактик: арг.тактик || КОРЕНЬ + 'out/ai/weights/тактик-bc.json',
  };
  const пары = [];
  for (let i = 0; i < МОЗГИ.length; i++) for (let j = i + 1; j < МОЗГИ.length; j++) пары.push([МОЗГИ[i], МОЗГИ[j]]);
  const задачи = [];
  for (const [A, B] of пары) for (const карта of карты) for (const племя of племена) for (const [a, b] of [[0, 1], [1, 0]])
    задачи.push({ A, B, карта, племя, местоA: a, местоB: b, секунд });

  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  await Promise.all(потоки.map(w => занять(w, { веса })));
  const куски = Array.from({ length: потоков }, (_, k) => задачи.filter((_, i) => i % потоков === k));
  const t0 = Date.now();
  const итоги = (await Promise.all(потоки.map((w, k) => занять(w, { задачи: куски[k] })))).flat();
  for (const w of потоки) w.postMessage('стоп');

  const счёт = {}; for (const м of МОЗГИ) счёт[м] = { побед: 0, поражений: 0, ничьих: 0, перевес: 0, партий: 0 };
  const пара = {};
  for (const и of итоги) {
    if (и.исход === 'ошибка') { console.log('ошибка:', и.ошибка); continue; }
    const k = `${и.A} — ${и.B}`; const п = пара[k] ??= { A: 0, B: 0, н: 0 };
    for (const [кто, знак] of [[и.A, 1], [и.B, -1]]) {
      const с = счёт[кто]; с.партий++; с.перевес += знак * (и.перевес || 0);
      if (и.исход === '-') с.ничьих++;
      else if ((и.исход === 'A') === (знак > 0)) с.побед++; else с.поражений++;
    }
    if (и.исход === 'A') п.A++; else if (и.исход === 'B') п.B++; else п.н++;
  }
  console.log(`партий ${итоги.length} (${карты.length} карт × ${племена.length} племён × 2 места × ${пары.length} пар), ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  console.log('\nпо парам:');
  for (const [k, п] of Object.entries(пара)) console.log(`  ${k.padEnd(18)} ${String(п.A).padStart(3)} : ${String(п.B).padEnd(3)} ничьих ${п.н}`);
  console.log('\nвсего:');
  for (const м of МОЗГИ) { const с = счёт[м];
    console.log(`  ${м.padEnd(8)} побед ${String(с.побед).padStart(3)}, поражений ${String(с.поражений).padStart(3)}, ничьих ${String(с.ничьих).padStart(3)}` +
                `, средний перевес ${(100 * с.перевес / Math.max(1, с.партий)).toFixed(1)} %`); }
  process.exit(0);
}
