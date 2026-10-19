// Локализация сюжетных текстов: русский и польский.
//
// Тексты оригинала лежат в паке 09 (96 брифингов, запись 80 + стадия*8 + племя) и в образе
// (восемь описаний племён для экрана выбора клана). Перевод хранится файлами data/story_<язык>.json
// с теми же ключами, оригинал — data/story_en.json (его собирает tools/dump_story.mjs). Текст
// перевода лежит сплошными абзацами: переносы считаются на месте по ширине рамки, потому что
// перевод длиннее английского и разбивка оригинала ему не годится.
//
// Букв, которых нет в шрифтах игры, две породы: вся кириллица и польские буквы с диакритикой.
// И те и другие дописываются в шрифт 1 (FE0816RD, клетка 8x16, 8 бит на пиксель) кодами
// 0x80..0xff — файлы data/font_ru.json и data/font_pl.json (их делает tools/mkfont_ru.py).
// Строку с такими кодами нельзя печатать через 0x29c38 — он считает байт со старшим битом
// первым из пары двухбайтового символа; поэтому screen.js печатает через 0x29c82.
//
// Патч шрифта делается по одному разу на язык и не откатывается: коды у языков не пересекаются
// по назначению, а переключение языка просто меняет таблицу «символ → код».
import { setGlyphs } from './screen.js';

const FONTS = 0x46f14, FSTRIDE = 0x1c;
/** Языки: код → имя файла перевода и файла глифов (en — оригинал из пака, ничего грузить не надо). */
export const LANGS = ['en', 'ru', 'pl'];
export const LANG_NAME = { en: 'EN', ru: 'RU', pl: 'PL' };

export class Locale {
  constructor() {
    this.lang = 'en';
    this.story = {};            // язык → тексты
    this.font = {};             // язык → глифы
    this.maps = {};             // язык → Map(символ → код)
    this.patched = new Set();
  }

  /** Загрузить переводы и глифы. Чего нет — того нет: язык просто не появится в переключателе. */
  static async load(base = '../data/') {
    const l = new Locale();
    const get = async (n) => { try { const r = await fetch(base + n); return r.ok ? await r.json() : null; } catch { return null; } };
    await Promise.all(LANGS.filter(x => x !== 'en').map(async (язык) => {
      const [story, font] = await Promise.all([get(`story_${язык}.json`), get(`font_${язык}.json`)]);
      if (story) l.story[язык] = story;
      if (font) {
        l.font[язык] = font;
        const map = new Map();
        [...font.chars].forEach((ch, i) => map.set(ch, font.first + i));
        l.maps[язык] = map;
      }
    }));
    return l;
  }
  /** Языки, для которых есть и текст, и глифы. Английский есть всегда. */
  get available() { return ['en', ...LANGS.filter(x => x !== 'en' && this.story[x] && this.font[x])]; }
  get ready() { return this.available.length > 1; }
  has(язык) { return язык === 'en' || (!!this.story[язык] && !!this.font[язык]); }

  /** Следующий язык по кругу — для кнопки в панели. */
  next() {
    const a = this.available;
    return a[(a.indexOf(this.lang) + 1) % a.length];
  }
  /** Переключить язык: подменить таблицу глифов (шрифт при первом обращении допишется). */
  use(язык, m) {
    if (!this.has(язык)) return this.lang;
    this.lang = язык;
    if (язык === 'en') { setGlyphs(new Map()); return язык; }
    if (m) this.patchFont(m);
    setGlyphs(this.maps[язык] || new Map());
    return язык;
  }

  /** Заново вписать буквы: загрузка миссии перезаписывает область шрифта, и патч пропадает.
   *  Без этого в партии кириллица превращалась в вопросительные знаки, хотя на экранах
   *  оболочки (до старта) всё было правильно. */
  перепатчить(m) { this.patched.delete(this.lang); this.patchFont(m); }

  /** Вписать буквы языка в шрифт оригинала. Делается один раз на язык, после fixFontPointers. */
  patchFont(m, язык = this.lang) {
    const font = this.font[язык];
    if (!font || this.patched.has(язык)) return;
    const e = FONTS + 1 * FSTRIDE;
    const base = m.u32(e + 0xc), gsz = m.u32(e + 0x10), rowb = m.u32(e + 0x14), doff = m.u32(e + 0x18);
    const [w, h] = font.cell;
    font.glyphs.forEach((g, i) => {
      const code = font.first + i;
      m.b[base + code] = font.widths[i];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        m.b[base + doff + code * gsz + y * rowb + x] = +g[y * w + x];
    });
    this.patched.add(язык);
  }

  /** Брифинг стадии за племя: { head: [строки шапки], body: 'сплошной абзац' } или null. */
  brief(mission, tribe) {
    if (this.lang === 'en') return null;
    return this.story[this.lang]?.briefs?.[`${mission}_${tribe}`] || null;
  }
  /** Описание племени для экрана выбора клана: { title, text } или null. */
  tribe(t) {
    if (this.lang === 'en') return null;
    return this.story[this.lang]?.tribes?.[String(t)] || null;
  }
}
