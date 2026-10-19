// Образец на ПОЛНОЙ первой миссии за Тирано: сколько еды наберёт и за сколько.
//
// Ориентир владельца: человек проходит её за 2:22. Цель миссии — накопить 3000 еды (считается
// только то, что юниты несут в руках). Обрезки карты здесь нет, зверьё не удаляется: это настоящая
// миссия, только ведёт её наш скриптовый образец.
//
//   node tools/образец_миссия.mjs [секунд=200] [ударовНаОтход]
import { движок, ТИК_МС } from './ai_duel.mjs';
const { loadMission } = await import('../reimpl/js/loader.js');
const { G, U, UNITS } = await import('../reimpl/js/mem.js');
const Обр = await import('../reimpl/js/ai/образец.js');
const СЕКУНД = +(process.argv[2] || 200), УДАРОВ = +(process.argv[3] || 0);
// Племя и миссия — доводами: тот же образец должен работать за всех, это и проверяем.
const ПЛЕМЯ = +(process.argv[4] ?? process.env.JW_ПЛЕМЯ ?? 0);
const МИССИЯ = +(process.argv[5] ?? process.env.JW_МИССИЯ ?? 0);
const ЦЕЛЬ_ЕДЫ = 3000;

const eng = движок(); const m = eng.m;
loadMission(m, eng.files, МИССИЯ, ПЛЕМЯ, 2);
const мой = m.u8(G.humanOwner); m.w8(0x32aec + мой, 0);
const наши = [];
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
  if (m.u8(UNITS + i + U.OWNER) === мой && m.u8(UNITS + i + U.TYPE) < 0x1a) наши.push(i);
}
const с = Обр.новое(); if (УДАРОВ) с.ударовНаОтход = УДАРОВ;
// ВЕДЁМ ВСЕХ СВОИХ, КАК НА СТРАНИЦЕ. Раньше стенд брал четвёрку один раз на старте, а страница
// (всеСвои в web/game.js) каждый шаг собирает всех живых заново — и деревня по ходу миссии
// рождает новых людей. Из-за этого стенд и страница расходились до неузнаваемости: у меня
// четверо ходили кучкой, у владельца к ним добавлялись новички от хижины и отряд «разбегался».
const всеСвои = () => {
  const из = [];
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (m.u8(UNITS + i + U.OWNER) !== мой || m.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
    if (m.u8(UNITS + i + U.HP) <= 0 || (m.u8(UNITS + i + U.STATE) & 0xf0) === 0x60) continue;
    из.push(i);
  }
  return из;
};
const еда = () => наши.reduce((a, i) => a + (Обр.жив(m, i) ? m.u16(UNITS + i + U.FOOD) : 0), 0);
const предел = Math.round(СЕКУНД * 1000 / ТИК_МС);
let убито = 0, достигнуто = null; let былоЖивых = наши.length, пикЖивых = наши.length;
for (let тик = 0; тик < предел; тик++) {
  const живые = всеСвои();
  for (const i of живые) if (!наши.includes(i)) наши.push(i);     // новички из деревни — тоже наши
  Обр.шаг(eng, живые, с);
  eng.timer++; eng.tick();
  if (!(тик % 18)) {
    const живо = наши.filter(i => Обр.жив(m, i)).length;
    if (живо > пикЖивых) пикЖивых = живо;
    if (живо < былоЖивых) {
      былоЖивых = живо;
      console.log(`  ${(тик * ТИК_МС / 1000).toFixed(0)}с потеря · осталось ${живо} · здоровье ` +
        наши.map(i => Обр.жив(m, i) ? m.u8(UNITS + i + U.HP) + '/' + m.u8(UNITS + i + U.HPMAX) : 'x').join(' ') +
        ` · еды ${еда()}`);
    }
    if (еда() >= ЦЕЛЬ_ЕДЫ && достигнуто === null) { достигнуто = тик * ТИК_МС / 1000; break; }
    if (наши.every(i => !Обр.жив(m, i))) break;
  }
}
const живых = наши.filter(i => Обр.жив(m, i)).length;
console.log(JSON.stringify({
  племя: ПЛЕМЯ, миссия: МИССИЯ + 1, цельЕды: ЦЕЛЬ_ЕДЫ, набрано: еда(), достигнутоНаСек: достигнуто,
  своихБыло: наши.length, живых, секундПрогона: +(предел * ТИК_МС / 1000).toFixed(0),
  здоровье: наши.map(i => Обр.жив(m, i) ? m.u8(UNITS + i + U.HP) : 'x').join('/'),
}));
