// ОПЫТ «ОДИН ПРОТИВ ТРЁХ»: маленькая сцена, где всё видно по тикам.
//
// Зачем. Владелец который раз показывает одно и то же: отряд бесконечно убегает, хотя за ним
// бежит один зверь. Мои замеры на полной миссии каждый раз показывали «гонятся 2–3», и спор
// упирался в то, что внутреннее состояние расходится с картинкой. Поэтому здесь — чистый опыт:
// один наш боец и ровно три зверя, всё остальное с карты убрано. Сперва натравливаем бойца,
// потом уводим, и КАЖДЫЙ ТИК пишем всё, что движок знает о каждом участнике: поле цели, состояние,
// приказ, координаты, расстояние, здоровье. Рядом рисуется картинка того же тика — ровно из тех же
// чисел, так что расхождение «в голове» и «на экране» стало бы видно сразу.
//
//   node tools/опыт_погони.mjs [секунд=8] [папка]
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import { движок, ТИК_МС } from './ai_duel.mjs';
const { loadMission } = await import('../reimpl/js/loader.js');
const { G, U, UNITS } = await import('../reimpl/js/mem.js');
const { приказ } = await import('../reimpl/js/port/inject.js');

const СЕКУНД = +(process.argv[2] || 8);
const ПАПКА = process.argv[3] || '/tmp/опыт_погони';
fs.mkdirSync(ПАПКА, { recursive: true });

const жив = (m, i) => !!i && !(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.HP) > 0
                      && (m.u8(UNITS + i + U.STATE) & 0xf0) !== 0x60;
const кл = (m, i) => ({ x: m.u16(UNITS + i + U.X) >> 5, y: m.u16(UNITS + i + U.Y) >> 5 });
const далеко = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const eng = движок(); const m = eng.m;
loadMission(m, eng.files, 0, 0, 2);
const мой = m.u8(G.humanOwner); m.w8(0x32aec + мой, 0);

// Оставляем одного своего и трёх ближайших зверей, остальных убираем насовсем.
let наш = 0; const звери = [];
const свои = [];
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
  const т = m.u8(UNITS + i + U.TYPE);
  if (m.u8(UNITS + i + U.OWNER) === мой && т < 0x1a) свои.push(i);
  else if (т >= 14 && т <= 23) звери.push(i);
}
наш = свои[0];
const c0 = кл(m, наш);
звери.sort((a, b) => далеко(кл(m, a), c0) - далеко(кл(m, b), c0));
const трое = звери.slice(0, 3);
for (const i of свои.slice(1)) m.w8(UNITS + i + U.FLAGS5B, m.u8(UNITS + i + U.FLAGS5B) | 1);
for (const з of звери.slice(3)) { m.w8(UNITS + з + U.FLAGS5B, m.u8(UNITS + з + U.FLAGS5B) | 1); m.w16(UNITS + з + U.ANIM, 0xffff); }

// ---- картинка кадра: клетки 12 пикселей, наш зелёный, звери красные, стрелка к их цели
const КЛ = 12, ПОЛЕ = 24;
function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function кадр(файл, центр, точки) {
  const w = ПОЛЕ * КЛ, h = ПОЛЕ * КЛ; const rgb = Buffer.alloc(w * h * 3, 24);
  const пиксель = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b; };
  const клетка = (кx, кy, r, g, b) => { const x0 = (кx - центр.x + ПОЛЕ / 2) * КЛ, y0 = (кy - центр.y + ПОЛЕ / 2) * КЛ;
    for (let y = 1; y < КЛ - 1; y++) for (let x = 1; x < КЛ - 1; x++) пиксель(x0 + x, y0 + y, r, g, b); };
  const линия = (a, b, r, g, bl) => { const ax = (a.x - центр.x + ПОЛЕ / 2) * КЛ + КЛ / 2, ay = (a.y - центр.y + ПОЛЕ / 2) * КЛ + КЛ / 2;
    const bx = (b.x - центр.x + ПОЛЕ / 2) * КЛ + КЛ / 2, by = (b.y - центр.y + ПОЛЕ / 2) * КЛ + КЛ / 2;
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) | 0;
    for (let k = 0; k <= n; k++) пиксель(Math.round(ax + (bx - ax) * k / n), Math.round(ay + (by - ay) * k / n), r, g, bl); };
  // сетка
  for (let к = 0; к <= ПОЛЕ; к++) for (let p = 0; p < ПОЛЕ * КЛ; p++) { пиксель(к * КЛ, p, 40, 40, 40); пиксель(p, к * КЛ, 40, 40, 40); }
  for (const т of точки) {
    if (т.цель) линия(т, т.цель, 120, 60, 60);
    клетка(т.x, т.y, ...т.цвет);
  }
  fs.writeFileSync(файл, png(w, h, rgb));
}

