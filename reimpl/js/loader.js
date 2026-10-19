// Загрузка миссии в память (порт FUN_00015026 и цепочки старта) — без снимка эталона.
import { Mem, G, U, UNITS } from './mem.js'; import { Archive } from './archive.js'; import { call, F } from './fn.js'; import { Engine } from './engine.js'; import * as НовыеЗвери from './port/новые_звери.js';
export const SECTIONS = [[0x31a90, 30], [0x31aae, 7072], [0xe4404, 57600], [0xf4f34, 8000], [0xf2504, 10800], [0x10ce74, 45056], [0x31b88, 160], [0xf6e74, 90112], [0x117e74, 45056]]; // SI GI OB OI OM BI EV BG MO
export const TILE_TRT = 0x49b2c, TILE_INF = 0x3183c, TILESET_LOADED = 0x33839, TILESET_CUR = 0x3364a;
// Карты лобби: id < 100 — миссия кампании (пак 08, вариант племени), id 100+k — сетевая карта k из
// пака 13 (у неё вариантов нет: одна запись, восемь племён с равными армиями). data/maps.json.
// id 200+k — «демо-карты» из пака 10: семь карт того же формата с именами demo #1…#7 и demo save,
// которые в самой игре ниоткуда не открываются (их считал ещё grom_pe: 96 + 7 + 20).
export const картаПоId = (id) => id >= 200 ? { пак: '_PWAR10.TRC', индекс: id - 200 }
  : id >= 100 ? { пак: '_PWAR13.TRC', индекс: id - 100 } : null;
/**
 * Загрузить карту в память движка.
 * @param {number} mission id < 100 — стадия кампании (пак 08, вариант по племени), 100+ — сетевая карта
 * @param {number} tribe   племя человека, difficulty — 0..2
 * @returns новый Engine поверх этой памяти
 */
/**
 * Номер карты, как её просили загрузить (100+ — сетевые, 200+ — демо). В памяти движка его нет:
 * все сетевые карты пишутся туда одним номером 11, потому что миссия у них общая. А угодьям
 * (js/ai/угодья.js) нужна именно КАРТА, поэтому запоминаем её здесь, при загрузке.
 */
export let текущаяКарта = -1;
export function loadMission(mem, files, mission, tribe, difficulty) {
  текущаяКарта = mission;
  // files: { '_PWAR08.TRC': Uint8Array, '_PWAR09.TRC': Uint8Array, '_PWAR13.TRC'?: Uint8Array }
  const карта = картаПоId(mission);
  if (карта && !files[карта.пак]) throw new Error('нет пака ' + карта.пак);
  const eng = new Engine(mem); eng.files = files;
  mem.w8(G.mission, карта ? 11 : mission); mem.w8(G.humanOwner, tribe); mem.w8(G.difficulty, difficulty);
  mem.w16(G.speed, 1); mem.w16(G.countdown, 1); mem.w8(G.norender, 1); mem.w8(0x30344, 0); mem.w8(G.netflag, 0);
  call(eng, 0x10713);                       // выгрузка предыдущей карты (FUN_00010713)
  const maps = new Archive(files[карта ? карта.пак : '_PWAR08.TRC']); const idx = карта ? карта.индекс : mission * 8 + tribe;
  for (let k = 0; k < 9; k++) { const [dst, size] = SECTIONS[k]; const d = maps.data(idx * 9 + k); mem.b.set(d.subarray(0, size), dst); }
  mem.w8(G.mission, карта ? 11 : mission); mem.w8(G.difficulty, difficulty); mem.w8(G.humanOwner, tribe);   // GI затирает их — оригинал восстанавливает (FUN_00015026)
  // FUN_00010b74: тайлсет по [0x3364a] (заполняется из SI? нет — из GI; см. трассу)
  const ts = mem.u32(TILESET_CUR) & 0xff;
  if (mem.u8(TILESET_LOADED) !== ts) { const t9 = new Archive(files['_PWAR09.TRC']); mem.b.set(t9.data(ts * 2).subarray(0, 605184), TILE_TRT); mem.b.set(t9.data(ts * 2 + 1).subarray(0, 591), TILE_INF); mem.w8(TILESET_LOADED, ts); call(eng, 0x24503); }
  if (F[0x10b29]) call(eng, 0x10b29, { eax: tribe });   // племенные спрайты (пак 05) в слоты 0xb17+
  call(eng, 0x26521);
  call(eng, 0x15070); call(eng, 0x244c3); call(eng, 0x15127);   // FUN_00015026 хвост
  call(eng, 0x1545a); call(eng, 0x15da1);                          // сложность, ИИ
  mem.w32(G.step, 0); mem.w32(G.ticks, 0); mem.w8(G.endcode, 0); mem.w16(G.gameover, 0);
  // Чистые племенные таблицы, какими их положил образ игры. Скирмиш (js/port/skirmish.js)
  // переставляет их по местам — облик зданий, доступные постройки, предпочтения ИИ, — и если
  // снимать «исходник» с уже переставленной таблицы, при повторной расстановке получается каша:
  // игрок за Ka-noo-se с домами Tyrano.
  //
  // ВАЖНО: ни одна из трёх таблиц не лежит в секциях карты (SECTIONS выше), то есть загрузка
  // следующей миссии их НЕ восстанавливает — они живут с самого старта и до конца вкладки.
  // Поэтому эталон снимаем ровно один раз, с ещё чистой памяти, а на каждой загрузке
  // возвращаем таблицы к нему. Иначе после первой же партии скирмиша «эталоном» становилась
  // уже переставленная таблица: во второй партии Tyrano в слоте получал чужое святилище и
  // чужие дома (владелец: «тирана взял, а главка не тирановская»).
  if (!mem.племенныеТаблицы) {
    mem.племенныеТаблицы = {
      тех: [...Array(8)].map((_, s) => mem.u32(0x30e88 + s * 4)),
      облик: mem.b.slice(0x416d4, 0x416d4 + 14 * 8 * 4),
      ии: mem.b.slice(0x32d2c, 0x32d2c + 8 * 32),
    };
  } else {
    const э = mem.племенныеТаблицы;
    for (let s = 0; s < 8; s++) mem.w32(0x30e88 + s * 4, э.тех[s]);
    mem.b.set(э.облик, 0x416d4);
    mem.b.set(э.ии, 0x32d2c);
  }
  НовыеЗвери.вставить(mem);           // кадры брахиозавра/демона вместо заглушек 1×1 (если пак загружен)
  return eng;
}
