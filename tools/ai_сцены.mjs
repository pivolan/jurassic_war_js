// Тестовые сцены уровня войска: поставленные вручную положения, в которых видно, ЧТО компьютер
// делает и насколько это разумно.
//
//   node tools/ai_сцены.mjs                       # прогнать все сцены скриптом, записать реплеи
//   node tools/ai_сцены.mjs --сцена=оборона --секунд=240
//   node tools/ai_сцены.mjs --комдив=out/ai/weights/комдив-комдив1.json   # те же сцены сетью
//   node tools/ai_сцены.mjs --список
//
// Зачем (просьба владельца): «не видно, как происходит управление группами и насколько адекватно
// она себя ведёт; если закидывать на карту против остальных игроков, они просто сумбурно
// двигаются туда-сюда, и непонятно, что менять». В полной партии всё смешано. Здесь каждая сцена
// проверяет ровно одно умение, и по ней сразу видно, получилось или нет.
//
// Что на выходе:
//   • .jwr в out/replays — его видно в списке реплеев прямо в игре: можно открыть и посмотреть
//     глазами, с паузой и перемоткой;
//   • строчка итога на сцену: выжили, убили, принесли еды, что построили;
//   • с --подробно — журнал решений: на каком шаге кто какую задачу получил.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url'; import zlib from 'node:zlib';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));

const { движок, ТИК_МС } = await import('./ai_duel.mjs');
const { loadMission } = await import('../reimpl/js/loader.js');
const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
const Скрипт = await import('../reimpl/js/port/ai_script.js');
const Комдив = await import('../reimpl/js/ai/комдив.js');
const { G, U, UNITS, BI, ITEMS } = await import('../reimpl/js/mem.js');
const { F } = await import('../reimpl/js/fn.js');
// Сами расстановки живут в reimpl/js/ai/сцены.js — их берёт и стенд, и игра (в игре их запускают
// живьём, а не смотрят записью). Здесь остаётся только прогон и запись .jwr.
const { СЦЕНЫ, бойцы, дома, кл, мясоНаЗемле } = await import('../reimpl/js/ai/сцены.js');
const { состояниеJS } = await import('../reimpl/js/net/lockstep.js');   // снимок JS-мира для записи — тот же, что в игре

const SIM_LO = 0x30000, SIM_HI = 0x123000, SYNC_EVERY = 512, REC_SIZE = 16;
const ЗДАНИЕ = 0x1a, ЕДА = 0x1e;
const ПЛЕМЕНА = ['Tyrano', 'Ka-noo-se', 'Romack', 'Masai', 'Moospell', 'Koomba', 'RaDumBa', 'Koaka'];

// ---------------------------------------------------------------- запись реплея
/** Собрать .jwr из снимка и записанных приказов — формат js/ui/replay.js. */
function собратьРеплей({ снимок, записи, синх, голова }) {
  const head = Buffer.from(JSON.stringify(голова), 'utf8');
  const snap = zlib.deflateSync(Buffer.from(снимок));
  const recs = Buffer.from(записи), sync = Buffer.from(синх);
  const части = [head, snap, recs, sync];
  const всего = 4 + части.reduce((s, ч) => s + 4 + ч.length, 0);
  const out = Buffer.alloc(всего); let p = 0;
  out.write('JWR1', p, 'latin1'); p += 4;
  for (const ч of части) { out.writeUInt32LE(ч.length, p); p += 4; ч.copy(out, p); p += ч.length; }
  return out;
}

