// node js/test/rendertest.mjs traces/render_m0_t0 [traces/m0_t0] — сверка JS-рендера с кадрами эталона (индексы палитры, попиксельно)
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import { Mem, G } from '../mem.js'; import { Engine } from '../engine.js'; import '../modules.js'; import { FrameBuffer } from '../render/fb.js'; import { Renderer } from '../render/renderer.js';
const RECT = process.env.RECT ? process.env.RECT.split(',').map(Number) : [0, 0, 640, 480]; const EXCLS = process.env.EXCL ? process.env.EXCL.split(';').map(r => r.split(',').map(Number)) : []; // прямоугольники-исключения через ';' (курсор, HUD-текст)
/** Пиксель не попал в исключённые прямоугольники (там расхождения ожидаемы). */
const inRect = i => { const x = i % 640, y = (i / 640) | 0; for (const E of EXCLS) if (x >= E[0] && x < E[2] && y >= E[1] && y < E[3]) return false; return x >= RECT[0] && x < RECT[2] && y >= RECT[1] && y < RECT[3]; };
const dir = process.argv[2]; const simdir = process.argv[3] || dir.replace('render_', ''); const ix = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'))); const six = JSON.parse(fs.readFileSync(path.join(simdir, 'index.json')));
const mem = Mem.ofSize(); mem.b.set(zlib.inflateSync(fs.readFileSync(path.join(simdir, 'snap0.bin.z'))), six.data_lo); mem.w32(0x46c, six.per_step[0].timer - 1);
const P = '../PWAR/'; const files = {}; for (const f of fs.readdirSync(P)) if (/^_PWAR\d\d\.TR[CSW]$/.test(f)) files[f] = new Uint8Array(fs.readFileSync(P + f));
const eng = new Engine(mem); eng.files = files; const fb = new FrameBuffer(); const r = new Renderer(eng, fb, files);
/** Сохранить палитровый PNG: на нём глазами видно, где кадры разошлись. */
function png(name, px, pal) { // минимальный PNG (палитровый) для просмотра расхождений
  const w = 640, h = 480; const raw = Buffer.alloc((w + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; px.subarray(y * w, y * w + w).forEach((v, x) => raw[y * (w + 1) + 1 + x] = v); }
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  fs.writeFileSync(name, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', Buffer.from(pal)), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
let k = 0, total = 0, bad = 0;
for (const f of ix.frames) {
  while (k < f) { eng.timer = six.per_step[k].timer; eng.tick(); if (process.env.TICKDRAW !== '0') r.drawTick(); k++; }   // как в оригинале: рендер после каждого тика
  const ref = zlib.inflateSync(fs.readFileSync(path.join(dir, `frame_${String(f).padStart(4, '0')}.bin.z`))); const rpx = ref.subarray(0, 640 * 480), rpal = ref.subarray(640 * 480);
  if (f === 0) r.drawFull(); else r.drawTick(); let diff = 0, first = -1; for (let i = 0; i < rpx.length; i++) if (inRect(i) && fb.px[i] !== rpx[i]) { diff++; if (first < 0) first = i; }
  total++; if (diff) bad++;
  { let x0 = 640, y0 = 480, x1 = -1, y1 = -1; for (let i = 0; i < rpx.length; i++) if (inRect(i) && fb.px[i] !== rpx[i]) { const x = i % 640, y = (i / 640) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } if (x1 >= 0) console.log(`   bbox расхождений: x ${x0}..${x1} y ${y0}..${y1}`); }
  if (f > 0 && ix.pool) { const expPool = ix.pool[f - 1]; const md5 = (await import('node:crypto')).createHash('md5').update(mem.slice(0xe4400, 57600)).digest('hex').slice(0, 12); if (md5 !== expPool) console.log(`   ВНИМАНИЕ: пул юнитов после тика ${f} не совпадает с эталоном (render-трасса) (${md5} vs ${expPool})`); }
  console.log(`кадр на шаге ${f}: расхождений ${diff}${diff ? ` (первое x=${first % 640} y=${(first / 640) | 0}: got ${fb.px[first]} exp ${rpx[first]})` : ''}`);
  if (diff && process.env.DUMP) { png(`out_js_${f}.png`, fb.px, rpal); png(`out_ref_${f}.png`, rpx, rpal); }
}
console.log(`кадров: ${total}, с расхождениями: ${bad}`); process.exit(bad ? 1 : 0);
