// Оболочка: логотипы → главное меню → сложность → выбор клана → сюжет и брифинг → миссия,
// плюс игровое меню, помощь и экраны итога.
//
// Геометрия и номера записей берутся из data/ui_screens.json (собран tools/ui_catalog.py,
// разбор — notes/ui-screens.md): кода меню оригинала в дизассемблере нет, но сами экраны и
// спрайты найдены в паках и размечены по пикселям. Всё остальное — настоящие подсистемы
// оригинала: тот же кадровый буфер, палитра, шрифты и программный курсор.
import { blitScreen, blitSpr, blitSprite, textFile, entryName, hasEntry, setPalFrom, text, inkIndex,
  mouse, drainMouse, setCursor, syncCursor, flip, fill, wrapText, textWidth } from './screen.js';
import { FB } from '../render/scene.js';
import { TRACK, BATTLE } from './music.js';
// Сэмпл щелчка по меню. Пак 06 даёт три «интерфейсных» звука (0, 1, 2). Второй звучит как отказ
// («так нельзя»), на это пожаловались тестеры, — берём первый, он мягкий.
const ЩЕЛЧОК = 0;
import { WINDOWS, winPos, sliderValue, barTicks } from './windows.js';
import * as Saves from './saves.js';

const P01 = '_PWAR01.TRC', P02 = '_PWAR02.TRS', P03 = '_PWAR03.TRC', P09 = '_PWAR09.TRC';
const MAIN_SCR = 5, MAIN_PAL = 4, TRIC_SCR = 10, TRIC_PAL = 9, SKC_SCR = 12, SKC_PAL = 11;
const CLAN_SCR = 163;

// Брифинг: сюжетный экран ST-xx (пак 09, 14 + стадия*2 — палитра, +1 — картинка) и текст
// (запись 80 + стадия*8 + племя). Кнопка OK нарисована в самой картинке.
//
// Разметка снята с оригинала (0x14c90 — экран, 0x14eb9 — отрисовка). В файле сначала байт
// «сколько строк в шапке», затем сами строки через CRLF, затем байт «сколько строк в тексте» и
// текст. Шапка (название стадии, племя с годом, задание) стоит неподвижно с x=20, y=40, шаг 22;
// текст ползёт снизу вверх с x=80: начинается на y=430 (нижняя граница окна, [0x35674]) и
// останавливается, когда первая строка дойдёт до низа шапки ([0x35670]). Клип по вертикали —
// от низа шапки до 430, цвет 0xf8 без тени: у шрифтов FE**** обводка уже внутри глифа.
// Скорость в оригинале — половина прироста таймера 18.2 Гц (0x21825), то есть ~9 px/с, и +8 за
// тик, пока нажата кнопка. Раньше здесь стояла своя раскладка мелким шрифтом 0 с постраничной
// прокруткой, и байты-счётчики печатались как мусорные символы в начале строк.
const BRIEF = { headX: 20, headY: 40, bodyX: 80, w: 460, lh: 22, bottom: 430, font: 1, col: 0xf8,
                speed: 9, fast: 110 };
// Сколько держать кнопку нарисованной вдавленной, прежде чем уйти на другой экран.
const ЗАДЕРЖКА_НАЖАТИЯ = 200;
const OK_BTN = { id: 'ok', x: 531, y: 431, w: 64, h: 39 };

// Итог миссии: WIN{стадия} — запись 54 + миссия*2; где вместо неё NULLDAT.DAT, в оригинале
// играет ролик из пака 11 (перекодирован в out/video). Финал — GRPEND1 по племени, DEFEAT — 78.
const WIN_PAL = (mi) => 54 + mi * 2, GRPEND_PAL = (tr) => 38 + tr * 2, DEFEAT_PAL = 78;
const LAST_MISSION = 11;
const WIN_VIDEO = new Set([1, 3, 5, 7, 8, 11, 12]);

const DIFF = { easy: 0, medium: 1, hard: 2 };

// Экран выбора клана: при выборе снизу вверх ползёт описание племени. Текст лежит в образе
// восемью блоками (см. tools и data/tribe_story.json), цвета — из MAIN.PAL.
const STORY = { lh: 20, x: 40, w: 560, speed: 26, col: 223, shadow: 87, top: 40 };   // speed — пикселей в секунду, top — где текст останавливается

// Настройки оригинала. Три верхние строки Game Option — не ползунки, а переключатели:
// оригинал (0x20c54) печатает в дорожке название значения из таблицы строк 0x398b3
// («fastest/fast/normal/slow/very slow/off») цветом 0xf8 на 2 px выше дорожки, движок при
// этом не рисуется. Значение = задержка: 1 — каждый тик (быстрее всего), больше — реже;
// у автопрокрутки 6 означает «выключено» (0x12acd). Нижняя строка, Mouse Sensitive, —
// заполнение: палочка 1x10 через каждые 2 px, счёт = [0x3009e] − 0x12.
const OPT = { gameSpeed: 0x30098, scrollSpeed: 0x3009a, scrollAuto: 0x3009c, mouse: 0x3009e };
const MOUSE_MIN = 0x12, MOUSE_MAX = 0x12 + 64;
/** Строка значения из таблицы оригинала (указатели лежат со сдвигом +0x100000, как у спрайтов). */
function optLabel(m, v) {
  let p = m.u32(0x398b3 + v * 4); if (p >= 0x110000 && p < 0x7483c0) p -= 0x100000;
  let s = ''; for (let c; (c = m.u8(p)); p++) s += String.fromCharCode(c);
  return s;
}
const SLIDERS = {
  game_speed:        { kind: 'label', min: 1, max: 5, get: (m) => clamp(m.u16(OPT.gameSpeed), 1, 5),
    set: (m, v) => m.w16(OPT.gameSpeed, v) },
  scroll_speed:      { kind: 'label', min: 1, max: 5, get: (m) => clamp(m.u16(OPT.scrollSpeed), 1, 5),
    set: (m, v) => { m.w16(OPT.scrollSpeed, v); localStorage.setItem('jw.scroll', v); } },
  scroll_auto_speed: { kind: 'label', min: 1, max: 6, get: (m) => clamp(m.u16(OPT.scrollAuto), 1, 6),
    set: (m, v) => m.w16(OPT.scrollAuto, v) },
  mouse_sensitive:   { kind: 'bar', min: MOUSE_MIN, max: MOUSE_MAX,
    get: (m) => clamp(m.u16(OPT.mouse), MOUSE_MIN, MOUSE_MAX),
    set: (m, v, sh) => { m.w16(OPT.mouse, v); localStorage.setItem('jw.mouse', v); sh.onMouseSensitivity?.(v); } },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v || a));

