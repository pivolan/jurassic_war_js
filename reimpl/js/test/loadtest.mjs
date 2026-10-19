// Сверка JS-загрузчика миссии со снимком эталона: node js/test/loadtest.mjs traces/m0_t0
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import { Mem, G, UNITS } from '../mem.js'; import { loadMission } from '../loader.js'; import '../modules.js';
const dir = process.argv[2] || 'traces/m0_t0'; const ix = JSON.parse(fs.readFileSync(path.join(dir, 'index.json')));
const exp = zlib.inflateSync(fs.readFileSync(path.join(dir, 'snap0.bin.z'))); const DATA_LO = 0x30000;
const boot = zlib.inflateSync(fs.readFileSync('data/boot_snap.bin.z'));
const mem = Mem.ofSize(); mem.b.set(boot, DATA_LO); mem.w32(0x46c, ix.per_step[0].timer - 1);
const P = '../PWAR/'; const files = {}; for (const f of ['_PWAR08.TRC', '_PWAR09.TRC', '_PWAR01.TRC']) files[f] = new Uint8Array(fs.readFileSync(P + f));
try { loadMission(mem, files, ix.mission, ix.tribe, ix.difficulty); } catch (e) { console.log('loadMission:', e.message); }
// сравнение по регионам
const got = mem.b.subarray(DATA_LO); let ranges = [], cur = null;
for (let a = 0; a < exp.length; a++) { if (got[a] !== exp[a]) { if (cur && a - cur[1] < 16) cur[1] = a + 1; else { cur = [a, a + 1]; ranges.push(cur); } } }
console.log(`различающихся диапазонов: ${ranges.length}, байт всего: ${ranges.reduce((s, r) => s + r[1] - r[0], 0)}`);
for (const [a, b] of ranges.slice(0, 40)) console.log(`  0x${(a + DATA_LO).toString(16)}..0x${(b + DATA_LO).toString(16)} (${b - a}) got ${[...got.subarray(a, Math.min(b, a + 6))]} exp ${[...exp.subarray(a, Math.min(b, a + 6))]}`);
