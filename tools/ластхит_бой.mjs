// Постановка одной драки для проверки ластхита: арена 11×11, зверь в середине (или в тупике),
// наши вокруг. Общая для таблицы (tools/ластхит_сцены.mjs) и ролика (tools/ластхит_кино.mjs).
import { движок } from './ai_duel.mjs';
const { loadMission } = await import('../reimpl/js/loader.js');
const { G, U, UNITS, BG } = await import('../reimpl/js/mem.js');
const { проходима } = await import('../reimpl/js/ai/act.js');
const { приказ, КОД } = await import('../reimpl/js/port/inject.js');
const { call } = await import('../reimpl/js/fn.js');
const ЛХ = await import('../reimpl/js/ai/ластхит.js');
const { уронПо } = await import('../reimpl/js/ai/образец.js');
export const ИМЯ = { 14: 'тираннозавр', 15: 'стегозавр', 19: 'мамонт', 21: 'тигр', 22: 'леопард', 23: 'пёс' };
/** Найти открытый квадрат R×R и вернуть его левый верхний угол. */
function открытоеМесто(m, R) {
  const W = m.u32(G.mapW), H = m.u32(G.mapH);
  for (let y0 = 1; y0 + R < H - 1; y0++) for (let x0 = 1; x0 + R < W - 1; x0++) {
    let ок = true;
    for (let y = y0; y < y0 + R && ок; y++) for (let x = x0; x < x0 + R; x++) if (!проходима(m, x, y)) { ок = false; break; }
    if (ок) return { x0, y0 };
  }
  return null;
}
const стена = (m, x, y) => m.w16(BG + (y << 9) + x * 2, m.u16(BG + (y << 9) + x * 2) | 0x0800);

/**
 * Одна драка. вид: открытая | угол | деревья. состав: [{atk, def, hp, тип}] наших. назначен: индекс
 * в составе или -1. Возвращает { шаг, кто (индекс), стопов, мест }.
 */
