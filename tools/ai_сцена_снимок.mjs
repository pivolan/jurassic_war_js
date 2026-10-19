// Снимки куска карты под учебную сцену (наше).
//
//   node tools/ai_сцена_снимок.mjs [--миссия=0] [--племя=0] [--сложность=2] [--куда=out/сцена]
//
// Зачем. Владелец просит вырезать из карты Тирано кусок вокруг старта и сделать из него стенд:
// «обрезать карту, вытянуть из неё кусок, от стартового поля увеличить область в полтора раза и
// только её взять; сцену сначала скриншотами накидай, я откорректирую». Здесь и рисуются эти
// картинки: вся карта без тумана, зверьё подписано видом и здоровьем, наши — зелёным, а поверх
// показана рамка предлагаемого куска. Вариантов рамки сразу несколько, чтобы выбрать глазами.
//
// Цвета — те же, что у мини-карты в игре (таблица 0x3e8aa по тайлу), поэтому вода, песок и трава
// выглядят как в игре. Это схема, а не снимок экрана: зум в кампании недоступен (он только у
// наблюдателя в сети), и показать одним кадром четверть карты в игровом виде нельзя.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'reimpl') + '/';
import { Mem, G, U, UNITS, BG, BI, MO } from '../reimpl/js/mem.js';
import { loadMission } from '../reimpl/js/loader.js';
import '../reimpl/js/modules.js';

const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const МИССИЯ = +(арг.миссия ?? 0), ПЛЕМЯ = +(арг.племя ?? 0), СЛОЖНОСТЬ = +(арг.сложность ?? 2);
const КУДА = path.join(КОРЕНЬ, '..', арг.куда || 'out/сцена'); fs.mkdirSync(КУДА, { recursive: true });
const PAL = 0x44980, COL_TILE = 0x3e8aa, COL_OWNER = 0x3e8a0;
const КЛЕТКА = 9;                        // точек на клетку карты
const ЗВЕРЬ = (t) => t >= 14 && t <= 23;

const files = {}; for (const f of ['_PWAR01.TRC', '_PWAR05.TRS', '_PWAR08.TRC', '_PWAR09.TRC']) files[f] = new Uint8Array(fs.readFileSync(КОРЕНЬ + '../PWAR/' + f));
const образ = zlib.inflateSync(fs.readFileSync(КОРЕНЬ + 'data/boot_snap.bin.z'));

function png(w, h, rgb) {                // минимальный PNG без зависимостей
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Мелкий шрифт 3×5 для подписей прямо в картинке: цифры и нужные буквы.
const ШРИФТ = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  'т': ['111', '010', '010', '010', '010'], 'x': ['101', '101', '010', '101', '101'],
  ':': ['000', '010', '000', '010', '000'], '-': ['000', '000', '111', '000', '000'], ' ': ['000', '000', '000', '000', '000'],
};

const m = Mem.ofSize(); m.b.set(образ, 0x30000); m.w32(0x46c, 110);
loadMission(m, files, МИССИЯ, ПЛЕМЯ, СЛОЖНОСТЬ);
const W = m.u32(G.mapW), H = m.u32(G.mapH), b = m.b;
const мой = m.u8(G.humanOwner);

// Что на карте: наши и зверьё.
const наши = [], звери = [];
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (b[UNITS + i + U.FLAGS5B] & 1) continue;
  const t = b[UNITS + i + U.TYPE];
  const п = { x: m.u16(UNITS + i + U.X) >> 5, y: m.u16(UNITS + i + U.Y) >> 5, т: t, hp: b[UNITS + i + U.HP] };
  if (b[UNITS + i + U.OWNER] === мой && t < 0x1a) наши.push(п); else if (ЗВЕРЬ(t)) звери.push(п);
}
const центр = наши.length
  ? { x: Math.round(наши.reduce((s, п) => s + п.x, 0) / наши.length), y: Math.round(наши.reduce((s, п) => s + п.y, 0) / наши.length) }
  : { x: W >> 1, y: H >> 1 };
console.log(`карта ${W}×${H}, наши ${наши.length} у (${центр.x},${центр.y}), зверья ${звери.length}`);

