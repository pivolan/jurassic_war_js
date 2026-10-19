// Реплеи: запись партии и её воспроизведение.
//
// Почему это вообще работает: симуляция полностью детерминирована. Бой без случайностей,
// ГСЧ (0x20469) считается от номера шага, второй генератор (0x204a6) — от таймера 0x46c,
// который в порту стартует с фиксированного значения. Два прогона одного и того же
// начального состояния дают побайтово одинаковый результат (проверено на 5000 шагов
// миссии 10: тот же seed, то же число вызовов ГСЧ, тот же хеш памяти).
//
// Поэтому реплей — это НЕ видео, а «начальное состояние + поток приказов игрока»:
//
//   • Приказы. Все приказы игрока, из любого места интерфейса, сходятся в одну функцию
//     0x14895 — она кладёт 10-байтовую запись в очередь 0x33c88 (это же делал сетевой код
//     оригинала, там записи уходили в COM-порт). ИИ очередью не пользуется вообще — он
//     пишет поля юнитов напрямую; замерено: за 3000 шагов симуляции ноль вызовов 0x14895.
//     Значит перехват этой одной функции даёт ровно ввод человека и ничего лишнего.
//
//   • Начальное состояние — снимок области симуляции на момент старта миссии. Казалось бы,
//     хватило бы номера миссии: loadMission детерминирован. Но повторный loadMission поверх
//     уже игранной памяти даёт не то же самое, что загрузка на чистом движке — остаются
//     хвосты в служебных ячейках (счётчики поиска пути 0x3796e, таймеры сообщений 0x41910,
//     состояние ГСЧ 0x393a0/0x393a4 и другие; замерено — 25 байт в 7 диапазонах), а от
//     0x393a4 зависит выбор врагов для ИИ в 0x15da1. Поэтому кладём снимок целиком:
//     ~300 КБ в deflate, зато воспроизведение точное и не зависит от истории сеанса.
//
//   • Контрольные хеши раз в SYNC_EVERY шагов — ровно то, что делал сетевой пакет 0xf8:
//     сверял seed и ловил расхождение. Если при просмотре хеш разошёлся, мы знаем точный шаг.
//
// Формат файла (.jwr) и записи в IndexedDB одинаковые по смыслу, см. encode()/decode().

// Область состояния симуляции: глобалы движка (0x30000) и дальше до конца последней сетки
// карты — MO 0x117e74 + 45056 = 0x122e74. Выше лежат таблица строк и буфер кадра: к симуляции
// отношения не имеют, в снимок не идут.
export const SIM_LO = 0x30000, SIM_HI = 0x123000;
export const SYNC_EVERY = 512;
export const REC_SIZE = 16;
export const KIND_ORDER = 0, KIND_DINO = 1, KIND_BRACHIO = 2;

