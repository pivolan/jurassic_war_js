// Проверка обученной сети в дуэли (наше): она играет как в игре — argmax, без случайности.
//
//   node tools/ai_дуэль.mjs <веса.json> [--карты=100] [--сеть=2] [--скрипт=0] [--секунд=900]
//                           [--характер=костяк] [--тактик=…json] [--стратег=…json] [--группы=осанка,стройка,…]
//
// Зачем отдельно от прогона обучения. В прогоне сеть сэмплирует действия (температура 1) — так
// она исследует; в партии температура нулевая, решение однозначное, иначе локстеп у игроков
// разъедется. Значит и проверять надо ровно тем, чем играют. Скрипт детерминирован, поэтому на
// одной карте всего два разных исхода — по одному на стартовое место; их и печатаем поимённо.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const ЭТОТ = url.fileURLToPath(import.meta.url);
const КОРЕНЬ = path.join(path.dirname(ЭТОТ), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const ПЛЕМЕНА = ['Tyrano', 'Ka-noo-se', 'Romack', 'Masai', 'Moospell', 'Koomba', 'RaDumBa', 'Koaka'];

const веса = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : null;
const { движок, прогнать, сводка, ТИК_МС } = await import('./ai_duel.mjs');
const { loadMission } = await import('../reimpl/js/loader.js');
const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
const { политикаСети } = await import('../reimpl/js/ai/policy_net.js');
const Скрипт = await import('../reimpl/js/port/ai_script.js');

// Без файла весов бойца дерётся учитель — так меряется вклад одного только верхнего слоя.
const бой = веса ? политикаСети(JSON.parse(fs.readFileSync(веса, 'utf8')), { температура: 0 }) : null;
let стратег = null;
if (арг.стратег) { const з = JSON.parse(fs.readFileSync(арг.стратег, 'utf8'));
  стратег = { w1: Float32Array.from(з.w1), b1: Float32Array.from(з.b1), w2: Float32Array.from(з.w2), b2: Float32Array.from(з.b2) }; }
let тактик = null;
if (арг.тактик) { const т = JSON.parse(fs.readFileSync(арг.тактик, 'utf8'));
  тактик = { w1: Float32Array.from(т.w1), b1: Float32Array.from(т.b1), w2: Float32Array.from(т.w2), b2: Float32Array.from(т.b2) }; }

const карты = (арг.карты || '100').split(',').map(Number);
const пСети = +(арг['сеть'] ?? 2), пСкрипта = +(арг['скрипт'] ?? 0);
const СЕК = +(арг.секунд || 900), характер = арг.характер || 'костяк';
console.log(`${ПЛЕМЕНА[пСети]} (сеть${тактик ? ' + тактик' : ''}${стратег ? ' + стратег' : ''}) против ${ПЛЕМЕНА[пСкрипта]} (скрипт, зверский «${характер}»), ${СЕК} с`);
console.log(`боец: ${веса ? path.basename(веса) : 'скриптовый учитель'}${стратег ? `, стратег: ${path.basename(арг.стратег)}` : ''}\n`);
let W = 0, L = 0, D = 0;
for (const карта of карты) for (const место of [0, 1]) {
  const eng = движок(); const m = eng.m;
  loadMission(m, eng.files, карта, пСети, 1);
  const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
  const N = цвета[место], S = цвета[1 - место];
  if (N === undefined || S === undefined) continue;
  расставить(eng, [{ цвет: N, племя: пСети, кто: 'компьютер' }, { цвет: S, племя: пСкрипта, кто: 'компьютер' }], {});
  m.w8(0x32aec + N, 0); Скрипт.задать(eng, N, { уровень: 3, характер, бойСеть: бой, тактик, стратег, стратегГруппы: арг.группы ? арг.группы.split(',') : null });
  m.w8(0x32aec + S, 0); Скрипт.задать(eng, S, { уровень: 3, характер });
  const r = прогнать(eng, Math.round(СЕК * 1000 / ТИК_МС));
  const с = сводка(m);
  const исход = r.победитель === N ? 'победа' : r.победитель === S ? 'ПОРАЖЕНИЕ' : 'ничья';
  if (исход === 'победа') W++; else if (исход === 'ничья') D++; else L++;
  const мой = с[N] || { бойцов: 0, зданий: 0 }, чужой = с[S] || { бойцов: 0, зданий: 0 };
  console.log(`  карта ${карта}, место ${место}: ${исход.padEnd(9)} ${String(Math.round(r.шагов * ТИК_МС / 1000)).padStart(3)} с · ` +
              `у нас ${мой.бойцов} бойцов и ${мой.зданий} домов, у него ${чужой.бойцов} и ${чужой.зданий}`);
}
console.log(`\nитого: побед ${W}, поражений ${L}, ничьих ${D}`);