export function бой(вид, тип, состав, назначен, зерно = 0, запись = null) {
  const eng = движок(); const m = eng.m; loadMission(m, eng.files, 1, 0, 2);
  if (зерно) m.w32(G.rngState, (m.u32(G.rngState) ^ (зерно * 2654435761)) >>> 0);
  const мой = m.u8(G.humanOwner); m.w8(0x32aec + мой, 0);
  // Арену вырезаем сами: 11×11 проходимой земли (плитка — с клетки у базы) в середине карты.
  const R = 11, x0 = 18, y0 = 18, цx = x0 + 5, цy = y0 + 5;
  const земля = m.u16(BG + (40 << 9) + 34 * 2) & 0x7ff;
  for (let y = y0; y < y0 + R; y++) for (let x = x0; x < x0 + R; x++) { m.w16(BG + (y << 9) + x * 2, земля); m.w8(0x10ce74 + x + (y << 8), 0); }
  // рамка арены
  for (let k = -1; k <= R; k++) { стена(m, x0 + k, y0 - 1); стена(m, x0 + k, y0 + R); стена(m, x0 - 1, y0 + k); стена(m, x0 + R, y0 + k); }
  let зx = цx, зy = цy;
  if (вид === 'угол') {
    // тупик: зверь у восточной стены в «кармане» — открыты только запад и северо-запад/юго-запад
    зx = x0 + R - 1; зy = цy;
    стена(m, зx, зy - 1); стена(m, зx, зy + 1); стена(m, зx - 1, зy - 1);
  }
  if (вид === 'деревья') for (const [dx, dy] of [[-2,-1],[-1,2],[1,-2],[2,1],[0,-3],[-3,0],[3,-1],[-1,-3],[1,3]]) стена(m, цx + dx, цy + dy);
  // снять всех, кроме нужных
  const наши = [], ждём = состав.length; let зверь = 0;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    const t = m.u8(UNITS + i + U.TYPE), в = m.u8(UNITS + i + U.OWNER);
    if (в === мой && t === 1 && наши.length < ждём) { наши.push(i); continue; }
    if (t === тип && !зверь) { зверь = i; continue; }
    m.w8(UNITS + i + U.FLAGS5B, m.u8(UNITS + i + U.FLAGS5B) | 1); m.w16(UNITS + i + U.ANIM, 0xffff);
  }
  if (!зверь) { const r = call(eng, 0x1caf0, { eax: тип | (8 << 8), ecx: 8, edx: зx << 5, ebx: зy << 5 }); зверь = r.esi; }
  const поставить = (i, x, y) => { call(eng, 0x1a42c, { esi: i, edx: m.u16(UNITS + i + U.X), ebx: m.u16(UNITS + i + U.Y) });
    m.w16(UNITS + i + U.X, x << 5); m.w16(UNITS + i + U.Y, y << 5); m.w8(UNITS + i + 0x44, x); m.w8(UNITS + i + 0x45, y);
    call(eng, 0x1a3db, { esi: i, edx: x << 5, ebx: y << 5 }); };
  поставить(зверь, зx, зy);
  m.w8(UNITS + зверь + 0x55, зx); m.w8(UNITS + зверь + 0x56, зy); m.w8(UNITS + зверь + 0x57, зx); m.w8(UNITS + зверь + 0x58, зy);
  m.w8(UNITS + зверь + 0x59, зx); m.w8(UNITS + зверь + 0x5a, зy);
  const места = [[-3,0],[-3,-2],[-3,2],[-2,-3],[-2,3],[0,-3],[0,3]];
  наши.forEach((i, k) => {
    const с = состав[k]; const [dx, dy] = места[k];
    поставить(i, Math.max(x0, Math.min(x0 + R - 1, зx + dx)), Math.max(y0, Math.min(y0 + R - 1, зy + dy)));
    m.w8(UNITS + i + U.ATK, с.atk); m.w8(UNITS + i + U.DEF, с.def); m.w8(UNITS + i + U.HPMAX, с.hp); m.w8(UNITS + i + U.HP, с.hp);
  });
  // сколько клеток вплотную к зверю можно занять
  let мест = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && проходима(m, зx + dx, зy + dy)) мест++;
  const лх = ЛХ.новое();
  if (запись) { запись.арена = { x0, y0, R }; запись.стены = []; for (let y = y0 - 1; y <= y0 + R; y++) for (let x = x0 - 1; x <= x0 + R; x++) if (!проходима(m, x, y)) запись.стены.push([x - x0, y - y0]); запись.кадры = []; }
  const держимСейчас = new Set();
  for (let t = 1; t <= 4000; t++) {
    if (!(m.u8(UNITS + зверь + U.FLAGS5B) & 1) && m.u8(UNITS + зверь + U.HP) > 0) {
      for (const i of наши) {
        if (держимСейчас.has(i)) continue;
        const ст = m.u8(UNITS + i + U.STATE);
        if (m.u32(UNITS + i + U.TARGET) !== зверь || ((ст >> 4) !== 1)) приказ(eng, i, КОД.АТАКА, зверь, зx << 5, зy << 5);
      }
      держимСейчас.clear();
      if (назначен >= 0) {
        const р = ЛХ.шаг(eng, лх, зверь, наши[назначен], наши, уронПо, { ДОПУСК: 120 });
        for (const i of ЛХ.неТрогать(лх)) держимСейчас.add(i);
      }
    }
    const было = наши.map(i => ЛХ.отпечатокОпыта(m, i));
    const hpДо = m.u8(UNITS + зверь + U.HP);
    eng.timer++; eng.tick();
    if (запись) запись.кадры.push({ t, зверь: { x: m.u16(UNITS + зверь + U.X) / 32 - x0, y: m.u16(UNITS + зверь + U.Y) / 32 - y0, hp: m.u8(UNITS + зверь + U.HP), max: m.u8(UNITS + зверь + U.HPMAX), до: hpДо },
      наши: наши.map((i, k) => ({ x: m.u16(UNITS + i + U.X) / 32 - x0, y: m.u16(UNITS + i + U.Y) / 32 - y0, hp: m.u8(UNITS + i + U.HP), max: m.u8(UNITS + i + U.HPMAX),
        ударил: m.u32(UNITS + i + U.XP) !== было[k].xp, стоп: лх.держим.has(i), уступил: лх.уступили.has(i), добил: ЛХ.добил(m, i, было[k]) })) });
    if ((m.u8(UNITS + зверь + U.FLAGS5B) & 1) || m.u8(UNITS + зверь + U.HP) === 0 || (m.u8(UNITS + зверь + U.STATE) & 0xf0) === 0x60) {
      const кто = наши.findIndex((i, k) => ЛХ.добил(m, i, было[k]));
      return { шаг: t, кто, стопов: лх.стопов + лх.уступок, мест, отказ: лх.отказ };
    }
  }
  return { шаг: Infinity, кто: -1, стопов: лх.стопов, мест };
}

export const СОСТАВЫ = {
  '2 равных':           [{ atk: 40, def: 40, hp: 250 }, { atk: 40, def: 40, hp: 250 }],
  '3: сильный+2 слабых': [{ atk: 90, def: 60, hp: 250 }, { atk: 20, def: 30, hp: 250 }, { atk: 20, def: 30, hp: 250 }],
  '4: 3 сильных+слабый': [{ atk: 90, def: 60, hp: 250 }, { atk: 90, def: 60, hp: 250 }, { atk: 70, def: 60, hp: 250 }, { atk: 20, def: 30, hp: 250 }],
  '4 новичка':           [{ atk: 20, def: 30, hp: 250 }, { atk: 20, def: 30, hp: 250 }, { atk: 20, def: 30, hp: 250 }, { atk: 20, def: 30, hp: 250 }],
};
