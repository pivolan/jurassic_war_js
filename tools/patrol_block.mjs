// Патруль с недостижимой точкой (наше). Игрок ставит десять точек кликами и легко попадает в
// дерево, воду или под здание. Что тогда делает патрульный — и не зависает ли он там навсегда.
//
//   node tools/patrol_block.mjs
import { движок } from '../tools/ai_duel.mjs';
import { loadMission } from '../reimpl/js/loader.js';
import { расставить } from '../reimpl/js/port/skirmish.js';
const Патруль = await import('../reimpl/js/port/patrol.js');
const { приказ, установить } = await import('../reimpl/js/port/inject.js');
import { G, U, UNITS, BG, BI } from '../reimpl/js/mem.js';
const TILE_INF = 0x3183c;
const eng = движок(); const m = eng.m; установить();
loadMission(m, eng.files, 100, 0, 1);
расставить(eng, [{ цвет: 0, племя: 0, кто: 'компьютер' }], {});
m.w8(0x32aec, 0);
const тик = (n) => { for (let k = 0; k < n; k++) { eng.timer++; eng.tick(); } };
тик(4);
let боец = 0;
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
  const t = m.u8(UNITS + i + U.TYPE);
  if (m.u8(UNITS + i + U.OWNER) === 0 && t >= 1 && t <= 13) { боец = i; break; }
}
for (const f of [U.HPMAX, U.HP, U.DEF]) m.w8(UNITS + боец + f, 200);
const bx = m.u16(UNITS + боец + U.X) >> 5, by = m.u16(UNITS + боец + U.Y) >> 5;
/** Непроходимая клетка: по таблице тайлов или под крупным объектом. */
const непроходима = (x, y) => { const w = m.u16(BG + (y << 9) + x * 2); return !!(w & 0xf800) || (m.b[TILE_INF + (w & 0x7ff)] & 1) !== 1; };
let плохая = null;
for (let r = 2; r < 25 && !плохая; r++)
  for (let dy = -r; dy <= r && !плохая; dy++) for (let dx = -r; dx <= r && !плохая; dx++)
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && непроходима(bx + dx, by + dy)) плохая = { x: bx + dx, y: by + dy };
console.log(`боец ${боец} в ${bx},${by}; недостижимая точка`, плохая);
if (!плохая) { console.log('на этой карте не нашлось непроходимой клетки рядом'); process.exit(0); }
// маршрут: своя клетка → соседняя открытая → непроходимая
приказ(eng, боец, Патруль.ORDER_POINT, 0, bx << 5, by << 5); тик(6);
приказ(eng, боец, Патруль.ORDER_POINT, 0, (bx + 4) << 5, by << 5); тик(6);
приказ(eng, боец, Патруль.ORDER_POINT, 0, плохая.x << 5, плохая.y << 5); тик(6);
приказ(eng, боец, Патруль.ORDER_GO, 0, 0, 0); тик(4);
let стоит = 0, макс = 0, px = -1, py = -1, где = '', сост = 0;
const сч = new Map();
for (let k = 0; k < 6000; k++) {
  eng.timer++; eng.tick();
  const x = m.u16(UNITS + боец + U.X), y = m.u16(UNITS + боец + U.Y), ст = m.u8(UNITS + боец + U.STATE);
  сч.set(ст, (сч.get(ст) || 0) + 1);
  if (x === px && y === py) { стоит++; if (стоит > макс) { макс = стоит; где = `${x >> 5},${y >> 5}`; сост = ст; } }
  else { стоит = 0; px = x; py = y; }
}
const топ = [...сч].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([с, n]) => `0x${с.toString(16)}×${n}`).join(' ');
console.log(`максимум без движения: ${макс} шагов в ${где}, состояние 0x${сост.toString(16)} | ${топ}`);
console.log('маршрут в конце:', JSON.stringify(Патруль.route(eng, боец)));
