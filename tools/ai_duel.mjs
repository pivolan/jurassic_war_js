// Дуэль компьютеров без браузера (наше): скирмиш-карта, места за компьютером, крутим симуляцию
// и смотрим, кто кого. Нужна, чтобы настраивать ИИ не вслепую и гонять сценарии в фоне.
//
//   node tools/ai_duel.mjs [карта] [секунд] [племена через запятую] [ии]
//     карта    — id как в лобби: 100+ сетевые (пак 13), 200+ демо (пак 10). По умолчанию 100.
//     секунд   — игрового времени (тик = 55 мс). По умолчанию 300.
//     племена  — по одному на место, например 0,4 (Tyrano против Moospell). По умолчанию 0,3.
//     ии       — 'встроенный' (по умолчанию) или 'скрипт'.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..') + '/';
import { Mem, G, U, UNITS } from '../reimpl/js/mem.js';
import { Engine } from '../reimpl/js/engine.js';
import { loadMission } from '../reimpl/js/loader.js';
import '../reimpl/js/modules.js';
// Угодья карт (js/ai/угодья.js): постоянные точки выпаса, посчитанные tools/ai_пастбища.mjs.
// Стенду файл доступен с диска; в игре его подтягивает game.js через fetch.
import * as Угодья from '../reimpl/js/ai/угодья.js';
// JW_PASTURES=0 — выключить таблицу: штаб ищет зверя глазами, как было до неё. Нужно для замера:
// иначе «с таблицей» и «без» сравнивать не с чем (имя латиницей — кириллицу из bash не задать).
if (process.env.JW_PASTURES !== '0') {
  try { Угодья.задать(JSON.parse(fs.readFileSync(КОРЕНЬ + 'reimpl/data/пастбища.json', 'utf8'))); }
  catch { /* таблицы нет — штаб будет искать зверя глазами, как раньше */ }
}
import { F } from '../reimpl/js/fn.js';
import { fixSlotPointers } from '../reimpl/js/render/scene.js';
import * as НовыеЗвери from '../reimpl/js/port/новые_звери.js';
import { расставить, стартовыеПозиции } from '../reimpl/js/port/skirmish.js';
import { setPathMode } from '../reimpl/js/port/path.js';
import * as Скрипт from '../reimpl/js/port/ai_script.js';

for (const a of [0x26e4d, 0x26e62]) F[a] = () => {};                       // звук и прочая обвязка экрана
// Возрождение зверья (0x1cfcb) и отрастание растений (0x1d12e) раньше здесь глушились — и все
// выводы про «еда на карте конечна, копить бессмысленно» оказались выводами про стенд, а не про
// игру: в оригинале собака возрождается через 720 шагов (40 с), леопард через 1080, тигр через
// 1800, крупные динозавры через 5400–8100. То есть мясо и опыт на карте восполняются, и долгая
// охота имеет смысл. Глушить можно только явно, переменной ЖИВНОСТЬ=0 (для старых замеров).
if (process.env.ЖИВНОСТЬ === '0' || process.env.ZHIVNOST === '0') { F[0x1cfcb] = () => {}; F[0x1d12e] = () => {}; }
setPathMode('astar');

export const ТИК_МС = 55;
export function движок() {
  const снимок = zlib.inflateSync(fs.readFileSync(КОРЕНЬ + 'reimpl/data/boot_snap.bin.z'));
  const files = {};
  for (const f of ['_PWAR01.TRC', '_PWAR05.TRS', '_PWAR08.TRC', '_PWAR09.TRC', '_PWAR10.TRC', '_PWAR13.TRC'])
    try { files[f] = new Uint8Array(fs.readFileSync(КОРЕНЬ + 'PWAR/' + f)); } catch {}
  const m = Mem.ofSize(); m.b.set(снимок, 0x30000); m.w32(0x46c, 110); fixSlotPointers(m);
  // кадры новых зверей (beasts.bin) не грузим: брахиозавр убран из игры 27.09.2026
  const eng = new Engine(m); eng.files = files;
  return eng;
}

/** Собрать партию: карта, места [{цвет, племя, кто}]. Возвращает движок. */
export function партия(карта, места, { сложность = 1, быстрый = false } = {}) {
  const eng = движок();
  loadMission(eng.m, eng.files, карта, места[0]?.племя ?? 0, сложность);
  расставить(eng, места, { быстрый });
  for (const м of места) if (м.ии === 'скрипт') {
    eng.m.w8(0x32aec + м.цвет, 0);                       // встроенный ИИ этому цвету не нужен
    Скрипт.задать(eng, м.цвет, { уровень: м.уровень ?? 1, характер: м.характер || 'ровный' });
  }
  return eng;
}

/** Сводка по цветам: живые бойцы, здания, еда. */
export function сводка(m) {
  const из = {};
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const вл = m.u8(UNITS + i + U.OWNER), t = m.u8(UNITS + i + U.TYPE); if (вл > 7) continue;
    const з = из[вл] ??= { бойцов: 0, зданий: 0, еда: 0 };
    if (t >= 1 && t <= 13) з.бойцов++; else if (t >= 0x1a) з.зданий++;
  }
  for (const вл of Object.keys(из)) из[вл].еда = m.u32(G.food + вл * 4);
  return из;
}
const живы = (с) => Object.entries(с).filter(([, з]) => з.бойцов + з.зданий > 0).map(([вл]) => +вл);

