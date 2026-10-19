// Что даёт удержание цели (фокус отряда + «липкая» цель бойца) — замер (наше).
//
//   node tools/ai_фокус.mjs [--карты=100,…] [--племена=0,…] [--секунд=600] [--потоков=18]
//
// Зачем. Владелец (13.09): «вдвоём бьют тигра, почти убили, один отвлёкся — и теперь урона не
// хватает; тигр всю игру бегает за одним магом». Причина была в том, что цель выбиралась заново
// каждые восемь шагов, и вложенный в жертву урон пропадал (зверь регенерирует 1 HP за 16 шагов).
// Здесь меряется, что меняется от удержания цели: не «кажется лучше», а армия, еда и добыча на
// одной и той же карте с одним и тем же племенем.
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
  const { G, U, UNITS } = await import('../reimpl/js/mem.js');
  parentPort.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    const итоги = з.задачи.map((t) => {
      try {
        const eng = движок(); const m = eng.m;
        loadMission(m, eng.files, t.карта, t.племя, 1);
        const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
        const A = цвета[0], B = цвета[1];
        if (A === undefined || B === undefined) return { ...t, нет: 1 };
        расставить(eng, [{ цвет: A, племя: t.племя, кто: 'компьютер' }, { цвет: B, племя: t.племя, кто: 'компьютер' }], {});
        // Лоб в лоб: держит цель только один из двух, места меняются между задачами.
        const держит = t.местоA === 0 ? A : B, нет = t.местоA === 0 ? B : A;
        m.w8(0x32aec + A, 0); Скрипт.задать(eng, A, { уровень: 3, характер: 'ровный', держатьЦель: A === держит });
        m.w8(0x32aec + B, 0); Скрипт.задать(eng, B, { уровень: 3, характер: 'ровный', держатьЦель: B === держит });
        const r = прогнать(eng, Math.round(t.секунд * 1000 / ТИК_МС));
        const срез = (ц) => { let армия = 0, сила = 0;
          for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
            if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
            if (m.u8(UNITS + i + U.OWNER) !== ц || m.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
            армия++;
            сила += m.u8(UNITS+i+U.HPMAX) + m.u8(UNITS+i+U.ATK) + m.u8(UNITS+i+U.DEF) + m.u8(UNITS+i+U.SPD) + m.u8(UNITS+i+U.MAG);
          }
          return { армия, сила, еда: m.u32(G.food + ц * 4) }; };
        const д = срез(держит), н = срез(нет);
        return { ...t, исход: r.победитель === держит ? 'держит' : r.победитель === нет ? 'нет' : '-',
                 армияД: д.армия, силаД: д.сила, едаД: д.еда, армияН: н.армия, силаН: н.сила, едаН: н.еда };
      } catch (e) { return { ...t, ошибка: String(e.message).slice(0, 120) }; }
    });
    parentPort.postMessage(итоги);
  });
}

if (isMainThread) {
  const карты = (арг.карты || '100,101,102,105,110,112').split(',').map(Number);
  const племена = (арг.племена || '0,1,2,3,4,5,6,7').split(',').map(Number);
  const секунд = +(арг.секунд || 600), потоков = Ядра.потоков(арг.потоков, 18);
  const задачи = [];
  for (const [a] of [[0], [1]]) for (const карта of карты) for (const племя of племена)
    задачи.push({ местоA: a, карта, племя, секунд });
  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const куски = Array.from({ length: потоков }, (_, k) => задачи.filter((_, i) => i % потоков === k));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  const t0 = Date.now();
  const итоги = (await Promise.all(потоки.map((w, k) => занять(w, { задачи: куски[k] })))).flat();
  for (const w of потоки) w.postMessage('стоп');
  const годные = итоги.filter(и => !и.ошибка && !и.нет);
  const сред = (сп, поле) => сп.length ? (сп.reduce((s, x) => s + (x[поле] || 0), 0) / сп.length) : 0;
  console.log(`партий ${годные.length} (${карты.length} карт × ${племена.length} племён × 2 места), предел ${секунд} с, ${((Date.now() - t0) / 1000).toFixed(0)} с\n`);
  const д = годные.filter(и => и.исход === 'держит').length, н = годные.filter(и => и.исход === 'нет').length;
  console.log(`лоб в лоб:  держит цель ${д} : ${н} не держит, ничьих ${годные.length - д - н}`);
  console.log(`к концу:    держит — армия ${сред(годные,'армияД').toFixed(1)}, статы ${сред(годные,'силаД').toFixed(0)}, еда ${сред(годные,'едаД').toFixed(0)}`);
  console.log(`            не держит — армия ${сред(годные,'армияН').toFixed(1)}, статы ${сред(годные,'силаН').toFixed(0)}, еда ${сред(годные,'едаН').toFixed(0)}`);
  console.log('\nпо племенам (побед держащего : не держащего):');
  for (const п of племена) {
    const свои = годные.filter(и => и.племя === п);
    const a = свои.filter(и => и.исход === 'держит').length, b = свои.filter(и => и.исход === 'нет').length;
    console.log(`  ${ПЛЕМЕНА[п].padEnd(10)} ${String(a).padStart(3)} : ${String(b).padEnd(3)} ничьих ${свои.length - a - b}   статы ${сред(свои,'силаД').toFixed(0)} против ${сред(свои,'силаН').toFixed(0)}`);
  }
  const ош = итоги.filter(и => и.ошибка); if (ош.length) console.log('\nошибок:', ош.length, ош[0].ошибка);
  process.exit(0);
}
