// Быстрый безголовый прогон миссии для проверки гипотез — без картинок.
//
//   node tools/м2_опыт.mjs [племя=0] [миссия=2] [секунд=1800] [зерно=0]
//   JW_ОБР_…=… node tools/м2_опыт.mjs …        — ручки ИИ, как обычно, через окружение
//
// Печатает одну строку JSON: итог (победа/поражение/не решено), на какой секунде, еда, дома,
// живых, сколько погибло, когда первая гибель и кем, плюс вехи — когда построен каждый дом.
// Зерно меняет случайность движка, чтобы мерить не одну партию, а разброс.
import { движок, ТИК_МС } from './ai_duel.mjs';
const { loadMission } = await import('../reimpl/js/loader.js');
const { call } = await import('../reimpl/js/fn.js');
const { G, U, UNITS } = await import('../reimpl/js/mem.js');
const Обр = await import('../reimpl/js/ai/образец.js');

const ПЛЕМЯ = +(process.argv[2] ?? 0), МИССИЯ = +(process.argv[3] ?? 2) - 1;
const СЕКУНД = +(process.argv[4] ?? 1800), ЗЕРНО = +(process.argv[5] ?? 0);
const ТИП = { 1: 'простолюдин', 4: 'строитель', 9: 'раптор' };
const ИМЯ = { 14: 'тираннозавр', 19: 'мамонт', 20: 'носорог', 21: 'тигр', 22: 'леопард', 23: 'пёс' };

const eng = движок(); const m = eng.m;
loadMission(m, eng.files, МИССИЯ, ПЛЕМЯ, 2);
if (ЗЕРНО) m.w32(G.rngState, (m.u32(G.rngState) ^ (ЗЕРНО * 2654435761)) >>> 0);
const мой = m.u8(G.humanOwner); m.w8(0x32aec + мой, 0);
const с = Обр.новое();
const жив = (i) => !(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.HP) > 0 && (m.u8(UNITS + i + U.STATE) & 0xf0) !== 0x60;
const свои = () => { const a = []; for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT))
  if (жив(i) && m.u8(UNITS + i + U.OWNER) === мой && m.u8(UNITS + i + U.TYPE) < 0x1a) a.push(i); return a; };
const дома = () => { const c = {}; for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if ((m.u8(UNITS + i + U.FLAGS5B) & 1) || m.u8(UNITS + i + U.OWNER) !== мой) continue;
  const т = m.u8(UNITS + i + U.TYPE); if (т >= 0x1a && !(m.u8(UNITS + i + U.FLAGS50) & 2)) c[т - 0x1a] = (c[т - 0x1a] || 0) + 1; }
  return c; };

