// Поиск функций, зарегистрированных в нескольких модулях порта
import fs from 'node:fs'; import path from 'node:path';
const dir = 'js/port'; const owners = new Map();
for (const f of fs.readdirSync(dir).sort()) { const src = fs.readFileSync(path.join(dir, f), 'utf8'); for (const m of src.matchAll(/F\[(0x[0-9a-f]+)\]\s*=/g)) { const a = m[1].toLowerCase(); if (!owners.has(a)) owners.set(a, []); owners.get(a).push(f); } }
let n = 0; for (const [a, fs_] of [...owners].sort()) if (fs_.length > 1) { n++; console.log(a, fs_.join(' '), fs.existsSync('claims/' + a) ? '' : '(без claim)'); }
console.log(`всего функций: ${owners.size}, дублей: ${n}`);
