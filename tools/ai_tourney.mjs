// Турнир скриптовых компьютеров: кто сильнее — характеры или племена (наше).
//
//   node tools/ai_tourney.mjs характеры [карта] [уровень] [секунд] [процессов]
//   node tools/ai_tourney.mjs племена   [карта] [уровень] [секунд] [процессов]
//
// Оба прогона считают обе посадки (кто на каком месте), чтобы преимущество места не читалось
// как преимущество стороны. «характеры» гоняют одно и то же племя с разными характерами —
// так видно, влияет ли стратегия вообще. «племена» гоняют один характер разными племенами —
// так видно, какой стартовый набор сильнее.
import { fork } from 'node:child_process';
import path from 'node:path'; import url from 'node:url';
const ЭТОТ = url.fileURLToPath(import.meta.url);
const ХАРАКТЕРЫ = (process.env.JW_CHARS || 'ровный,агрессор,экономист,черепаха,налётчик,охотник,защитник,костяк').split(',');
const ПЛЕМЕНА = ['Tyrano', 'Ka-noo-se', 'Romack', 'Masai', 'Moospell', 'Koomba', 'RaDumBa', 'Koaka'];

async function рабочий() {
  const { движок, прогнать, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  process.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    const eng = движок(); const m = eng.m;
    loadMission(m, eng.files, з.карта, з.A.племя, 1);
    const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
    const места = [{ цвет: цвета[0], племя: з.A.племя, кто: 'компьютер' }, { цвет: цвета[1], племя: з.B.племя, кто: 'компьютер' }];
    расставить(eng, места, {});
    for (const [k, мес] of места.entries()) {
      m.w8(0x32aec + мес.цвет, 0);
      const кто = k === 0 ? з.A : з.B;
      Скрипт.задать(eng, мес.цвет, { уровень: з.уровень, характер: кто.характер });
    }
    const r = прогнать(eng, Math.round(з.сек * 1000 / ТИК_МС));
    const победA = r.победитель === места[0].цвет, победB = r.победитель === места[1].цвет;
    process.send({ ...з, итог: победA ? 'A' : победB ? 'B' : '-', секунд: Math.round(r.шагов * ТИК_МС / 1000) });
  });
  process.send('готов');
}

async function главный() {
  const режим = process.argv[2] || 'характеры';
  const КАРТЫ = String(process.argv[3] || 206).split(',').map(Number), УРОВЕНЬ = +(process.argv[4] || 2);
  const СЕК = +(process.argv[5] || 900), ПРОЦЕССОВ = +(process.argv[6] || 10);
  const задачи = [];
  if (режим === 'характеры') {
    for (const КАРТА of КАРТЫ) for (let племя = 0; племя < 8; племя++)
      for (const a of ХАРАКТЕРЫ) for (const b of ХАРАКТЕРЫ) { if (a === b) continue;
        задачи.push({ карта: КАРТА, уровень: УРОВЕНЬ, сек: СЕК, A: { племя, характер: a }, B: { племя, характер: b } }); }
  } else {
    for (const КАРТА of КАРТЫ) for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) { if (a === b) continue;
      задачи.push({ карта: КАРТА, уровень: УРОВЕНЬ, сек: СЕК, A: { племя: a, характер: 'ровный' }, B: { племя: b, характер: 'ровный' } }); }
  }
  console.log(`${режим}: карты ${КАРТЫ.join(',')}, уровень ${УРОВЕНЬ}, партий ${задачи.length}, процессов ${ПРОЦЕССОВ}, предел ${СЕК} с игры`);
  const итоги = []; let выдано = 0, готово = 0;
  await new Promise((всё) => {
    for (let k = 0; k < ПРОЦЕССОВ; k++) {
      const п = fork(ЭТОТ, ['рабочий'], { cwd: path.dirname(ЭТОТ) });
      п.on('message', (м) => {
        if (м !== 'готов') { итоги.push(м); готово++; if (готово % 40 === 0) process.stdout.write(`  ${готово}/${задачи.length}\n`); }
        if (выдано < задачи.length) п.send(задачи[выдано++]); else { п.send('стоп'); if (готово >= задачи.length) всё(); }
      });
    }
  });
  const ничьих = итоги.filter(и => и.итог === '-').length;
  console.log(`\nсыграно ${итоги.length}, ничьих ${ничьих} (${Math.round(ничьих / итоги.length * 100)}%)`);
  const счёт = new Map();
  const имя = (у) => режим === 'характеры' ? у.характер : ПЛЕМЕНА[у.племя];
  for (const и of итоги) {
    for (const [у, победа] of [[и.A, и.итог === 'A'], [и.B, и.итог === 'B']]) {
      const k = имя(у); const з = счёт.get(k) || { побед: 0, партий: 0 };
      з.побед += победа ? 1 : 0; з.партий++; счёт.set(k, з);
    }
  }
  console.log('\nкто сколько взял (только решённые партии в знаменателе не учтены — считаем от всех):');
  for (const [k, з] of [...счёт].sort((a, b) => b[1].побед - a[1].побед))
    console.log(`  ${k.padEnd(12)} ${String(з.побед).padStart(3)} побед из ${з.партий}  (${(з.побед / з.партий * 100).toFixed(0)}%)`);
  // Таблица пар: строка — A, столбец — B, значение — победы A
  const ключи = [...счёт.keys()].sort();
  console.log('\nпо парам (строка бьёт столбец):');
  console.log('            ' + ключи.map(k => k.slice(0, 9).padStart(10)).join(''));
  for (const a of ключи) {
    const стр = ключи.map(b => {
      if (a === b) return '—';
      const п = итоги.filter(и => имя(и.A) === a && имя(и.B) === b);
      return `${п.filter(и => и.итог === 'A').length}/${п.length}`;
    });
    console.log(a.slice(0, 11).padEnd(12) + стр.map(с => с.padStart(10)).join(''));
  }
}
if (process.argv[2] === 'рабочий') рабочий(); else главный();
