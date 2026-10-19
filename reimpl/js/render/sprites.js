// Загрузка спрайтов в память как в оригинале (таблица слотов 0x16e5f4, пиксели по [0x48874]) — для режима без снимка эталона.
import { F, call } from '../fn.js'; import { Archive } from '../archive.js';
const SLOTS = 0x16e5f4, NSLOTS = 0x48870, HEAP = 0x48874, HEAP_END = 0x5177f0;
F[0x2bbbd] = (eng, r) => { // освободить слоты начиная с eax
  const m = eng.m; const n = r.eax >>> 0; if (m.u32(NSLOTS) === n) return { cf: 0 }; if (m.u32(NSLOTS) < n) return { cf: 1 };
  m.w32(NSLOTS, n); const p = m.u32(SLOTS + n * 16); if (m.u32(HEAP) >= p) m.w32(HEAP, p); return { cf: 0 };
};
// 0x2bcc0: загрузить запись esi из текущего TRS ([0x475a8] имя файла) в новый слот; здесь — из eng.files по имени
export function loadSpriteEntry(eng, file, entryIndex) {
  const m = eng.m; const a = eng._arch = eng._arch || {}; const arc = a[file] || (a[file] = new Archive(eng.files[file])); const e = arc.entries[entryIndex];
  const slot = m.u32(NSLOTS); if (slot >= 0xb6e) return { cf: 1 }; m.w32(NSLOTS, slot + 1);
  const size = e.w * e.h; const ptr = m.u32(HEAP); if (ptr + size > HEAP_END) return { cf: 1 }; m.w32(HEAP, ptr + size);
  const o = SLOTS + slot * 16; m.w32(o, ptr); m.w16(o + 4, e.w); m.w16(o + 6, e.h); for (let k = 0; k < 4; k++) m.w16(o + 8 + k * 2, e.x[k] & 0xffff);
  m.b.set(arc.raw(entryIndex).subarray(0, size), ptr); return { cf: 0, eax: slot };
}
F[0x2bcc0] = (eng, r) => { const name = eng._curSpriteFile || '_PWAR05.TRS'; return loadSpriteEntry(eng, name, r.esi >>> 0); };
F[0x10b29] = (eng, r) => { // спрайты тайлсета/племени: 19 записей пака 05 со слота 0xb17 (al = племя)
  const m = eng.m; const tribe = r.eax & 0xff; if (m.u8(0x33838) === tribe) return { cf: 0 }; m.w8(0x33838, tribe);
  if (call(eng, 0x2bbbd, { eax: 0xb17 }).cf) return { cf: 1 };
  eng._curSpriteFile = '_PWAR05.TRS'; for (let k = 0; k < 0x13; k++) { const res = loadSpriteEntry(eng, '_PWAR05.TRS', tribe * 0x13 + k); if (res.cf) return { cf: 1 }; }
  return { cf: 0 };
};
