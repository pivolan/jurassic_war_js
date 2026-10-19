// Замер того, что реально крутится в обучении ИИ: шаг движка на арене, кодирование наблюдения
// и прямой проход небольшой свёрточной сети на JS — наивный и оптимизированный.
//
//   node tools/ai_bench.mjs        (из <project>/re/jw)
//
// Зачем: вопрос «не переписать ли движок ради скорости на другой язык» решается числами, а не на
// глаз. Ответ — нет: шаг движка занимает единицы микросекунд, а всё время съедает прямой проход
// сети. Оптимизировать надо инференс и батчить его, движок трогать незачем.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'reimpl') + '/';
import { Mem, G, U, UNITS, BI, BG, MO } from '../reimpl/js/mem.js'; import { Engine } from '../reimpl/js/engine.js';
import { loadMission } from '../reimpl/js/loader.js'; import '../reimpl/js/modules.js'; import { F } from '../reimpl/js/fn.js';
import { fixSlotPointers } from '../reimpl/js/render/scene.js';
const { setPathMode } = await import('../reimpl/js/port/path.js');
import { собрать, МИССИЯ, ПЛЕМЯ } from '../reimpl/js/ui/pathscenes.js';
F[0x26e4d]=()=>{};F[0x26e62]=()=>{};
if (process.env.ЖИВНОСТЬ === '0' || process.env.ZHIVNOST === '0') { F[0x1cfcb] = () => {}; F[0x1d12e] = () => {}; }   // зверьё возрождается, как в игре
setPathMode('astar');
const снимок=zlib.inflateSync(fs.readFileSync(КОРЕНЬ + 'data/boot_snap.bin.z'));
const files={};for(const f of ['_PWAR01.TRC','_PWAR05.TRS','_PWAR08.TRC','_PWAR09.TRC'])files[f]=new Uint8Array(fs.readFileSync(КОРЕНЬ + '../PWAR/'+f));

// ---- 1. шаг движка на арене 20x15
const m=Mem.ofSize(); m.b.set(снимок,0x30000); m.w32(0x46c,110); fixSlotPointers(m);
const eng=new Engine(m); eng.files=files; loadMission(m,files,МИССИЯ,ПЛЕМЯ,1);
собрать(eng,4);                              // сцена «скала и лес», 4 бойца
let бойцы=[]; for(let i=m.u32(G.unitHead);i;i=m.u32(UNITS+i+U.NEXT)) if(m.u8(UNITS+i+U.F07)&0x80) бойцы.push(i);
for(let k=0;k<200;k++){eng.timer++;eng.tick();}
let t=process.hrtime.bigint(); const N=50000;
for(let k=0;k<N;k++){eng.timer++;eng.tick();}
const шагМс=Number(process.hrtime.bigint()-t)/1e6;
console.log(`шаг движка на арене 20x15: ${N} шагов за ${шагМс.toFixed(0)} мс = ${(N/шагМс*1000/1000).toFixed(0)} тыс. шагов/с`);

// ---- 2. кодирование наблюдения: окно 15x15, 8 слоёв
const R=7, W=15, СЛОЁВ=8, ОКНО=new Float32Array(W*W*СЛОЁВ), СВОИ=new Float32Array(24);
const TILE_INF=0x3183c;
function наблюдение(esi){
  ОКНО.fill(0);
  const cx=m.u16(UNITS+esi+U.X)>>5, cy=m.u16(UNITS+esi+U.Y)>>5;
  const mw=m.u32(G.mapW), mh=m.u32(G.mapH);
  for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
    const x=cx+dx, y=cy+dy, k=((dy+R)*W+(dx+R));
    if(x<0||y<0||x>=mw||y>=mh) continue;
    const c=x+(y<<8);
    const разведано=m.b[BI+c]&1; ОКНО[1*225+k]=разведано;
    if(!разведано) continue;                       // честность: под туманом ничего не видно
    const tile=m.u16(BG+(y<<9)+x*2);
    ОКНО[0*225+k]=(tile&0xf800)?0:(m.b[TILE_INF+(tile&0x7ff)]&1);
  }
  const мой=m.u8(UNITS+esi+U.OWNER);
  for(let i=m.u32(G.unitHead);i;i=m.u32(UNITS+i+U.NEXT)){
    if(m.u8(UNITS+i+U.FLAGS5B)&1) continue;
    const x=(m.u16(UNITS+i+U.X)>>5)-cx, y=(m.u16(UNITS+i+U.Y)>>5)-cy;
    if(x<-R||x>R||y<-R||y>R) continue;
    const k=((y+R)*W+(x+R)); if(!ОКНО[225+k]) continue;
    const вл=m.u8(UNITS+i+U.OWNER), т=m.u8(UNITS+i+U.TYPE);
    const hp=m.u8(UNITS+i+U.HPMAX)?m.u8(UNITS+i+U.HP)/m.u8(UNITS+i+U.HPMAX):1;
    const слой = т>=0x1a ? (вл===мой?5:6) : вл===8 ? 4 : вл===мой?2:3;
    ОКНО[слой*225+k]=hp;
  }
  СВОИ[0]=m.u8(UNITS+esi+U.HP)/(m.u8(UNITS+esi+U.HPMAX)||1);
  СВОИ[1]=m.u8(UNITS+esi+0x40)/12; СВОИ[2]=m.u8(UNITS+esi+U.STATE)>>4;
  СВОИ[3]=m.u8(UNITS+esi+U.DIR)/8; СВОИ[4]=m.u8(UNITS+esi+0x46)===0xff?1:0;
  return ОКНО;
}
наблюдение(бойцы[0]);
t=process.hrtime.bigint(); const N2=200000;
for(let k=0;k<N2;k++) наблюдение(бойцы[k&3]);
const обзМкс=Number(process.hrtime.bigint()-t)/1e3/N2;
console.log(`кодирование наблюдения (15x15x8 + признаки): ${обзМкс.toFixed(1)} мкс на юнита`);