/** Прогнать партию. Возвращает {шагов, победитель, история}. */
export function прогнать(eng, шагов, { отметка = 0, наШаге = null } = {}) {
  const m = eng.m; const история = [];
  for (let k = 0; k < шагов; k++) {
    eng.timer++; eng.tick();
    наШаге?.(eng, k);
    if (отметка && (k % отметка) === 0) история.push({ шаг: k, ...сводка(m) });
    if ((k & 0x3f) === 0) { const ж = живы(сводка(m)); if (ж.length <= 1) return { шагов: k, победитель: ж[0] ?? null, история }; }
  }
  const ж = живы(сводка(m));
  return { шагов, победитель: ж.length === 1 ? ж[0] : null, история };
}

/** Что сейчас в голове у каждого скриптового штаба — для разбора зависаний. */
export function отчёт(eng, места) {
  const m = eng.m;
  for (const мес of места) {
    const с = Скрипт.состояние(eng, мес.цвет); if (!с) continue;
    const оп = (i) => `#${i} т${m.u8(UNITS + i + U.TYPE)} hp${m.u8(UNITS + i + U.HP)}/${m.u8(UNITS + i + U.HPMAX)} сост${m.u8(UNITS + i + U.STATE)} цель${m.u32(UNITS + i + U.TARGET)} (${m.u16(UNITS + i + U.X) >> 5},${m.u16(UNITS + i + U.Y) >> 5})`;
    const дома = []; let звери = 0, мясо = 0, чужие = 0;
    for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
      if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
      const t = m.u8(UNITS + i + U.TYPE), вл = m.u8(UNITS + i + U.OWNER);
      if (вл === мес.цвет && t >= 0x1a) дома.push(`${t - 0x1a}:hp${m.u8(UNITS + i + U.HP)}/${m.u8(UNITS + i + U.HPMAX)}@${m.u16(UNITS + i + U.X) >> 5},${m.u16(UNITS + i + U.Y) >> 5}`);
      else if (t >= 14 && t <= 23) звери++;
      else if (вл < 8 && вл !== мес.цвет && t >= 1 && t <= 13) чужие++;
    }
    for (let it = m.u32(0x31b7c); it; it = m.u32(0xf4f34 + it + 0xc)) if (m.u8(0xf4f34 + it) === 0x1e) мясо++;
    console.log(`  цвет ${мес.цвет}: осанка ${с.осанка} · еда ${m.u32(G.food + мес.цвет * 4)} · дома [${дома}] · зверья на карте ${звери} · мяса ${мясо} · чужих бойцов ${чужие} · цель ${JSON.stringify(с.цель)} · добыча ${с.добыча} · чёрный список ${с.чёрный.size}`);
    console.log(`     армия: ${с.отряды.кулак.map(оп).join(' | ') || 'нет'}`);
    console.log(`     рабочие: ${с.отряды.рабочие.map(оп).join(' | ') || 'нет'} · строители: ${[...Array(0)].length ? '' : ''}`);
  }
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  const карта = +(process.argv[2] || 100), сек = +(process.argv[3] || 300);
  const племена = (process.argv[4] || '0,3').split(',').map(Number);
  const eng = движок();
  loadMission(eng.m, eng.files, карта, племена[0], 1);
  const точки = стартовыеПозиции(eng.m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
  const ии = (process.argv[5] || 'скрипт').split(',');
  const уровни = (process.argv[6] || '1').split(',').map(Number);
  const места = племена.map((т, i) => ({ цвет: цвета[i], племя: т, кто: 'компьютер',
                                          ии: ии[i] ?? ии[0], уровень: уровни[i] ?? уровни[0] })).filter(м => м.цвет !== undefined);
  расставить(eng, места, {});
  for (const м of места) if (м.ии === 'скрипт') {
    eng.m.w8(0x32aec + м.цвет, 0);
    Скрипт.задать(eng, м.цвет, { уровень: м.уровень, характер: м.характер || 'ровный' });
  }
  console.log(`карта ${карта}: мест на карте ${цвета.length}, играют ${места.map(м => `цвет ${м.цвет}/племя ${м.племя}/${м.ии}${м.ии === 'скрипт' ? ' ур.' + м.уровень : ''}`).join(', ')}`);
  const t0 = Date.now();
  const шагов = Math.round(сек * 1000 / ТИК_МС);
  const r = прогнать(eng, шагов, { отметка: Math.round(30000 / ТИК_МС) });
  for (const с of r.история) {
    const строки = Object.entries(с).filter(([k]) => k !== 'шаг').map(([вл, з]) => `${вл}: ${з.бойцов}б ${з.зданий}д ${з.еда}е`);
    console.log(`  ${String(Math.round(с.шаг * ТИК_МС / 1000)).padStart(4)} с  ${строки.join('  |  ')}`);
  }
  console.log(`итог: ${r.победитель === null ? 'ничья/не доиграли' : 'победил цвет ' + r.победитель} за ${Math.round(r.шагов * ТИК_МС / 1000)} с игры, реального времени ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  отчёт(eng, места);
}
