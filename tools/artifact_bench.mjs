// Стенд украшений (наше): проверяем, что пассивные прибавки из слотов 9..11 (js/port/artifacts.js)
// ничего не меняют при выключенном переключателе и меняют ровно то, что обещано, при включённом.
//
//   node tools/artifact_bench.mjs            — прогнать все опыты, вывести числа
//   node tools/artifact_bench.mjs --кадры    — плюс кадры сцены в out/img/украшения/
//
// Каждый опыт ставится на чистом куске карты: все чужие юниты сняты, бойцы созданы руками с
// одинаковыми характеристиками и одинаковым сидом, поэтому разница в итоге может быть только от
// украшения. Каждый опыт гоняется трижды: без предмета, с предметом и выключенным правилом,
// с предметом и включённым правилом. Первые два обязаны совпасть до байта.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import url from 'node:url';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(КОРЕНЬ, p);
const { Mem, G, U, UNITS, BI } = await import(R('reimpl/js/mem.js'));
const { Engine } = await import(R('reimpl/js/engine.js'));
const { loadMission } = await import(R('reimpl/js/loader.js'));
await import(R('reimpl/js/modules.js'));
const { F, call } = await import(R('reimpl/js/fn.js'));
const Артефакты = await import(R('reimpl/js/port/artifacts.js'));
const { приказ, КОД } = await import(R('reimpl/js/port/inject.js'));
const { fixSlotPointers, drawScene, SCENE_FULL } = await import(R('reimpl/js/render/scene.js'));
const { fixFontPointers } = await import(R('reimpl/js/render/text.js'));

const ПРЕДМЕТЫ = JSON.parse(fs.readFileSync(R('reimpl/data/economy_items.json'), 'utf8')).rows;
const имяПредмета = (id) => ПРЕДМЕТЫ[id]?.name || String(id);
const образ = zlib.inflateSync(fs.readFileSync(R('reimpl/data/boot_snap.bin.z')));
const files = {}; for (const f of fs.readdirSync(R('PWAR'))) if (/^_PWAR\d+\.TR[CSW]$/.test(f)) files[f] = new Uint8Array(fs.readFileSync(R('PWAR/' + f)));
const КАДРЫ = process.argv.includes('--кадры');
const КУДА = R('out/img/украшения'); if (КАДРЫ) fs.mkdirSync(КУДА, { recursive: true });

// ---------------------------------------------------------------- стенд
const МИССИЯ = 9;                         // карта кампании: племена с хозяйством, юниты не голодают
function стенд() {
  const m = Mem.ofSize(); m.b.set(образ, 0x30000); m.w32(0x46c, 110);
  const eng = loadMission(m, files, МИССИЯ, 0, 1);
  fixSlotPointers(m); fixFontPointers(m);
  for (let s = 0; s < 8; s++) { m.w32(G.food + s * 4, 60000); m.w8(0x32aec + s, 0); }   // ИИ выключен, еда есть
  m.w8(G.humanOwner, 0);
  return eng;
}
/** Боец с заданными характеристиками: «чуть выше среднего» — это десятая доля шкалы сверху базы. */
function боец(eng, тип, владелец, x, y, статы = {}) {
  const m = eng.m;
  const r = call(eng, 0x1caf0, { eax: тип | (владелец << 8), ecx: владелец, edx: x, ebx: y });
  if (!r || r.cf) return 0;
  const i = r.esi >>> 0, s = UNITS + i;
  const баз = { hp: m.u8(s + U.HPMAX), atk: m.u8(s + U.ATK), def: m.u8(s + U.DEF), spd: m.u8(s + U.SPD), mag: m.u8(s + U.MAG) };
  const дать = (поле, ключ) => { const v = статы[ключ]; if (v === undefined) return; m.w8(s + поле, Math.max(1, Math.min(255, v))); };
  дать(U.HPMAX, 'hp'); дать(U.ATK, 'atk'); дать(U.DEF, 'def'); дать(U.SPD, 'spd'); дать(U.MAG, 'mag');
  m.w8(s + U.HP, m.u8(s + U.HPMAX)); m.w8(s + U.MANA, m.u8(s + U.MAG)); m.w16(s + U.FOOD, 4000);
  return { i, баз };
}
const надеть = (eng, ю, предмет, слот = 9) => eng.m.w8(UNITS + ю + U.INV + слот, предмет);
const статы = (m, i) => ({ hp: m.u8(UNITS + i + U.HP), hpmax: m.u8(UNITS + i + U.HPMAX), atk: m.u8(UNITS + i + U.ATK),
  def: m.u8(UNITS + i + U.DEF), spd: m.u8(UNITS + i + U.SPD), mag: m.u8(UNITS + i + U.MAG), жив: !(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.HP) > 0 });
const крутить = (eng, шагов, кадр) => { for (let k = 0; k < шагов; k++) { eng.timer++; eng.tick(); кадр?.(k); } };

