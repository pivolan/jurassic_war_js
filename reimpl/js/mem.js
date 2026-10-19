// Память игры: сегмент данных оригинала 0x30000..0x6483c0 по тем же адресам, что в заметках (база 0x10000).
// Сколько добавить за концом исходной памяти: таблица строк (1600 записей) плюс кадр до
// 2560×1600 восьмибитных пикселей, с запасом. Памяти это стоит четыре мегабайта на вкладку.
// Таблица строк + кадр до 2560×1600 + четыре массива сетки слоя юнитов на то же число клеток.
// + 512 КБ под кадры новых зверей (js/port/новые_звери.js) — последним куском хвоста.
const ХВОСТ_ПРЕЖНИЙ = 0x420000 + 0x40000;
export const ЗВЕРИ_РАЗМЕР = 0x80000;
const ХВОСТ_ЗАПАС = ХВОСТ_ПРЕЖНИЙ + ЗВЕРИ_РАЗМЕР;
export const ХВОСТ = 0x6483c0;
export const ЗВЕРИ_АДРЕС = 0x6483c0 + ХВОСТ_ПРЕЖНИЙ;

export class Mem {
  constructor(buf) { this.b = buf; this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  // Конец исходной памяти игры. Всё, что дальше, — наше: там живёт широкий игровой кадр и его
  // таблица строк (js/render/wide.js). Это вне области симуляции 0x30000..0x123000, поэтому в
  // хеш локстепа и в снимок партии оно не попадает.
  static get ХВОСТ() { return 0x6483c0; }
  static ofSize() { return new Mem(new Uint8Array(0x6483c0 + ХВОСТ_ЗАПАС)); }
  u8(a) { return this.b[a]; }            i8(a) { return (this.b[a] << 24) >> 24; }
  u16(a) { return this.dv.getUint16(a, true); } i16(a) { return this.dv.getInt16(a, true); }
  u32(a) { return this.dv.getUint32(a, true); } i32(a) { return this.dv.getInt32(a, true); }
  w8(a, v) { this.b[a] = v & 0xff; }
  w16(a, v) { this.dv.setUint16(a, v & 0xffff, true); }
  w32(a, v) { this.dv.setUint32(a, v >>> 0, true); }
  slice(a, n) { return this.b.subarray(a, a + n); }
}
// Глобалы (адреса оригинала)
export const G = {
  unitHead: 0x31b6c, mapW: 0x31af8, mapH: 0x31afc, step: 0x31ab4, stepLow: 0x31b66, ticks: 0x31ab0,
  timer: 0x46c, lastTimer: 0x36d80, countdown: 0x3033c, speed: 0x30098, norender: 0x30346,
  food: 0x31c28, endcode: 0x30349, gameover: 0x303b0, rngState: 0x31b5c, rngRange: 0x31b58, rngCount: 0x393a0, rngN: 0x393a8, rngTab: 0x393ac,
  difficulty: 0x31aba, mission: 0x31abb, humanOwner: 0x31b64, netflag: 0x333c0,
};
export const UNITS = 0xe4400, UNIT_SZ = 96, NUNITS = 600;
export const BI = 0x10ce74, MO = 0x117e74, BG = 0xf6e74, ITEMS = 0xf4f34, PROJ = 0xf2504;
// Поля записи юнита (смещения от 0xe4400 + индекс)
export const U = {
  TYPE: 0x04, SLOT: 0x05, OWNER: 0x06, F07: 0x07, F08: 0x08, F09: 0x09, F0A: 0x0a, STAT0B: 0x0b, HPMAX: 0x0c, MAG: 0x0d, HP: 0x0e,
  ATK: 0x0f, DEF: 0x10, MANA: 0x11, SPD: 0x12, FOOD: 0x13, WEAPON: 0x15, SHIELD: 0x16, SKILLS: 0x17, INV: 0x1b, XP: 0x27,
  STATE: 0x2b, ATKCTR: 0x2c, SPR: 0x2d, X: 0x2f, Y: 0x31, TARGET: 0x33, DSTX: 0x37, DSTY: 0x39, DIR: 0x3d, FX43: 0x43,
  ORDER: 0x46, ANIM: 0x4f, FLAGS50: 0x50, FLAGS5B: 0x5b, PREV: 0x5c, NEXT: 0x60,
};