const потериДомов = []; let былиДома = {};
const гибели = []; let итог = 'не решено', секИтога = null, погибло = 0, перваяГибель = null, максБойцов = 0, еды = 0;
const СЛЕД = +(process.env.JW_ОПЫТ_СЛЕД || 0);
// JW_ОПЫТ_КАЖДЫЕ=N — ИИ думает раз в N шагов движка (по умолчанию каждый шаг, как в игре).
const КАЖДЫЕ = Math.max(1, +(process.env.JW_ОПЫТ_КАЖДЫЕ || 1));
const вехи = {}; let прошлые = new Set(свои()); const ктоБил = new Map();
for (let т = 0; т < СЕКУНД * 1000 / ТИК_МС; т++) {
  if (т % КАЖДЫЕ === 0) Обр.шаг(eng, свои(), с); eng.timer++; eng.tick();
  // Условия миссии движок сам не проверяет: их зовёт кадр игры раз в 32 шага (game.js, 0x17728).
  // Без этого вызова победа здесь не наступала никогда, даже когда все дома задания стояли.
  if ((m.u32(G.step) & 0x1f) === 0) { try { call(eng, 0x17728, {}); } catch { /* на следующем */ } }
  const сек = +(т * ТИК_МС / 1000).toFixed(1);
  const живые = new Set(свои());
  for (const i of прошлые) if (!живые.has(i) && !(m.u8(UNITS + i + U.TYPE) >= 0x1a && !(m.u8(UNITS + i + U.FLAGS5B) & 1))) {
    погибло++; гибели.push([Math.round(сек), ТИП[m.u8(UNITS + i + U.TYPE)] || m.u8(UNITS + i + U.TYPE), (ктоБил.get(i) || []).join('+') || '?', (m.u16(UNITS + i + U.X) >> 5) + ',' + (m.u16(UNITS + i + U.Y) >> 5)]); if (!перваяГибель) перваяГибель = { сек, кем: (ктоБил.get(i) || []).join('+') || '?' };
  }
  прошлые = живые; максБойцов = Math.max(максБойцов, [...живые].filter(i => m.u8(UNITS + i + U.TYPE) !== 4).length);
  if (т % 9 === 0) {
    ктоБил.clear();
    for (let з = m.u32(G.unitHead); з; з = m.u32(UNITS + з + U.NEXT)) {
      if (!жив(з) || m.u8(UNITS + з + U.OWNER) === мой) continue;
      const ц = m.u32(UNITS + з + U.TARGET);
      if (ц && живые.has(ц)) { const сп = ктоБил.get(ц) || []; сп.push(ИМЯ[m.u8(UNITS + з + U.TYPE)] || 'чужой'); ктоБил.set(ц, сп); }
    }
    const сейчас = дома();
    for (const [в, n] of Object.entries(сейчас)) for (let k = 1; k <= n; k++) if (!вехи[`${в}#${k}`]) вехи[`${в}#${k}`] = Math.round(сек);
    // Кто ломает дома: вид дома, секунда и кто держал наши дома целью на этом шаге.
    for (const [в, n] of Object.entries(былиДома)) if ((сейчас[в] || 0) < n) {
      const ломали = new Set();
      for (let з = m.u32(G.unitHead); з; з = m.u32(UNITS + з + U.NEXT)) {
        if (!жив(з) || m.u8(UNITS + з + U.OWNER) === мой) continue;
        const ц = m.u32(UNITS + з + U.TARGET); if (ц && m.u8(UNITS + ц + U.OWNER) === мой && m.u8(UNITS + ц + U.TYPE) >= 0x1a) ломали.add(ИМЯ[m.u8(UNITS + з + U.TYPE)] || 'чужой');
      }
      потериДомов.push({ вид: +в, сек: Math.round(сек), ломали: [...ломали].join('+') || '?' });
    }
    былиДома = сейчас;
    еды = Math.max(еды, m.u32(G.food + мой * 4));
  }
  // JW_ОПЫТ_СЛЕД=N — раз в N секунд в stderr: план штаба, директива и статы отряда (hp/макс атк/защ).
  if (СЛЕД && т % Math.round(СЛЕД * 1000 / ТИК_МС) === 0)
    console.error(Math.round(сек), 'еда', m.u32(G.food + мой * 4), 'дома', JSON.stringify(дома()), с.штаб?.план ?? с.план ?? '-', с.директива?.почему ?? '-', свои().filter(i => m.u8(UNITS + i + U.TYPE) === 1)
      .map(i => `${m.u8(UNITS + i + U.HP)}/${m.u8(UNITS + i + U.HPMAX)} ${m.u8(UNITS + i + U.ATK)} ${m.u8(UNITS + i + U.DEF)} ${m.u8(UNITS + i + U.SPD)} x${m.u32(UNITS + i + U.XP)} w${m.u8(UNITS + i + U.WEAPON)}`).join(' | '), 'g', [0x38206,0x38208,0x3820a,0x3820c,0x3820e].map(a => m.u16(a).toString(16)).join(','));
  const конец = m.u8(G.endcode);
  if (конец) { итог = конец === 2 ? 'ПОБЕДА' : 'поражение'; секИтога = сек; break; }
}
console.log(JSON.stringify({ итог, секИтога, еда: m.u32(G.food + мой * 4), максКазна: еды, дома: дома(),
  живых: свои().length, максБойцов, погибло, перваяГибель, вехи, потериДомов, выходы: с.выходы, гибели }));
