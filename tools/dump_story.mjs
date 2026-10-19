// Сюжетные тексты игры в один файл: 96 брифингов (_PWAR09.TRC, записи 80..175) и восемь
// историй племён с экрана выбора клана. node tools/dump_story.mjs > reimpl/data/story_en.json
import fs from 'node:fs';
import { Archive } from '../reimpl/js/archive.js';
const P = '../PWAR/', D = '../reimpl/data/';
const a = new Archive(new Uint8Array(fs.readFileSync(P + '_PWAR09.TRC')));
const dec = d => { let s = ''; for (const c of d) s += String.fromCharCode(c); return s; };
const briefs = {};
for (let mi = 0; mi < 12; mi++) for (let t = 0; t < 8; t++) {
  const s = dec(a.data(80 + mi * 8 + t)); let p = 0;
  const take = n => { const out = []; for (let i = 0; i < n; i++) { const e = s.indexOf('\r\n', p); const end = e < 0 ? s.length : e; out.push(s.slice(p, end).replace(/\s+$/, '')); p = e < 0 ? s.length : e + 2; } return out; };
  const head = take(s.charCodeAt(p++) || 0), body = take(s.charCodeAt(p++) || 0);
  briefs[`${mi}_${t}`] = { head: head.filter(l => l !== ''), body: body.join(' ').replace(/\s+/g, ' ').trim() };
}
const tribes = JSON.parse(fs.readFileSync(D + 'tribe_story.json', 'utf8')).tribes;
const out = { _: 'Английский оригинал сюжетных текстов: story.briefs["миссия_племя"] и story.tribes[племя]. Извлекается tools/dump_story.mjs.',
  briefs, tribes: Object.fromEntries(Object.entries(tribes).map(([k, v]) => [k, { title: v.title, text: v.lines.join(' ').replace(/\s+/g, ' ').trim() }])) };
process.stdout.write(JSON.stringify(out, null, 1));