// ---- 3. прямой проход сети: 2 свёртки 3x3 (8->16->32) + пулинг + 2 полносвязных
function свёртка(вх,Cin,Cout,H,ядра,смещ,вых){
  const P=H*H;
  for(let o=0;o<Cout;o++){ const б=смещ[o];
    for(let y=0;y<H;y++) for(let x=0;x<H;x++){ let s=б;
      for(let c=0;c<Cin;c++){ const база=(o*Cin+c)*9, вс=c*P;
        for(let ky=-1;ky<=1;ky++){ const yy=y+ky; if(yy<0||yy>=H) continue;
          for(let kx=-1;kx<=1;kx++){ const xx=x+kx; if(xx<0||xx>=H) continue;
            s+=вх[вс+yy*H+xx]*ядра[база+(ky+1)*3+(kx+1)]; } } }
      вых[o*P+y*H+x]=s>0?s:0; } }
}
const сл=(n)=>{const a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=(Math.random()-0.5)*0.1;return a;};
const K1=сл(16*8*9), B1=сл(16), K2=сл(32*16*9), B2=сл(32);
const A1=new Float32Array(16*225), A2=new Float32Array(32*225);
const СКР=new Float32Array(128), ВЫХ=new Float32Array(14);
const W3=сл(128*(32+24)), B3=сл(128), W4=сл(14*128), B4=сл(14);
const ПУЛ=new Float32Array(32);
function проход(окно){
  свёртка(окно,8,16,15,K1,B1,A1); свёртка(A1,16,32,15,K2,B2,A2);
  for(let c=0;c<32;c++){let s=0;for(let i=0;i<225;i++)s+=A2[c*225+i];ПУЛ[c]=s/225;}
  for(let h=0;h<128;h++){let s=B3[h];const б=h*56;
    for(let c=0;c<32;c++)s+=ПУЛ[c]*W3[б+c];
    for(let c=0;c<24;c++)s+=СВОИ[c]*W3[б+32+c];
    СКР[h]=s>0?s:0;}
  for(let o=0;o<14;o++){let s=B4[o];const б=o*128;for(let h=0;h<128;h++)s+=СКР[h]*W4[б+h];ВЫХ[o]=s;}
  return ВЫХ;
}
проход(ОКНО);
t=process.hrtime.bigint(); const N3=5000;
for(let k=0;k<N3;k++) проход(ОКНО);
const сетьМкс=Number(process.hrtime.bigint()-t)/1e3/N3;
const параметров=16*8*9+16+32*16*9+32+128*56+128+14*128+14;
console.log(`прямой проход сети (${(параметров/1000).toFixed(0)} тыс. параметров): ${сетьМкс.toFixed(0)} мкс`);