// ---------------------------------------------------------------- прогон одной сцены
async function прогнатьСцену(имя, сц) {
  const eng = движок(); const m = eng.m;
  const карта = +(арг.карта || сц.карта), секунд = +(арг.секунд || сц.секунд);
  const племяСц = +(арг.племя ?? сц.племя ?? 0);
  loadMission(m, eng.files, карта, племяСц, 1);
  const цвета = Object.keys(стартовыеПозиции(m)).map(Number).sort((a, b) => a - b);
  const нас = цвета[0], враг = цвета[1];
  расставить(eng, [{ цвет: нас, племя: 0, кто: 'компьютер' }, { цвет: враг, племя: 3, кто: 'компьютер' }], {});
  сц.собрать(eng, нас, враг);

  // Мозги: скрипт или комдив. Соперник всегда обычный скрипт.
  const комдив = арг.комдив ? Комдив.изЗаписи(JSON.parse(fs.readFileSync(path.join(КОРЕНЬ, арг.комдив), 'utf8'))) : null;
  // --стратег=1 — новый скриптовый ИИ (js/ai/стратег_правило.js) вместо нынешнего: на сцене сразу
  // видно, какая из его фаз работает хуже старого.
  m.w8(0x32aec + нас, 0); const сНаш = Скрипт.задать(eng, нас, { уровень: 3, характер: 'костяк', комдив, стратегПравило: арг.стратег === '1' });
  m.w8(0x32aec + враг, 0); Скрипт.задать(eng, враг, { уровень: 3, характер: 'ровный' });
  m.w8(G.humanOwner, нас);                                            // камера и «наши» в просмотре — это мы

  // Снимок ДО первого шага: реплей воспроизводится ровно с него. Память движка — половина дела;
  // штабы компьютера, планы и очереди живут в JS, и без них запись переигрывается без ИИ вовсе.
  const снимок = m.b.slice(SIM_LO, SIM_HI);
  const снимокJS = состояниеJS(eng);
  // Пишем приказы так же, как это делает игра: обёрткой над 0x14895.
  const записи = [], синх = [];
  const прежний = F[0x14895];
  F[0x14895] = (e, r) => {
    const шаг = m.u32(G.step);
    const б = Buffer.alloc(REC_SIZE);
    б.writeUInt32LE(шаг >>> 0, 0); б.writeUInt8(0, 4); б.writeUInt8(r.eax & 0xff, 5);
    б.writeUInt16LE(r.esi & 0xffff, 8); б.writeUInt16LE(r.edi & 0xffff, 10);
    б.writeUInt16LE(r.edx & 0xffff, 12); б.writeUInt16LE(r.ebx & 0xffff, 14);
    записи.push(б);
    return прежний(e, r);
  };

  const шагов = Math.round(секунд * 1000 / ТИК_МС);
  const журнал = [];
  let прошлые = '';
  const { stateHash } = await import('../reimpl/js/ui/replay.js');
  // Рост по минутам: лучший боец и вся армия. Для сцены-качалки это и есть главный ответ.
  const ростПоМинутам = [];
  const вМинуте = Math.round(60000 / ТИК_МС);
  for (let k = 0; k < шагов; k++) {
    eng.timer++; eng.tick();
    if (арг.рост && k % вМинуте === 0) {
      let лучший = 0, сумма = 0, n = 0;
      for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
        if (m.u8(UNITS + i + U.FLAGS5B) & 1 || m.u8(UNITS + i + U.OWNER) !== нас) continue;
        const t = m.u8(UNITS + i + U.TYPE); if (t < 1 || t > 13) continue;
        const с2 = m.u8(UNITS + i + U.ATK) + m.u8(UNITS + i + U.DEF) + m.u8(UNITS + i + U.HPMAX);
        сумма += с2; n++; if (с2 > лучший) лучший = с2;
      }
      ростПоМинутам.push(`${String(Math.round(k / вМинуте)).padStart(3)} мин: бойцов ${String(n).padStart(2)}, лучший ${String(лучший).padStart(3)}, вся армия ${сумма}`);
    }
    const ш = m.u32(G.step);
    if (ш % SYNC_EVERY === 0) { const б = Buffer.alloc(8); б.writeUInt32LE(ш >>> 0, 0); б.writeUInt32LE(stateHash(m) >>> 0, 4); синх.push(б); }
    if (арг.подробно) {
      const о2 = сНаш.отряды || {};
      const н = (к) => (о2[к] || []).length;
      const т = `${сНаш.стратегПравило ? сНаш.фаза : сНаш.осанка} | раб ${н('рабочие')} охот ${н('охотники')}+${н('охота')} кулак ${н('кулак')} охр ${н('охрана')} разв ${н('разведка')}`;
      if (т !== прошлые) { журнал.push(`  ${String(Math.round(ш * 55 / 1000)).padStart(4)} с: ${т}`); прошлые = т; }
    }
  }
  F[0x14895] = прежний;

  const наши = бойцы(m, нас), чужие = бойцы(m, враг);
  const сила = (сп) => сп.reduce((s, i) => s + m.u8(UNITS + i + U.ATK) + m.u8(UNITS + i + U.DEF) + m.u8(UNITS + i + U.HPMAX), 0);
  // Разброс: средняя удалённость бойца от середины отряда. По нему видно «держатся ли вместе».
  let сx = 0, сy = 0;
  for (const i of наши) { const c = кл(m, i); сx += c.x; сy += c.y; }
  const центр = наши.length ? { x: сx / наши.length, y: сy / наши.length } : null;
  const разброс = наши.length ? наши.reduce((s2, i) => { const c = кл(m, i);
    return s2 + Math.hypot(c.x - центр.x, c.y - центр.y); }, 0) / наши.length : 0;
  const итог = { сцена: имя, наших: наши.length, силаНаших: сила(наши), чужих: чужие.length, силаЧужих: сила(чужие),
                 казна: m.u32(G.food + нас * 4), домов: дома(m, нас).length, шагов,
                 разброс: Math.round(разброс), мясоНаЗемле: мясоНаЗемле(m) };

  // ver 2 — нынешняя формула сверки (js/ui/replay.js, ВЕРСИЯ): «нарисован в кадре» в хеш не идёт.
  const голова = { ver: 2, mission: карта, tribe: 0, difficulty: 1, path: 'astar', outcome: 'exit',
    состояние: снимокJS,               // штабы, планы, очереди — иначе запись переигрывается без ИИ
    steps: шагов, orders: записи.length, date: Date.now(),
    name: `сцена «${имя}» · ${арг.комдив ? 'комдив' : (арг.стратег === '1' ? 'стратег' : 'скрипт')} · ${ПЛЕМЕНА[племяСц]}`,
    build: new Date().toISOString(), patrols: [], queues: [], следом: [],
    правила: { сцена: имя, мозги: арг.комдив ? 'комдив' : 'скрипт' } };
  // Имя файла латиницей: релей берёт id реплея прямо из имени файла и отдаёт его по ссылке,
  // а кириллица в ссылке превращается в проценты и читается глазами плохо. Русское название
  // живёт внутри, в поле name — именно его показывает список в игре.
  const ЛАТ = { пастбище: 'pasture', мясо: 'meat', оборона: 'defend', встречный: 'clash', добить: 'finish', сильнее: 'stronger',
                качалка: 'levelup', двастада: 'two-herds', дальнее: 'far-herd', вразброс: 'scattered', слабыйсильный: 'weak-strong' };
  const файл = path.join(КОРЕНЬ, 'out/replays', `scene-${ЛАТ[имя] || имя}-${арг.комдив ? 'net' : (арг.стратег === '1' ? 'strateg' : 'script')}.jwr`);
  fs.mkdirSync(path.dirname(файл), { recursive: true });
  fs.writeFileSync(файл, собратьРеплей({ снимок, записи: Buffer.concat(записи), синх: Buffer.concat(синх), голова }));
  return { итог, журнал, файл, ростПоМинутам };
}

