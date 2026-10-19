// Сон: «отступил — поспал» (наше; в оригинале такого нет).
//
// Юнит (люди и ручные динозавры, типы 1..13) по приказу 0x3a засыпает: стоит, ничего не ищет и
// не атакует, но лечится быстрее. Регенерация оригинала (0x18ab2, economy-spec §4) — +1 HP раз в
// 16 шагов, и каждый четвёртый HP у людей платный (1 еда), без еды лечение встаёт. Сон даёт +1 HP
// каждые СОН_ШАГ = 4 шага (в четыре раза быстрее) и бесплатно: это единственный способ вылечиться
// без еды, что и делает механику осмысленной.
//
// Как устроено. Приказ 0x3a идёт через штатную очередь (0x14895 → ORDER → applyOrder на тайле →
// STATE = 0x3a), то есть попадает в реплей и в сетевой ход как любой другой. Состояние 0x3a
// разбирает обработчик 0x3x (0x18e89) — здесь он обёрнут, и для 0x3a оригинал не вызывается вовсе:
// ни поиска врага (0x1a526), ни контратаки. Счётчик шагов сна и здоровье на момент засыпания
// живут в JS (WeakMap eng → Map(esi → {с, hp})) — это состояние симуляции вне памяти движка,
// поэтому оно едет со снимком в сетевой игре (dump/restore, см. net/lockstep.js).
//
// Просыпается: новый приказ (0x18154 применит его на тайле и сам сменит состояние), удар (HP ниже
// запомненного или пометка цели, бит 2 в +0x43), полное здоровье. После пробуждения — 0x3f,
// «встать на пост»: дальше юнит ведёт себя как обычно.
//
// Выключается через eng.sleep = false.
import { F } from '../fn.js';
import { U, UNITS } from '../mem.js';

export const ORDER_SLEEP = 0x3a;
export const СОН_ШАГ = 4;                   // шагов на +1 HP во сне

const карта = new WeakMap();                // eng → Map(esi → {с: шагов во сне, hp: на момент проверки})
const map = (eng) => { let m = карта.get(eng); if (!m) карта.set(eng, m = new Map()); return m; };

/** Спит ли юнит (для наблюдения и стенда). */
export const спит = (eng, esi) => eng.m.u8(UNITS + esi + U.STATE) === ORDER_SLEEP && map(eng).has(esi);
/** Состояние сна для снимка сетевой игры: [[юнит, шагов, hp], …]. */
export function dump(eng) { return [...map(eng)].map(([i, s]) => [i, s.с, s.hp]); }
export function restore(eng, список) { const m = map(eng); m.clear(); for (const [i, с, hp] of список || []) m.set(i, { с, hp }); }

const orig18e89 = F[0x18e89];
F[0x18e89] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi;
  const st = m.u8(b + U.STATE);
  if (st !== ORDER_SLEEP) { if (карта.get(eng)?.has(esi)) карта.get(eng).delete(esi); return orig18e89(eng, r); }
  if (eng.sleep === false || m.u8(b + U.TYPE) >= 0xe) { m.w8(b + U.STATE, 0x3f); return orig18e89(eng, r); }
  const к = map(eng);
  let s = к.get(esi);
  const hp = m.u8(b + U.HP), макс = m.u8(b + U.HPMAX);
  if (!s) { s = { с: 0, hp }; к.set(esi, s); m.w32(b + U.TARGET, 0); m.w8(b + U.ANIM, 0); }
  // Проснуться: ударили (здоровье упало или пометка цели) или здоровье полное.
  if (hp < s.hp || (m.u8(b + U.FX43) & 2) || hp >= макс) {
    к.delete(esi);
    m.w8(b + U.FX43, m.u8(b + U.FX43) & ~2);
    m.w8(b + U.STATE, 0x3f);
    return orig18e89(eng, r);
  }
  s.с++;
  if (s.с % СОН_ШАГ === 0) m.w8(b + U.HP, hp + 1);
  s.hp = m.u8(b + U.HP);
};