// ---- 4. итог: эпизод 600 шагов, 4 юнита, решение раз в 8 тиков
const шагов=600, юнитов=4, решений=шагов/8*юнитов;
const мсЭпизод = шагов*(шагМс/N) + решений*(обзМкс+сетьМкс)/1000;
console.log(`\nэпизод 600 шагов, ${юнитов} юнита, решение раз в 8 тиков (${решений} решений):`);
console.log(`  движок ${(шагов*(шагМс/N)).toFixed(1)} мс + сеть с кодировщиком ${(решений*(обзМкс+сетьМкс)/1000).toFixed(1)} мс = ${мсЭпизод.toFixed(1)} мс`);
console.log(`  одно ядро: ${(1000/мсЭпизод).toFixed(0)} эпизодов/с; 20 ядер (берём 16 рабочих): ${(16000/мсЭпизод).toFixed(0)} эпизодов/с`);
console.log(`  миллион эпизодов на 16 ядрах: ${(1e6*мсЭпизод/16/1000/60).toFixed(0)} минут`);

{
function conv3(вх,Cin,Cout,H,K,B,вых){          // 'same', ReLU, без проверок во внутренней области
  const P=H*H;
  for(let o=0;o<Cout;o++){ const б=B[o]; const о=o*P;
    for(let i=0;i<P;i++) вых[о+i]=б;
    for(let c=0;c<Cin;c++){ const k=(o*Cin+c)*9, вс=c*P;
      const k0=K[k],k1=K[k+1],k2=K[k+2],k3=K[k+3],k4=K[k+4],k5=K[k+5],k6=K[k+6],k7=K[k+7],k8=K[k+8];
      for(let y=1;y<H-1;y++){ const с0=вс+(y-1)*H, с1=вс+y*H, с2=вс+(y+1)*H, д=о+y*H;
        for(let x=1;x<H-1;x++){
          вых[д+x]+= вх[с0+x-1]*k0+вх[с0+x]*k1+вх[с0+x+1]*k2
                   + вх[с1+x-1]*k3+вх[с1+x]*k4+вх[с1+x+1]*k5
                   + вх[с2+x-1]*k6+вх[с2+x]*k7+вх[с2+x+1]*k8; } } }
    for(let i=0;i<P;i++) if(вых[о+i]<0) вых[о+i]=0; }
}
function пул2(вх,C,H,вых){                       // max-pool 2x2, H чётное после обрезки
  const h=H>>1;
  for(let c=0;c<C;c++){ const вс=c*H*H, ис=c*h*h;
    for(let y=0;y<h;y++) for(let x=0;x<h;x++){
      const a=вх[вс+(2*y)*H+2*x], b=вх[вс+(2*y)*H+2*x+1], d=вх[вс+(2*y+1)*H+2*x], e=вх[вс+(2*y+1)*H+2*x+1];
      вых[ис+y*h+x]=Math.max(a,b,d,e); } }
}
const ОКНО16=сл(8*16*16);                          // 16x16, чтобы пулинг делился нацело
const K1=сл(16*8*9),B1=сл(16),K2=сл(32*16*9),B2=сл(32);
const A1=new Float32Array(16*256), P1=new Float32Array(16*64), A2=new Float32Array(32*64);
const ПУЛ=new Float32Array(32), СВОИ=new Float32Array(24), СКР=new Float32Array(128), ВЫХ=new Float32Array(14);
const W3=сл(128*56),B3=сл(128),W4=сл(14*128),B4=сл(14);
function проходБыстрый(){
  conv3(ОКНО16,8,16,16,K1,B1,A1); пул2(A1,16,16,P1); conv3(P1,16,32,8,K2,B2,A2);
  for(let c=0;c<32;c++){let s=0;for(let i=0;i<64;i++)s+=A2[c*64+i];ПУЛ[c]=s/64;}
  for(let h=0;h<128;h++){let s=B3[h];const б=h*56;
    for(let c=0;c<32;c++)s+=ПУЛ[c]*W3[б+c];
    for(let c=0;c<24;c++)s+=СВОИ[c]*W3[б+32+c];
    СКР[h]=s>0?s:0;}
  for(let o=0;o<14;o++){let s=B4[o];const б=o*128;for(let h=0;h<128;h++)s+=СКР[h]*W4[б+h];ВЫХ[o]=s;}
}
проходБыстрый(); for(let k=0;k<2000;k++) проходБыстрый();
let t=process.hrtime.bigint(); const N=20000; for(let k=0;k<N;k++) проходБыстрый();
const мкс=Number(process.hrtime.bigint()-t)/1e3/N;
const пар=16*8*9+16+32*16*9+32+128*56+128+14*128+14;
console.log(`оптимизированный проход (${(пар/1000).toFixed(0)} тыс. параметров, 16x16 → пул → 8x8): ${мкс.toFixed(0)} мкс`);
}
