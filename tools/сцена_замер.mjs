// ЗАМЕР ПРЯМО НА СТРАНИЦЕ. Владелец: «у тебя стенд говна, он отличается от того, что я запускаю».
// И правда: стенд крутит движок сам, а страница — своим циклом, с ×3, своим таймером и своим
// случайным зерном. Поэтому меряем там же, где он смотрит: открываем /jw/scene/<племя> в том же
// браузере и просто читаем еду, живых и секунду достижения цели.
//
//   node tools/сцена_замер.mjs [племя=tyrano] [секундИгры=200] [кадрыВпапку]
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const ПЛЕМЯ = process.argv[2] || 'tyrano';
const СЕКУНД = +(process.argv[3] || 200);
const КАДРЫ = process.argv[4] || null;
const РУЧКИ = process.argv[5] || '';   // например JW_ОБР_ДАЛЬНИЙ_ОТХОД=2&JW_ОБР_РОТАЦИЯ=1
const ПОРТ = 8826 + (process.pid % 100);
if (КАДРЫ) { fs.rmSync(КАДРЫ, { recursive: true, force: true }); fs.mkdirSync(КАДРЫ, { recursive: true }); }
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'],
                     { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const бр = await chromium.launch();
const стр = await бр.newPage({ viewport: { width: 1024, height: 768 } });
const ош = []; стр.on('pageerror', e => ош.push(e.message));
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html?lab=1&scene=${ПЛЕМЯ}${РУЧКИ ? '&' + РУЧКИ : ''}`, { waitUntil: 'load' });
await стр.waitForFunction(() => {
  const j = window.__jw; if (!j?.mem) return false; const m = j.mem, { G, U, UNITS } = j;
  if (!m.u32(G.unitHead)) return false; const мой = m.u8(G.humanOwner); let n = 0;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT))
    if (m.u8(UNITS + i + U.OWNER) === мой && m.u8(UNITS + i + U.TYPE) < 0x1a) n++;
  return n > 0;
}, null, { timeout: 180000 });
// СОСТАВ БЕРЁМ КАЖДЫЙ РАЗ ЗАНОВО. Запоминать номера записей нельзя: движок переиспользует их
// после смерти, и запомненный «наш боец» через минуту оказывается тигром — первый вариант этого
// замера именно так и врал (в здоровье светилось 58/65, чего у Тирано быть не может).
const срез = () => стр.evaluate(() => {
  const j = window.__jw, m = j.mem, { G, U, UNITS } = j;
  const мой = m.u8(G.humanOwner);
  let еда = 0, живых = 0; const строки = [];
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.OWNER) !== мой || m.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (m.u8(UNITS + i + U.HP) <= 0 || (m.u8(UNITS + i + U.STATE) & 0xf0) === 0x60) continue;
    живых++; еда += m.u16(UNITS + i + U.FOOD);
    строки.push(`${m.u8(UNITS + i + U.HP)}/${m.u8(UNITS + i + U.HPMAX)}`);
  }
  // Чужие бойцы (другие племена) — по ним видно, выполняется ли «добить племя» в задании миссии.
  const чужие = [];
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    const t = m.u8(UNITS + i + U.TYPE);
    if (t >= 0x1a || (t >= 14 && t <= 25)) continue;
    if (m.u8(UNITS + i + U.OWNER) === мой || (m.u8(UNITS + i + U.FLAGS5B) & 1)) continue;
    if (m.u8(UNITS + i + U.HP) <= 0 || (m.u8(UNITS + i + U.STATE) & 0xf0) === 0x60) continue;
    чужие.push(`${m.u8(UNITS + i + U.OWNER)}:т${t}:${m.u8(UNITS + i + U.HP)}`);
  }
  return { шаг: m.u32(G.step), еда, живых, строки, чужие, мозги: j.лаб ? j.лаб.мозги : '?' };
});

const t0 = Date.now(); let шаг0 = null, достигнуто = null, былоЖивых = null, к = 0;
const ЖДАТЬ = СЕКУНД * 1000 / 3 * 3 + 20000;       // с запасом: при нескольких браузерах разом ×3 не держится
while (Date.now() - t0 < ЖДАТЬ) {
  const с = await срез();
  if (шаг0 === null) шаг0 = с.шаг;
  const игровых = (с.шаг - шаг0) * 55 / 1000;
  if (былоЖивых === null) былоЖивых = с.живых;
  if (с.живых < былоЖивых) { былоЖивых = с.живых;
    console.log(`  ${игровых.toFixed(0)}с потеря · осталось ${с.живых} · ${с.строки.join(' ')} · еды ${с.еда}`); }
  if (достигнуто === null && с.еда >= 3000) { достигнуто = игровых; }
  if (КАДРЫ && к % 4 === 0) await стр.screenshot({ path: `${КАДРЫ}/к${String(к).padStart(3, '0')}.png` });
  if (игровых >= СЕКУНД || с.живых === 0) break;
  к++;
  await new Promise(r => setTimeout(r, 500));
}
const к2 = await срез();
console.log(JSON.stringify({ племя: ПЛЕМЯ, чужиеЖивы: к2.чужие, набрано: к2.еда, достигнутоНаСек: достигнуто, живых: к2.живых,
  игровыхСекунд: +(((к2.шаг - шаг0) * 55) / 1000).toFixed(1), здоровье: к2.строки.join('/'), ошибок: ош.length }));
if (ош.length) console.log('ошибки страницы:', ош.slice(0, 3));
await бр.close(); сервер.kill();
