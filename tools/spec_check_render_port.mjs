// Помощник для tools/spec_check_render.py, раздел 7: прогоняет ПОРТ (reimpl/js/render/scene.js)
// на тех же случаях, что и эталон под unicorn, и пишет нарисованные пиксели в JSON.
// Вызов: node tools/spec_check_render_port.mjs cases.json out.json
// Кадровый буфер перед каждым случаем обнуляется, поэтому «что нарисовано» = все ненулевые пиксели.
import fs from 'node:fs'; import zlib from 'node:zlib';
import { Mem, UNITS, G } from '../reimpl/js/mem.js';
import { Engine } from '../reimpl/js/engine.js';
import '../reimpl/js/modules.js';
import { F, call } from '../reimpl/js/fn.js';

const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mem = Mem.ofSize();
mem.b.set(zlib.inflateSync(fs.readFileSync(cases.snapshot)), cases.data_lo);   // статические таблицы 0x3d1b8/0x3054d/0x3e3d8 и строки 0x122e74
const eng = new Engine(mem);
const FB = 0x1235f4, SLOT = 96 * 3;      // произвольная запись пула — обходов списка тут нет
const out = [];
for (const c of cases.cases) {
  mem.b.fill(0, FB, FB + 640 * 480);
  mem.b.fill(0, UNITS + SLOT, UNITS + SLOT + 96);
  mem.w8(UNITS + SLOT + 0x04, c.type); mem.w8(UNITS + SLOT + 0x06, c.owner); mem.w8(UNITS + SLOT + 0x07, 0x80);
  mem.w8(UNITS + SLOT + 0x0c, c.hpmax); mem.w8(UNITS + SLOT + 0x0e, c.hp);
  mem.w16(UNITS + SLOT + 0x2f, c.x); mem.w16(UNITS + SLOT + 0x31, c.y);
  mem.w8(G.humanOwner, c.local); mem.w32(0x31adc, c.lead ? SLOT : 0);
  mem.w32(0x31ae8, c.camx); mem.w32(0x31aec, c.camy);
  mem.w32(0x488c4, c.vw); mem.w32(0x488c8, c.vh);
  call(eng, 0x23f44, { esi: SLOT });
  const px = [];
  for (let k = 0; k < 640 * 480; k++) if (mem.b[FB + k]) px.push([k % 640, (k / 640) | 0, mem.b[FB + k]]);
  out.push(px);
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
