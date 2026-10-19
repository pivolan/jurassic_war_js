// Лобби и вход в идущую партию — проверка без браузера (js/net/игра.js через релей):
// открытая комната, список комнат /rooms, незнакомец входит в идущий матч и получает племя на
// одном и том же ходу у всех, наблюдатель получает снимок и крутит ту же симуляцию.
//   node tools/net_lobby.mjs [адрес релея]
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'reimpl') + '/';
import { Mem, G, U, UNITS } from '../reimpl/js/mem.js';
import { loadMission } from '../reimpl/js/loader.js';
import '../reimpl/js/modules.js';
const { setPathMode } = await import('../reimpl/js/port/path.js');
const { КОД } = await import('../reimpl/js/port/inject.js');
const { люди } = await import('../reimpl/js/port/humans.js');
const { СетеваяИгра } = await import('../reimpl/js/net/игра.js');
setPathMode('astar');
const АДРЕС = process.argv[2] || 'ws://127.0.0.1:8791/';
const HTTP = АДРЕС.replace(/^ws/, 'http').replace(/\/$/, '') + '/rooms';
const образ = zlib.inflateSync(fs.readFileSync(КОРЕНЬ + 'data/boot_snap.bin.z'));
const files = {}; for (const f of ['_PWAR01.TRC', '_PWAR05.TRS', '_PWAR08.TRC', '_PWAR09.TRC', '_PWAR13.TRC']) files[f] = new Uint8Array(fs.readFileSync(КОРЕНЬ + '../PWAR/' + f));
const чистая = () => { const m = Mem.ofSize(); m.b.set(образ, 0x30000); m.w32(0x46c, 110); return m; };
const комната = 'лобби-' + Date.now();
const узлы = [];
function узел(k, ключ) {
  const у = { k, eng: null, журнал: [], игра: null };
  у.игра = new СетеваяИгра({ ключ, движок: () => у.eng, память: () => у.eng?.m,
    загрузить: async (миссия, племя, сложность) => { у.eng = loadMission(чистая(), files, миссия, племя, сложность); у.eng.files = files; return у.eng; },
    владельцы: async (миссия, племя) => { const m = чистая(); loadMission(m, files, миссия, племя, 1); const есть = new Set();
      for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { const t = m.u8(UNITS + i + U.TYPE), вл = m.u8(UNITS + i + U.OWNER); if (t >= 1 && t <= 13 && вл < 8) есть.add(вл); } return [...есть].sort((a, b) => a - b); },
    наСтатус: (т) => { if (т) у.журнал.push(т); } });
  узлы.push(у); return у;
}
const жди = (мс) => new Promise(r => setTimeout(r, мс));
const сост = (у) => { const л = у.игра.лс; return `${у.k}:${у.игра.фаза}${у.игра.готова ? '' : '(не готов)'}${у.игра.наблюдатель ? ' набл' : ''} ход ${л?.ход ?? '-'}${л?.ждём?.length ? ' ждём ' + л.ждём : ''}${л?.расхождение ? ' РАСХ' : ''}`; };
async function пока(усл, мс, что) { const t0 = Date.now(); while (Date.now() - t0 < мс) { if (усл()) return true; await жди(50); } console.log('НЕ ДОЖДАЛИСЬ:', что, '·', узлы.map(сост).join(' | ')); for (const у of узлы) console.log(`   журнал ${у.k}:`, у.журнал.slice(-5).join(' / ')); return false; }
function сверить(живые) { const общий = Math.min(...живые.map(у => у.игра.лс.ход)) - 1; const х = живые.map(у => у.игра.лс.хеши.get(общий)); const ок = х.every(v => v !== undefined && v === х[0]);
  console.log(`  ход ${общий}: хеши ${х.map(v => v?.toString(16)).join('/')} — ${ок ? 'совпали' : 'РАЗНЫЕ'}`); return ок; }
const тикер = setInterval(() => { for (const у of узлы) if (у.игра.активна) у.игра.тик(false); }, 5);
const приказы = setInterval(() => { for (const у of узлы) { const л = у.игра.лс; if (!у.игра.активна || !у.игра.готова || !л || у.игра.наблюдатель || у.игра.моёПлемя === undefined) continue;
  const m = у.eng.m, мои = []; for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { const t = m.u8(UNITS + i + U.TYPE); if (t >= 1 && t <= 13 && m.u8(UNITS + i + U.OWNER) === у.игра.моёПлемя && !(m.u8(UNITS + i + U.FLAGS5B) & 1)) мои.push(i); }
  if (мои.length) { const i = мои[(л.ход * 7 + у.k) % мои.length]; л.прикажи(i, КОД.ИДТИ, 0, ((m.u16(UNITS + i + U.X) >> 5) + (у.k + 1) * 3) % m.u32(G.mapW) << 5, m.u16(UNITS + i + U.Y)); } } }, 300);