/** Нарисовать всю карту в буфер RGB по КЛЕТКА точек на клетку. */
function холст() {
  const ш = W * КЛЕТКА, в = H * КЛЕТКА; const rgb = Buffer.alloc(ш * в * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cell = (y << 8) | x;
    const col = b[COL_TILE + (m.u16(BG + cell * 2) & 0x7ff)];
    const [r, g, bl] = [b[PAL + col * 3], b[PAL + col * 3 + 1], b[PAL + col * 3 + 2]];
    for (let dy = 0; dy < КЛЕТКА; dy++) for (let dx = 0; dx < КЛЕТКА; dx++) {
      const p = ((y * КЛЕТКА + dy) * ш + x * КЛЕТКА + dx) * 3;
      rgb[p] = r; rgb[p + 1] = g; rgb[p + 2] = bl;
    }
  }
  return { rgb, ш, в };
}
const точка = (c, x, y, цв) => { if (x < 0 || y < 0 || x >= c.ш || y >= c.в) return; const p = (y * c.ш + x) * 3; c.rgb[p] = цв[0]; c.rgb[p + 1] = цв[1]; c.rgb[p + 2] = цв[2]; };
const прямоуг = (c, x0, y0, x1, y1, цв, толщ = 1) => {
  for (let t = 0; t < толщ; t++) { for (let x = x0; x <= x1; x++) { точка(c, x, y0 + t, цв); точка(c, x, y1 - t, цв); }
    for (let y = y0; y <= y1; y++) { точка(c, x0 + t, y, цв); точка(c, x1 - t, y, цв); } }
};
const залить = (c, x0, y0, x1, y1, цв) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) точка(c, x, y, цв); };
const надпись = (c, s, x, y, цв) => { let dx = 0;
  for (const ch of String(s)) { const г = ШРИФТ[ch] || ШРИФТ[' ']; 
    for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (г[r][k] === '1') { точка(c, x + dx + k, y + r, цв); }
    dx += 4; } };

// Варианты рамки. Владелец: «от стартового поля по центру камеры увеличить область в полтора
// раза», «снизу почти ничего не надо — там вода», «чуть справа захватить, вверх и влево побольше».
// Кадр игры — 20×15 клеток; в полтора раза это 30×22. От него и пляшем, сдвигая вверх-влево.
const БАЗА_Ш = 30, БАЗА_В = 22;
const ВАРИАНТЫ = [
  { имя: '01-ровно-по-центру', ш: БАЗА_Ш, в: БАЗА_В, dx: 0, dy: 0 },
  { имя: '02-вверх-влево', ш: БАЗА_Ш, в: БАЗА_В, dx: -4, dy: -4 },
  { имя: '03-вверх-влево-сильнее', ш: БАЗА_Ш, в: БАЗА_В, dx: -7, dy: -7 },
  { имя: '04-шире-вверх', ш: 36, в: 24, dx: -3, dy: -6 },
  { имя: '05-шире-влево', ш: 38, в: 22, dx: -8, dy: -4 },
  { имя: '06-квадрат-32', ш: 32, в: 32, dx: -2, dy: -8 },
  { имя: '07-узкий-высокий', ш: 26, в: 28, dx: -2, dy: -8 },
  { имя: '08-широкий-низкий', ш: 42, в: 18, dx: -6, dy: -2 },
  { имя: '09-почти-четверть', ш: 40, в: 28, dx: -6, dy: -8 },
  { имя: '10-плотный-у-старта', ш: 24, в: 18, dx: -2, dy: -2 },
];

const ЗЕЛ = [90, 240, 90], КРАС = [250, 70, 70], ЖЁЛТ = [250, 230, 60], БЕЛ = [255, 255, 255], ЧЁРН = [0, 0, 0];
for (const в of ВАРИАНТЫ) {
  const c = холст();
  // зверьё: точка с подписью «тип:здоровье»
  for (const з of звери) {
    const x = з.x * КЛЕТКА, y = з.y * КЛЕТКА;
    залить(c, x + 1, y + 1, x + КЛЕТКА - 2, y + КЛЕТКА - 2, КРАС);
    надпись(c, 'т' + з.т, x + 1, y + КЛЕТКА, ЧЁРН);
    надпись(c, 'т' + з.т, x, y + КЛЕТКА - 1, БЕЛ);
  }
  for (const н of наши) {
    const x = н.x * КЛЕТКА, y = н.y * КЛЕТКА;
    залить(c, x + 1, y + 1, x + КЛЕТКА - 2, y + КЛЕТКА - 2, ЗЕЛ);
  }
  // рамка куска
  const x0 = Math.max(0, центр.x + в.dx - (в.ш >> 1)), y0 = Math.max(0, центр.y + в.dy - (в.в >> 1));
  const x1 = Math.min(W - 1, x0 + в.ш - 1), y1 = Math.min(H - 1, y0 + в.в - 1);
  прямоуг(c, x0 * КЛЕТКА, y0 * КЛЕТКА, (x1 + 1) * КЛЕТКА - 1, (y1 + 1) * КЛЕТКА - 1, ЖЁЛТ, 2);
  // сколько зверья внутри
  const внутри = звери.filter(з => з.x >= x0 && з.x <= x1 && з.y >= y0 && з.y <= y1);
  const поВидам = {}; for (const з of внутри) поВидам[з.т] = (поВидам[з.т] || 0) + 1;
  надпись(c, `${в.ш}x${в.в}`, x0 * КЛЕТКА + 3, y0 * КЛЕТКА + 3, ЖЁЛТ);
  fs.writeFileSync(path.join(КУДА, в.имя + '.png'), png(c.ш, c.в, c.rgb));
  console.log(`${в.имя}: клетки (${x0},${y0})-(${x1},${y1}), ${в.ш}×${в.в}, зверья внутри ${внутри.length} — ` +
    Object.entries(поВидам).sort((a, b) => a[0] - b[0]).map(([т, n]) => `т${т}×${n}`).join(' '));
}
console.log('картинки:', КУДА);
