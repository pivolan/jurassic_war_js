// Угодья всех карт в один файл: reimpl/data/пастбища.json.
//
//   node tools/ai_пастбища.mjs [--карты=100,…] [--радиус=8] [--мин=3]
//
// Замысел владельца дословно: «мы можем немножко сжульничать — ты читаешь все карты, знаешь точки
// респавна животных, помечаешь их как удобные пастбища, и тогда компьютер даже с закрытой картой
// знает, где кормиться, и выбирает ближайшее или самое выгодное».
//
// Почему именно точки респавна, а не то, где зверь стоит сейчас. У каждого зверя в записи лежит
// его домашняя клетка (+0x59/+0x5a) и прямоугольник выпаса (+0x55..+0x58) — по ним движок его и
// возрождает (0x1cfcb). Стадо бродит, но возрождается ВСЕГДА на своём месте: значит угодье — это
// не «где сейчас видно мясо», а постоянная точка карты. Такую таблицу можно посчитать один раз.
//
// Что в файле: по каждой карте список кучек — середина, сколько в ней зверья, сколько мяса даёт
// полный выпас, и самый опасный зверь кучки (по нему видно, по зубам ли она молодому отряду).
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));

const { движок } = await import('./ai_duel.mjs');
const { loadMission } = await import('../reimpl/js/loader.js');
const { G, U, UNITS } = await import('../reimpl/js/mem.js');

const РАДИУС = +(арг.радиус || 8);         // клетки: ближе этого зверь считается тем же угодьем
const МИН = +(арг.мин || 2);               // кучка меньше этого — не угодье, а одинокий зверь
const ЗВЕРЬ = (t) => t >= 14 && t <= 23;

/** Все звери карты со своими ДОМАШНИМИ точками (там они возрождаются). */
function звериКарты(m) {
  const с = [];
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = m.u8(UNITS + i + U.TYPE); if (!ЗВЕРЬ(t)) continue;
    // Домашняя клетка; если её нет (ноль), берём нынешнее положение.
    const дx = m.u8(UNITS + i + 0x59), дy = m.u8(UNITS + i + 0x5a);
    const x = дx || (m.u16(UNITS + i + U.X) >> 5), y = дy || (m.u16(UNITS + i + U.Y) >> 5);
    с.push({ x, y, тип: t, еда: m.u16(UNITS + i + U.FOOD), hp: m.u8(UNITS + i + U.HPMAX),
             атк: m.u8(UNITS + i + U.ATK), деф: m.u8(UNITS + i + U.DEF) });
  }
  return с;
}

/** Склейка в кучки: волной по расстоянию РАДИУС (шахматная метрика — так же ходит движок). */
function кучки(звери) {
  const чей = звери.map(() => -1), из = [];
  for (let a = 0; a < звери.length; a++) {
    if (чей[a] >= 0) continue;
    const к = [a]; чей[a] = из.length;
    for (let q = 0; q < к.length; q++) for (let b = 0; b < звери.length; b++) {
      if (чей[b] >= 0) continue;
      const d = Math.max(Math.abs(звери[к[q]].x - звери[b].x), Math.abs(звери[к[q]].y - звери[b].y));
      if (d <= РАДИУС) { чей[b] = из.length; к.push(b); }
    }
    из.push(к);
  }
  return из;
}

const карты = (арг.карты || Array.from({ length: 20 }, (_, k) => 100 + k).join(',')).split(',').map(Number);
const итог = {};
for (const карта of карты) {
  let m;
  try { const eng = движок(); m = eng.m; loadMission(m, eng.files, карта, 0, 1); }
  catch (e) { console.log(`карта ${карта}: не загрузилась (${e.message})`); continue; }
  const звери = звериКарты(m);
  const список = кучки(звери).filter(к => к.length >= МИН).map(к => {
    const з = к.map(i => звери[i]);
    const сx = Math.round(з.reduce((s, о) => s + о.x, 0) / з.length);
    const сy = Math.round(з.reduce((s, о) => s + о.y, 0) / з.length);
    const еда = з.reduce((s, о) => s + о.еда, 0);
    // «Самый злой» зверь кучки: по нему видно, по зубам ли она отряду.
    const злой = з.reduce((a, b) => (b.hp + b.атк + b.деф > a.hp + a.атк + a.деф ? b : a));
    return { x: сx, y: сy, зверей: з.length, еда, тип: злой.тип, сила: злой.hp + злой.атк + злой.деф };
  }).sort((a, b) => b.еда - a.еда);
  итог[карта] = { ширина: m.u32(G.mapW), высота: m.u32(G.mapH), зверья: звери.length, угодья: список };
  console.log(`карта ${карта}: зверья ${String(звери.length).padStart(3)}, угодий ${String(список.length).padStart(2)}` +
              `, лучшее ${список[0] ? `(${список[0].x},${список[0].y}) ${список[0].зверей} зверей, ${список[0].еда} мяса` : '—'}`);
}
const файл = path.join(КОРЕНЬ, 'reimpl/data/пастбища.json');
fs.writeFileSync(файл, JSON.stringify(итог), 'utf8');
console.log(`\n${Object.keys(итог).length} карт → ${path.relative(КОРЕНЬ, файл)} (${(fs.statSync(файл).size / 1024).toFixed(1)} КБ)`);