// ---- кадры: та же отрисовка, что в игре, камера на точку
const PAL = 0x44980, ROWS = 0x122e74, XBASE = 0x488c0, VW = 0x488c4, VH = 0x488c8, CAMX = 0x31ae8, CAMY = 0x31aec;
function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const T = Buffer.from(t), L = Buffer.alloc(4); L.writeUInt32BE(d.length); const C = Buffer.alloc(4); C.writeUInt32BE(crc(Buffer.concat([T, d]))); return Buffer.concat([L, T, d, C]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
function кадр(eng, файл, cx, cy, сТуманом = false) {
  const m = eng.m;
  // Кадр стенда: если не проверяем обзор, туман на время отрисовки снимаем и тут же возвращаем —
  // иначе поединок в глубине карты рисуется чёрным квадратом.
  let сохранено = null;
  if (!сТуманом) { сохранено = m.b.slice(BI, BI + 0xb000); for (let k = 0; k < 0xb000; k++) m.b[BI + k] |= 1; }
  m.w32(VW, 640); m.w32(VH, 480); m.w32(0x46ffc, 639); m.w32(0x31af0, 20); m.w32(0x31af4, 15);
  m.w8(0x31ae0, m.u8(0x31ae0) & 0xfe);
  m.w32(CAMX, Math.max(0, (cx - 320)) & ~31); m.w32(CAMY, Math.max(0, (cy - 240)) & ~31);
  drawScene(eng, SCENE_FULL);
  const base = m.u32(XBASE); const rgb = Buffer.alloc(640 * 480 * 3);
  for (let y = 0; y < 480; y++) { const строка = base + m.u32(ROWS + y * 4);
    for (let x = 0; x < 640; x++) { const c = m.b[строка + x], o = (y * 640 + x) * 3;
      rgb[o] = m.b[PAL + c * 3]; rgb[o + 1] = m.b[PAL + c * 3 + 1]; rgb[o + 2] = m.b[PAL + c * 3 + 2]; } }
  fs.writeFileSync(path.join(КУДА, файл), png(640, 480, rgb));
  if (сохранено) m.b.set(сохранено, BI);
}

// ---------------------------------------------------------------- опыты
const ПОЛЕ = { x: 32 * 60, y: 32 * 60 };        // пустое место на карте, подальше от чужих
const итоги = [];
const запиши = (о) => { итоги.push(о); console.log('   ' + Object.entries(о).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')); return о; };

/** Поединок: слева боец с украшением, справа такой же без него. Статы подобраны так, чтобы
 *  прибавка пересекала ступень формулы урона ((ATK−DEF)>>4 + ATK>>5 + 1). */
function поединок(имя, предмет, вкл, статыA, статыB, кадрыПрефикс) {
  const eng = стенд(); const m = eng.m;
  Артефакты.задать(eng, вкл);
  const A = боец(eng, 1, 0, ПОЛЕ.x, ПОЛЕ.y, статыA);
  const B = боец(eng, 1, 1, ПОЛЕ.x + 32, ПОЛЕ.y, статыB);
  if (предмет) надеть(eng, A.i, предмет);
  крутить(eng, 8);
  const доA = статы(m, A.i);
  приказ(eng, A.i, КОД.АТАКА, B.i, m.u16(UNITS + B.i + U.X), m.u16(UNITS + B.i + U.Y));
  приказ(eng, B.i, КОД.АТАКА, A.i, m.u16(UNITS + A.i + U.X), m.u16(UNITS + A.i + U.Y));
  let шаг = 0;
  for (; шаг < 1200; шаг++) {
    eng.timer++; eng.tick();
    if (кадрыПрефикс && КАДРЫ && (шаг === 1 || шаг === 150)) кадр(eng, `${кадрыПрефикс}-${String(шаг).padStart(4, '0')}.png`, ПОЛЕ.x + 16, ПОЛЕ.y);
    if (!статы(m, A.i).жив || !статы(m, B.i).жив) break;
  }
  if (кадрыПрефикс && КАДРЫ) кадр(eng, `${кадрыПрефикс}-итог.png`, ПОЛЕ.x + 16, ПОЛЕ.y);
  const a = статы(m, A.i), b = статы(m, B.i);
  return запиши({ опыт: имя, предмет: предмет ? имяПредмета(предмет) : 'нет', правило: вкл ? 'вкл' : 'выкл',
    статыA: `${доA.atk}/${доA.def}/${доA.spd}`, шагов: шаг, hpA: a.hp, hpB: b.hp,
    исход: a.жив && !b.жив ? 'победил носитель' : b.жив && !a.жив ? 'победил соперник' : 'оба живы' });
}

/** Обзор: туман закрыт целиком, просим движок открыть вокруг бойца и считаем клетки. */
function обзор(имя, предмет, вкл, кадрыПрефикс) {
  const eng = стенд(); const m = eng.m;
  Артефакты.задать(eng, вкл);
  const A = боец(eng, 1, 0, ПОЛЕ.x, ПОЛЕ.y, { hp: 55, atk: 45, def: 40, spd: 45 });
  if (предмет) надеть(eng, A.i, предмет);
  крутить(eng, 8);
  for (let k = 0; k < 0xb000; k++) m.b[BI + k] &= 0xfe;
  call(eng, 0x1a4cc, { esi: A.i });
  let открыто = 0; for (let k = 0; k < 0xb000; k++) if (m.b[BI + k] & 1) открыто++;
  if (кадрыПрефикс && КАДРЫ) кадр(eng, `${кадрыПрефикс}.png`, ПОЛЕ.x, ПОЛЕ.y, true);
  return запиши({ опыт: имя, предмет: предмет ? имяПредмета(предмет) : 'нет', правило: вкл ? 'вкл' : 'выкл',
    скорость: m.u8(UNITS + A.i + U.SPD), открытоКлеток: открыто });
}

/** Маг: предел магии, мана и сколько заклинаний открылось по порогу. */
const ЗАКЛЯТЬЯ = JSON.parse(fs.readFileSync(R('reimpl/data/magic_spells.json'), 'utf8')).spells.filter(s => s.exists);
function маг(имя, предмет, вкл, тип, кадрыПрефикс) {
  const eng = стенд(); const m = eng.m;
  Артефакты.задать(eng, вкл);
  const A = боец(eng, тип, 0, ПОЛЕ.x, ПОЛЕ.y, { hp: 50, atk: 30, def: 30, spd: 35, mag: 35 });
  if (предмет) надеть(eng, A.i, предмет);
  крутить(eng, 12);
  const mag = m.u8(UNITS + A.i + U.MAG);
  const свои = ЗАКЛЯТЬЯ.filter(s => s.caster_type === тип);
  const доступно = свои.filter(s => s.mag_threshold <= mag).map(s => s.cursor_prompt || s.name);
  if (кадрыПрефикс && КАДРЫ) кадр(eng, `${кадрыПрефикс}.png`, ПОЛЕ.x, ПОЛЕ.y);
  return запиши({ опыт: имя, предмет: предмет ? имяПредмета(предмет) : 'нет', правило: вкл ? 'вкл' : 'выкл',
    магия: mag, мана: m.u8(UNITS + A.i + U.MANA), заклинаний: `${доступно.length} из ${свои.length}`, открылись: доступно.join(', ') });
}

// ---------------------------------------------------------------- прогон
const РОВНЫЙ = { hp: 60, atk: 51, def: 35, spd: 45 };        // бьёт на 3: (51−35)>>4=1, 51>>5=1, +1
const СЛАБЫЙ = { hp: 60, atk: 41, def: 30, spd: 45 };        // бьёт на 2: (41−30)>>4=0, 41>>5=1, +1

console.log('== 1. Глаз дракона: обзор (скорость +30 → шире круг видимости)');
обзор('обзор', 0, false, 'обзор-нет');
обзор('обзор', 20, false, 'обзор-выкл');
обзор('обзор', 20, true, 'обзор-вкл');

console.log('== 2. Костяное ожерелье (+15 к защите): держит удар');
поединок('ожерелье', 0, false, { ...СЛАБЫЙ, def: 35 }, РОВНЫЙ, 'ожерелье-нет');
поединок('ожерелье', 26, false, { ...СЛАБЫЙ, def: 35 }, РОВНЫЙ, 'ожерелье-выкл');
поединок('ожерелье', 26, true, { ...СЛАБЫЙ, def: 35 }, РОВНЫЙ, 'ожерелье-вкл');

console.log('== 3. Перчатки (+5 к атаке, +10 к защите): бьёт больнее');
поединок('перчатки', 0, false, СЛАБЫЙ, { ...СЛАБЫЙ, def: 30 }, 'перчатки-нет');
поединок('перчатки', 28, false, СЛАБЫЙ, { ...СЛАБЫЙ, def: 30 }, 'перчатки-выкл');
поединок('перчатки', 28, true, СЛАБЫЙ, { ...СЛАБЫЙ, def: 30 }, 'перчатки-вкл');

console.log('== 4. Каменный кристалл (+20 к магии) волшебнику');
маг('кристалл', 0, false, 6, 'кристалл-нет');
маг('кристалл', 19, false, 6, 'кристалл-выкл');
маг('кристалл', 19, true, 6, 'кристалл-вкл');

console.log('== 5. Мистический напиток (+10 к магии): носится, не пьётся');
маг('напиток', 17, false, 5);
маг('напиток', 17, true, 5);

console.log('== 6. Бесполезный случай: Каменный кристалл простолюдину в бою');
поединок('кристалл простолюдину', 19, false, РОВНЫЙ, РОВНЫЙ);
поединок('кристалл простолюдину', 19, true, РОВНЫЙ, РОВНЫЙ);

fs.writeFileSync(R('out/img/украшения/итоги.json'), JSON.stringify(итоги, null, 1));
console.log('\nвсего опытов:', итоги.length);
