// Сохранения в браузере. Формат слота оригинала (30-байтовый дескриптор в SI сейва) разобран
// не до конца, поэтому храним своё: сжатый снимок всей памяти движка 0x30000..0x6483c0 плюс
// мета (стадия, племя, дата). Этого хватает, чтобы восстановить партию до байта — в снимке лежат
// и юниты, и сетки, и загруженный тайлсет со спрайтами, так что архивы карт для загрузки не нужны.
const DB = 'jw', STORE = 'saves', SLOTS = 7;
export const SLOT_COUNT = SLOTS;

// Версия 2 добавила хранилища реплеев (js/ui/replay.js): мета отдельно от снимка и приказов,
// чтобы список открывался, не читая по 300 КБ на запись.
const STORES = [[STORE, 'slot'], ['replays', 'id'], ['replay_blobs', 'id']];
let dbp = null;
/** Открыть (и при надобности создать) хранилище сохранений. */
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => { for (const [name, key] of STORES) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name, { keyPath: key }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const open = openDB;
/** Одна транзакция IndexedDB как промис. */
function tx(db, mode, fn) {
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const rq = fn(t.objectStore(STORE));
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
}
/** Сжать снимок памяти перед укладкой в базу. */
export async function deflate(u8) { const cs = new CompressionStream('deflate'); const w = cs.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
/** Разжать снимок из базы. */
export async function inflate(u8) { const ds = new DecompressionStream('deflate'); const w = ds.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }

/** Список слотов: массив длиной SLOTS, пустой слот — null. */
export async function list() {
  const out = new Array(SLOTS).fill(null);
  try {
    const db = await open(); const all = await tx(db, 'readonly', (s) => s.getAll());
    for (const r of all) if (r.slot >= 0 && r.slot < SLOTS) out[r.slot] = { slot: r.slot, name: r.name, date: r.date, mission: r.mission, tribe: r.tribe, bytes: r.data.length };
  } catch { /* приватный режим или запрет хранилища — просто нет сохранений */ }
  return out;
}
/** Записать слот: снимок сжимается, поэтому функция асинхронная целиком. */
export async function save(slot, meta, snapshot) {
  const data = await deflate(snapshot);
  const db = await open();
  await tx(db, 'readwrite', (s) => s.put({ slot, ...meta, date: Date.now(), data }));
  return data.length;
}
/** Прочитать сохранение из слота. */
export async function load(slot) {
  const db = await open(); const r = await tx(db, 'readonly', (s) => s.get(slot));
  if (!r) return null;
  // patrols — маршруты патрулей обвязки (js/port/patrol.js): в снимке памяти их нет.
  return { meta: { name: r.name, mission: r.mission, tribe: r.tribe, date: r.date, patrols: r.patrols || [] },
           snapshot: await inflate(r.data) };
}
/** Стереть сохранение из слота. */
export async function remove(slot) { const db = await open(); await tx(db, 'readwrite', (s) => s.delete(slot)); }
