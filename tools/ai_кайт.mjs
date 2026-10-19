// Сколько стоит отказ от кайта у скриптового компьютера (наше).
//
//   node tools/ai_кайт.mjs [--карты=100,…] [--племена=0,…] [--секунд=900] [--потоков=18]
//
// Зачем. Тестер (Discord, 13.09): «fighting against ranged AI units is really annoying because
// they kite too much». Владелец решил кайт у скриптового компьютера убрать — играть должно
// быть интересно, а не изматывающе. Но выключение может стоить силы, особенно стрелковым
// племенам, поэтому цену надо знать числом, а не на глаз: одно и то же племя, одна карта, оба
// места, кайт против без кайта.
import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const ПЛЕМЕНА = ['Tyrano', 'Ka-noo-se', 'Romack', 'Masai', 'Moospell', 'Koomba', 'RaDumBa', 'Koaka'];

if (!isMainThread) {
  const { движок, прогнать, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  parentPort.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    const итоги = з.задачи.map((t) => {
      try {
        const eng = движок(); const m = eng.m;
        loadMission(m, eng.files, t.карта, t.племя, 1);
        const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
        const A = цвета[t.местоA], B = цвета[t.местоB];
        if (A === undefined || B === undefined) return { ...t, исход: 'нет' };
        расставить(eng, [{ цвет: A, племя: t.племя, кто: 'компьютер' }, { цвет: B, племя: t.племя, кто: 'компьютер' }], {});
        m.w8(0x32aec + A, 0); Скрипт.задать(eng, A, { уровень: 3, характер: 'ровный', кайт: t.A });
        m.w8(0x32aec + B, 0); Скрипт.задать(eng, B, { уровень: 3, характер: 'ровный', кайт: t.B });
        const r = прогнать(eng, Math.round(t.секунд * 1000 / ТИК_МС));
        return { ...t, исход: r.победитель === A ? 'A' : r.победитель === B ? 'B' : '-' };
      } catch (e) { return { ...t, исход: 'ошибка', ошибка: String(e.message).slice(0, 120) }; }
    });
    parentPort.postMessage(итоги);
  });
}

if (isMainThread) {
  const карты = (арг.карты || '100,101,102,105,110,112').split(',').map(Number);
  const племена = (арг.племена || '0,1,2,3,4,5,6,7').split(',').map(Number);
  const секунд = +(арг.секунд || 900), потоков = Ядра.потоков(арг.потоков, 18);
  const пары = (арг.пары || 'всегда:нет,всегда:ранен,ранен:нет').split(',').map(x => x.split(':'));
  const задачи = [];
  for (const [A, B] of пары) for (const карта of карты) for (const племя of племена) for (const [a, b] of [[0, 1], [1, 0]])
    задачи.push({ A, B, карта, племя, местоA: a, местоB: b, секунд });
  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const куски = Array.from({ length: потоков }, (_, k) => задачи.filter((_, i) => i % потоков === k));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  const t0 = Date.now();
  const итоги = (await Promise.all(потоки.map((w, k) => занять(w, { задачи: куски[k] })))).flat();
  for (const w of потоки) w.postMessage('стоп');
  console.log(`партий ${итоги.length}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  for (const [A, B] of пары) {
    const в = итоги.filter(и => и.A === A && и.B === B && и.исход !== 'ошибка' && и.исход !== 'нет');
    const a = в.filter(и => и.исход === 'A').length, b = в.filter(и => и.исход === 'B').length;
    console.log(`\n${A} — ${B}:  ${a} : ${b}  ничьих ${в.length - a - b}`);
    console.log('  по племенам (кайт нужнее всего стрелковым — Ka-noo-se, Romack, Moospell):');
    for (const п of племена) {
      const свои = в.filter(и => и.племя === п);
      const ка = свои.filter(и => и.исход === 'A').length, кб = свои.filter(и => и.исход === 'B').length;
      console.log(`    ${ПЛЕМЕНА[п].padEnd(10)} ${String(ка).padStart(3)} : ${String(кб).padEnd(3)} ничьих ${свои.length - ка - кб}`);
    }
  }
  const ош = итоги.filter(и => и.исход === 'ошибка'); if (ош.length) console.log('\nошибок:', ош.length, ош[0].ошибка);
  process.exit(0);
}