// Что попадает в контрольный хеш — только состояние симуляции. Интерфейс в него не берём:
//   • камера, форма курсора, выделенный юнит (0x31ae8/0x31aca/0x31adc) — зритель водит мышью сам;
//   • признак выделения в байте +7 записи юнита — он тоже интерфейсный;
//   • пул эффектов 0xf2504..0xf4f34 — его трогает отрисовка, то есть частота кадров.
// Иначе хеш ловил бы не расхождение симуляции, а разницу в том, куда смотрел зритель.
// Записи юнитов идут с 0xe4400 шагом 96 (сама секция OB карты грузится с 0xe4404 — это её
// внутреннее смещение, база записи всё равно 0xe4400 + 96*k).
//   • байт +0x42 записи юнита, бит 0 — «нарисован в этом кадре»: его ставит ОТРИСОВКА
//     (render/scene.js, afterBlit), а читают только звуки (0x1ff88, 0x1fd8b) и второй ГСЧ. В
//     партии он зависит от того, куда смотрел игрок, при просмотре — от того, куда смотрит
//     зритель, и именно он расходился первым: свежая запись кампании не сходилась со своей же
//     сверкой на шаге 102. Сетевой хеш (net/lockstep.js) его маскирует с самого начала — здесь
//     этого не сделали, и сверка ловила не расхождение симуляции, а разницу в кадре.
const UNITS_LO = 0xe4400, UNITS_HI = 0xf2500, UNIT_SZ = 96, SEL_BYTE = 7, DRAWN_BYTE = 0x42;
// Версия сверки. Хеш считается иначе, чем в записях версии 1, поэтому их контрольные суммы с
// нынешними несравнимы: у старых записей сверку просто не делаем (сами они играются как прежде).
export const ВЕРСИЯ = 2;
const WORLD = [[0xf4f34, 0xf6e74], [0x10ce74, 0x122e74]];   // предметы на земле, сетки BI и MO
//   • состояние второго ГСЧ 0x393a4 — его двигают голоса юнитов («есть!», отклик на выделение),
//     то есть зависит от того, включён ли звук и куда щёлкал зритель. На симуляцию он не влияет:
//     единственный живой потребитель — расстановка врагов ИИ при загрузке миссии. А вот счётчик
//     вызовов основного ГСЧ 0x393a0 в сверке оставляем — это самый чувствительный признак того,
//     что симуляция пошла тем же путём.
const GLOB = [[0x31b58, 0x31b70], [0x31c28, 0x31c68], [0x32aec, 0x32d00], [0x33358, 0x333c8], [0x393a0, 0x393a4]];

/** Хеш состояния симуляции — то же, чем сетевой код оригинала ловил рассинхрон (пакет 0xf8). */
export function stateHash(m) {
  let h = 0x811c9dc5;
  const mix = (v) => { h ^= v; h = Math.imul(h, 0x01000193) >>> 0; };
  for (let i = UNITS_LO; i < UNITS_HI; i += UNIT_SZ)
    for (let k = 0; k < UNIT_SZ; k++) {
      if (k === SEL_BYTE) continue;
      mix(k === DRAWN_BYTE ? m.b[i + k] & 0xfe : m.b[i + k]);
    }
  for (const [a, b] of WORLD) for (let i = a; i < b; i++) mix(m.b[i]);
  for (const [a, b] of GLOB) for (let i = a; i < b; i++) mix(m.b[i]);
  return h >>> 0;
}

// ---------------------------------------------------------------- запись
export class Recorder {
  constructor() { this.reset(); }
  reset() { this.on = false; this.head = null; this.snap = null; this.recs = []; this.sync = []; this.lastSync = -1; }

  /** Начать запись. snapshot — копия области симуляции сразу после загрузки миссии. */
  begin(head, snapshot) {
    this.head = { ...head, started: Date.now() };
    this.snap = snapshot; this.recs = []; this.sync = []; this.lastSync = -1; this.on = true;
  }
  /** Приказ игрока (обёртка 0x14895). Шаг — номер на момент отдачи: очередь опустошается
   *  в начале следующего шага, поэтому при воспроизведении запись вносится перед ним же. */
  order(step, code, unit, target, x, y) {
    if (this.on) this.recs.push(step >>> 0, KIND_ORDER, code & 0xff, unit & 0xffff, target & 0xffff, x & 0xffff, y & 0xffff);
  }
  /** Событие мимо очереди приказов (кнопка «тираннозавр» — создание юнита через 0x1caf0). */
  event(step, kind, x, y) {
    if (this.on) this.recs.push(step >>> 0, kind & 0xff, 0, 0, 0, x & 0xffff, y & 0xffff);
  }
  /** Контрольная точка; зовётся после каждого шага. */
  mark(step, m) {
    if (!this.on || step === this.lastSync || step % SYNC_EVERY !== 0) return;
    this.lastSync = step; this.sync.push(step >>> 0, stateHash(m));
  }
  get orderCount() { return this.recs.length / 7 | 0; }

