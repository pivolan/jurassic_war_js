// Общая обвязка headless-инструментов обучения АИ (наше): загрузка снимка и архивов, сборка
// движка под арену, список сцен. Используется ai_smoke / ai_dataset / ai_eval / ai_rollout.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
export const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..') + '/';
const R = КОРЕНЬ + 'reimpl/';
import { Mem } from '../reimpl/js/mem.js';
import { Engine } from '../reimpl/js/engine.js';
import { loadMission } from '../reimpl/js/loader.js';
import '../reimpl/js/modules.js';
import { F } from '../reimpl/js/fn.js';
const { setPathMode } = await import('../reimpl/js/port/path.js');
await import('../reimpl/js/ai/act.js');            // обёртка 0x1419e ставится после modules.js
export const { АРЕНЫ, собрать, МИССИЯ, ПЛЕМЯ } = await import('../reimpl/js/ai/arena.js');
export const { СЦЕНЫ, УЧЕБНЫЕ, ПРОВЕРОЧНЫЕ, ПРОВЕРОЧНАЯ_ВАРИАЦИЯ } = await import('../reimpl/js/ai/scenes.js');
export const { решение } = await import('../reimpl/js/ai/policy_script.js');
export const { прогнать, начать, шаг, завершить, ИНТЕРВАЛ } = await import('../reimpl/js/ai/episode.js');
export const { ДЕЙСТВИЯ, ЧИСЛО_ДЕЙСТВИЙ } = await import('../reimpl/js/ai/act.js');
export const { ОКНО, СЛОЁВ, ВЕКТОР, РОЛИ } = await import('../reimpl/js/ai/obs.js');
export const { ПОДСКАЗКИ } = await import('../reimpl/js/ai/reward.js');
// Возрождение зверья и отрастание растений держим включёнными: в игре они есть (собака через
// 720 шагов, тигр через 1800, крупные динозавры через 5400–8100), и без них карта обедняется,
// а любые выводы про экономику получаются про стенд, а не про игру. Выключить — ЖИВНОСТЬ=0.
if (process.env.ЖИВНОСТЬ === '0' || process.env.ZHIVNOST === '0') { F[0x1cfcb] = () => {}; F[0x1d12e] = () => {}; }
// Веса подсказок можно переопределить переменной окружения — так PPO гоняется с разными
// наградами без правки кода: AI_ПОДСКАЗКИ='{"шаг":-0.002,"осцилляция":-0.06}'.
if (process.env.AI_ПОДСКАЗКИ) Object.assign(ПОДСКАЗКИ, JSON.parse(process.env.AI_ПОДСКАЗКИ));
// Константы учителя из JSON эволюции: AI_УЧИТЕЛЬ=out/ai/teacher-<дата>.json (поле «параметры»).
export const { ПАРАМЕТРЫ, СПЕК, задать, поУмолчанию } = await import('../reimpl/js/ai/params.js');
if (process.env.AI_УЧИТЕЛЬ) { const j = JSON.parse(fs.readFileSync(process.env.AI_УЧИТЕЛЬ, 'utf8')); задать(j.параметры || j); }
setPathMode('astar');

const снимок = zlib.inflateSync(fs.readFileSync(R + 'data/boot_snap.bin.z'));
const files = {};
for (const f of ['_PWAR01.TRC', '_PWAR05.TRS', '_PWAR08.TRC', '_PWAR09.TRC'])
  files[f] = new Uint8Array(fs.readFileSync(R + '../PWAR/' + f));

/** Свежий движок с загруженной миссией арены. Память выделяется заново — так проще, чем чистить. */
export function движок() {
  const m = Mem.ofSize(); m.b.set(снимок, 0x30000); m.w32(0x46c, 110);
  const eng = new Engine(m); eng.files = files;
  loadMission(m, files, МИССИЯ, ПЛЕМЯ, 1);
  return eng;
}

/** Собрать и прогнать эпизод: политика (eng, боец, эп, наб) → действие. */
export function эпизод(сцена, вариация, политика, собирать = false) {
  const eng = движок();
  const эп = собрать(eng, сцена, вариация);
  прогнать(eng, эп, политика, собирать);
  if (eng.errors && eng.errors.length) эп.ошибки = eng.errors.slice(0, 3);
  return эп;
}

export const среднее = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
