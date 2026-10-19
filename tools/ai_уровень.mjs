// Влияет ли «уровень» компьютера, когда у него стоит нейросеть (наше).
//
//   node tools/ai_уровень.mjs [--карты=100,…] [--племена=0,4,6] [--секунд=600] [--потоков=16]
//                             [--мозги=скрипт,боец,обе] [--боец=…json] [--тактик=…json]
//
// Зачем. В лобби у места компьютера две независимые ручки: «уровень» (лёгкий…зверский) и
// «мозги» (скрипт / сеть бойца / сеть тактика / обе). Сети заменяют не весь ИИ, а только свои
// слои: сеть бойца — выбор действия одного юнита в отряде, сеть тактика — что делает главный
// отряд. Экономику, стройку, состав отрядов, разведку, охрану и частоту тактов по-прежнему ведёт
// скрипт, а всё это задаётся уровнем. Проверяем это не рассуждением, а прямой встречей:
// одни и те же мозги, разные уровни, одинаковые племена и обмен местами.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const КОРЕНЬ = path.join(path.dirname(ЭТОТ), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const ИМЯ_УРОВНЯ = ['лёгкий', 'обычный', 'сложный', 'зверский'];

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
        m.w8(0x32aec + A, 0); Скрипт.задать(eng, A, { уровень: t.урA, характер: 'ровный', ...мозгам(t.мозги) });
        m.w8(0x32aec + B, 0); Скрипт.задать(eng, B, { уровень: t.урB, характер: 'ровный', ...мозгам(t.мозги) });
        const r = прогнать(eng, Math.round(t.секунд * 1000 / ТИК_МС));
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
  const мозгиСписок = (арг.мозги || 'скрипт,боец,обе').split(',');
  const секунд = +(арг.секунд || 600), потоков = Ядра.потоков(арг.потоков, 16);
  const веса = { боец: арг.боец || КОРЕНЬ + 'out/ai/weights/ppoИгры-2026-09-12-2250.json',
                 тактик: арг.тактик || КОРЕНЬ + 'out/ai/weights/тактик-bc.json' };
  // Пары уровней: крайние (лёгкий против зверского) и соседние ступеньки.
  const пары = [[0, 3], [0, 1], [1, 2], [2, 3]];
  const задачи = [];
  for (const мозги of мозгиСписок) for (const [урA, урB] of пары) for (const карта of карты)
    for (const племя of племена) for (const [a, b] of [[0, 1], [1, 0]])
      задачи.push({ мозги, урA, урB, карта, племя, местоA: a, местоB: b, секунд });

  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  await Promise.all(потоки.map(w => занять(w, { веса })));
  const куски = Array.from({ length: потоков }, (_, k) => задачи.filter((_, i) => i % потоков === k));
  const t0 = Date.now();
  const итоги = (await Promise.all(потоки.map((w, k) => занять(w, { задачи: куски[k] })))).flat();
  for (const w of потоки) w.postMessage('стоп');

  console.log(`партий ${итоги.length} (${мозгиСписок.length} мозгов × ${пары.length} пар уровней × ${карты.length} карт × ${племена.length} племён × 2 места), ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  for (const мозги of мозгиСписок) {
    console.log(`\nмозги: ${мозги}`);
    for (const [урA, урB] of пары) {
      const свои = итоги.filter(и => и.мозги === мозги && и.урA === урA && и.урB === урB && и.исход !== 'ошибка' && и.исход !== 'нет');
      if (!свои.length) continue;
      const низ = свои.filter(и => и.исход === 'A').length, верх = свои.filter(и => и.исход === 'B').length;
      const нич = свои.filter(и => и.исход === '-').length;
      const перевес = свои.reduce((s, и) => s - (и.перевес || 0), 0) / свои.length;   // в пользу верхнего уровня
      console.log(`  ${ИМЯ_УРОВНЯ[урA].padEnd(9)} ${String(низ).padStart(3)} : ${String(верх).padEnd(3)} ${ИМЯ_УРОВНЯ[урB].padEnd(9)}` +
                  ` ничьих ${String(нич).padStart(3)} · перевес старшего ${(100 * перевес).toFixed(1)} %`);
    }
  }
  const ош = итоги.filter(и => и.исход === 'ошибка'); if (ош.length) console.log('\nошибок:', ош.length, ош[0].ошибка);
  process.exit(0);
}
