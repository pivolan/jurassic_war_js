// Что даёт каждый приём по отдельности (наше). Раньше уровни складывались «по нарастающей», и
// никто не проверял, что каждый следующий приём и правда усиливает: замер ai_balance показал
// обратную лестницу — лёгкий бил зверского. Здесь берём один и тот же базовый ИИ и добавляем
// ему ровно один приём, а против него ставим тот же базовый ИИ без приёмов. Всё остальное —
// племя, карта, место — одинаково, и оба посадочных места считаются.
//
//   node tools/ai_ablate.mjs главный <карты> [секунд] [процессов] [приёмы через запятую]
import { fork } from 'node:child_process';
import path from 'node:path'; import url from 'node:url';
const ЭТОТ = url.fileURLToPath(import.meta.url);

async function рабочий() {
  const { движок, прогнать, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  process.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    const eng = движок(); const m = eng.m;
    loadMission(m, eng.files, з.карта, з.племя, 1);
    const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
    const места = [{ цвет: цвета[0], племя: з.племя, кто: 'компьютер' }, { цвет: цвета[1], племя: з.племя, кто: 'компьютер' }];
    расставить(eng, места, {});
    for (const [k, мес] of места.entries()) {
      m.w8(0x32aec + мес.цвет, 0);
      const с = Скрипт.задать(eng, мес.цвет, { уровень: з.уровень });
      с.приёмы = new Set(k === з.ктоСПриёмом ? [з.приём] : []);
    }
    const r = прогнать(eng, Math.round(з.сек * 1000 / ТИК_МС));
    const победил = r.победитель === места[з.ктоСПриёмом]?.цвет ? 'приём'
                  : r.победитель === null ? '-' : 'база';
    process.send({ ...з, итог: победил });
  });
  process.send('готов');
}

async function главный() {
  const КАРТЫ = (process.argv[3] || '100').split(',').map(Number);
  const СЕК = +(process.argv[4] || 1800), ПРОЦЕССОВ = +(process.argv[5] || 12);
  const { ПРИЁМЫ: ВСЕ } = await import('../reimpl/js/port/ai_script.js');
  const отбор = (process.argv[6] || '').split(',').filter(Boolean);
  const ПРИЁМЫ = отбор.length ? ВСЕ.filter(п => отбор.includes(п)) : ВСЕ;
  const задачи = [];
  for (const приём of ПРИЁМЫ) for (const карта of КАРТЫ) for (let племя = 0; племя < 8; племя++) for (const ктоСПриёмом of [0, 1])
    задачи.push({ карта, сек: СЕК, уровень: 1, приём, племя, ктоСПриёмом });
  console.log(`карты ${КАРТЫ.join(',')}, предел ${СЕК} с, приёмов ${ПРИЁМЫ.length}, партий ${задачи.length}`);
  const итоги = []; let выдано = 0, готово = 0;
  await new Promise((всё) => {
    for (let k = 0; k < ПРОЦЕССОВ; k++) {
      const п = fork(ЭТОТ, ['рабочий'], { cwd: path.dirname(ЭТОТ) });
      п.on('message', (м) => {
        if (м !== 'готов') { итоги.push(м); готово++; if (готово % 100 === 0) process.stdout.write(`  ${готово}/${задачи.length}\n`); }
        if (выдано < задачи.length) п.send(задачи[выдано++]); else { п.send('стоп'); if (готово >= задачи.length) всё(); }
      });
    }
  });
  console.log('\nприём: побед / поражений / ничьих (за приём против того же ИИ без приёмов)');
  const свод = ПРИЁМЫ.map(п => {
    const свои = итоги.filter(и => и.приём === п);
    return { п, за: свои.filter(и => и.итог === 'приём').length, против: свои.filter(и => и.итог === 'база').length,
             ничьих: свои.filter(и => и.итог === '-').length };
  }).sort((a, b) => (b.за - b.против) - (a.за - a.против));
  for (const с of свод) console.log(`  ${с.п.padEnd(14)} ${String(с.за).padStart(3)} / ${String(с.против).padStart(3)} / ${String(с.ничьих).padStart(3)}   итог ${с.за - с.против > 0 ? '+' : ''}${с.за - с.против}`);
}
if (process.argv[2] === 'рабочий') рабочий(); else главный();
