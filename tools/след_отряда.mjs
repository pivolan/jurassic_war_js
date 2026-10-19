// Трасса боя отрядной сети: кого она бьёт, от кого бежит и что делает с БЛИЖАЙШИМ зверем.
// Нужна из-за жалобы владельца: «по итогу они всё так же убегают от ближайшей псины, которую в
// самом начале должны начать убивать». Средние цифры на это не отвечают: сеть может брать две
// жертвы подальше и обходить ближнюю.
import fs from 'node:fs'; import url from 'node:url';
import { движок, ТИК_МС } from './ai_duel.mjs';
const { loadMission } = await import('../reimpl/js/loader.js');
const { G, U, UNITS } = await import('../reimpl/js/mem.js');
const О = await import('../reimpl/js/ai/отряд.js');
const { выполнить, ДЕЙСТВИЯ } = await import('../reimpl/js/ai/act.js');
const { приказ } = await import('../reimpl/js/port/inject.js');
const среда = process.env;
const ВЕСА = среда.JW_ВЕСА || new URL('../out/ai/data/отряд-отряд4/лучшие.json', import.meta.url);
const СЕКУНД = +(среда.JW_CUT_SEC || 30), ТАКТ = 4;
const жив = (m,i) => i && !(m.u8(UNITS+i+U.FLAGS5B)&1) && m.u8(UNITS+i+U.HP)>0 && (m.u8(UNITS+i+U.STATE)&0xf0)!==0x60;
const кл = (m,i) => ({x:m.u16(UNITS+i+U.X)>>5, y:m.u16(UNITS+i+U.Y)>>5});
const eng = движок(); const m = eng.m;
loadMission(m, eng.files, 0, 0, 2);
const мой = m.u8(G.humanOwner); m.w8(0x32aec+мой, 0);
const [x0,y0,x1,y1] = [1,12,32,43]; const наши=[], звери=[];
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS+i+U.NEXT)) {
  if (m.u8(UNITS+i+U.FLAGS5B)&1) continue;
  const c = кл(m,i), т = m.u8(UNITS+i+U.TYPE), внутри = c.x>=x0&&c.x<=x1&&c.y>=y0&&c.y<=y1;
  if (m.u8(UNITS+i+U.OWNER)===мой && т<0x1a) { if (внутри) наши.push(i); continue; }
  if (!(т>=14&&т<=23)) continue;
  if (внутри) звери.push(i); else { m.w8(UNITS+i+U.FLAGS5B, m.u8(UNITS+i+U.FLAGS5B)|1); m.w16(UNITS+i+U.ANIM,0xffff); }
}
const места = наши.slice(0,О.МЕСТ).sort((a,b)=>a-b);
const серёдка = () => { let x=0,y=0,n=0; for (const i of места) if (жив(m,i)) { const c=кл(m,i); x+=c.x; y+=c.y; n++; } return n?{x:x/n,y:y/n}:{x:0,y:0}; };
const ближний = () => { const с = серёдка(); let л=null, д=1e9;
  for (const з of звери) { if (!жив(m,з)) continue; const c=кл(m,з); const r=Math.max(Math.abs(c.x-с.x),Math.abs(c.y-с.y)); if (r<д) {д=r; л={и:з, т:m.u8(UNITS+з+U.TYPE), д:r, hp:m.u8(UNITS+з+U.HP)};} }
  return л; };
const политика = О.политика(fs.readFileSync(ВЕСА,'utf8'), {температура:+(среда.JW_T||0.001), seed:3});
const наб = О.пустое();
const предел = Math.round(СЕКУНД*1000/ТИК_МС);
let действия = null, началоHP = new Map(звери.map(з=>[з,m.u8(UNITS+з+U.HP)]));
const первыйБлижний = ближний();
console.log(`ближайший в начале: #${первыйБлижний.и} тип ${первыйБлижний.т} в ${первыйБлижний.д} клетках, ${первыйБлижний.hp}hp`);
for (let тик=0; тик<предел; тик++) {
  if ((тик%ТАКТ)===0) {
    О.наблюдать(eng, места, тик/предел, наб);
    const р = политика(наб);
    действия = Array.from(р.действия);
    for (let s=0;s<О.МЕСТ;s++) { const i=места[s]; if (!жив(m,i)) continue;
      выполнить(eng, i, р.действия[s], {роль:'ATTACK_TO_DEATH', вес:2, точка:null, цель:0, кайт:'всегда'}, (e,u,код,ц=0,x=0,y=0)=>приказ(e,u,код,ц,x,y)); }
  }
  eng.timer++; eng.tick();
  if (тик%18) continue;
  const б = ближний();
  const п = первыйБлижний;
  const пж = жив(m,п.и) ? `${m.u8(UNITS+п.и+U.HP)}hp` : 'МЁРТВ';
  const рассто = (i) => { if (!жив(m,п.и)) return '—'; const a=кл(m,i), b=кл(m,п.и); return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)); };
  const кто = места.map((i,s)=> жив(m,i) ? `${ДЕЙСТВИЯ[действия[s]]}(д${рассто(i)})` : 'труп').join(' | ');
  console.log(`${(тик*ТИК_МС/1000).toFixed(1).padStart(4)}с первый-пёс #${п.и} ${пж} · ближайший сейчас #${б?б.и:'—'} в ${б?б.д:'-'} · ${кто}`);
}
const убито = звери.filter(з=>!жив(m,з));
console.log('убито', убито.length, ':', убито.map(з=>`#${з} тип ${m.u8(UNITS+з+U.TYPE)}`).join(', '));
console.log('первый ближайший убит:', убито.includes(первыйБлижний.и) ? 'ДА' : 'НЕТ');