  /** Собрать запись для хранилища. outcome: victory | defeat | restart | exit | load. */
  build(outcome, steps) {
    if (!this.on) return null;
    const n = this.orderCount, recs = new Uint8Array(n * REC_SIZE), dv = new DataView(recs.buffer);
    for (let i = 0; i < n; i++) {
      const o = i * 7, p = i * REC_SIZE;
      dv.setUint32(p, this.recs[o], true); dv.setUint8(p + 4, this.recs[o + 1]); dv.setUint8(p + 5, this.recs[o + 2]);
      dv.setUint16(p + 8, this.recs[o + 3], true); dv.setUint16(p + 10, this.recs[o + 4], true);
      dv.setUint16(p + 12, this.recs[o + 5], true); dv.setUint16(p + 14, this.recs[o + 6], true);
    }
    const sn = this.sync.length / 2 | 0, sync = new Uint8Array(sn * 8), sv = new DataView(sync.buffer);
    for (let i = 0; i < sn; i++) { sv.setUint32(i * 8, this.sync[i * 2], true); sv.setUint32(i * 8 + 4, this.sync[i * 2 + 1], true); }
    return { ...this.head, outcome, steps, orders: n, date: Date.now(), snapRaw: this.snap, recs, sync };
  }
}

// ---------------------------------------------------------------- файл .jwr
const MAGIC = 'JWR1';
const enc = new TextEncoder(), dec = new TextDecoder();

/** Реплей → один Uint8Array (для скачивания). snap уже сжат. */
export function encode(r) {
  const head = enc.encode(JSON.stringify({
    ver: r.ver || ВЕРСИЯ, mission: r.mission, tribe: r.tribe, difficulty: r.difficulty, path: r.path,
    outcome: r.outcome, steps: r.steps, orders: r.orders, date: r.date, name: r.name, build: r.build,
    // Полное состояние JS-мира на момент снимка: маршруты, очереди, планы строек, украшения,
    // камикадзе, цели магов, очередь приказов и штабы компьютера (js/net/lockstep.состояниеJS).
    // Без него запись воспроизводилась «почти»: половина состояния поднималась умолчаниями.
    состояние: r.состояние || null,
    patrols: r.patrols || [],          // маршруты патрулей на момент снимка (js/port/patrol.js)
    queues: r.queues || [],            // очереди производства в зданиях (js/port/prodqueue.js)
    следом: r.следом || [],            // кто за кем идёт (js/port/follow.js)
    шаги: r.шаги || [],                // очередь приказов игрока (js/port/orderqueue.js)
    // Правила партии: включённые механики и компьютерные противники (вид, уровень, характер).
    // Свой номер версии внутри: набор полей будет расти, а старые записи должны читаться.
    правила: r.правила || null,
  }));
  const total = 4 + 4 + head.length + 4 + r.snap.length + 4 + r.recs.length + 4 + r.sync.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer); let p = 0;
  for (let i = 0; i < 4; i++) out[p++] = MAGIC.charCodeAt(i);
  const put = (u8) => { dv.setUint32(p, u8.length, true); p += 4; out.set(u8, p); p += u8.length; };
  put(head); put(r.snap); put(r.recs); put(r.sync);
  return out;
}
/** Разобрать файл .jwr обратно в запись партии (или сказать, что это не он). */
export function decode(u8) {
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== MAGIC) throw new Error('это не файл реплея');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = 4;
  const take = () => { const n = dv.getUint32(p, true); p += 4; const s = u8.subarray(p, p + n); p += n; return s; };
  const head = JSON.parse(dec.decode(take()));
  return { ...head, snap: take().slice(), recs: take().slice(), sync: take().slice() };
}

// ---------------------------------------------------------------- хранилище
import { openDB, deflate, inflate } from './saves.js';
const META = 'replays', BLOB = 'replay_blobs';

