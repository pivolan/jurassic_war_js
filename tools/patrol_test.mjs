// Проверка патруля (наше): патрульный убивает зверя на маршруте и должен (1) остаться в патруле,
// (2) подобрать выпавшее мясо, (3) пойти дальше по точкам.
//
//   node tools/patrol_test.mjs
//
// Раньше патруль снимался от любого убийства: движок после боя зовёт 0x1a34c («стоять на посту»),
// а это приказ 0x3f — сторож патруля принимал его за приказ игрока и стирал маршрут.
import { движок } from '../tools/ai_duel.mjs';
import { loadMission } from '../reimpl/js/loader.js';
import { расставить } from '../reimpl/js/port/skirmish.js';
// Статически импортировать port/*.js рядом с modules.js нельзя: из-за верхнеуровневого await
// внутри modules.js они выполнятся раньше и их обёртки затрёт базовый модуль (как было с inject).
const Патруль = await import('../reimpl/js/port/patrol.js');
const { приказ, установить } = await import('../reimpl/js/port/inject.js');
import { G, U, UNITS } from '../reimpl/js/mem.js';
const eng = движок(); const m = eng.m; установить();
loadMission(m, eng.files, 100, 0, 1);
расставить(eng, [{цвет:0,племя:0,кто:'компьютер'}], {});
m.w8(0x32aec, 0);
// сильный боец
let боец=0; for (let i=m.u32(G.unitHead); i; i=m.u32(UNITS+i+U.NEXT)) { if (m.u8(UNITS+i+U.FLAGS5B)&1) continue; const t=m.u8(UNITS+i+U.TYPE); if (m.u8(UNITS+i+U.OWNER)===0 && t>=9 && t<=13) { боец=i; break; } }
for (const f of [U.HPMAX, U.HP, U.ATK, U.DEF, U.SPD]) m.w8(UNITS+боец+f, 200);
// ближайший зверь
let зверь=0,d0=1e9; const bx=m.u16(UNITS+боец+U.X)>>5, by=m.u16(UNITS+боец+U.Y)>>5;
for (let i=m.u32(G.unitHead); i; i=m.u32(UNITS+i+U.NEXT)) { if (m.u8(UNITS+i+U.FLAGS5B)&1) continue; const t=m.u8(UNITS+i+U.TYPE); if (t>=14&&t<=23) { const x=m.u16(UNITS+i+U.X)>>5,y=m.u16(UNITS+i+U.Y)>>5; const d=Math.abs(x-bx)+Math.abs(y-by); if (d<d0){d0=d;зверь=i;} } }
const zx=m.u16(UNITS+зверь+U.X)>>5, zy=m.u16(UNITS+зверь+U.Y)>>5;
console.log(`боец ${боец} в ${bx},${by}; зверь ${зверь} т${m.u8(UNITS+зверь+U.TYPE)} в ${zx},${zy} (d=${d0})`);
// маршрут: две точки — своя клетка и клетка зверя
// Точки маршрута игрок ставит кликами в разных шагах: если положить всё в один шаг, записи
// перезапишут друг друга (в поле приказа юнита место только под один).
const тик = (n) => { for (let k=0;k<n;k++){ eng.timer++; eng.tick(); } };
тик(4);
приказ(eng, боец, Патруль.ORDER_POINT, 0, bx<<5, by<<5); тик(6);
приказ(eng, боец, Патруль.ORDER_POINT, 0, zx<<5, zy<<5); тик(6);
приказ(eng, боец, Патруль.ORDER_GO, 0, 0, 0); тик(2);
console.log('маршрут после приказов:', JSON.stringify(Патруль.route(eng, боец)));
const ITEMS=0xf4f34;
let убит=false, подобрал=0;
for (let k=0;k<4000;k++){ eng.timer++; eng.tick();
  if (!убит && ((m.u8(UNITS+зверь+U.FLAGS5B)&1) || m.u8(UNITS+зверь+U.STATE)===0x6f)) { убит=true;
    console.log(`шаг ${k}: зверь убит. патруль ${Патруль.route(eng,боец)?'жив':'СНЯТ'}`); }
  if (убит && k%200===0) {
    let мясо=0; for (let it=m.u32(0x31b7c); it; it=m.u32(ITEMS+it+0xc)) { const x=m.u8(ITEMS+it+1),y=m.u8(ITEMS+it+2); if (Math.abs(x-zx)+Math.abs(y-zy)<=6) мясо++; }
    const р = Патруль.route(eng,боец);
    console.log(`  шаг ${k}: патруль ${р?'жив, точка '+р.i:'СНЯТ'} · сост ${m.u8(UNITS+боец+U.STATE)} · несёт ${m.u16(UNITS+боец+U.FOOD)} · кучек рядом ${мясо}`);
    подобрал = Math.max(подобрал, m.u16(UNITS+боец+U.FOOD));
  } }
console.log(`итог: патруль ${Патруль.route(eng,боец)?'жив':'снят'}, максимум добычи в руках ${подобрал}`);
