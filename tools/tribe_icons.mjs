// Значки племён для лобби, выбора уровня и сайта (наше): out/ui/icons/<племя>.png.
//
// Каждое племя показывается тем юнитом, которым оно и правда воюет, в своих цветах, и с той
// вещью в руках, по которой его узнают. Рисуем не «вырезкой спрайта», а самой отрисовкой игры
// (0x25151): она сама складывает тело и надетое оружие по их смещениям, и стойка «с луком»
// получается настоящая, а не собранная на глаз.
//
// Почему это важно: раньше у RaDumBa на значке стоял карнотавр. Карнотавров у них нет вовсе —
// маска Святилища даёт им только Казарму, Оружейную и склад, никаких домов динозавров; дино
// появляются у них по сюжету лишь после поглощения Koaka (поправка из Дискорда).
//
// Остальные семь значков подобраны руками ещё раньше и выглядят выразительнее (у Ka-noo-se
// узнаваемое красное платье, у Moospell посох, у Koomba удар ногой), поэтому по умолчанию
// инструмент ничего не трогает: перерисовывает только те племена, номера которых ему дали.
//
//   node tools/tribe_icons.mjs 6        — перерисовать значок RaDumBa
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'reimpl') + '/';
const { Mem, U, UNITS } = await import(КОРЕНЬ + 'js/mem.js');
const { loadMission } = await import(КОРЕНЬ + 'js/loader.js');
const { Engine } = await import(КОРЕНЬ + 'js/engine.js');
await import(КОРЕНЬ + 'js/modules.js');
const { F, call } = await import(КОРЕНЬ + 'js/fn.js');
const { fixSlotPointers, XBASE, ROWS } = await import(КОРЕНЬ + 'js/render/scene.js');
const PAL = 0x44980, VW = 512, VH = 480;
const КУДА = path.join(КОРЕНЬ, '..', 'out', 'ui', 'icons');

// племя → [файл, тип юнита, вещь в руках (0 — без), направление].
// Тип — из стартового набора племени (js/port/skirmish.js), направление подобрано так, чтобы
// фигура читалась в мелком размере.
const ЗНАЧКИ = [
  ['tyrano',   12, 0, 5],   // Triceratops
  ['kanoose',   5, 0, 5],   // Elf
  ['romack',    8, 0, 5],   // Ranger
  ['masai',     3, 1, 5],   // Warrior с мечом
  ['moospell',  7, 0, 5],   // Warlock
  ['koomba',    2, 0, 5],   // Muscle-man
  ['radumba',   2, 6, 5],   // Muscle-man с огненной стрелой — по ней их и узнают
  ['koaka',    11, 0, 5],   // Rhamphorhynchus
];

const files = {}; for (const f of fs.readdirSync(КОРЕНЬ + '../PWAR')) if (/^_PWAR\d+\.TR[CSW]$/.test(f)) files[f] = new Uint8Array(fs.readFileSync(КОРЕНЬ + '../PWAR/' + f));
const образ = zlib.inflateSync(fs.readFileSync(КОРЕНЬ + 'data/boot_snap.bin.z'));

function png(w, h, rgba) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const T = Buffer.from(t), L = Buffer.alloc(4); L.writeUInt32BE(d.length); const C = Buffer.alloc(4); C.writeUInt32BE(crc(Buffer.concat([T, d]))); return Buffer.concat([L, T, d, C]); };
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Нарисовать одного юнита на пустом кадре и вырезать по непрозрачному. */
function значок(eng, юнит, файл) {
  const m = eng.m, base = m.u32(XBASE);
  m.w32(0x31ae8, 0); m.w32(0x31aec, 0);                                  // камера в начало: юнит стоит близко к углу
  for (let y = 0; y < VH; y++) { const o = base + m.u32(ROWS + y * 4); for (let x = 0; x < VW; x++) m.b[o + x] = 0; }
  F[0x25151](eng, { esi: юнит });
  let x0 = VW, y0 = VH, x1 = -1, y1 = -1;
  for (let y = 0; y < VH; y++) { const o = base + m.u32(ROWS + y * 4); for (let x = 0; x < VW; x++) if (m.b[o + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) return null;
  const W = x1 - x0 + 1, H = y1 - y0 + 1, rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) { const o = base + m.u32(ROWS + (y + y0) * 4);
    for (let x = 0; x < W; x++) { const c = m.b[o + x + x0]; if (!c) continue; const p = (y * W + x) * 4;
      rgba[p] = m.b[PAL + c * 3]; rgba[p + 1] = m.b[PAL + c * 3 + 1]; rgba[p + 2] = m.b[PAL + c * 3 + 2]; rgba[p + 3] = 255; } }
  fs.writeFileSync(файл, png(W, H, rgba)); return { w: W, h: H };
}

const какие = process.argv.slice(2).map(Number).filter(n => n >= 0 && n < 8);
if (!какие.length) { console.log('укажи номера племён: 0 Tyrano … 7 Koaka. Без номеров ничего не трогаем — остальные значки подобраны руками.'); process.exit(0); }
for (let племя = 0; племя < 8; племя++) {
  if (!какие.includes(племя)) continue;
  const [имя, тип, вещь, dir] = ЗНАЧКИ[племя];
  const m = Mem.ofSize(); m.b.set(образ, 0x30000); m.w32(0x46c, 110);
  loadMission(m, files, 101, племя, 1); fixSlotPointers(m);
  const eng = new Engine(m); eng.files = files;
  const r = call(eng, 0x1caf0, { eax: тип | (племя << 8), ecx: племя, edx: 10 << 5, ebx: 10 << 5 });
  const i = r.esi >>> 0;
  if (!i || r.cf) { console.log(`${имя}: юнит ${тип} не создался`); continue; }
  if (вещь) { m.w8(UNITS + i + U.INV, вещь); m.w8(UNITS + i + U.WEAPON, 0); }
  m.w8(UNITS + i + U.DIR, dir); m.w8(UNITS + i + U.STATE, 0x38);
  m.w8(UNITS + i + U.F07, m.u8(UNITS + i + U.F07) & 0x7f);               // без рамки выделения
  const итог = значок(eng, i, path.join(КУДА, имя + '.png'));
  console.log(`${имя.padEnd(9)} племя ${племя}, юнит ${тип}${вещь ? ', вещь ' + вещь : ''} → ${итог ? итог.w + '×' + итог.h : 'пусто'}`);
}
