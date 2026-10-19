// Что даёт слой стратега (наше).
//
//   node tools/ai_стратег_ab.mjs [--карты=100,…] [--племена=0,…] [--секунд=900] [--потоков=18]
//
// Лоб в лоб: одно и то же племя, одна карта, оба места; у стороны A решения штаба принимает
// обученная сеть (js/ai/strategy.js), у стороны B — прежние правила. Всё остальное одинаково.
// Режим `--что=пусто` — контроль: обеим сторонам одно и то же, счёт обязан быть ровным.
import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const ПЛЕМЕНА = ['Tyrano', 'Ka-noo-se', 'Romack', 'Masai', 'Moospell', 'Koomba', 'RaDumBa', 'Koaka'];

if (!isMainThread) {
  const fsW = await import('node:fs');
  const { движок, прогнать, ТИК_МС } = await import('./ai_duel.mjs');
  let сеть = null, группы = null;
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  parentPort.on('message', async (з) => {
    if (з === 'стоп') return process.exit(0);
    if (з.веса !== undefined) { const w = JSON.parse(fsW.readFileSync(з.веса, 'utf8'));
      сеть = { w1: Float32Array.from(w.w1), b1: Float32Array.from(w.b1), w2: Float32Array.from(w.w2), b2: Float32Array.from(w.b2) };
      группы = з.группы; return parentPort.postMessage('готов'); }
    const итоги = [];
    for (const t of з.задачи) итоги.push(await (async () => {
      try {
        const eng = движок(); const m = eng.m;
        loadMission(m, eng.files, t.карта, t.племя, 1);
        const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
        const A = цвета[t.местоA], B = цвета[t.местоB];
        if (A === undefined || B === undefined) return { ...t, исход: 'нет' };
        расставить(eng, [{ цвет: A, племя: t.племя, кто: 'компьютер' }, { цвет: B, племя: t.племя, кто: 'компьютер' }], {});
        const порог = +String(t.что).split(':')[1] || null;
        const вид = String(t.что).split(':')[0];
        // «пусто» — контрольный прогон: обеим сторонам одно и то же. Если он даёт перекос,
        // виноват стенд или сама игра, а не правка, и остальным числам верить нельзя.
        const нас = (вкл) => вид === 'пусто' ? {} : { стратег: вкл ? сеть : null, стратегГруппы: группы };
        m.w8(0x32aec + A, 0); Скрипт.задать(eng, A, { уровень: 3, характер: t.характер, ...нас(true) });
        m.w8(0x32aec + B, 0); Скрипт.задать(eng, B, { уровень: 3, характер: t.характер, ...нас(false) });
        const r = прогнать(eng, Math.round(t.секунд * 1000 / ТИК_МС));
        const { G, U, UNITS } = await import('../reimpl/js/mem.js');
        const срез = (ц) => { let домов = 0, бойцов = 0;
          for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
            if (m.u8(UNITS + i + U.FLAGS5B) & 1 || m.u8(UNITS + i + U.OWNER) !== ц) continue;
            if (m.u8(UNITS + i + U.TYPE) >= 0x1a) домов++; else бойцов++; }
          return { домов, бойцов, еда: m.u32(G.food + ц * 4) }; };
        // Правка всегда у стороны A (местоA меняет только её стартовую точку), поэтому и снимаем
        // с A. Раньше здесь стояло `местоA === 0 ? A : B` — это мерило цвет 0 против цвета 1,
        // а не включённое против выключенного, и все средние по концу партии были враньём:
        // контрольный прогон с одинаковыми настройками у обеих сторон давал «4 бойца против 10».
        const вкл = срез(A), выкл = срез(B);
        return { ...t, исход: r.победитель === A ? 'A' : r.победитель === B ? 'B' : '-',
                 домовВкл: вкл.домов, бойцовВкл: вкл.бойцов, едаВкл: вкл.еда,
                 домовВыкл: выкл.домов, бойцовВыкл: выкл.бойцов, едаВыкл: выкл.еда };
      } catch (e) { return { ...t, исход: 'ошибка', ошибка: String(e.message).slice(0, 120) }; }
    })());
    parentPort.postMessage(итоги);
  });
}

if (isMainThread) {
  const карты = (арг.карты || '100,101,102,105,110,112').split(',').map(Number);
  const племена = (арг.племена || '0,1,2,3,4,5,6,7').split(',').map(Number);
  const секунд = +(арг.секунд || 900), потоков = Ядра.потоков(арг.потоков, 18);
  const что = (арг.что || 'стратег').split(',');
  const характер = арг.характер || 'костяк';
  const задачи = [];
  for (const ч of что) for (const карта of карты) for (const племя of племена) for (const [a, b] of [[0, 1], [1, 0]])
    задачи.push({ что: ч, A: true, B: false, карта, племя, местоA: a, местоB: b, секунд, характер });
  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const куски = Array.from({ length: потоков }, (_, k) => задачи.filter((_, i) => i % потоков === k));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  await Promise.all(потоки.map(w => занять(w, { веса: арг.веса || 'out/ai/weights/стратег-bc.json',
                                               группы: арг.группы ? арг.группы.split(',') : null })));
  const t0 = Date.now();
  const итоги = (await Promise.all(потоки.map((w, k) => занять(w, { задачи: куски[k] })))).flat();
  for (const w of потоки) w.postMessage('стоп');
  console.log(`партий ${итоги.length}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  for (const ч of что) {
    const в = итоги.filter(и => и.что === ч && и.исход !== 'ошибка' && и.исход !== 'нет');
    const a = в.filter(и => и.исход === 'A').length, b = в.filter(и => и.исход === 'B').length;
    const ср = (поле) => (в.reduce((s2, и) => s2 + (и[поле] || 0), 0) / Math.max(1, в.length)).toFixed(1);
    console.log(`\n${ч}: со стратегом — без него  ${a} : ${b}  ничьих ${в.length - a - b}`);
    console.log(`  к концу: домов ${ср('домовВкл')} против ${ср('домовВыкл')}, бойцов ${ср('бойцовВкл')} против ${ср('бойцовВыкл')}, еда ${ср('едаВкл')} против ${ср('едаВыкл')}`);
    console.log('  по племенам:');
    for (const п of племена) {
      const свои = в.filter(и => и.племя === п);
      const ка = свои.filter(и => и.исход === 'A').length, кб = свои.filter(и => и.исход === 'B').length;
      console.log(`    ${ПЛЕМЕНА[п].padEnd(10)} ${String(ка).padStart(3)} : ${String(кб).padEnd(3)} ничьих ${свои.length - ка - кб}`);
    }
  }
  const ош = итоги.filter(и => и.исход === 'ошибка'); if (ош.length) console.log('\nошибок:', ош.length, ош[0].ошибка);
  process.exit(0);
}
