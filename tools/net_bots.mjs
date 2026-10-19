// Комнаты-«болванчики» для живой проверки лобби: игроки в Node крутят партию через релей, а
// человек заходит в неё из браузера как игрок (комната открытая) или наблюдателем.
//   node tools/net_bots.mjs [минут]   — две комнаты: идущая партия с двумя ботами и комната
//   ожидания с одним ботом-хостом, который стартует, как только к нему кто-то зайдёт.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'reimpl') + '/';
import { Mem, G, U, UNITS } from '../reimpl/js/mem.js';
import { loadMission } from '../reimpl/js/loader.js';
import '../reimpl/js/modules.js';
const { setPathMode } = await import('../reimpl/js/port/path.js');
const { КОД } = await import('../reimpl/js/port/inject.js');
const { СетеваяИгра } = await import('../reimpl/js/net/игра.js');
setPathMode('astar');
const МИНУТ = +(process.argv[2] || 120), АДРЕС = 'ws://127.0.0.1:8791/';
const образ = zlib.inflateSync(fs.readFileSync(КОРЕНЬ + 'data/boot_snap.bin.z'));
const files = {}; for (const f of ['_PWAR01.TRC', '_PWAR05.TRS', '_PWAR08.TRC', '_PWAR09.TRC', '_PWAR13.TRC']) files[f] = new Uint8Array(fs.readFileSync(КОРЕНЬ + '../PWAR/' + f));
const чистая = () => { const m = Mem.ofSize(); m.b.set(образ, 0x30000); m.w32(0x46c, 110); return m; };
const боты = [];
function бот(имя, ключ) {
  const у = { имя, eng: null, игра: null };
  у.игра = new СетеваяИгра({ ключ, движок: () => у.eng, память: () => у.eng?.m,
    загрузить: async (миссия, племя, сложность) => { у.eng = loadMission(чистая(), files, миссия, племя, сложность); у.eng.files = files; return у.eng; },
    владельцы: async (миссия, племя) => { const m = чистая(); loadMission(m, files, миссия, племя, 1); const е = new Set();
      for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { const t = m.u8(UNITS + i + U.TYPE), в = m.u8(UNITS + i + U.OWNER); if (t >= 1 && t <= 13 && в < 8) е.add(в); } return [...е].sort((a, b) => a - b); },
    наСтатус: (т) => { if (т) console.log(`[${имя}] ${т}`); } });
  боты.push(у); return у;
}
const жди = (мс) => new Promise(r => setTimeout(r, мс));
/** Войти в комнату; если релей не пустил (комната занята мёртвыми местами прошлого запуска) — под соседним именем. */
async function войти(у, имя, ник) {
  for (let n = 0; n < 5; n++) { const название = n ? `${имя} ${n + 1}` : имя;
    try { await у.игра.войти(АДРЕС, название, ник); return название; } catch (e) { console.log(`[${ник}] «${название}»: ${e.message}`); } }
  throw new Error('не удалось войти: ' + имя);
}
process.on('uncaughtException', (e) => console.log('ошибка:', e.message));
// тик как в браузере — 55 мс; приказы своим бойцам раз в пару секунд, чтобы что-то происходило
setInterval(() => { for (const у of боты) if (у.игра.активна) у.игра.тик(false); }, 55);
setInterval(() => { for (const у of боты) { const л = у.игра.лс; if (!у.игра.активна || !у.игра.готова || !л || у.игра.моёПлемя === undefined) continue;
  const m = у.eng.m, мои = []; for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { const t = m.u8(UNITS + i + U.TYPE); if (t >= 1 && t <= 13 && m.u8(UNITS + i + U.OWNER) === у.игра.моёПлемя && !(m.u8(UNITS + i + U.FLAGS5B) & 1)) мои.push(i); }
  if (!мои.length) continue; const i = мои[Math.floor(Math.random() * мои.length)];
  const x = Math.max(0, Math.min(m.u32(G.mapW) - 1, (m.u16(UNITS + i + U.X) >> 5) + Math.floor(Math.random() * 9) - 4)), y = Math.max(0, Math.min(m.u32(G.mapH) - 1, (m.u16(UNITS + i + U.Y) >> 5) + Math.floor(Math.random() * 9) - 4));
  л.прикажи(i, КОД.ИДТИ, 0, x << 5, y << 5); } }, 2500);
// ---- комната 1: идущая открытая партия, два бота
const К = '-' + Date.now();   // ключи на каждый запуск свои: иначе новые боты садятся на места старых, если релей ещё не заметил их уход
const а = бот('бот-Тирано', 'бот-а' + К), б = бот('бот-Кануси', 'бот-б' + К);
const к1 = await войти(а, 'битва ботов', 'бот-Тирано'); await жди(1500); а.игра.задатьОткрытость(true);
await войти(б, к1, 'бот-Кануси'); await жди(2000);
а.игра.место(2, 'компьютер'); а.игра.место(3, 'компьютер'); await жди(600);   // два места за компьютером — в них можно войти по ходу партии
а.игра.старт();
// ---- комната 3: идущая открытая партия на сетевой карте Titan Plains (пак 13, 256×176, восемь племён)
const г = бот('бот-Масаи', 'бот-г' + К), д = бот('бот-Ромак', 'бот-д' + К);
const к3 = await войти(г, 'Titan Plains', 'бот-Масаи'); await жди(1500); г.игра.задатьМиссию(117, 1); await жди(1500); г.игра.задатьОткрытость(true);
await войти(д, к3, 'бот-Ромак'); await жди(2000);
г.игра.место(2, 'компьютер'); г.игра.место(3, 'компьютер'); await жди(600);
г.игра.старт();
// ---- комната 2: ожидание; бот-хост стартует, как только зайдёт живой игрок
const в = бот('бот-ждущий', 'бот-в' + К);
await войти(в, 'жду соперника', 'бот-ждущий'); await жди(1500); в.игра.задатьОткрытость(true);
setInterval(() => { if (в.игра.фаза === 'лобби' && в.игра.яХост && в.игра.игрокиКомнаты.length >= 2 && в.игра.игрокиКомнаты.every(у => в.игра.лобби.племена[у.игрок] !== undefined)) { console.log('[бот-ждущий] соперник пришёл — старт через 3 с'); setTimeout(() => в.игра.старт(), 3000); } }, 2000);
// Уход за комнатами: вылетевших людей боты не ждут дольше 30 с (голосуют «не ждать»); комната
// ожидания, чья партия осталась без живых людей на 2 минуты, пересоздаётся заново.
const людиВКомнате = (у) => у.игра.участники.some(п => !п.имя.startsWith('бот'));
setInterval(() => {
  for (const у of боты) if (у.игра.активна) for (const [игрок, о] of у.игра.ожидание) if (Date.now() - о.с > 30000) у.игра.неЖдать(игрок);
  if (в.игра.активна) { в.безЛюдей = людиВКомнате(в) ? 0 : (в.безЛюдей || 0) + 1;
    if (в.безЛюдей >= 24) { console.log('[бот-ждущий] людей нет — пересоздаю комнату ожидания'); в.безЛюдей = 0; в.игра.выйти();
      setTimeout(async () => { await войти(в, 'жду соперника', 'бот-ждущий'); await жди(1500); в.игра.задатьОткрытость(true); }, 3000); } }
}, 5000);
console.log('комнаты подняты, живу', МИНУТ, 'минут');
setTimeout(() => process.exit(0), МИНУТ * 60000);
