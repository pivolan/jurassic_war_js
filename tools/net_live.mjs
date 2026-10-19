// Проверка сетевой игры на настоящем канале (наше).
//
//   node tools/net_server.mjs 8791 &      (или боевой: ws://127.0.0.1:8791/)
//   node tools/net_live.mjs [игроков] [шагов] [адрес]
//
// Поднимает N клиентов в одном процессе, но общаются они по-честному — через веб-сокет до релея.
// Хост загружает миссию, рассылает снимок, дальше все крутят локстеп и каждый ход сверяют хеши.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'reimpl') + '/';
import { Mem, G, U, UNITS } from '../reimpl/js/mem.js';
import { Engine } from '../reimpl/js/engine.js';
import { loadMission } from '../reimpl/js/loader.js';
import '../reimpl/js/modules.js';
const { setPathMode } = await import('../reimpl/js/port/path.js');
const { КОД } = await import('../reimpl/js/port/inject.js');
const { Локстеп, снимок, восстановить, СНИМОК, зрительское } = await import('../reimpl/js/net/lockstep.js');
const { Канал } = await import('../reimpl/js/net/канал.js');
setPathMode('astar');

const ИГРОКОВ = +(process.argv[2] || 2);
const ШАГОВ = +(process.argv[3] || 2000);
const АДРЕС = process.argv[4] || 'ws://127.0.0.1:8791/';
const МИССИЯ = 5, ПЛЕМЯ = 0;

const образ = zlib.inflateSync(fs.readFileSync(КОРЕНЬ + 'data/boot_snap.bin.z'));
const files = {};
for (const f of ['_PWAR01.TRC', '_PWAR05.TRS', '_PWAR08.TRC', '_PWAR09.TRC'])
  files[f] = new Uint8Array(fs.readFileSync(КОРЕНЬ + '../PWAR/' + f));
const новый = () => { const m = Mem.ofSize(); m.b.set(образ, 0x30000); m.w32(0x46c, 110);
                      const e = new Engine(m); e.files = files; return e; };

const комната = 'проверка-' + Date.now();
const узлы = [];
for (let p = 0; p < ИГРОКОВ; p++) {
  const к = new Канал(АДРЕС);
  await к.подключиться(комната, 'игрок ' + p);
  узлы.push({ канал: к, eng: новый(), лс: null, готов: false });
}
await new Promise(r => setTimeout(r, 200));           // дать разойтись сообщению о составе
const номера = узлы.map(у => у.канал.игрок);
console.log(`комната ${комната}, игроки ${номера.join(', ')}, хост ${узлы[0].канал.хост}`);

// ---- хост готовит начальное состояние и рассылает снимком
const хостУзел = узлы.find(у => у.канал.яХост);
loadMission(хостУзел.eng.m, files, МИССИЯ, ПЛЕМЯ, 1);
const начальный = снимок(хостУзел.eng);
let принялиСнимок = 0;
for (const у of узлы) у.канал.наСнимок = (данные, ш) => {
  восстановить(у.eng, данные); у.eng.timer = ш.таймер; у.готов = true; принялиСнимок++;
};
хостУзел.канал.снимок(начальный, { ход: 0, таймер: хостУзел.eng.timer });
const t0 = Date.now();
while (принялиСнимок < ИГРОКОВ && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 20));
if (принялиСнимок < ИГРОКОВ) { console.log('снимок не дошёл до всех:', принялиСнимок); process.exit(1); }
console.log(`снимок ${(начальный.length / 1024).toFixed(0)} КБ разошёлся всем за ${Date.now() - t0} мс`);

for (const у of узлы) {
  у.лс = new Локстеп(у.eng, у.канал.игрок, номера, { шли: (п) => у.канал.ход(п) });
  у.канал.наХод = (п) => у.лс.принять(п);
}

// ---- отряды: только юниты человека, ИИ-слоты трогать бессмысленно
const отряды = [];
{
  const m = хостУзел.eng.m, мой = m.u8(G.humanOwner), все = [];
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    const t = m.u8(UNITS + i + U.TYPE);
    if (t >= 1 && t <= 13 && m.u8(UNITS + i + U.OWNER) === мой) все.push(i);
  }
  for (let p = 0; p < ИГРОКОВ; p++) отряды.push(все.filter((_, k) => k % ИГРОКОВ === p));
}
let сид = 12345;
const сл = (n) => { сид = (Math.imul(сид, 1103515245) + 12345) & 0x7fffffff; return сид % n; };
const W = хостУзел.eng.m.u32(G.mapW), H = хостУзел.eng.m.u32(G.mapH);

// ---- ход времени: все крутятся, пока не сделают ШАГОВ
const t1 = Date.now();
let стоялиПодряд = 0;
while (узлы.some(у => у.лс.шаг < ШАГОВ)) {
  let двигались = 0;
  for (const [k, у] of узлы.entries()) {
    if (у.лс.шаг >= ШАГОВ) continue;
    if (у.лс.шаг % у.лс.шаговВХоде === 0 && у.лс.готов(у.лс.ход)) {
      const отряд = отряды[k];
      if (сл(3) === 0 && отряд.length) {
        const ю = отряд[сл(отряд.length)];
        у.лс.прикажи(ю, сл(4) === 0 ? КОД.ОХРАНА : КОД.ИДТИ, 0, сл(W) << 5, сл(H) << 5);
      }
      у.лс.отправитьХод();
    }
    if (у.лс.тик() === null) двигались++;
  }
  if (двигались === 0) {
    стоялиПодряд++;
    if (стоялиПодряд > 4000) { console.log('встали: ждём пакетов', узлы.map(у => у.лс.ждём)); break; }
    await new Promise(r => setTimeout(r, 1));
  } else стоялиПодряд = 0;
}
const мс = Date.now() - t1;

// ---- итог
const эталон = узлы[0].eng.m.b.subarray(СНИМОК.от, СНИМОК.до);
let всёсошлось = true;
for (const у of узлы) {
  const свой = у.eng.m.b.subarray(СНИМОК.от, СНИМОК.до);
  let плохо = -1;
  for (let a = 0; a < эталон.length; a++) {
    if (эталон[a] === свой[a]) continue;
    const адр = СНИМОК.от + a;
    if (зрительское(адр)) continue;                                                       // камера, выделение, панель
    if (адр >= 0x10ce74 && адр < 0x117e74 && ((эталон[a] ^ свой[a]) & 0xfe) === 0) continue;  // туман
    плохо = a; break;
  }
  const х = у.лс.хеши.get(у.лс.ход - 1);
  console.log(`  игрок ${у.лс.игрок}: шаг ${у.лс.шаг}, хеш ${х?.toString(16)}, ` +
              (плохо < 0 ? 'память совпала' : `РАСХОЖДЕНИЕ по 0x${(СНИМОК.от + плохо).toString(16)}`) +
              (у.лс.расхождение ? ` (сам поймал: ход ${у.лс.расхождение.ход})` : '') +
              ` · чужих хешей сверено ${у.лс.чужиеХеши.size ? 'да' : 'нет'}`);
  if (плохо >= 0) всёсошлось = false;
}
console.log(всёсошлось ? `сошлось по-настоящему, через сокет: ${ШАГОВ} шагов за ${мс} мс` : 'РАЗОШЛОСЬ');
for (const у of узлы) у.канал.закрыть();
process.exit(всёсошлось ? 0 : 1);