// ---------------------------------------------------------------- запуск
if (арг.список) {
  for (const [имя, сц] of Object.entries(СЦЕНЫ)) console.log(`${имя.padEnd(12)} — ${сц.что} (карта ${сц.карта}, ${сц.секунд} с)`);
  process.exit(0);
}
const имена = арг.сцена ? арг.сцена.split(',') : Object.keys(СЦЕНЫ);
console.log(`сцены: ${имена.join(', ')}; мозги: ${арг.комдив ? 'комдив ' + арг.комдив : 'скрипт'}`);
for (const имя of имена) {
  const сц = СЦЕНЫ[имя]; if (!сц) { console.log(`нет такой сцены: ${имя}`); continue; }
  const { итог, журнал, файл, ростПоМинутам } = await прогнатьСцену(имя, сц);
  console.log(`\n${имя} — ${сц.что}`);
  console.log(`  к концу: наших ${итог.наших} (сила ${итог.силаНаших}), чужих ${итог.чужих} (сила ${итог.силаЧужих}), казна ${итог.казна}, домов ${итог.домов}, разброс ${итог.разброс} кл., мяса на земле ${итог.мясоНаЗемле}`);
  console.log(`  реплей: ${path.relative(КОРЕНЬ, файл)}`);
  if (журнал.length) { console.log('  что решал штаб:'); for (const с of журнал.slice(0, 40)) console.log(с); }
  if (ростПоМинутам?.length) { console.log('  рост по минутам:'); for (const р of ростПоМинутам) console.log('    ' + р); }
}
process.exit(0);