/** Одна транзакция IndexedDB как промис. */
function tx(db, store, mode, fn) {
  return new Promise((res, rej) => { const t = db.transaction(store, mode); const rq = fn(t.objectStore(store));
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
}

/** Список без тяжёлых данных: снимок и приказы лежат в отдельном хранилище. */
export async function list() {
  try { const db = await openDB(); const all = await tx(db, META, 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.date - a.date);
  } catch { return []; }
}
/** Взять запись партии из браузерного хранилища. */
export async function load(id) {
  const db = await openDB();
  const meta = await tx(db, META, 'readonly', (s) => s.get(id)); if (!meta) return null;
  const blob = await tx(db, BLOB, 'readonly', (s) => s.get(id)); if (!blob) return null;
  return { ...meta, snapshot: await inflate(blob.snap), recs: blob.recs, sync: blob.sync, snap: blob.snap };
}
/** Сохранить собранную запись (build()). Снимок сжимается здесь. */
export async function save(r) {
  const snap = r.snap || await deflate(r.snapRaw);
  const db = await openDB();
  const id = r.id || (Date.now() * 1000 + (Math.random() * 1000 | 0));
  const meta = { id, ver: r.ver || ВЕРСИЯ, date: r.date || Date.now(), name: r.name || autoName(r), mission: r.mission, tribe: r.tribe,
    difficulty: r.difficulty, path: r.path, outcome: r.outcome, steps: r.steps, orders: r.orders,
    build: r.build, состояние: r.состояние || null, patrols: r.patrols || [], queues: r.queues || [],
    следом: r.следом || [], шаги: r.шаги || [], правила: r.правила || null,
    bytes: snap.length + r.recs.length + r.sync.length };
  await tx(db, META, 'readwrite', (s) => s.put(meta));
  await tx(db, BLOB, 'readwrite', (s) => s.put({ id, snap, recs: r.recs, sync: r.sync }));
  return meta;
}
/** Распаковать снимок из файла реплея (скачанного с сервера, минуя хранилище браузера). */
export const распаковать = (snap) => inflate(snap);
/** Удалить запись. */
export async function remove(id) {
  const db = await openDB();
  await tx(db, META, 'readwrite', (s) => s.delete(id));
  await tx(db, BLOB, 'readwrite', (s) => s.delete(id));
}
/** Удалить все записи. */
export async function clear() { for (const r of await list()) await remove(r.id); }
/** Держать библиотеку в рамках: самые старые сверх бюджета удаляются. */
export async function prune(maxBytes = 80 << 20, maxCount = 60) {
  const all = await list(); let sum = 0, n = 0;
  for (const r of all) { sum += r.bytes || 0; n++; if (sum > maxBytes || n > maxCount) await remove(r.id); }
}

// Порядок племён — как в игре (тот же, что в ссылках /jw/<племя>/<уровень> в web/game.js).
export const TRIBES = ['Tyrano', 'Ka-noo-se', 'Romack', 'Masai', 'Moospell', 'Koomba', 'Radumba', 'Koaka'];
export const OUTCOME = { victory: 'победа', defeat: 'поражение', restart: 'рестарт', exit: 'выход', load: 'загрузка' };
export const СЛОЖНОСТИ = ['лёгкая', 'обычная', 'трудная'];
/**
 * Имя записи по умолчанию: стадия, племя, сложность, исход. Сложность в имени нужна затем же,
 * зачем она в списке записей: две партии на одной стадии за одно племя отличаются только ею,
 * а всплывающая строка «реплей сохранён» показывает как раз имя (просьба владельца).
 */
export function autoName(r) {
  const сл = СЛОЖНОСТИ[r.difficulty] || `сложность ${r.difficulty}`;
  return `Stage ${r.mission + 1} · ${TRIBES[r.tribe] || 'tribe ' + r.tribe} · ${сл} · ${OUTCOME[r.outcome] || r.outcome}`;
}
/** Длительность партии в игровом времени: шаг симуляции — 1/18.2 с, как тик BIOS в оригинале. */
export function duration(steps) {
  const s = Math.round(steps / 18.2), mm = String(s / 60 | 0).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
