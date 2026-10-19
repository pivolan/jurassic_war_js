// Какое поведение какому племени подходит (наше).
//
//   node tools/ai_поведение.mjs [--карты=100,…] [--соперник=0|все] [--егоХарактер=костяк] [--секунд=900]
//
// Зачем. Замеры «характер против характера» усредняют по всем племенам и прячут главное: одно и
// то же поведение может быть лучшим для динозавров и худшим для стрелков. Владелец наткнулся на
// это в лоб — Romack (телепортеры) на Ashfall против Tyrano разваливался. Здесь каждое племя
// играет каждым поведением против одного и того же сильного соперника, на всех картах и с обоих
// мест: видно не «кто сильнее вообще», а «чем играть за это племя».
import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
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
        const N = цвета[t.место], S = цвета[1 - t.место];
        if (N === undefined || S === undefined) return { ...t, исход: 'нет' };
        расставить(eng, [{ цвет: N, племя: t.племя, кто: 'компьютер' }, { цвет: S, племя: t.соперник, кто: 'компьютер' }], {});
        m.w8(0x32aec + N, 0); Скрипт.задать(eng, N, { уровень: 3, характер: t.характер });
        m.w8(0x32aec + S, 0); Скрипт.задать(eng, S, { уровень: 3, характер: t.егоХарактер });
        const r = прогнать(eng, Math.round(t.секунд * 1000 / ТИК_МС));
        return { ...t, исход: r.победитель === N ? 'W' : r.победитель === S ? 'L' : '-' };
      } catch (e) { return { ...t, исход: 'ошибка', ошибка: String(e.message).slice(0, 120) }; }
    });
    parentPort.postMessage(итоги);
  });
}

if (isMainThread) {
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  const характеры = (арг.характеры || Object.keys(Скрипт.ХАРАКТЕРЫ).join(',')).split(',');
  const карты = (арг.карты || '100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119').split(',').map(Number);
  // «все» — круговой турнир: племя играет против каждого из остальных. Только так видно, чем
  // играть за племя вообще, а не против одного конкретного соперника: против Tyrano и против
  // Moospell выгодны разные вещи, и выбирать умолчание по одному сопернику — та же ошибка,
  // что выбирать по одной карте.
  const всеСоперники = String(арг.соперник ?? '0') === 'все';
  const соперник = всеСоперники ? -1 : +(арг.соперник ?? 0), егоХарактер = арг.егоХарактер || 'костяк';
  const секунд = +(арг.секунд || 900), потоков = Ядра.потоков(арг.потоков, 18);
  const племена = (арг.племена || '0,1,2,3,4,5,6,7').split(',').map(Number);
  const задачи = [];
  for (const племя of племена) for (const характер of характеры) for (const карта of карты) for (const место of [0, 1]) {
    const соперники = всеСоперники ? [0,1,2,3,4,5,6,7].filter(с => с !== племя) : [соперник];
    for (const с of соперники) задачи.push({ племя, характер, карта, место, соперник: с, егоХарактер, секунд });
  }
  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  const t0 = Date.now();
  const итоги = (await Promise.all(потоки.map((w, k) => занять(w, { задачи: задачи.filter((_, i) => i % потоков === k) })))).flat();
  for (const w of потоки) w.postMessage('стоп');
  console.log(`партий ${итоги.length} (${племена.length} племён × ${характеры.length} поведений × ${карты.length} карт × 2 места` +
              `${всеСоперники ? ' × 7 соперников' : ''}) против ${всеСоперники ? 'всех остальных' : ПЛЕМЕНА[соперник]}/${егоХарактер}, ${((Date.now() - t0) / 1000).toFixed(0)} с\n`);
  const ш = 11;
  console.log('племя'.padEnd(11) + характеры.map(х => х.slice(0, ш - 1).padStart(ш)).join(''));
  for (const п of племена) {
    const ряд = характеры.map(х => {
      const в = итоги.filter(и => и.племя === п && и.характер === х && и.исход !== 'ошибка' && и.исход !== 'нет');
      const w = в.filter(и => и.исход === 'W').length, l = в.filter(и => и.исход === 'L').length;
      return `${w}:${l}`.padStart(ш);
    });
    console.log(ПЛЕМЕНА[п].padEnd(11) + ряд.join(''));
  }
  console.log('\nлучшее поведение для каждого племени (побед минус поражений):');
  for (const п of племена) {
    const оценки = характеры.map(х => {
      const в = итоги.filter(и => и.племя === п && и.характер === х && и.исход !== 'ошибка' && и.исход !== 'нет');
      return { х, о: в.filter(и => и.исход === 'W').length - в.filter(и => и.исход === 'L').length };
    }).sort((a, b) => b.о - a.о);
    console.log(`  ${ПЛЕМЕНА[п].padEnd(11)} ${оценки.slice(0, 3).map(x => `${x.х} ${x.о >= 0 ? '+' : ''}${x.о}`).join(' · ')}`);
  }
  const ош = итоги.filter(и => и.исход === 'ошибка'); if (ош.length) console.log('\nошибок:', ош.length, ош[0].ошибка);
  process.exit(0);
}