// ---- попадание в зону каталога: эллипс, сектор колеса или прямоугольник
function inZone(z, x, y, wheel) {
  if (z.kind === 'ellipse') { const dx = (x - z.cx) / z.rx, dy = (y - z.cy) / z.ry; return dx * dx + dy * dy <= 1; }
  if (z.kind === 'sector' && wheel) {
    const dx = x - wheel.cx, dy = y - wheel.cy; const d = Math.hypot(dx, dy);
    // r0 у втулки — 2.8 px (замер по краю спрайта), из-за чего нажатие ровно в центр не
    // засчитывалось: такой зазор считаем нулевым.
    if (d > z.r1 || (z.r0 > 5 && d < z.r0)) return false;
    const a = Math.atan2(-dy, dx) * 180 / Math.PI;              // 0 — вправо, против часовой
    return z.a0 <= z.a1 ? (a >= z.a0 && a <= z.a1) : (a >= z.a0 || a <= z.a1);
  }
  return x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h;
}

export class Shell {
  /** @param opts.need(имя, прогресс) — догрузить архив; opts.catalog — data/ui_screens.json */
  constructor(eng, files, opts = {}) {
    this.eng = eng; this.files = files; this.need = opts.need || (async () => {});
    this.onStartMission = opts.onStartMission || (() => {});
    this.onMultiplayer = opts.onMultiplayer || null;           // пункт меню Multiplayer → экран сетевой игры
    this.onQuit = opts.onQuit || null;                         // пункт Quit: выйти из игры (в браузере — на сайт)
    this.onSkirmish = opts.onSkirmish || null;                 // Null Modem: партия против компьютера без сети
    this.onScreenHint = opts.onScreenHint || null;             // короткая подсказка при входе на экран
    this.onOptions = opts.onOptions || null;                   // закрыли окно опций — сохранить настройки
    this.onLeaveGame = opts.onLeaveGame;                                 // ушли из партии живой: 'restart' | 'exit' | 'load'
    this.cat = opts.catalog || null;
    this.uiBoot = opts.uiBoot || null;                                  // вырезки медальонов облегчённого набора
    this.ensureFull02 = opts.ensureFull02 || (async () => {});          // догрузка полного пака 02
    this.наОшибку = opts.наОшибку || null;                              // сказать игроку, что пак не доехал
    this.music = opts.music || null;
    this.sfx = opts.sfx || null;
    this.onSoundReady = opts.onSoundReady || (() => {});
    this.onMouseSensitivity = opts.onMouseSensitivity || null;
    this.onSnapshot = opts.onSnapshot || (() => new Uint8Array(0));      // снимок памяти движка
    this.onSaveMeta = opts.onSaveMeta || null;                           // что дописать в сейв помимо снимка
    this.onRestore = opts.onRestore || (() => {});                       // восстановить снимок и продолжить партию
    this.slots = null; this.slot = 0;
    this.screen = null; this.dirty = true; this.hover = null; this.status = '';
    this.tribe = 0; this.mission = 0; this.difficulty = 1; this.paused = false;
    this.brief = []; this.scroll = 0; this.helpPage = 0; this.animFrame = 0; this.animAt = 0; this.trackPage = 0;
    this.story = opts.story || null; this.storyAt = 0; this.storyTick = 0; this.storyLen = 0;
    this.locale = opts.locale || null;                                   // русские сюжетные тексты, js/ui/locale.js
  }
  // Экраны лежат в cat.screens, всплывающие окна — в cat.families; ищем в обоих.
  zones(key) { return this.cat?.screens?.[key]?.hotspots || this.cat?.families?.[key]?.hotspots || []; }
  wheel(screen) { return this.cat?.screens?.[screen]?.wheel || null; }

