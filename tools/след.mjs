// Куда уходят секунды: раз в полсекунды пишем здоровье добычи, сколько наших стоит вплотную,
// и что каждый из наших делает (приказ и расстояние до добычи).
import { движок, ТИК_МС } from './ai_duel.mjs';
const { loadMission } = await import('../reimpl/js/loader.js');
const { G, U, UNITS } = await import('../reimpl/js/mem.js');
const Скрипт = await import('../reimpl/js/port/ai_script.js');
const { политикаСети } = await import('../reimpl/js/ai/policy_net.js');
import fs from 'node:fs';
const жив = (m,i) => i && !(m.u8(UNITS+i+U.FLAGS5B)&1) && m.u8(UNITS+i+U.HP)>0 && (m.u8(UNITS+i+U.STATE)&0xf0)!==0x60;
const кл = (m,i) => ({x: m.u16(UNITS+i+U.X)>>5, y: m.u16(UNITS+i+U.Y)>>5});
const eng = движок(); const m = eng.m;
loadMission(m, eng.files, 0, 0, 2);
const мой = m.u8(G.humanOwner); m.w8(0x32aec+мой, 0);
const [x0,y0,x1,y1] = [1,12,32,43]; const наши = [], звери = [];
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS+i+U.NEXT)) {
  if (m.u8(UNITS+i+U.FLAGS5B)&1) continue;
  const {x,y} = кл(m,i), т = m.u8(UNITS+i+U.TYPE), внутри = x>=x0&&x<=x1&&y>=y0&&y<=y1;
  if (m.u8(UNITS+i+U.OWNER)===мой && т<0x1a) { if (внутри) наши.push(i); continue; }
  if (!(т>=14&&т<=23)) continue;
  if (внутри) звери.push(i); else { m.w8(UNITS+i+U.FLAGS5B, m.u8(UNITS+i+U.FLAGS5B)|1); m.w16(UNITS+i+U.ANIM,0xffff); }
}
const сеть = политикаСети(fs.readFileSync(new URL('../out/ai/data/ppo-кусок1/лучшие.json', import.meta.url),'utf8'), {температура:0.3, seed:5});
Скрипт.задать(eng, мой, {уровень:3, характер:'ровный', стратегПравило:true, бойСеть:(e,i,эп,наб)=>сеть(e,i,эп,наб)});
const предел = Math.round(25*1000/ТИК_МС);
for (let тик=0; тик<предел; тик++) {
  eng.timer++; eng.tick();
  if (тик % 9) continue;
  const с = Скрипт.состояние(eng, мой); const ц = с.добыча;
  const цж = жив(m, ц); const цк = ц ? кл(m,ц) : null;
  const строки = наши.map(i => {
    if (!жив(m,i)) return 'труп';
    const c = кл(m,i); const d = цк ? Math.max(Math.abs(c.x-цк.x), Math.abs(c.y-цк.y)) : -1;
    return `${m.u8(UNITS+i+U.HP)}hp пр${m.u8(UNITS+i+U.ORDER).toString(16)} д${d}`;
  });
  console.log(`${(тик*ТИК_МС/1000).toFixed(1).padStart(4)}с добыча ${ц?'#'+ц:'—'} ${цж?m.u8(UNITS+ц+U.HP)+'hp':'мертва'} | ${строки.join(' | ')}`);
  if (звери.every(з => !жив(m,з))) break;
}
console.log('приказы:', JSON.stringify(Скрипт.отказы));
