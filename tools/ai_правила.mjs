// Новые правила скирмиша против прежнего поведения, лоб в лоб (наше).
//
//   node tools/ai_правила.mjs [--карты=100,101,…] [--племена=0..7] [--секунд=900] [--процессов=8]
//
// Одна сторона играет с `правила2` (мясо при первой возможности, склад ломаем первым, вся армия
// на того, кто бьёт наш дом, добивание при перевесе), другая — без них. Каждая пара играется
// дважды, со сменой мест: карта не симметрична, и место решает не меньше племени.
import { fork } from 'node:child_process';
import path from 'node:path'; import url from 'node:url';
import * as Ядра from './ai_ядра.mjs';
const ЭТОТ = url.fileURLToPath(import.meta.url);
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));

if (process.argv[2] === 'рабочий') {
  const { движок, прогнать, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  const { G, U, UNITS } = await import('../reimpl/js/mem.js');
  process.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    const eng = движок(); const m = eng.m;
    loadMission(m, eng.files, з.карта, з.племя, 2);
    const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
    const [цA, цB] = з.местами ? [цвета[1], цвета[0]] : [цвета[0], цвета[1]];
    расставить(eng, [{ цвет: цA, племя: з.племя, кто: 'компьютер' }, { цвет: цB, племя: з.племя, кто: 'компьютер' }], {});
    m.w8(0x32aec + цA, 0); m.w8(0x32aec + цB, 0);
    Скрипт.задать(eng, цA, { уровень: 3, характер: 'ровный', правила2: true });
    Скрипт.задать(eng, цB, { уровень: 3, характер: 'ровный', правила2: false });
    const r = прогнать(eng, Math.round(з.сек * 1000 / ТИК_МС));
    // Партии часто не доигрываются до конца: считаем ещё и очки, как это делает табло в игре —
    // качество армии (сумма всех статов) / 10 + дома × 50 + казна / 20.
    const очки = (ц) => {
      let сила = 0, домов = 0;
      for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
        if (m.u8(UNITS + i + U.FLAGS5B) & 1 || m.u8(UNITS + i + U.OWNER) !== ц) continue;
        if (m.u8(UNITS + i + U.TYPE) >= 0x1a) { домов++; continue; }
        if (m.u8(UNITS + i + U.HP) <= 0) continue;
        сила += m.u8(UNITS + i + U.HPMAX) + m.u8(UNITS + i + U.ATK) + m.u8(UNITS + i + U.DEF)
              + m.u8(UNITS + i + U.MAG) + m.u8(UNITS + i + U.SPD);
      }
      return Math.round(сила / 10 + домов * 50 + m.u32(G.food + ц * 4) / 20);
    };
    const очкиA = очки(цA), очкиB = очки(цB);
    process.send({ ...з, итог: r.победитель === цA ? 'новые' : r.победитель === цB ? 'старые' : '-',
                   очкиA, очкиB, секунд: Math.round(r.шагов * ТИК_МС / 1000) });
  });
  process.send('готов');
} else {
  const КАРТЫ = String(арг.карты || '100,101,102').split(',').map(Number);
  const ПЛЕМЕНА = String(арг.племена || '0,1,2,3,4,5,6,7').split(',').map(Number);
  const СЕК = +(арг.секунд || 900), ПРОЦЕССОВ = Ядра.потоков(арг.процессов, 8);
  const задачи = [];
  for (const карта of КАРТЫ) for (const племя of ПЛЕМЕНА) for (const местами of [false, true])
    задачи.push({ карта, племя, местами, сек: СЕК });
  console.log(`карт ${КАРТЫ.length}, племён ${ПЛЕМЕНА.length}, партий ${задачи.length}, процессов ${ПРОЦЕССОВ}, предел ${СЕК} с`);
  const итоги = []; let выдано = 0, готово = 0;
  await new Promise((всё) => {
    for (let k = 0; k < ПРОЦЕССОВ; k++) {
      const п = fork(ЭТОТ, ['рабочий'], { cwd: path.dirname(ЭТОТ) });
      п.on('message', (м) => {
        if (м !== 'готов') { итоги.push(м); готово++; if (готово % 8 === 0) process.stdout.write(`  ${готово}/${задачи.length}\n`); }
        if (выдано < задачи.length) п.send(задачи[выдано++]); else { п.send('стоп'); if (готово >= задачи.length) всё(); }
      });
    }
  });
  const счёт = { новые: 0, старые: 0, '-': 0 };
  let поОчкамН = 0, поОчкамС = 0, суммаН = 0, суммаС = 0;
  for (const и of итоги) { счёт[и.итог]++;
    суммаН += и.очкиA; суммаС += и.очкиB;
    if (и.очкиA > и.очкиB * 1.05) поОчкамН++; else if (и.очкиB > и.очкиA * 1.05) поОчкамС++; }
  console.log(`\nновые ${счёт.новые} : ${счёт.старые} старые, ничьих ${счёт['-']}`);
  console.log(`по очкам: новые ${поОчкамН} : ${поОчкамС} старые · очков всего ${суммаН} против ${суммаС}`);
  const поПлеменам = {};
  for (const и of итоги) { const к = поПлеменам[и.племя] ??= { новые: 0, старые: 0, '-': 0 }; к[и.итог]++; }
  for (const [п, к] of Object.entries(поПлеменам)) console.log(`  племя ${п}: ${к.новые} : ${к.старые} (ничьих ${к['-']})`);
}