  goto(name, arg) {
    this.screen = name; this.arg = arg; this.enteredAt = performance.now(); this.dirty = true; this.hover = null;
    this.отложено = null; this.нажатая = null;      // ушли с экрана — забываем отложенное нажатие
    this.tune(name);
    this.onScreen?.(name);            // обвязка вешает сюда озвучку сюжета (js/ui/narration.js)
    this.onScreenHint?.(name);        // короткая подсказка внизу экрана (что делает пункт)
  }
  /** Музыка по экрану: у оригинала под каждый экран свой модуль (см. js/ui/music.js). */
  tune(name) {
    if (!this.music) return;
    const n = { menu: TRACK.title, difficulty: TRACK.title, clan: TRACK.clan, briefing: TRACK.story,
      victory: TRACK.victory, defeat: TRACK.defeat, ending: TRACK.ending,
      game: BATTLE[this.mission % BATTLE.length] }[name];
    if (!n) return;
    if (name === 'game') this.music.бойТрек(n); else this.music.экранТрек(n);
  }
  toMenu() { this.goto('menu'); }
  /** Экраны, которых нет в облегчённом наборе (игровое меню, опции, звук, сохранения). */
  async withFullPack(then) {
    if (this.fullPack) return then();
    // Если пак не доехал, надо вернуться в меню и сказать об этом. Раньше отказ никто не ловил:
    // промис отваливался молча, экран оставался на «loading screens…» навсегда, и помогала только
    // перезагрузка страницы. Теперь повторное нажатие пробует скачать заново.
    const назад = this.screen === 'loading' ? 'menu' : this.screen;
    this.goto('loading'); this.status = 'loading screens...';
    try {
      await this.ensureFull02((p) => { this.status = `loading screens... ${p}%`; this.draw(); flip(this.eng); });
    } catch (e) {
      this.status = '';
      this.goto(назад);
      this.наОшибку?.('не удалось загрузить экраны: ' + (e?.message || e));
      return;
    }
    this.fullPack = true; then();
  }
  // Переход в партию: гасим накопленные события и держим короткую паузу — отпускание пальца
  // после нажатия кнопки оболочки иначе попадает уже в игровое поле или в кнопку панели.
  toGame() { drainMouse(this.eng.m); this.screen = 'game'; this.hover = null; this.отложено = null; this.нажатая = null; this.guardUntil = performance.now() + 400; this.tune('game');
    this.onScreen?.('game'); }        // мимо goto(): отсюда выходят по OK на брифинге и из меню

  // ---- колесо: куски рисуются прозрачным блиттером, нажатый — последним, поверх соседей.
  // Вдавленным сектор рисуется только пока кнопку держат. Раньше он вдавливался от одного
  // наведения курсора, и круглое меню «нажималось само» — жалоба тестера. То же самое уже
  // исправлено в окнах настроек (drawWindow).
  drawWheel(screen, base = 0) {
    const { eng, files } = this; const m = eng.m; const zs = this.zones(screen);
    const нажат = this.нажатая;
    for (const z of zs) if (z.id !== нажат) blitSprite(m, files, P02, z.sprite_normal + base, z.sprite_xy[0], z.sprite_xy[1], true);
    const h = zs.find(z => z.id === нажат);
    if (h) blitSprite(m, files, P02, h.sprite_over + base, h.sprite_xy[0], h.sprite_xy[1], true);
  }

  // Четыре участка титульного экрана живые: морда динозавра, шея, тело с хвостом и наскальная
  // роспись слева. Кадры — записи 0..18 пака 02, координаты из каталога; кадр 0 у каждого — фон.
  drawAnims(screen) {
    const anims = this.cat?.screens?.[screen]?.animations; if (!anims) return;
    const m = this.eng.m;
    for (const a of anims) blitSprite(m, this.files, P02, a.entries[this.animFrame % a.entries.length], a.x, a.y, false);
  }

  /** Рамка окна, его кнопки (нажатая под курсором) и ползунки. */
  drawWindow(kind) {
    const { eng, files } = this; const m = eng.m; const w = WINDOWS[kind]; const p = winPos(w);
    const base = w.base + this.tribe * w.stride;
    m.b.set(this.winBg, FB);                                             // экран, поверх которого открыли
    blitSprite(m, files, P02, base, p.x, p.y, false);
    for (const [id, off] of Object.entries(w.btn)) {
      const lit = (id === 'shuffle' && this.music?.shuffle) || (id === 'repeat' && this.music?.repeat);
      // Вдавленной кнопку рисуем, только пока её держат: раньше она «нажималась» от одного
      // наведения курсора, и окно казалось живущим своей жизнью (жалоба тестера).
      const нажата = this.нажатая === id && mouse(m).btn;
      if (!нажата && !lit) continue;                                     // обычное состояние уже нарисовано в рамке
      const z = this.zone(w.key, id); if (!z) continue;
      blitSprite(m, files, P02, base + off + 1, p.x + z.x, p.y + z.y, false);
    }
    if (w.knob !== undefined) {
      for (const z of this.zones(w.key)) {
        const sl = SLIDERS[z.id] || this.soundSlider(z.id); if (!sl) continue;
        const v = sl.get(m, this);
        if (sl.kind === 'label') { text(eng, optLabel(m, v), p.x + z.x, p.y + z.y - 2, { col: 0xf8 }); continue; }
        for (let i = 0, n = barTicks(z, v, sl.min, sl.max); i < n; i++)
          blitSprite(m, files, P02, base + w.knob, p.x + z.x + i * 2, p.y + z.y, false);
      }
    }
    return p;
  }
  zone(key, id) { return this.zones(key).find(z => z.id === id); }
  /** Щелчок по элементу меню. Сэмплы 0, 1 и 2 пака 06 — единственные, что играет код меню
   *  оригинала (0x1fd1d, 0x1fd54, 0x1fd8b); который из них на что, в дизассемблере не видно,
   *  поэтому на нажатие ставим самый «весомый» — 2. */
  click() { this.sfx?.play(ЩЕЛЧОК, 15, 15); }
  /** Ползунки окна звука живут не в памяти оригинала, а в проигрывателе. */
  soundSlider(id) {
    if (id === 'music_volume') return { kind: 'bar', min: 1, max: 10,
      get: () => Math.round((this.music?.volume ?? 0.5) * 9) + 1,
      set: (_m, v) => this.music?.setVolume((v - 1) / 9) };
    // Крайнее левое положение обоих ползунков — тишина: (v−1)/9, как и у музыки.
    if (id === 'sound_volume') return { kind: 'bar', min: 1, max: 10,
      get: () => +(localStorage.getItem('jw.sfxvol') ?? 6),
      set: (_m, v) => { localStorage.setItem('jw.sfxvol', v); this.sfx?.setVolume((v - 1) / 9); } };
    return null;
  }