// ---- сам опыт
const журнал = [];
const предел = Math.round(СЕКУНД * 1000 / ТИК_МС);
const цельАтаки = трое[0];
let фаза = 'атака';
for (let тик = 0; тик < предел; тик++) {
  // первые две секунды — бьём ближайшего, дальше уходим прочь
  if (тик === 0) приказ(eng, наш, 0x1f, цельАтаки, кл(m, цельАтаки).x << 5, кл(m, цельАтаки).y << 5);
  if (тик === Math.round(2000 / ТИК_МС)) {
    фаза = 'отход';
    const c = кл(m, наш), з = кл(m, цельАтаки);
    const dx = c.x - з.x, dy = c.y - з.y, д = Math.hypot(dx, dy) || 1;
    приказ(eng, наш, 0x0f, 0, Math.round(c.x + dx / д * 12) << 5, Math.round(c.y + dy / д * 12) << 5);
  }
  eng.timer++; eng.tick();

  const c = кл(m, наш);
  const строка = { тик, сек: +(тик * ТИК_МС / 1000).toFixed(2), фаза,
    наш: { x: c.x, y: c.y, hp: m.u8(UNITS + наш + U.HP), сост: m.u8(UNITS + наш + U.STATE).toString(16),
           приказ: m.u8(UNITS + наш + U.ORDER).toString(16), цель: m.u32(UNITS + наш + U.TARGET) },
    звери: трое.map(з => { const зк = кл(m, з); const ц = m.u32(UNITS + з + U.TARGET);
      return { и: з, тип: m.u8(UNITS + з + U.TYPE), x: зк.x, y: зк.y, hp: m.u8(UNITS + з + U.HP),
               сост: m.u8(UNITS + з + U.STATE).toString(16), приказ: m.u8(UNITS + з + U.ORDER).toString(16),
               цель: ц, целитВНас: ц === наш, до: далеко(зк, c) }; }) };
  журнал.push(строка);

  if (тик % 9 === 0) {                       // кадр раз в полсекунды
    const точки = [{ x: c.x, y: c.y, цвет: [80, 220, 80] }];
    for (const з of строка.звери) точки.push({ x: з.x, y: з.y, цвет: з.целитВНас ? [230, 60, 60] : [140, 90, 40],
                                               цель: з.целитВНас ? { x: c.x, y: c.y } : null });
    кадр(path.join(ПАПКА, `к${String(тик).padStart(3, '0')}.png`), c, точки);
  }
}
fs.writeFileSync(path.join(ПАПКА, 'журнал.json'), JSON.stringify(журнал, null, 1));

// ---- краткая сводка: сколько тиков кто нас держал целью
const держали = {};
for (const с of журнал) for (const з of с.звери) if (з.целитВНас) держали[з.и] = (держали[з.и] || 0) + 1;
console.log('зверей в опыте:', трое.map(з => `#${з} т${m.u8(UNITS + з + U.TYPE)}`).join(' '));
console.log('держали нас целью (тиков):', Object.entries(держали).map(([и, н]) => `#${и}:${н}`).join(' ') || 'никто');
for (const с of журнал) if (с.тик % 9 === 0)
  console.log(`${String(с.сек).padStart(5)}с ${с.фаза} · наш ${с.наш.x},${с.наш.y} hp${с.наш.hp} сост${с.наш.сост} · ` +
    с.звери.map(з => `#${з.и}${з.целитВНас ? '→НАС' : '   '} сост${з.сост} в ${з.до}`).join(' · '));
