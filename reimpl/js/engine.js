// Ядро симуляции Jurassic War — построчный порт pwar.exe. Адреса функций оригинала — в именах (f_XXXXX).
import { Mem, G, U, UNITS, UNIT_SZ, NUNITS } from './mem.js';
import { F, call } from './fn.js';
export class Engine {
  constructor(mem) { this.m = mem; this.todo = new Set(); this.files = null; }
  get timer() { return this.m.u32(0x46c); }
  set timer(v) { this.m.w32(0x46c, v); }
  // ---- ГСЧ: FUN_00020469 (сырой) и FUN_000204a6 (rand(n) через [393a8])
  rand_raw() { // 0x20469
    const m = this.m; const range = m.u32(G.rngRange); if (range === 0) return 0;
    const eax = (m.u32(G.rngState) + m.u32(G.step)) >>> 0;   // add eax,[31ab4] (dword)
    const q = Math.floor(eax / range) >>> 0, r = eax % range;
    m.w32(G.rngState, (m.u32(G.rngState) + q) >>> 0);
    const t = m.u32(G.rngTab + (q >>> 28));
    m.w32(G.rngState, (m.u32(G.rngState) ^ t) >>> 0);
    m.w32(G.rngCount, m.u32(G.rngCount) + 1);
    return r;
  }
  // ---- тик: FUN_00017e1c (только симуляция, без рендера)
  tick() {
    const m = this.m;
    if (m.u32(G.lastTimer) === this.timer) return;
    m.w32(G.ticks, m.u32(G.ticks) + 1); m.w32(G.lastTimer, this.timer);
    let cd = (m.u16(G.countdown) - 1) & 0xffff; m.w16(G.countdown, cd);
    if (cd !== 0) return;
    m.w16(G.countdown, m.u16(G.speed));
    m.w32(G.step, m.u32(G.step) + 1);
    m.w16(G.stepLow, (m.u16(G.stepLow) + 1) & 0xf);   // inc word [31b66]; and word,0xf
    this.phase(0x13f4c);   // очередь приказов
    this.f_15f86();        // суммы статов по игрокам
    this.unitLoop();
    this.phase(0x200fe); this.phase(0x1ab4c); this.phase(0x1c340); this.phase(0x15634);
  }
  unitLoop() {
    const m = this.m; let i = m.u32(G.unitHead);
    // Сторож от зацикливания: слотов юнитов 600, длиннее список быть не может. Если связка
    // «следующий» когда-нибудь замкнётся в кольцо, вкладка не повиснет намертво — шаг просто
    // оборвётся, и это будет видно.
    let сторож = 0;
    while (i !== 0) {
      if (++сторож > 4096) { if (!this.кольцоСообщено) { this.кольцоСообщено = true; console.error('список юнитов замкнулся в кольцо'); } break; }
      if ((m.u8(UNITS + i + U.FLAGS5B) & 1) === 0) {
        const f43 = m.u8(UNITS + i + U.FX43);
        if (f43 === 0) { const nx = m.u32(UNITS + i + U.NEXT); this.dispatch(i); i = nx; continue; }
        if ((f43 & 3) !== 0) m.w8(UNITS + i + U.FX43, f43 - 1);
        if ((m.u8(UNITS + i + U.FX43) & 0xfc) === 0) { const nx = m.u32(UNITS + i + U.NEXT); this.dispatch(i); i = nx; continue; }
        if ((m.u32(G.step) & 3) === 0) m.w8(UNITS + i + U.FX43, m.u8(UNITS + i + U.FX43) - 4);
        if (m.u8(UNITS + i + U.STATE) === 0x6f) { m.w8(UNITS + i + U.FX43, 0); const nx = m.u32(UNITS + i + U.NEXT); this.dispatch(i); i = nx; continue; }
        i = m.u32(UNITS + i + U.NEXT);
      } else { const nx = m.u32(UNITS + i + U.NEXT); this.phase(0x18058, { esi: i }); i = nx; }
    }
  }
  dispatch(i) { // таблица 0x17fb8: люди 0x18154, звери 0x184c8, растения 0x18568, здания 0x186b3
    const t = this.m.u8(UNITS + i + U.TYPE);
    const h = t === 0 ? 0x17fb4 : t < 14 ? 0x18154 : t < 24 ? 0x184c8 : t < 26 ? 0x18568 : 0x186b3;
    return this.phase(h, { esi: i });
  }
  nyi(name, i) { this.todo.add(name); }
  phase(addr, regs = {}) { const f = F[addr]; if (!f) { this.todo.add('0x' + addr.toString(16)); return {}; } return f(this, regs) || {}; }
  f_15f86() { // суммы статов по слотам игроков (FUN_00015f86)
    const m = this.m; const A = [0x32b8c, 0x32b9c, 0x32bac, 0x32b3c, 0x32b4c, 0x32b5c];
    for (const a of A) for (let s = 0; s < 8; s++) m.w16(a + s * 2, 0);
    for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(UNITS + i + U.NEXT)) {
      if (m.u8(UNITS + i + U.F08) === 0) continue;
      if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
      const slot = m.u8(UNITS + i + U.SLOT); if (slot >= 8) continue;
      const t = m.u8(UNITS + i + U.TYPE); if (t >= 0x1a) continue;
      const bx = slot * 2; const grp = m.u8(UNITS + i + U.F08) === 1 ? 3 : 0;
      const add = (a, v) => m.w16(a, m.u16(a) + v);
      add(A[grp] + bx, m.u8(UNITS + i + U.HPMAX)); add(A[grp] + bx, m.u8(UNITS + i + U.MAG));
      add(A[grp + 1] + bx, m.u8(UNITS + i + U.ATK)); add(A[grp + 1] + bx, m.u8(UNITS + i + U.DEF));
      const edi = m.u32(0x30dd8 + bx * 2) + m.u32(0x30dfc + t * 4);
      add(A[grp + 2] + bx, m.u8(edi)); add(A[grp + 2] + bx, m.u8(edi + 2)); add(A[grp + 2] + bx, m.u8(edi + 4)); add(A[grp + 2] + bx, m.u8(edi + 6));
    }
  }
}