  /** Описание выбранного племени: строки ползут снизу вверх и уходят за верх экрана. */
  drawStory() {
    const loc = this.locale?.tribe(this.tribe);
    const t = loc ? { title: loc.title, lines: wrapText(this.eng, loc.text, STORY.w) } : this.story?.tribes?.[String(this.tribe)];
    if (!t) return;
    const lines = [t.title, ''].concat(t.lines);
    const top = 480 - this.storyAt;
    for (let i = 0; i < lines.length; i++) {
      const y = top + i * STORY.lh;
      if (y < -STORY.lh || y > 470) continue;
      text(this.eng, lines[i], STORY.x, y, { font: 1, col: STORY.col, shadow: STORY.shadow });
    }
    // Предел прокрутки: короткий текст останавливается, когда первая строка дошла до верха
    // (y = STORY.top), длинный — когда последняя строка вошла в экран.
    this.storyLen = Math.max(480 - STORY.top, lines.length * STORY.lh + 10);
  }

  draw() {
    const { eng, files } = this; const m = eng.m;
    switch (this.screen) {
      case 'logo_tric': setPalFrom(m, files, P01, TRIC_PAL); blitScreen(m, files, P01, TRIC_SCR); break;
      case 'logo_skc':  setPalFrom(m, files, P01, SKC_PAL);  blitScreen(m, files, P01, SKC_SCR);  break;

      case 'menu':                                                     // MAIN.SCR + анимации + колесо
        setPalFrom(m, files, P01, MAIN_PAL); blitScreen(m, files, P01, MAIN_SCR);
        this.drawAnims('title_menu'); this.drawWheel('title_menu');
        break;

      case 'difficulty': {                                             // то же колесо: плашка сверху + 3 сектора
        setPalFrom(m, files, P01, MAIN_PAL); blitScreen(m, files, P01, MAIN_SCR);
        const b = this.wheel('difficulty')?.static_banner;
        if (b) blitSprite(m, files, P02, b.entry, b.x, b.y, true);
        this.drawWheel('difficulty');
        break;
      }

      // Оригинальный экран «Multiplayer Game» (запись 33): четыре круглые кнопки. Null Modem у нас
      // означает локальную партию (скирмиш), Modem — игру через релей.
      case 'multiplayer': {
        setPalFrom(m, files, P01, MAIN_PAL); blitScreen(m, files, P01, MAIN_SCR);
        blitSprite(m, files, P02, this.cat?.screens?.multiplayer?.entry ?? 33, 0, 0, false);
        for (const z of this.zones('multiplayer')) {
          const спр = z.id === this.нажатая && z.sprite_over !== undefined ? z.sprite_over : z.sprite_normal;
          if (спр !== undefined) blitSprite(m, files, P02, спр, z.x, z.y, true);
        }
        break;
      }

      case 'clan': {
        // порядок: экран, подсвеченный медальон, поверх — ползущее описание
        // Экран 163 — никто не выбран. В оригинале выбранный клан — это отдельная картинка
        // 164..171 целиком (1.2 МБ по сети на восемь); вместо них кладём вырезку медальона из
        // облегчённого набора — результат тот же пиксель в пиксель.
        setPalFrom(m, files, P01, MAIN_PAL); blitScreen(m, files, P02, CLAN_SCR);
        // Вырезки медальонов есть только в облегчённом наборе. Когда вместо него уже приехал
        // полный пак 02 (после первой партии), их там нет — берём полноэкранную подсветку.
        const p = this.uiBoot?.tribe_patch?.[String(this.tribe)];
        if (p && hasEntry(files, P02, p.entry)) blitSprite(m, files, P02, p.entry, p.x, p.y, false);
        else {
          const v = this.cat?.screens?.tribe_select?.highlight_screens?.[String(this.tribe)];
          if (v && hasEntry(files, P02, v)) blitScreen(m, files, P02, v);
        }
        this.drawStory();
        break;
      }

      case 'help':
        setPalFrom(m, files, P03, this.helpPage * 2); blitScreen(m, files, P03, this.helpPage * 2 + 1);
        break;

      case 'briefing': {
        setPalFrom(m, files, P09, 14 + this.mission * 2); blitSpr(m, files, P09, 15 + this.mission * 2);
        const o = { font: BRIEF.font, col: BRIEF.col };
        // В оригинале шапка отцентрована пробелами прямо в тексте; перевод хранится без набивки,
        // поэтому название и племя центруем по рамке, а строки задач оставляем слева.
        const hx = (ln) => !this.briefCentered || ln.startsWith('—') ? BRIEF.headX
          : Math.max(BRIEF.headX, Math.round(BRIEF.headX + (BRIEF.w + 40 - textWidth(eng, ln, BRIEF.font)) / 2));
        this.briefHead.forEach((ln, i) => text(eng, ln, hx(ln), BRIEF.headY + i * BRIEF.lh,
          { ...o, clip: [0, BRIEF.headY, 639, BRIEF.bottom] }));
        const clip = [0, this.briefTop, 639, BRIEF.bottom];
        let y = Math.round(this.briefY);
        for (const ln of this.briefBody) {
          if (y + 16 > this.briefTop) text(eng, ln, BRIEF.bodyX, y, { ...o, clip });
          y += BRIEF.lh;
          if (y > BRIEF.bottom) break;
        }
        break;
      }

      case 'ingame':                                                   // колесо со скином племени поверх кадра партии
        m.b.set(this.frozen, FB);
        this.drawWheel('ingame_menu', this.tribe * (this.cat?.screens?.ingame_menu?.tribe_stride || 14));
        break;

      case 'victory': case 'defeat': case 'ending': {
        const p = this.screen === 'defeat' ? DEFEAT_PAL
          : this.screen === 'ending' ? GRPEND_PAL(this.tribe)
          : (entryName(files, P09, WIN_PAL(this.mission)) === 'NULLDAT.DAT' ? GRPEND_PAL(this.tribe) : WIN_PAL(this.mission));
        setPalFrom(m, files, P09, p); blitSpr(m, files, P09, p + 1);
        const ink = inkIndex(m), sh = inkIndex(m, { light: false });
        // Подпись можно подменить: сетевой партии и скирмишу нужна не «стадия пройдена», а
        // «победил такой-то». Экран при этом остаётся родным, из пака игры.
        const cap = this.подписьИтога || (this.screen === 'defeat' ? 'Defeat - tap to try again'
          : this.screen === 'ending' ? 'Campaign complete - tap to continue'
          : `Stage ${this.mission + 1} complete - tap to continue`);
        text(eng, cap, 20, 452, { font: 1, col: ink, shadow: sh });
        break;
      }

      case 'options': this.drawWindow('options'); break;

      case 'save': case 'load': {                                        // окна сохранения и загрузки
        const p = this.drawWindow(this.screen);
        const list = this.zone(WINDOWS[this.screen].key, 'list');
        const ink = inkIndex(m), sh = inkIndex(m, { light: false });
        for (let i = 0; i < Saves.SLOT_COUNT; i++) {
          const r = this.slots?.[i]; const cur = this.slot === i;
          const d = r && new Date(r.date);
          const line = r ? `${i + 1}. ${r.name}  ${d.toLocaleDateString()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                         : `${i + 1}. - empty -`;
          text(eng, (cur ? '>' : ' ') + line, p.x + list.x + 6, p.y + list.y + 6 + i * 21, { font: 0, col: ink, shadow: cur ? 0 : sh });
        }
        break;
      }

      case 'sound': {
        const p = this.drawWindow('sound');
        const list = this.zone('sound_controls', 'playlist');
        const ink = inkIndex(m), sh = inkIndex(m, { light: false });
        const tracks = this.music?.tracks || [];
        const per = 6, from = this.trackPage * per;
        tracks.slice(from, from + per).forEach((t, i) => {
          const cur = this.music?.n === t.n;
          text(eng, (cur ? '> ' : '  ') + t.n + '. ' + this.music.name(t.n), p.x + list.x + 8, p.y + list.y + 8 + i * 19,
            { font: 0, col: ink, shadow: cur ? 0 : sh });
        });
        break;
      }

      case 'loading':
        setPalFrom(m, files, P01, MAIN_PAL); blitScreen(m, files, P01, MAIN_SCR);   // «Loading…» запечено в картинке
        // Строку состояния пишем всегда: без неё «Loading…» — чёрный ящик, и непонятно, идёт
        // закачка, встала она или уже отвалилась. Тень тёмная, поэтому текст читается на любом фоне.
        { const ink = inkIndex(m); text(eng, this.status || 'loading...', 200, 344, { font: 1, col: ink, shadow: 1 }); }
        break;

      default: fill(m, 0);
    }
  }

  /** Кадр оболочки: события мыши, наведение, перерисовка, вывод с курсором. */
  frame() {
    const m = this.eng.m; const ev = drainMouse(m); const { x, y } = mouse(m);
    setCursor(this.eng, 0); syncCursor(m);
    const clicks = ev.filter(e => e.mask & 2);                          // 2 — ЛКМ нажата
    const s = this.screen;
    if (s === 'menu') {
      // Живой фон титульного экрана крутится от движения курсора, как в оригинале: стоит мышь —
      // стоит и картинка.
      const d = Math.abs(x - (this.lastX ?? x)) + Math.abs(y - (this.lastY ?? y));
      this.animPath = (this.animPath || 0) + d;
      if (this.animPath > 36) { this.animPath = 0; this.animFrame++; this.dirty = true; }
    }
    this.lastX = x; this.lastY = y;
    if (s === 'briefing') {                                             // текст ползёт снизу вверх
      const t = performance.now(); const dt = Math.min(200, t - (this.briefTick || t)); this.briefTick = t;
      if (this.briefY > this.briefStop) {
        const overOk = inZone(OK_BTN, x, y);
        const v = (mouse(m).btn && !overOk) ? BRIEF.fast : BRIEF.speed;   // держишь кнопку — быстрее
        this.briefY = Math.max(this.briefStop, this.briefY - v * dt / 1000);
        this.dirty = true;
      }
    }
    if (s === 'clan' && this.story) {                                   // ползущее описание племени
      const t = performance.now(); const dt = Math.min(200, t - (this.storyTick || t)); this.storyTick = t;
      this.storyAt = (this.storyAt || 0) + STORY.speed * dt / 1000;
      // Доехали до конца — стоим (раньше текст уходил за верх и шёл по кругу заново)
      if (this.storyLen && this.storyAt > this.storyLen) this.storyAt = this.storyLen;
      this.dirty = true;
    }

    if (s === 'logo_tric' || s === 'logo_skc') {
      if (clicks.length || performance.now() - this.enteredAt > 2500) return s === 'logo_tric' ? this.goto('logo_skc') : this.toMenu();
    } else if (s === 'menu' || s === 'difficulty' || s === 'ingame' || s === 'multiplayer') {
      const key = s === 'menu' ? 'title_menu' : s === 'difficulty' ? 'difficulty' : s === 'multiplayer' ? 'multiplayer' : 'ingame_menu';
      const w = this.wheel(key); const z = this.zones(key).find(z => inZone(z, x, y, w));
      const id = z ? z.id : null; if (id !== this.hover) { this.hover = id; this.dirty = true; }
      // Отложенное нажатие. Экран менялся в тот же кадр, и вдавленной кнопки никто не успевал
      // увидеть: щелчок — и уже другая страница. Теперь сектор остаётся нажатым ЗАДЕРЖКА_НАЖАТИЯ
      // миллисекунд, и только потом выполняется действие.
      if (this.отложено) {
        this.нажатая = this.отложено.id;                                // держим кнопку вдавленной
        if (performance.now() >= this.отложено.когда) {
          const { экран, id: кнопка } = this.отложено;
          this.отложено = null; this.нажатая = null; this.dirty = true;
          this.action(экран, кнопка);
        }
        return;                                                         // пока ждём — новые щелчки не берём
      }
      // Вдавленный сектор — только пока держат кнопку мыши над ним (как в окнах настроек).
      const держат = !!mouse(m).btn;
      const было = this.нажатая;
      this.нажатая = держат ? (this.нажатая ?? id) : null;
      if (было !== this.нажатая) this.dirty = true;
      if (clicks.length) {
        if (z) { this.click(); this.нажатая = z.id; this.dirty = true; this.отложено = { экран: s, id: z.id, когда: performance.now() + ЗАДЕРЖКА_НАЖАТИЯ }; }
        else if (s === 'ingame') this.closeIngame();
      }
    } else if (s === 'clan') {
      for (const c of clicks) {
        const z = this.zones('tribe_select').find(z => inZone(z, c.x, c.y));
        if (!z) continue;
        if (z.tribe !== undefined) {
          if (this.tribe === z.tribe) this.start();
          else { this.tribe = z.tribe; this.storyAt = 0; this.storyTick = 0; this.dirty = true; this.click();
                 this.onScreen?.('clan'); }                 // другое племя — другой рассказ
        }
        else if (z.id === 'select') { this.click(); this.start(); }
        else if (z.id === 'cancel') { this.click(); this.toMenu(); }
      }
    } else if (s === 'save' || s === 'load') {
      const w = WINDOWS[s]; const p = winPos(w);
      const hz = this.zones(w.key).find(z => inZone(z, x - p.x, y - p.y));
      const id = hz && w.btn[hz.id] !== undefined ? hz.id : null;
      if (id !== this.hover) { this.hover = id; this.dirty = true; }
      for (const c of clicks) {
        const q = { x: c.x - p.x, y: c.y - p.y };
        const z = this.zones(w.key).find(z => inZone(z, q.x, q.y)); if (!z) continue;
        if (z.id === 'list') { this.slot = Math.max(0, Math.min(Saves.SLOT_COUNT - 1, Math.floor((q.y - z.y - 2) / 21))); this.dirty = true; this.click(); continue; }
        this.click(); this.slotAction(s, z.id);
      }
    } else if (s === 'options' || s === 'sound') {
      const w = WINDOWS[s === 'options' ? 'options' : 'sound']; const p = winPos(w);
      const rel = (c) => ({ x: c.x - p.x, y: c.y - p.y });
      const hz = this.zones(w.key).find(z => inZone(z, x - p.x, y - p.y)) || null;
      const id = hz && w.btn[hz.id] !== undefined ? hz.id : null;
      if (id !== this.hover) { this.hover = id; this.dirty = true; }
      // Кнопку рисуем вдавленной, только пока её действительно держат.
      const держат = !!mouse(m).btn;
      const было = this.нажатая;
      this.нажатая = держат ? (this.нажатая ?? id) : null;
      if (было !== this.нажатая) this.dirty = true;
      for (const c of clicks) {
        this.нажатая = id; this.dirty = true;
        const q = rel(c); const z = this.zones(w.key).find(z => inZone(z, q.x, q.y));
        if (!z) continue;
        const sl = SLIDERS[z.id] || this.soundSlider(z.id);
        if (sl) {                                        // переключатель — по кругу, заполнение — по x
          const v = sl.kind === 'label' ? (sl.get(m, this) >= sl.max ? sl.min : sl.get(m, this) + 1)
                                        : sliderValue(z, q.x, sl.min, sl.max);
          sl.set(m, v, this); this.click(); this.dirty = true; continue;
        }
        this.click(); this.windowAction(s, z.id, q);
      }
    } else if (s === 'briefing') {
      for (const c of clicks) {
        if (inZone(OK_BTN, c.x, c.y)) { this.toGame(); return this.onStartMission({ mission: this.mission, tribe: this.tribe, difficulty: this.difficulty }); }
        this.briefY = this.briefStop; this.dirty = true;                // тап мимо OK — сразу до конца
      }
    } else if (s === 'help') {
      if (clicks.length) { this.helpPage++; if (this.helpPage > 2) return this.goto('menu'); this.dirty = true; }
    } else if (s === 'victory' || s === 'defeat' || s === 'ending') {
      if (clicks.length) this.afterMission();
    }

    if (this.dirty) { this.draw(); this.dirty = false; }
    flip(this.eng);
  }

  /** Клавиша из браузера: на экранах оболочки порт клавиатуры не работает. */
  key(code) {
    if (code !== 'Escape' && code !== 'F10') return false;
    if (this.screen === 'options' || this.screen === 'sound' || this.screen === 'save' || this.screen === 'load') { this.closeWindow(); return true; }
    if (this.screen === 'ingame') { this.closeIngame(); return true; }
    if (this.screen === 'help' || this.screen === 'difficulty' || this.screen === 'clan') { this.toMenu(); return true; }
    return false;
  }

  // ---- действия
  action(screen, id) {
    if (screen === 'menu') {
      if (id === 'new_game') return this.goto('difficulty');
      if (id === 'replay_introduction') return this.playIntro();
      if (id === 'help') return this.openHelp();
      if (id === 'option') return this.withFullPack(() => this.openWindow('options', 'menu'));
      if (id === 'load_game') return this.withFullPack(() => this.openSlots('load', 'menu'));
      // Пункт «Multiplayer Game» ведёт на оригинальный экран выбора: там Null Modem — скирмиш
      // (локально, без сети), Modem — игра через релей.
      if (id === 'multiplayer_game' || id === 'multiplayer') return this.withFullPack(() => this.goto('multiplayer'));
      if (id === 'quit' && this.onQuit) return this.onQuit();          // выход: в браузере уводим на сайт
      return this.notReady(id);
    }
    if (screen === 'multiplayer') {
      if (id === 'previous') return this.toMenu();
      if (id === 'null_modem' && this.onSkirmish) return this.onSkirmish();
      if (id === 'modem' && this.onMultiplayer) return this.onMultiplayer();
      return this.notReady(id);                                        // com setting — настройка порта, нам не нужна
    }
    if (screen === 'difficulty') {
      if (id === 'cancel') return this.toMenu();
      if (id in DIFF) { this.difficulty = DIFF[id]; return this.goto('clan'); }
    }
    if (screen === 'ingame') {
      if (id === 'center') return this.closeIngame();
      if (id === 'pause') { this.paused = !this.paused; return this.closeIngame(); }
      // Реплей текущей партии сохраняется и при рестарте, и при выходе — не только по её исходу.
      if (id === 'restart_scenario') { this.onLeaveGame?.('restart'); this.toGame(); return this.onStartMission({ mission: this.mission, tribe: this.tribe, difficulty: this.difficulty }); }
      if (id === 'exit') { this.onLeaveGame?.('exit'); return this.toMenu(); }
      if (id === 'option') return this.openWindow('options', 'ingame');
      if (id === 'save_game') return this.openSlots('save', 'ingame');
      if (id === 'load_game') return this.openSlots('load', 'ingame');
      return;
    }
  }
  /** Окна сохранения и загрузки. */
  async openSlots(kind, from) {
    this.slots = await Saves.list(); this.slot = 0;
    this.openWindow(kind, from);
  }
  async slotAction(kind, id) {
    if (id === 'cancel') return this.closeWindow();
    if (id === 'page_up') { this.slot = Math.max(0, this.slot - 1); this.dirty = true; return; }
    if (id === 'page_down') { this.slot = Math.min(Saves.SLOT_COUNT - 1, this.slot + 1); this.dirty = true; return; }
    if (id === 'delete') { await Saves.remove(this.slot); this.slots = await Saves.list(); this.dirty = true; return; }
    if (id === 'save') {
      const name = `Stage ${this.mission + 1}  ${this.tribeName()}`;
      await Saves.save(this.slot, { name, mission: this.mission, tribe: this.tribe, ...(this.onSaveMeta?.() || {}) }, this.onSnapshot());
      this.slots = await Saves.list(); this.dirty = true;
      // Сохранил — и сразу назад в игру, как в оригинале: закрывать окно (и меню под ним) руками
      // не надо. Если сохранялись не из партии, просто закрываем окно.
      if (this.returnTo === 'ingame' || this.returnTo === 'game') return this.closeIngame();
      return this.closeWindow();
    }
    if (id === 'load') {
      const r = await Saves.load(this.slot); if (!r) return;
      this.onLeaveGame?.('load');
      this.mission = r.meta.mission; this.tribe = r.meta.tribe;
      this.toGame(); this.onRestore(r.snapshot, r.meta);
    }
  }
  tribeName() { const z = this.zones('tribe_select').find(z => z.tribe === this.tribe); return z ? z.label : 'tribe ' + this.tribe; }

  /** Кнопки окон опций и звука. */
  windowAction(screen, id, q) {
    if (screen === 'options') {
      if (id === 'ok') return this.closeWindow();
      if (id === 'sound_controls') { this.trackPage = 0; return this.goto('sound'); }
      return;
    }
    if (id === 'ok') return this.goto('options');
    if (id === 'play') return this.music?.play(this.music.n || TRACK.title, { force: true });
    if (id === 'stop') return this.music?.stop();
    if (id === 'shuffle') { if (this.music) this.music.shuffle = !this.music.shuffle; this.dirty = true; return; }
    if (id === 'repeat') { if (this.music) this.music.repeat = !this.music.repeat; this.dirty = true; return; }
    if (id === 'page_up') { this.trackPage = Math.max(0, this.trackPage - 1); this.dirty = true; return; }
    if (id === 'page_down') { const n = this.music?.tracks.length || 0; if ((this.trackPage + 1) * 6 < n) this.trackPage++; this.dirty = true; return; }
    if (id === 'playlist') {                                             // выбрать трек из списка
      const row = Math.floor((q.y - this.zone('sound_controls', 'playlist').y - 4) / 19);
      const t = this.music?.tracks[this.trackPage * 6 + row]; if (t) this.music.play(t.n, { force: true });
      this.dirty = true;
    }
  }
  /** Открыть окно поверх текущего экрана и запомнить, куда возвращаться. */
  openWindow(kind, from) {
    if (from === 'menu') { this.screen = 'menu'; this.draw(); }          // иначе фоном застынет экран загрузки
    this.winBg = from === 'ingame' && this.frozen ? this.frozen.slice() : this.eng.m.b.slice(FB, FB + 0x4b000);
    this.returnTo = from; this.trackPage = 0; this.goto(kind);
  }
  closeWindow() {
    if (this.screen === 'options' || this.screen === 'sound') this.onOptions?.();   // обвязка сохраняет настройки (web/game.js)
    if (this.returnTo === 'ingame') { this.goto('ingame'); return; }
    if (this.returnTo === 'game') return this.closeIngame();
    this.toMenu();
  }

  notReady(id) {
    this.status = id.replace(/_/g, ' ') + ': not implemented yet'; this.goto('loading');
    setTimeout(() => { if (this.screen === 'loading') this.toMenu(); }, 1400);
  }

  async openHelp() { await this.need(P03); this.helpPage = 0; this.goto('help'); }
  async playIntro() { if (!this.playVideo) return; await this.playVideo('intro'); drainMouse(this.eng.m); this.dirty = true; }

  /** Открыть игровое меню — движок зовёт это через F[0x20acb]: кнопка MENU, ESC, F10. */
  openIngame() { if (this.screen !== 'game') return; this.frozen = this.eng.m.b.slice(FB, FB + 0x4b000); this.goto('ingame'); }
  closeIngame() { this.toGame(); this.onResume?.(); }

  /** Партия кончилась: 1 — поражение, 2 — победа ([0x30349], notes/ai-spec.md §11). */
  async finish(code) {
    const stage = this.mission + 1;
    if (code === 2 && this.playVideo && WIN_VIDEO.has(stage)) {
      this.goto('victory'); this.draw(); flip(this.eng);
      await this.playVideo('win' + String(stage).padStart(2, '0'));
      drainMouse(this.eng.m); this.dirty = true;
      // Где есть ролик, картинки победы обычно нет (NULLDAT), а GRPEND1 — финал кампании:
      // показывать его в середине нельзя, сразу идём к брифингу следующей стадии.
      if (entryName(this.files, P09, WIN_PAL(this.mission)) === 'NULLDAT.DAT' && this.mission < LAST_MISSION) this.afterMission();
      return;
    }
    this.goto(code === 2 ? 'victory' : 'defeat');
  }
  afterMission() {
    if (this.screen === 'ending') return this.toMenu();
    if (this.screen === 'victory') { if (this.mission >= LAST_MISSION) return this.goto('ending'); this.mission++; }
    this.loadBrief(); this.goto('briefing');
  }
  loadBrief() {
    const loc = this.locale?.brief(this.mission, this.tribe);
    if (loc) { this.briefCentered = true; return this.setBrief(loc.head, wrapText(this.eng, loc.body, BRIEF.w)); }
    this.briefCentered = false;
    const s = textFile(this.files, P09, 80 + this.mission * 8 + this.tribe);
    let p = 0;
    const take = (n) => { const out = [];
      for (let i = 0; i < n; i++) { const e = s.indexOf('\r\n', p); const end = e < 0 ? s.length : e;
        out.push(s.slice(p, end)); p = e < 0 ? s.length : e + 2; }
      return out; };
    const nh = s.charCodeAt(p++) || 0; const head = take(nh);
    const nb = s.charCodeAt(p++) || 0; const body = take(nb);
    this.setBrief(head, body);
  }
  /** Разложить брифинг по экрану: шапка сверху, тело ползёт снизу до низа шапки. */
  setBrief(head, body) {
    this.briefHead = head; this.briefBody = body;
    this.briefTop = head.length * BRIEF.lh + 32;                                    // [0x35678]
    this.briefStop = this.briefTop + Math.max(0, BRIEF.bottom - this.briefTop - body.length * BRIEF.lh);  // [0x35670]
    this.briefY = BRIEF.bottom;                                                     // [0x35674]
    this.briefTick = 0;
    this.brief = head.concat(body);                       // плоский список для накладки в партии
  }

  /** SELECT на экране клана: догрузить тяжёлые паки и показать брифинг стадии (по умолчанию первой). */
  async start(mission = 0) {
    try { return await this.startВнутри(mission); }
    catch (e) { this.status = ''; this.goto('menu'); this.наОшибку?.('не удалось загрузить: ' + (e?.message || e)); }
  }
  async startВнутри(mission = 0) {
    this.goto('loading');
    const step = (label) => (p) => { this.status = `${label} ${p}%`; this.draw(); flip(this.eng); };
    this.status = 'loading maps...'; this.draw(); flip(this.eng);
    await this.need('_PWAR08.TRC', step('loading maps...'));
    this.status = 'loading tiles...'; this.draw(); flip(this.eng);
    await this.need('_PWAR09.TRC', step('loading tiles...'));
    this.status = 'loading sprites...'; this.draw(); flip(this.eng);
    await this.need('_PWAR04.TRS'); await this.need('_PWAR05.TRS');     // спрайты юнитов и скин панели по племени
    this.status = 'loading sounds...'; this.draw(); flip(this.eng);
    await this.need('_PWAR06.TRW'); this.onSoundReady();                // 110 сэмплов эффектов
    this.status = 'loading screens...'; this.draw(); flip(this.eng);
    // Пак экранов может не доехать (оборванный канал, испорченный кеш). Раньше отказ здесь никто
    // не ловил: промис отваливался молча, и экран «Loading…» висел до перезагрузки страницы.
    try { await this.ensureFull02(step('loading screens...')); this.fullPack = true; }
    catch (e) { this.status = ''; this.goto('menu'); this.наОшибку?.('не удалось загрузить экраны: ' + (e?.message || e)); return; }
    this.mission = Math.max(0, Math.min(LAST_MISSION, mission | 0));
    this.loadBrief(); this.goto('briefing');
  }
}