let ок = true;
// ---- хост создаёт открытую комнату, второй игрок входит, старт
const а = узел(0, 'к0-' + комната); await а.игра.войти(АДРЕС, комната, 'хост'); await жди(300);
await пока(() => а.игра.лобби.доступные.length, 15000, 'карта у хоста'); а.игра.задатьОткрытость(true);
const б = узел(1, 'к1-' + комната); await б.игра.войти(АДРЕС, комната, 'второй'); await жди(800);
а.игра.место(2, 'компьютер'); а.игра.место(3, 'закрыть'); await жди(400);   // режим «наборы»: место 2 — компьютер (в него потом войдёт незнакомец), 3 закрыто
console.log('места:', JSON.stringify(а.игра.лобби.места.map(м => `${м.цвет}:${м.кто}${м.кто === 'игрок' ? '#' + м.игрок : ''}/${м.племя}`)));
let список = await (await fetch(HTTP)).json(); let к = список.find(r => r.имя === комната);
console.log('список до старта:', JSON.stringify({ статус: к.статус, миссия: к.миссия, открытая: к.открытая, мест: к.мест, игроков: к.игроков, места: к.места.map(м => `${м.имя}:${м.племя}`) }));
ок &= к.статус === 'ожидание' && к.открытая && к.игроков === 2;
а.игра.старт();
if (!await пока(() => узлы.every(у => у.игра.активна && у.игра.готова), 20000, 'старт')) process.exit(1);
await пока(() => узлы.every(у => у.игра.лс.ход >= 25), 20000, '25 ходов');
ок &= сверить(узлы);
список = await (await fetch(HTTP)).json(); к = список.find(r => r.имя === комната);
console.log('список в игре:', JSON.stringify({ статус: к.статус, игроков: к.игроков, места: к.места.map(м => `${м.имя}:${м.племя}`) }));
ок &= к.статус === 'игра';
// ---- незнакомец входит в идущий матч
console.log('— незнакомец входит в идущую партию');
const в = узел(2, 'к2-' + комната); await в.игра.войти(АДРЕС, комната, 'незнакомец');
await пока(() => в.игра.лобби.идёт, 5000, 'лобби идущей партии'); console.log('  лобби у незнакомца:', JSON.stringify({ идёт: в.игра.лобби.идёт, племена: в.игра.лобби.племена, доступные: в.игра.лобби.доступные })); в.игра.хочуИграть(2);
if (!await пока(() => в.игра.активна && в.игра.готова, 20000, 'вход незнакомца')) ок = false;
console.log('  ', сост(в), '·', в.журнал.slice(-3).join(' / '));
const ходВхода = в.игра.лс.ход;
if (!await пока(() => узлы.every(у => у.игра.лс.ход >= ходВхода + 30), 30000, '30 ходов после входа')) ок = false;
const наборы = узлы.map(у => [...(люди(у.eng.m) || [])].sort().join(','));
console.log('  люди у каждого:', наборы.join(' | '), наборы.every(x => x === наборы[0]) ? 'одинаково' : 'РАЗНЫЕ');
ок &= наборы.every(x => x === наборы[0]) && наборы[0].split(',').length === 3;
console.log('  армии после старта (хост):', (() => { const m = а.eng.m, по = {}; for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { const o = m.u8(UNITS + i + U.OWNER); if (o < 8 && !(m.u8(UNITS + i + U.FLAGS5B) & 1)) по[o] = (по[o] || 0) + 1; } return JSON.stringify(по); })());
ок &= сверить(узлы);
console.log('  племя незнакомца:', в.игра.моёПлемя, '· у хоста в параметрах:', а.игра.параметры.племена[в.игра.я]);
// ---- наблюдатель
console.log('— наблюдатель входит');
const г = узел(3, 'к3-' + комната); await г.игра.войти(АДРЕС, комната, 'зритель', 'наблюдатель'); await жди(500); г.игра.хочуСмотреть();
if (!await пока(() => г.игра.активна && г.игра.готова, 20000, 'вход наблюдателя')) ок = false;
console.log('  ', сост(г), '·', г.журнал.slice(-2).join(' / '));
const ходНабл = г.игра.лс.ход;
if (!await пока(() => узлы.every(у => у.игра.лс.ход >= ходНабл + 30), 30000, '30 ходов с наблюдателем')) ок = false;
ок &= сверить(узлы);
г.игра.задатьТуман('нет'); await жди(500); const открыто = (() => { let n = 0; for (let k = 0; k < 0xb000; k++) n += г.eng.m.b[0x10ce74 + k] & 1; return n; })();
г.игра.задатьТуман('племя', 1); await жди(700); const заПлемя = (() => { let n = 0; for (let k = 0; k < 0xb000; k++) n += г.eng.m.b[0x10ce74 + k] & 1; return n; })();
г.игра.задатьТуман('все'); await жди(700); const заВсех = (() => { let n = 0; for (let k = 0; k < 0xb000; k++) n += г.eng.m.b[0x10ce74 + k] & 1; return n; })();
console.log(`  туман: без тумана ${открыто} клеток, за племя 1 — ${заПлемя}, за всех — ${заВсех}`, открыто === 0xb000 && заПлемя > 0 && заВсех > заПлемя ? 'ок' : 'СТРАННО');
ок &= открыто === 0xb000 && заПлемя > 0 && заВсех > заПлемя;
ок &= сверить(узлы);
список = await (await fetch(HTTP)).json(); к = список.find(r => r.имя === комната);
console.log('список:', JSON.stringify({ статус: к.статус, игроков: к.игроков, наблюдателей: к.наблюдателей, мест: к.мест }));
ок &= к.игроков === 3 && к.наблюдателей === 1;
// ---- все выходят — комната закрывается
for (const у of узлы) у.игра.выйти(); await жди(500);
список = await (await fetch(HTTP)).json();
console.log('после выхода всех комната', список.find(r => r.имя === комната) ? 'ОСТАЛАСЬ' : 'закрылась');
ок &= !список.find(r => r.имя === комната);
console.log(ок ? 'ЛОББИ РАБОТАЕТ' : 'ЕСТЬ ПРОБЛЕМЫ');
clearInterval(тикер); clearInterval(приказы); process.exit(ок ? 0 : 1);
