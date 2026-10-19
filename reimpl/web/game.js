// Точка входа игры: оболочка (логотипы → меню → выбор клана) и переход в саму партию.
// Просмотрщик отладки остался отдельно — web/index.html + web/viewer.js.
import { Mem, G, U, UNITS, BG, BI, MO } from '../js/mem.js'; import { Input } from '../js/input.js'; import { F, call } from '../js/fn.js';
import { Engine } from '../js/engine.js'; import { loadMission } from '../js/loader.js'; import '../js/modules.browser.js';
import { FrameBuffer } from '../js/render/fb.js'; import { Renderer } from '../js/render/renderer.js';
import { FB, ROWS, ряды, drawScene, SCENE_FULL, XBASE, VW, VH } from '../js/render/scene.js';
import { описаниеДома, описаниеБойца } from '../js/ai/справочник.js';
// ?v=6 — разовый обход кеша Cloudflare: этот файл он успел закешировать на 4 часа до того, как
// на /jw/ выставили no-store, а права Cache Purge у токена нет. Новый URL приходит с origin.
import { PATROL_MODE, setPatrolHandler, BUILD_MODE, setBuildHandler } from '../js/port/input.js';
import * as Ввод from '../js/port/input.js';
import * as Patrol from '../js/port/patrol.js';
import * as Очередь from '../js/port/prodqueue.js';
import * as План from '../js/port/buildplan.js';
import * as ИИ from '../js/port/ai_script.js';
import * as Кампания from '../js/ai/кампания.js';
import * as Артефакты from '../js/port/artifacts.js';
import * as Автоеда from '../js/port/autofood.js';
import * as Автогруппы from '../js/port/autogroups.js';
import * as Сети from '../js/ai/нейросети.js';
import * as Отряд from '../js/ai/отряд.js';
import * as Образец from '../js/ai/образец.js';
import { выполнить as выполнитьДействие, ДЕЙСТВИЯ as ДЕЙСТВИЯ_ИМЕНА } from '../js/ai/act.js';
import { наШаг } from '../js/port/inject.js';
import * as Следом from '../js/port/follow.js';
import * as Камикадзе from '../js/port/kamikaze.js';
import * as ОчередьПриказов from '../js/port/orderqueue.js';
import { НАШИ as НАШИ_КОДЫ, приказ as вОчередьПриказов } from '../js/port/inject.js';
import { Locale, LANG_NAME } from '../js/ui/locale.js';
import { Narration } from '../js/ui/narration.js';
import { Shell } from '../js/ui/shell.js'; import { PAL, drainMouse, invalidateArch, syncCursor, text, fill, wrapText } from '../js/ui/screen.js';
import { pathMode, setPathMode } from '../js/port/path.js';
import * as Replay from '../js/ui/replay.js';
import { Music } from '../js/ui/music.js';
import { СетеваяИгра, ПЛЕМЯ, ЖДАТЬ_МС } from '../js/net/игра.js';
import { состояниеJS, восстановитьJS } from '../js/net/lockstep.js';
import * as Сейвы from '../js/ui/saves.js';
import { Холл } from '../js/net/холл.js';
import { t, применитьЯзык } from './lang.js?v=a78bf313';
import { состояние as внедрение } from '../js/port/inject.js';
import { Sfx, voiceRand } from '../js/ui/sfx.js';
import * as Широко from '../js/render/wide.js';
import { СЦЕНЫ } from '../js/ai/сцены.js';
import * as НовыеЗвери from '../js/port/новые_звери.js';
import * as Вождь from '../js/ai/вождь.js';
import * as Вождь3 from '../js/ai/вождь3.js';
import { расставить as расставитьМеста, стартовыеПозиции, включитьИИ } from '../js/port/skirmish.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d'), note = document.getElementById('note');
const vid = document.getElementById('vid');
let img = ctx.createImageData(640, 480); let fb = new FrameBuffer();
// ---- широкое окно карты (js/render/wide.js)
//
// Игра нарисована под кадр 640×480, и окно карты в нём — 512×480, то есть 16×15 клеток. На
// сегодняшнем экране это крошечный кусок мира. Прежний «зум» проблему не решал: он не расширяет
// обзор, а прореживает уже отрисованную сцену, и потому мылит и стоит дорого. Здесь вместо этого
// растёт сам кадр, а картинка остаётся один к одному, родными пикселями.
//
// Размер берём по окну браузера, с запасом кратности 32 (клетка): движку нужно целое число
// клеток, иначе справа и снизу остаётся недорисованная полоса. Меню, заставки и окна оболочки
// живут в своём кадре 640×480 и на это не смотрят вовсе.
// Широкое окно НЕ ЗАПОМИНАЕТСЯ и всегда выключено на старте: страницу открыли — игра выглядит
// как оригинал, окно 512×480. Меняют размер только кнопки лупы (просьба владельца: «по умолчанию
// и при перезагрузке страницы всегда должен устанавливаться нативный размер, только кнопки лупы
// увеличивают или уменьшают»). Поэтому ни читать, ни писать настройку не надо.
const ШИРОКО = { вкл: false, ш: 640, в: 480 };
/**
 * Какой кадр просить у движка под текущее окно браузера. Меряем ДОСТУПНУЮ область (#main), а не
 * саму канву: её размер как раз и зависит от кадра, и мерить его собой значило бы гонять размер
 * туда-сюда. Размер округляется вниз до целых клеток по 32 пикселя, поэтому колебания гасятся
 * сами, а выше есть ещё и порог в клетку.
 */
function желаемыйКадр() {
  if (!ШИРОКО.вкл || shell.screen !== 'game') return { ш: 640, в: 480 };
  const эл = document.getElementById('main') || document.body;
  const ш = Math.max(640, Math.min(Широко.МАКС_Ш, Math.round(эл.clientWidth || 640) - 8));
  const в = Math.max(480, Math.min(Широко.МАКС_В, Math.round(эл.clientHeight || 480) - 8));
  return { ш, в };
}
/** Перестроить кадр движка и канву под новый размер. Зовётся, когда размер и правда изменился. */
function задатьКадр(ш, в) {
  if (ш === ШИРОКО.ш && в === ШИРОКО.в) return;
  if (ш === 640 && в === 480) { Широко.выключить(mem); ШИРОКО.ш = 640; ШИРОКО.в = 480; }
  else { const р = Широко.включить(mem, ш, в); ШИРОКО.ш = р.ш; ШИРОКО.в = р.в; }
  cv.width = ШИРОКО.ш; cv.height = ШИРОКО.в;
  img = ctx.createImageData(ШИРОКО.ш, ШИРОКО.в);
  fb = new FrameBuffer(ШИРОКО.ш, ШИРОКО.в);
  try { fit(); } catch {}                                // пропорции картинки изменились — переразложить
  mem.b[0x31ae0] |= 1;                                   // перерисовать мини-карту целиком
  try {
    rend.fb = fb;                                        // до создания рендера его ещё нет — это нормально
    // Подложка панели и статичные части рисуются только в полном кадре (0x2661c), а обычный такт
    // их не трогает. После смены размера полный кадр обязателен, иначе панель останется чёрной.
    if (shell.screen === 'game' && running) rend.drawFull();
  } catch {}
}
/** Строка состояния под нижней панелью: единственное место, где игра говорит с игроком словами. */
const say = (s) => { note.textContent = s; };

// ---------------------------------------------------------------- счётчик запусков игры
// Тот же счётчик, что на сайте (site/site.js), но здесь он отмечает ещё и саму игру: открыл ли
// человек страницу игры и дошёл ли до партии. Владельцу нужно видеть не только посещения, но и
// «кто запускал игру, а кто нет».
// Ботов не считаем: автоматизированный браузер (в том числе наши же прогоны playwright) виден по
// navigator.webdriver, и для него счётчик молчит вовсе.
const статистика = (() => {
  // В публичной сборке счётчик выключен: адрес приёмника задаётся явно (window.JW_STATS_URL).
  const АДРЕС = window.JW_STATS_URL || '';
  if (!АДРЕС || navigator.webdriver) return () => {};
  const сл = () => Math.random().toString(36).slice(2, 12);
  const сеанс = сл();
  let гость; try { гость = localStorage.getItem('jw-гость') || (localStorage.setItem('jw-гость', сл()), localStorage.getItem('jw-гость')); } catch { гость = сеанс; }
  let жив = false;
  const ожил = () => { жив = true; };
  for (const с of ['pointerdown', 'keydown', 'touchstart']) addEventListener(с, ожил, { passive: true });
  return (соб, ещё = {}) => {
    const тело = JSON.stringify({ соб, гость, сеанс, живой: жив, путь: location.pathname.slice(0, 120),
      яз: (navigator.language || '').slice(0, 5), экран: `${innerWidth}x${innerHeight}`,
      мобильный: matchMedia('(pointer: coarse)').matches,
      откуда: (() => { try { return document.referrer ? new URL(document.referrer).host : ''; } catch { return ''; } })(), ...ещё });
    try { navigator.sendBeacon ? navigator.sendBeacon(АДРЕС, new Blob([тело], { type: 'application/json' }))
                               : fetch(АДРЕС, { method: 'POST', body: тело, keepalive: true, mode: 'no-cors' }); } catch {}
  };
})();
setTimeout(() => статистика('игра'), 1500);                // страницу игры открыли (ещё не партия)
let net = null;                                      // сетевая партия (js/net/игра.js), создаётся ниже
// Пока движок не поднят, рисовать нечем — а чёрный экран на медленной сети выглядит как
// «зависло». Поэтому первые проценты пишем прямо на канву обычным 2D-контекстом.
function splash(line, pct) {
  ctx.fillStyle = '#0b0908'; ctx.fillRect(0, 0, 640, 480);
  ctx.fillStyle = '#e8c07d'; ctx.font = '20px ui-monospace, monospace'; ctx.textAlign = 'center';
  ctx.fillText('JURASSIC WAR', 320, 210);
  ctx.fillStyle = '#8d8274'; ctx.font = '13px ui-monospace, monospace';
  ctx.fillText(line, 320, 245);
  if (pct != null) {
    ctx.strokeStyle = '#3a3229'; ctx.strokeRect(170.5, 262.5, 300, 10);
    ctx.fillStyle = '#e8c07d'; ctx.fillRect(172, 264, Math.round(296 * pct / 100), 7);
  }
}

// ---- загрузка файлов с прогрессом
// Архивы отдаются сжатыми (nginx gzip_static, рядом лежат .gz): пак 08 ужимается на 85%, пак 02
// на 61%. Поэтому content-length — это размер сжатого потока, а из reader идут уже распакованные
// байты; проценты считаем от известного размера файла, иначе получается больше 100%.
const RAW_SIZE = {
  '_PWAR01.TRC': 1566374, '_PWAR02.TRS': 9295747, '_PWAR03.TRC': 924128, '_PWAR04.TRS': 3369918,
  '_PWAR05.TRS': 910384, '_PWAR06.TRW': 1085016, '_PWAR08.TRC': 16809358, '_PWAR09.TRC': 12944593,
  '_PWAR13.TRC': 3535542,   // сетевые карты оригинала
  '_PWAR10.TRC': 1226680,   // семь демо-карт, которых в самой игре нет в меню
};
// Скачивание пака с проверкой размера. Раньше проверки не было, и оборванная закачка тихо
// становилась «архивом»: заголовок разбирался, ранние записи читались, поздних не было. Снаружи
// это выглядело так, что игра сломалась — у окна настроек пропадала рамка (текст поверх колеса
// оставался), а экран сетевой игры не рисовался вовсе и висело «Loading…». Причём битый файл
// оседал в кеше браузера на неделю (ресурсы паков отдаются с max-age=604800), и перезагрузка
// страницы не помогала. Теперь недокачанный файл не принимается, а вторая попытка идёт мимо
// кеша — это лечит и уже испорченный кеш.
// Сколько ждать молчащий канал. Не общий срок закачки (на медленной связи пак едет долго и это
// нормально), а паузу без единого байта: именно так выглядит зависшее соединение. Без этого
// экран «Loading…» висел вечно и не сообщал ничего.
const ТИШИНА_МС = 25000;
/**
 * Скачать архив игры с проверкой размера и, если надо, повторить мимо кеша.
 * @param {string} url     адрес пака относительно web/
 * @param {(p:number)=>void} onProgress  сколько процентов доехало
 * @param {number} rawSize эталонный размер (RAW_SIZE): по нему ловим обрыв
 * @param {boolean} мимоКеша вторая попытка — с ?fresh= и cache: reload
 */
async function fetchU8(url, onProgress, rawSize, мимоКеша = false) {
  const адрес = мимоКеша ? url + (url.includes('?') ? '&' : '?') + 'fresh=' + Date.now() : url;
  const стоп = new AbortController();
  let молчит = setTimeout(() => стоп.abort(), ТИШИНА_МС);
  const тик = () => { clearTimeout(молчит); молчит = setTimeout(() => стоп.abort(), ТИШИНА_МС); };
  let r;
  try { r = await fetch(адрес, { signal: стоп.signal, ...(мимоКеша ? { cache: 'reload' } : {}) }); }
  catch (e) { clearTimeout(молчит); throw new Error(url + (стоп.signal.aborted ? ': сервер молчит ' + (ТИШИНА_МС / 1000) + ' с' : ': ' + e.message)); }
  if (!r.ok) { clearTimeout(молчит); throw new Error(url + ': ' + r.status); }
  const total = rawSize || +r.headers.get('content-length') || 0;
  let out;
  try {
    if (!total || !r.body) out = new Uint8Array(await r.arrayBuffer());
    else {
      const rd = r.body.getReader(); const parts = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; тик(); parts.push(value); got += value.length; onProgress?.(Math.min(100, Math.floor(got * 100 / total))); }
      out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    }
  } catch (e) { throw new Error(url + (стоп.signal.aborted ? `: оборвалось на ${ТИШИНА_МС / 1000} с тишины` : ': ' + e.message)); }
  finally { clearTimeout(молчит); }
  if (rawSize && out.length !== rawSize) {
    if (мимоКеша) throw new Error(`${url}: пришло ${out.length} байт вместо ${rawSize}`);
    return fetchU8(url, onProgress, rawSize, true);          // вторая попытка мимо кеша
  }
  return out;
}
/** Разжать deflate-поток (снимок памяти движка лежит сжатым). */
async function inflate(u8) { const ds = new DecompressionStream('deflate'); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }

// Один архив качается один раз, даже если его попросили из нескольких мест: повторный вызов
// присоединяется к тому же запросу и просто подменяет колбэк прогресса.
const files = {}, inflight = {}, progressOf = {};
/** Взять архив: из памяти, из уже идущего запроса или новым запросом. Один пак — одна закачка. */
function need(name, onProgress) {
  if (files[name]) return Promise.resolve(files[name]);
  if (onProgress) progressOf[name] = onProgress;
  if (!inflight[name]) {
    inflight[name] = fetchU8('../../PWAR/' + name, p => progressOf[name]?.(p), RAW_SIZE[name])
      .then(u => { files[name] = u; delete progressOf[name]; return u; })
      // Отказ не запоминаем: раньше упавший запрос оставался в inflight, и все следующие
      // попытки получить этот пак отваливались тем же отказом до перезагрузки страницы.
      .catch(e => { delete inflight[name]; delete progressOf[name]; throw e; });
  }
  return inflight[name];
}

// ---- старт: снимок статических таблиц движка + паки оболочки (01 шрифты/курсоры/титул, 02 экраны меню)
say(t('загрузка…')); splash('loading engine...', 0);
const mem = Mem.ofSize();
mem.b.set(await inflate(await fetchU8('../data/boot_snap.bin.z', p => { say(t('движок ') + p + '%'); splash('loading engine...', p); })), 0x30000);
// Кадры новых зверей (наш пак data/beasts.bin поверх заглушек 1×1) — только на тестовой сцене демона
// (?demon=1): в обычную игру новые звери не входят, решение владельца 27.09.2026. loader.js кладёт кадры
// заново после каждой загрузки миссии, если пак задан.
if (new URLSearchParams(location.search).get('demon')) {
  // тестовая страница: кадры меняются часто, поэтому без кэша (?t=)
  try { НовыеЗвери.задать(await fetchU8('../data/beasts.bin?t=' + Date.now())); НовыеЗвери.вставить(mem); } catch (e) { console.warn('beasts.bin', e); }
}
// Кадры новых зверей (брахиозавр, демон) — наш пак поверх заглушек игры; нет файла — игра как была.

mem.w32(0x46c, 110);
// Пак 01 (шрифты, курсоры, титул, логотипы) нужен сразу. Вместо пака 02 целиком (9 МБ, 3.6 по
// сети) на старте берём облегчённый набор out/ui/_UI_BOOT.TRS — те же номера записей, но только
// колесо меню, экран сложности и база выбора клана: 307 КБ по сети (tools/ui_bundle.py).
say(t('интерфейс…')); splash('loading interface...', 0);
await need('_PWAR01.TRC', p => { say(t('интерфейс ') + p + '%'); splash('loading interface...', p); });
splash('loading menu...', 0);
// В имени файла версии нет, но ресурсы отдаются с max-age на неделю, поэтому ссылку берём из
// ui_boot.json — там к ней приписан хеш содержимого, и пересборка набора сразу видна браузеру.
const uiBoot = await fetch('../data/ui_boot.json').then(r => r.ok ? r.json() : null).catch(() => null);
// Ноты для музыки и восемь клановых текстов: если файла нет, обходимся без них.
const musicData = await fetch('../data/music.json').then(r => r.ok ? r.json() : null).catch(() => null);
// Восемь клановых текстов для экрана выбора племени; нет файла — экран просто без текста.
const storyData = await fetch('../data/tribe_story.json').then(r => r.ok ? r.json() : null).catch(() => null);
files['_PWAR02.TRS'] = await fetchU8('../../ui/' + (uiBoot?.url || '_UI_BOOT.TRS'),
  p => splash('loading menu...', p), uiBoot?.bytes);
let full02 = false, ждём02 = null;
/** Догрузить полный пак 02: нужен для игрового меню, опций, звука и окон сохранения. */
async function ensureFull02(onProgress) {
  // Флаг ставится ТОЛЬКО после удачной загрузки. Раньше он взводился до запроса: если пак
  // (9 МБ) не доехал — оборвалась связь, вкладку усыпили, — второй заход считал его готовым,
  // экран «Multiplayer Game» рисовался из несуществующего архива и падал каждый кадр. Снаружи
  // это выглядело как зависшее «loading screens…». Параллельные вызовы ждут один запрос.
  if (full02) return;
  if (ждём02) return ждём02;
  ждём02 = (async () => {
    const u = await fetchU8('../../PWAR/_PWAR02.TRS', onProgress, RAW_SIZE['_PWAR02.TRS']);
    files['_PWAR02.TRS'] = u; invalidateArch(files, '_PWAR02.TRS'); full02 = true;
  })();
  try { await ждём02; } finally { ждём02 = null; }
}
// Разметка экранов: номера записей, геометрия колёс и хотспоты (tools/ui_catalog.py).
const catalog = await fetch('../data/ui_screens.json').then(r => r.ok ? r.json() : null).catch(() => null);
let eng = new Engine(mem); eng.files = files;
// Указатели слотов спрайтов и шрифтов чинятся в конструкторе Renderer — и ровно один раз:
// fixSlotPointers/fixFontPointers вычитают 0x100000 из подходящих указателей, повторный вызов
// вычтет ещё раз и порвёт спрайты. Поэтому Renderer создаётся здесь, а при старте миссии
// ему просто подменяется движок.
const rend = new Renderer(eng, fb, files);
rend.поверхКадра = () => подсказкаПредмета();            // надписи шрифтом игры поверх сцены
// Локализация: русские сюжетные тексты и кириллица, дописанная в шрифт 1 оригинала.
// Патчить шрифт можно только после Renderer — он чинит указатели шрифтов (fixFontPointers).
const locale = await Locale.load('../data/');
locale.use(localStorage.getItem('jw.lang') || 'en', mem);          // по умолчанию английский, выбор помнится
применитьЯзык(locale.lang);                      // наш интерфейс (кнопки, лобби) — web/lang.js
// Какая версия интерфейса сейчас загружена. Берём прямо из адреса своего же модуля (game.js?v=…),
// чтобы не держать число в двух местах. Показываем в строке состояния при старте партии: иначе
// открытую со вчера вкладку не отличить от свежей, и кажется, что правки не приехали.
const ВЕРСИЯ_UI = (() => { try { return new URL(import.meta.url).searchParams.get('v') || '?'; } catch { return '?'; } })();

// ---- ввод: те же кольца событий оригинала, что и в игре.
// На телефоне по умолчанию тачпад: палец ведёт курсор относительно, тап — клик. Абсолютный
// режим («тап») остаётся переключателем; мышь всегда работает абсолютно.
const latchb = document.getElementById('latch'), pmodeb = document.getElementById('pmode');
let padMode = (localStorage.getItem('jw.pmode') ?? (matchMedia('(pointer: coarse)').matches ? 'pad' : 'tap')) === 'pad';
const input = new Input(mem);
input.attach(cv, { pad: padMode, onButton: (b) => markButton(b), onLatch: (on) => latchb.classList.toggle('on', on) });
// Куда можно тапать пальцем напрямую, без наведения курсора: все экраны оболочки целиком,
// а в партии — боковая панель и мини-карта. По игровому полю тап остаётся относительным.
input.directTap = (x, y) => {
  // Есть отдельная область-тачпад — значит точное ведение курсора живёт там, а по картинке
  // тап работает как обычное нажатие в это место.
  if (padwrap.classList.contains('on')) return true;
  if (shell.screen !== 'game') return true;
  if (x >= mem.u32(0x488c4)) return true;                          // панель: [0x488c4] — ширина окна карты
  const mm = { x0: mem.u32(0x30388), y0: mem.u32(0x3038c), x1: mem.u32(0x30398), y1: mem.u32(0x3039c) };
  return (mem.u8(0x31ae0) & 9) !== 0 && x >= mm.x0 && x < mm.x1 && y >= mm.y0 && y < mm.y1;
};
/** Обновить кнопку «pad/tap»: тачпад под картинкой или касания прямо по ней. */
function markMode() { pmodeb.textContent = padMode ? 'pad' : 'tap'; pmodeb.classList.toggle('on', padMode); latchb.hidden = !padMode; }
pmodeb.onclick = () => { padMode = !padMode; localStorage.setItem('jw.pmode', padMode ? 'pad' : 'tap'); input.setPad(padMode); markMode(); fit(); };
latchb.onclick = () => input.setLatch(!latchb.classList.contains('on'));
markMode();
let running = false, mission = 0, tribe = 0;
let stick = null;              // стик прокрутки карты на тачпаде: { id, cx, cy, dx, dy } (см. ниже)

const music = new Music(document.getElementById('mus'), musicData);

// ---- звуковые эффекты: сэмплы пака 06, заявки движок ставит сам (js/ui/sfx.js)
const sfx = new Sfx();
sfx.setVolume((+(localStorage.getItem('jw.sfxvol') ?? 6) - 1) / 9);
// ?mute — тихая вкладка: для плиток multi.html, где на экране сразу несколько партий; настройки
// громкости общие на localStorage, поэтому здесь глушим только эту страницу, ничего не сохраняя
if (new URLSearchParams(location.search).has('mute')) { sfx.setVolume(0); music.on = false; }
addEventListener('pointerdown', () => sfx.ready(), true);          // до первого жеста звук не пустят
/** Разрешить звуковые эффекты: пак 06 доехал, движку можно ставить заявки. */
function enableSound() {
  if (!files['_PWAR06.TRW']) return;
  sfx.attach(files); mem.w8(0x30c4c, 1);                           // [0x30c4c] = 1 — движок ставит заявки
}
// Конец шага: сначала играем накопленное, потом отдаём движку опустошить очередь.
const clearQueue = F[0x200fe];
F[0x200fe] = (e) => { sfx.flush(e.m); clearQueue(e); };

// Голоса юнитов идут мимо очереди — прямым вызовом драйвера, поэтому обработчики переписаны
// целиком (порт js/port/input.js их только «прокручивал», чтобы не сбить ГСЧ). Номер сэмпла:
// база + rand(число вариантов), таблицы T_SND_SELECT @0x38be8 и T_SND_ORDER @0x38d28.
// Вариант выбирает СВОЙ генератор (voiceRand), а не движковый 0x204a6: иначе поток случайных
// чисел зависел бы от того, включён ли звук и куда щёлкал игрок, — см. ROADMAP §7a.
const sndOn = () => mem.u8(0x30c4c) === 1;
/** Не чаще раза в игровой такт: иначе на клик выделения накладывается несколько голосов. */
const voiceGate = (m) => { const t = m.u32(0x46c) & ~0xf; if (m.u32(0x3886c) === t) return false; m.w32(0x3886c, t); return true; };
F[0x1fdc2] = (eng, r) => {                                          // голос при выделении
  const m = eng.m; if (!sndOn() || !voiceGate(m)) return;
  const s = UNITS + r.esi, ty = m.u8(s + U.TYPE);
  if (ty >= 0x1a) {                                                 // здания: молчат, пока целы и достроены
    const hurt = m.u8(s + U.HP) < (m.u8(s + U.HPMAX) >> 1);
    if (!(m.u8(s + 0x50) & 2) && !hurt) return;
    return sfx.play(hurt ? 0x6b : 0x68);
  }
  sfx.play((m.u32(0x38be8 + ty * 8) + voiceRand(m.u32(0x38bec + ty * 8))) >>> 0);
};
F[0x1fe5e] = (eng, r) => {                                          // «есть!» в ответ на приказ
  const m = eng.m; if (!sndOn()) return;
  const ty = m.u8(UNITS + r.esi + U.TYPE); if (ty >= 0x0e) return;
  sfx.play((m.u32(0x38d28 + ty * 8) + voiceRand(m.u32(0x38d2c + ty * 8))) >>> 0);
};
// Mouse Sensitive хранится там же, где в оригинале ([0x3009e], 0x12..0x52 — по одной
// «палочке» заполнения на единицу), и задаёт множитель хода пальца по тачпаду.
const applySensitivity = (v) => { input.padScale = 0.35 + (v - 0x12) * 1.5 / 64; };
{
  const st = +(localStorage.getItem('jw.mouse') || 0);           // до 2026-09-08 тут лежало 1..5
  const v = st >= 0x12 && st <= 0x52 ? st : 50;
  mem.w16(0x3009e, v); applySensitivity(v);
}
// Настройки из окна опций оригинала (скорость игры, прокрутка, авто-прокрутка, чувствительность
// мыши) живут в памяти движка и раньше сбрасывались при каждой перезагрузке. Храним их в localStorage.
const OPTS = { speed: 0x30098, scroll: 0x3009a, scrollAuto: 0x3009c, mouse: 0x3009e };
// Подписи скорости — как в окне настроек оригинала (строки 0x398b3), только словами и на нашем языке.
const СКОРОСТИ = { 1: 'самая быстрая', 2: 'быстрая', 3: 'обычная', 4: 'медленная', 5: 'самая медленная' };
/** Настройки из окна опций оригинала — из localStorage обратно в память движка. */
function loadOpts() {
  let o = null; try { o = JSON.parse(localStorage.getItem('jw.opts') || 'null'); } catch {}
  if (!o) return;
  for (const [k, a] of Object.entries(OPTS)) if (Number.isFinite(o[k])) mem.w16(a, o[k]);
  applySensitivity(mem.u16(OPTS.mouse));
}
/** И наоборот: то, что игрок покрутил в окне опций, сохранить между заходами. */
function saveOpts() {
  const o = {}; for (const [k, a] of Object.entries(OPTS)) o[k] = mem.u16(a);
  localStorage.setItem('jw.opts', JSON.stringify(o)); localStorage.setItem('jw.scroll', String(o.scroll)); localStorage.setItem('jw.mouse', String(o.mouse));
  applySensitivity(o.mouse);
}
loadOpts();
const shell = new Shell(eng, files, {
  catalog, uiBoot, ensureFull02, music, sfx, story: storyData, locale, onSoundReady: enableSound, onMouseSensitivity: applySensitivity,
  наОшибку: (т) => { say(т); toast(т); },                    // пак экранов не доехал — сказать и вернуть в меню
  // Сохранение — снимок всей памяти движка; загрузка кладёт его обратно и продолжает партию.
  onSnapshot: () => mem.b.slice(0x30000),
  // В памяти оригинала нет ни маршрутов патруля, ни очередей, ни планов строек, ни штабов нашего
  // компьютера — всё это живёт в JS. Кладём в сейв тот же полный снимок, что едет по сети и в
  // запись: раньше сохранялись только три поля из тринадцати, и после загрузки компьютер начинал
  // партию заново — без разведанного, без отрядов, без фазы, а «иду за ним» и камикадзе слетали.
  onSaveMeta: () => ({ состояние: состояниеJS(eng),
                       patrols: Patrol.dump(eng), queues: Очередь.dump(eng), шаги: ОчередьПриказов.dump(eng) }),

  onRestore: (snap, meta) => {
    mem.b.set(snap, 0x30000); НовыеЗвери.вставить(mem);
    eng = new Engine(mem); eng.files = files; shell.eng = eng; rend.eng = eng;
    mission = meta.mission; tribe = meta.tribe;
    if (meta.состояние) восстановитьJS(eng, meta.состояние);
    else { Patrol.restore(eng, meta.patrols); Очередь.restore(eng, meta.queues); ОчередьПриказов.restore(eng, meta.шаги); }   // сейвы прежних сборок
    rend.drawFull(); running = true; shell.paused = false;
    beginRecording('save');                        // партия продолжается с сейва — пишем новый реплей
    say(t('миссия {m}, племя {t}, сложность {d}', { m: mission + 1, t: ПЛЕМЕНА_ИМЕНА[tribe] || tribe, d: t(имяСложности(shell.difficulty ?? 1)) }));
  },
  onLeaveGame: (why) => { saveReplay(why); if (net?.активна) net.выйти(); },      // рестарт, выход в меню, загрузка сейва
  need: (name, onProgress) => need(name, onProgress),
  onStartMission: (a) => startMission(a.mission, a.tribe, a.difficulty),
  onMultiplayer: () => openNet(),
  onSkirmish: () => openSkirmish(),
  onScreenHint: (имя) => { if (имя === 'multiplayer') say(t('Null Modem — партия против компьютера, Modem — игра по сети')); },
  // Quit в главном меню: выходим из игры на сайт порта. Внутри плитки (iframe) уводим верхнее окно,
  // иначе сайт открылся бы внутри рамки. Локально (file://, 127.0.0.1) просто ничего не делаем.
  onQuit: () => {
    if (net?.фаза !== 'нет') net.выйти();
    // Куда уходить по Quit — window.JW_QUIT_URL (например, на свой сайт); по умолчанию никуда.
    const куда = window.JW_QUIT_URL || null;
    if (!куда) { say(t('выход')); return; }
    свойУход = true;
    try { (window.top || window).location.href = куда; } catch { location.href = куда; }
  },
  onOptions: () => saveOpts(),
});
// Игровое меню оригинала: кнопка MENU в панели, ESC и F10 ведут в 0x20acb (js/port/input.js
// вызывает его через opt() — если функция не определена, нажатие просто игнорируется).
// Перед открытием внутриигрового меню кладём середину широкого кадра в кадр оболочки: она
// замораживает именно его и рисует колесо поверх (js/render/wide.js, вКадрМеню).
F[0x20acb] = () => { Широко.вКадрМеню(mem); shell.openIngame(); };

let netLoading = false;                                     // миссию грузит сетевой контроллер (не выходить из комнаты)
/**
 * Начать миссию кампании: загрузить карту, поднять правила и оболочку, начать запись партии.
 * @param {number} m0 номер стадии 0..11
 * @param {number} t0 племя 0..7
 * @param {number} diff сложность 0..2
 */
function startMission(m0, t0, diff = 1) {
  try { охоты.length = 0; } catch {}                  // отряды угодий прошлой партии — долой
  статистика('партия', { миссия: m0 | 0, режим: m0 >= 100 ? 'схватка' : 'кампания' });
  if (playing) { playing = null; rpbar.hidden = true; }      // из просмотра — сразу в новую партию
  // Обычная партия поверх сетевой (вышли через «menu» или после конца сетевой): сетевой локстеп
  // иначе продолжает перехватывать приказы и тики — юниты «не слушаются»
  if (net && net.фаза !== 'нет' && !netLoading) net.выйти();
  mission = m0; tribe = t0; сцена = null;                    // вышли из учебной сцены в настоящую партию
  eng = loadMission(mem, files, mission, tribe, diff);
  eng.files = files; shell.eng = eng; rend.eng = eng; shell.mission = mission; shell.tribe = tribe;
  enableSound();
  // Кириллица в шрифте 1 — наш патч поверх данных пака; загрузка миссии затирает эту область,
  // поэтому вписываем буквы заново, иначе в партии весь русский текст станет «?».
  try { locale.перепатчить(mem); } catch {}
  // Прокрутка от курсора у края экрана выключена: на телефоне она мешает, а карту двигают
  // кнопки и стрелки. Это штатная настройка игры — «Scroll Auto Speed» в опциях, значение 6.
  mem.w16(0x3009c, 6);
  try { задатьКрая(localStorage.getItem('jw.edge') === '1', true); } catch {}   // наша полоса у края, если включена
  // Скорость прокрутки по умолчанию на шаг медленнее заводской (1 — самая быстрая).
  if (localStorage.getItem('jw.scroll') === null) mem.w16(0x3009a, 2);
  else mem.w16(0x3009a, +localStorage.getItem('jw.scroll'));
  loadOpts();                                                   // всё, что человек поменял в окне опций
  // Украшения с прибавками — наша добавка поверх оригинала; в кампании включается настройкой,
  // в сетевой партии правило приезжает от хоста вместе с параметрами старта.
  // По умолчанию прибавки ВКЛЮЧЕНЫ (владелец: «украшения-прибавка должны работать по умолчанию, кнопка
  // включена»); выключены — только если человек сам нажал кнопку (в хранилище '0').
  if (!net?.активна) Артефакты.задать(eng, localStorage.getItem('jw.artifacts') !== '0');
  // Автоприрост еды — правило скирмиша, в кампании его быть не должно. Флаг живёт в модуле и
  // переживает выход из партии: сыграл скирмиш с галочкой, пошёл в кампанию — и там базам
  // капала еда. Гасим на каждом старте обычной миссии; сетевой партии его ставит хост.
  if (!net?.активна) Автоеда.задать(eng, false);
  try { updArtBtn(); } catch {}
  shell.screen = 'game'; shell.tune('game'); rend.drawFull();   // экран ставим напрямую, поэтому музыку переключаем сами
  running = true; shell.paused = false;
  say(t('миссия {m}, племя {t}, сложность {d}', { m: mission + 1, t: ПЛЕМЕНА_ИМЕНА[tribe] || tribe, d: t(имяСложности(diff)) })
      + ` · v${ВЕРСИЯ_UI}`);
  setPaused(false);
  try { применитьАвтобой(false); } catch {}      // автобой переживает смену миссии
  сценаКуска = false; сценаПлемя = null;          // обычный старт миссии выводит из режима сцены;
                                                 // сама сцена ставит флаг обратно сразу после старта
  beginRecording('mission');
}

// ---- учебные сцены
// Просьба владельца: «ты сцены мне дай, а не репки записанные». Запись показывает поведение на тот
// час, когда её сняли; правила с тех пор менялись десятки раз. Поэтому сцену СТАВИМ и играем
// живьём: то же подготовленное положение, но управляет им нынешний код, партию можно поставить на
// паузу, походить по карте и перезапустить с другими мозгами.
let сцена = null;                                  // { имя, безВрага, мозги } — пока идёт сцена
/**
 * Запустить учебную сцену. Обе стороны ведёт компьютер, человек только смотрит (и может вмешаться —
 * юниты его слушаются, это удобно, когда хочется проверить «а если так?»).
 * @param {string} имя ключ из СЦЕНЫ
 * @param {'скрипт'|'стратег'} мозги чей ИИ ведёт нашу сторону
 */
async function startScene(имя, мозги = 'скрипт') {
  const сц = СЦЕНЫ[имя]; if (!сц) return say(t('нет такой сцены'));
  // Сети качаем до старта: внутри партии они нужны сразу, а fetch — дело не мгновенное.
  const место = мозги === 'нейронка' ? { мозги: 'боец' } : мозги === 'комдив' ? { мозги: 'комдив' } : null;
  if (место) {
    const беда = await Сети.подготовить([место]);
    const нет = беда.length ? беда : Сети.чегоНеХватает([место]);
    // Молча подменять сеть скриптом нельзя: сцена будет выглядеть рабочей и покажет не то.
    if (нет.length) { const т = t('сцена не запущена: не подключилась нейросеть — {e}', { e: нет.join(', ') });
      say(т); toast(т); console.error(т); return; }
  }
  статистика('партия', { миссия: сц.карта | 0, режим: 'сцена' });
  // Паки под карту сцены. Сцены стоят на сетевых картах (100+ — _PWAR13.TRC), а их в свежей
  // вкладке ещё нет: без этого сцена падала с «нет пака _PWAR13.TRC».
  say(t('сцена: загрузка ресурсов…'));
  const паки = ['_PWAR08.TRC', '_PWAR09.TRC', '_PWAR04.TRS', '_PWAR05.TRS', '_PWAR06.TRW'];
  if (сц.карта >= 200) паки.push('_PWAR10.TRC'); else if (сц.карта >= 100) паки.push('_PWAR13.TRC');
  for (const f of паки) await need(f);
  if (playing) { playing = null; rpbar.hidden = true; }
  if (net && net.фаза !== 'нет' && !netLoading) net.выйти();
  mission = сц.карта; tribe = сц.племя ?? 0;
  eng = loadMission(mem, files, mission, tribe, 1);
  eng.files = files; shell.eng = eng; rend.eng = eng; shell.mission = mission; shell.tribe = tribe;
  enableSound();
  try { locale.перепатчить(mem); } catch {}
  mem.w16(0x3009c, 6);
  try { задатьКрая(localStorage.getItem('jw.edge') === '1', true); } catch {}
  mem.w16(0x3009a, localStorage.getItem('jw.scroll') === null ? 2 : +localStorage.getItem('jw.scroll'));
  loadOpts();
  Артефакты.задать(eng, false); Автоеда.задать(eng, false);            // сцена меряет ИИ, а не наши добавки
  try { updArtBtn(); } catch {}
  // Две стороны, наша первая. Расстановка — та же, что в схватке, иначе у сторон не будет ни домов,
  // ни начальных бойцов, и сцене нечего будет ставить.
  const цвета = Object.keys(стартовыеПозиции(mem)).map(Number).sort((a, b) => a - b);
  const нас = цвета[0], враг = цвета[1];
  расставитьМеста(eng, [{ цвет: нас, племя: tribe, кто: 'компьютер' }, { цвет: враг, племя: 3, кто: 'компьютер' }], {});
  сц.собрать(eng, нас, враг);
  ИИ.сброс(eng);
  // Встроенный ИИ оригинала обеим сторонам гасим: сцена про наш скрипт, а не про игру 1993 года.
  mem.w8(0x32aec + нас, 0);
  ИИ.задать(eng, нас, { уровень: 3, характер: 'костяк', стратегПравило: мозги === 'стратег',
                        ...(место ? Сети.дляМеста(место) : {}) });
  mem.w8(0x32aec + враг, 0); ИИ.задать(eng, враг, { уровень: 3, характер: 'ровный' });
  mem.w8(G.humanOwner, нас);                                            // камера и «наши» — это наша сторона
  сцена = { имя, безВрага: !!сц.безВрага, мозги };
  shell.screen = 'game'; shell.tune('game'); rend.drawFull();
  running = true; shell.paused = false; setPaused(false);
  // Камера на нашу базу: без этого сцена открывается в углу карты, где ничего не происходит.
  try { кНашейБазе(нас); } catch {}
  say(t('сцена «{s}» · {b} — {w}', { s: имя, b: мозги, w: сц.что }));
}
/** Камера на середину между базами участников сцены «трое». */
function кСерединеБоя() {
  const цвета = new Set(бой.места.map(м => м.цвет));
  let sx = 0, sy = 0, n = 0;
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1 || !цвета.has(mem.u8(UNITS + i + U.OWNER))) continue;
    if (mem.u8(UNITS + i + U.TYPE) < 0x1a) continue;
    sx += mem.u16(UNITS + i + U.X); sy += mem.u16(UNITS + i + U.Y); n++;
  }
  if (!n) return;
  const окнШ = mem.u32(0x31af0) || 16, окнВ = mem.u32(0x31af4) || 15;
  const прX = Math.max(0, (mem.u32(G.mapW) - окнШ) << 5), прY = Math.max(0, (mem.u32(G.mapH) - окнВ) << 5);
  // КАМЕРУ ВЫРАВНИВАЕМ ПО КЛЕТКЕ. Отрисовка земли берёт тайлы по (камера >> 5), а строки кадра —
  // по своей таблице: при камере не кратной 32 сцена выводится в пустоту и экран остаётся чёрным,
  // хотя игра идёт и мини-карта обновляется. Ровно это и было видно в сцене «трое».
  mem.w32(0x31ae8, Math.min(прX, Math.max(0, Math.round(sx / n) - ((окнШ << 5) >> 1))) & ~31);
  mem.w32(0x31aec, Math.min(прY, Math.max(0, Math.round(sy / n) - ((окнВ << 5) >> 1))) & ~31);
}

/** Подвинуть камеру к первому дому (или бойцу) цвета. */
function кНашейБазе(цвет) {
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1 || mem.u8(UNITS + i + U.OWNER) !== цвет) continue;
    if (mem.u8(UNITS + i + U.TYPE) < 0x1a) continue;
    // Камера в точках, окно — в клетках (0x31af0/0x31af4). Ставим базу в середину окна и
    // прижимаем к краям карты, иначе движок нарисует область за её пределами.
    const x = mem.u16(UNITS + i + U.X), y = mem.u16(UNITS + i + U.Y);
    const окнШ = mem.u32(0x31af0) || 16, окнВ = mem.u32(0x31af4) || 15;
    const прX = Math.max(0, (mem.u32(G.mapW) - окнШ) << 5), прY = Math.max(0, (mem.u32(G.mapH) - окнВ) << 5);
    mem.w32(0x31ae8, Math.min(прX, Math.max(0, x - ((окнШ << 5) >> 1))) & ~31);   // строго по клетке
    mem.w32(0x31aec, Math.min(прY, Math.max(0, y - ((окнВ << 5) >> 1))) & ~31);
    return;
  }
}

// ---- кадр
// Сцена перерисовывается ~25 раз в секунду (это дорого), а курсор и ввод — каждый кадр экрана:
// иначе указатель ощутимо отстаёт от пальца. «Дешёвый» кадр — только композит курсора поверх
// уже нарисованной сцены (порт 0x299b4) и копия буфера в канву.
const SCENE_MS = 40;
let lastScene = 0;

// ---- сглаживание движения между шагами симуляции
// Мир считается 18 раз в секунду (шаг 55 мс), а экран обновляется 60 раз, поэтому юниты
// двигаются заметными скачками. Перед отрисовкой подставляем им промежуточные координаты между
// прошлым и нынешним шагом, сразу после отрисовки возвращаем настоящие. Симуляция этого не видит:
// и подстановка, и возврат происходят внутри одного кадра, до следующего тика.
// `показано` — координаты, с которыми юниты были НАРИСОВАНЫ в последний раз. Наложения (номера
// групп, рамки, маршруты) обязаны брать их, а не то, что лежит в памяти: сцена перерисовывается
// не каждый кадр экрана, и на промежуточных кадрах память уже «ступенчатая», а спрайт на экране —
// сглаженный. Из-за этого циферки над идущими юнитами дёргались отдельно от самих юнитов.
const ПЛАВНО = { вкл: localStorage.getItem('jw.smooth') !== '0', было: new Map(), когда: 0, правки: [], дорого: 0, показано: new Map() };
const ПЛАВНО_МС = 22;                    // не чаще ~45 кадров в секунду со сглаживанием
const ПРЫЖОК = 48;                       // больше этого за шаг — телепорт или рождение, не сглаживаем
/** Перед шагом симуляции запомнить, где юниты стояли: от этих точек и считается сглаживание. */
function запомнитьПозиции() {
  if (!ПЛАВНО.вкл) return;
  const b = ПЛАВНО.было; b.clear(); ПЛАВНО.когда = performance.now();
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    b.set(i, (mem.u16(UNITS + i + U.X) << 16) | mem.u16(UNITS + i + U.Y));
  }
}
/** Подставить промежуточные координаты по времени внутри такта. true — что-то подменили. */
function сгладить() {
  if (!ПЛАВНО.вкл || !running || shell.paused || !ПЛАВНО.было.size) return false;
  const a = Math.min(1, (performance.now() - ПЛАВНО.когда) / 55);
  if (a >= 1) { ПЛАВНО.показано.clear(); return false; }
  const правки = ПЛАВНО.правки; правки.length = 0;
  ПЛАВНО.показано.clear();
  for (const [i, xy] of ПЛАВНО.было) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const px = xy >>> 16, py = xy & 0xffff;
    const x = mem.u16(UNITS + i + U.X), y = mem.u16(UNITS + i + U.Y);
    const dx = x - px, dy = y - py;
    if ((dx | dy) === 0 || Math.abs(dx) > ПРЫЖОК || Math.abs(dy) > ПРЫЖОК) continue;
    правки.push(i, x, y);
    const сx = (px + dx * a) | 0, сy = (py + dy * a) | 0;
    mem.w16(UNITS + i + U.X, сx); mem.w16(UNITS + i + U.Y, сy);
    ПЛАВНО.показано.set(i, (сx << 16) | сy);
  }
  return правки.length > 0;
}
/** Вернуть настоящие координаты шага. Обязано выполниться до конца кадра, иначе поедет симуляция. */
/** X юнита ТАК, КАК ОН НАРИСОВАН: сглаженный, если сцену рисовали со сглаживанием. */
const юX = (i) => { const v = ПЛАВНО.показано.get(i); return v === undefined ? mem.u16(UNITS + i + U.X) : (v >>> 16); };
/** Y юнита так, как он нарисован. */
const юY = (i) => { const v = ПЛАВНО.показано.get(i); return v === undefined ? mem.u16(UNITS + i + U.Y) : (v & 0xffff); };

function вернутьПозиции() {
  const п = ПЛАВНО.правки;
  for (let k = 0; k < п.length; k += 3) { mem.w16(UNITS + п[k] + U.X, п[k + 1]); mem.w16(UNITS + п[k] + U.Y, п[k + 2]); }
  п.length = 0;
}

/** Кадр: посчитать ввод, нарисовать сцену или экран оболочки, сверху положить наши наложения. */
function present(full = true) {
  eng.vram = fb.px;
  // Сглаженные позиции держим до конца кадра, а не только на время отрисовки сцены. Раньше их
  // возвращали сразу после rend.drawTick(), и все наложения — номера групп, рамки, маршруты
  // патруля, цепочки приказов — считались по «ступенчатым» координатам шага. Юнит ехал плавно, а
  // циферка над ним дёргалась. Возврат теперь в finally: до него доживают все наложения, а любой
  // выход из функции всё равно вернёт настоящие координаты.
  let правили = false;
  try {
    if (shell.screen === 'game') {
      if (performance.now() < (shell.guardUntil || 0)) drainMouse(mem);     // хвост нажатия, которым закрыли экран оболочки
      else F[0x1133c](eng);
      F[0x12acd](eng); F[0x10d44](eng); F[0x12be6](eng);                    // прокрутка, клавиши, форма курсора
      // Позиция вывода курсора в оригинале обновлялась драйвером мыши; в порту она меняется только
      // при смене формы — а над панелью форма постоянна, и указатель «застревал». Двигаем сами.
      syncCursor(mem);
      наПаузеЖивём();
      checkMission();
      правили = full ? сгладить() : false;
      try { if (full) rend.drawTick(); else { подсказкаПредмета(); call(eng, 0x299b4, {}); } }
      catch (e) { say(t('рендер: ') + e.message); running = false; return; }
    } else {
      shell.frame();
    }
  drawBrief();                                                            // задание поверх кадра
    fb.pal.set(mem.b.subarray(PAL, PAL + 768));
    fb.blitTo(img); ctx.putImageData(img, 0, 0);
    if (briefPage >= 0) return;
    // Отдалённая карта поверх сцены. Наложения (рамки, планы, отладка ИИ) считают координаты по
    // обычному масштабу, поэтому при отдалении их не рисуем — иначе линии уезжают мимо карты.
    if (показатьЗум()) { рисоватьКрая(); рисоватьБуквыКоманд(); drawЖест(); drawКруг(); drawPause(); drawToasts(); return; }
    рисоватьКрая();
    // Наложения рисуются ПОСЛЕ вывода кадра — иначе кадр их затирает. Линия приказа и круговое
    // меню стояли выше по коду и не появлялись вовсе, хотя состояние у них было верное.
    drawHover(); drawGroups(); рисоватьОтряды(); рисоватьСводкуЗрителя(); рисоватьБуквыКоманд(); рисоватьКамикадзе(); drawPatrol(); drawOrderQueue(); drawQueue(); drawPlans(); drawAI(); drawMarker(); drawЖест(); drawКруг(); drawPause(); drawToasts();
  } finally { if (правили) вернутьПозиции(); }
}
/** Цикл кадров браузера: решает, рисовать ли сцену заново, и следит, тянет ли машина сглаживание. */
/** Подогнать кадр под окно браузера. Дёшево: почти всегда размер тот же и мы сразу выходим. */
function следитьЗаКадром() {
  const н = желаемыйКадр();
  // Порог в клетку: без него кадр пересобирался бы от любого дрожания раскладки на пиксель,
  // а пересборка — это новая канва, новый ImageData и полная перерисовка.
  if (Math.abs(н.ш - ШИРОКО.ш) >= 32 || Math.abs(н.в - ШИРОКО.в) >= 32) задатьКадр(н.ш, н.в);
}
addEventListener('resize', () => { try { следитьЗаКадром(); } catch {} });

function frame(t) {
  requestAnimationFrame(frame);
  try { следитьЗаКадром(); } catch (e) { ШИРОКО.вкл = false; }
  stickStep();                                                       // прокрутка карты стиком
  // Со сглаживанием сцену надо рисовать чаще, чем идут шаги игры, иначе промежуточных позиций не
  // видно. Но каждый кадр экрана — это перебор, особенно на 120 Гц: полная отрисовка сцены стоит
  // 2-3 мс, и на поздних картах вкладка начинала есть заметную долю процессора и дёргаться.
  // 22 мс — это ~45 кадров в секунду: движение уже плавное, а работы вдвое меньше.
  // Порог «машина не тянет» тоже строже прежнего: пять дорогих кадров подряд, и возвращаемся к
  // обычным 25 кадрам, а не ждём двадцати.
  const плавноМожно = ПЛАВНО.вкл && shell.screen === 'game' && running && !shell.paused && ПЛАВНО.дорого < 5;
  const плавно = плавноМожно && t - lastScene >= ПЛАВНО_МС;
  const full = shell.screen !== 'game' || плавно || t - lastScene >= SCENE_MS;
  if (full) lastScene = t;
  const t0 = плавно ? performance.now() : 0;
  present(full);
  if (плавно) ПЛАВНО.дорого = performance.now() - t0 > 6 ? ПЛАВНО.дорого + 1 : 0;
}
requestAnimationFrame(frame);
// Ускорение втрое. Шаг симуляции остаётся тем же — просто делаем три шага за такт вместо одного.
// В настоящей сетевой партии выключено: там темп задаёт локстеп, и уехавший вперёд игрок сломает
// сверку хешей. В скирмише (локальный канал, живой человек один) ускорять можно.
let ускорение = 1;
/** Ускорение ×3 доступно везде, кроме настоящей сетевой партии: там темп задаёт локстеп. */
const ускорениеМожно = () => !net?.активна || net.локальная;
setInterval(() => {
  if (playing) return driveReplay();
  const раз = (ускорение > 1 && ускорениеМожно()) ? ускорение : 1;
  for (let k = 0; k < раз; k++) {
    if (net?.активна) { if (!k) запомнитьПозиции(); net.тик(!running || shell.paused || shell.screen !== 'game'); continue; }
    if (!running || shell.screen !== 'game') return;
    // На паузе шагаем только один раз и только когда на паузе что-то приказали.
    if (shell.paused) {
      if (шаговПаузы <= 0 || k) return;
      // ФЛАГ ГАСИМ ПОСЛЕ ШАГА, А НЕ ДО. Выкладывание кармана приказов живёт ВНУТРИ шага (0x1419e)
      // и смотрит как раз на этот флаг: пока он сбрасывался раньше вызова, условие внутри шага
      // всегда было ложным, карман не раскрывался, и приказ, отданный на паузе, не доходил
      // никогда. Владелец: «во время паузы не реагируют на команды; тик происходит, но команда,
      // видимо, в очередь не встаёт» — и то же самое с переключателями HP/OP/DP/MP/VP.
      запомнитьПозиции();
      вШаге = true; eng.timer++; eng.tick(); вШаге = false;
      шаговПаузы--;
      rec.mark(mem.u32(G.step), mem);
      условияШага();
      // И сразу перерисовываем: на паузе обычный цикл отрисовки стоит, а владелец ждёт, что
      // нажатие отобразится немедленно — «я хочу нажать, и чтобы оно сработало и прям
      // отобразилось». Кнопка прокачки перерисовывает себя внутри шага, но в кадр это попадёт
      // только при следующей отрисовке.
      rend.drawFull();
      return;
    }
    if (!k) запомнитьПозиции();
    вШаге = true; eng.timer++; eng.tick(); вШаге = false;
    // Порядок важен и должен совпадать с просмотром (replayStep): сперва контрольный хеш, потом
    // цель миссии. Проверка досчитывает суммы еды, и если снять хеш после неё, запись и партия
    // будут считать его в разных состояниях.
    rec.mark(mem.u32(G.step), mem);
    условияШага();                                    // цель миссии — один раз на шаг, как при просмотре
  }
}, 55);
const fast3Btn = document.getElementById('fast3');
/** Подтянуть вид кнопки ×3 под текущее состояние и доступность. */
function обновитьУскорение() {
  fast3Btn.classList.toggle('on', ускорение > 1);
  fast3Btn.disabled = !ускорениеМожно();
  // Три положения (владелец: «кнопку сделай до ×10, третье нажатие»): ×1 → ×3 → ×10 → ×1.
  fast3Btn.textContent = ускорение >= 10 ? '×10' : '×3';
  fast3Btn.title = ускорение > 1 ? t('скорость ×{n}: включена', { n: ускорение }) : t('ускорить игру втрое; в сетевой партии недоступно');
  const лаб = document.getElementById('labfast'); if (лаб) лаб.textContent = fast3Btn.textContent;
}
fast3Btn.onclick = () => {
  if (!ускорениеМожно()) return say(t('в сетевой партии нельзя'));
  ускорение = ускорение === 1 ? 3 : ускорение === 3 ? 10 : 1;
  say(ускорение > 1 ? t('скорость ×{n}', { n: ускорение }) : t('обычная скорость'));
  обновитьУскорение(); cv.focus();
};
обновитьУскорение();

// Демо-схватка «трое на Ashfall»: состояние объявлено здесь, потому что проверки условий ниже
// обращаются к нему раньше, чем выполнится его прежнее место (см. запуститьБой).
const бой = { вкл: false, состав: [], места: [], карта: 100 };

// Условия миссии. В оригинале это часть главного цикла (0x10143): проверка на шагах, кратных 32,
// и на каждом кадре, пока код исхода уже выставлен. Сам шаг симуляции 0x17e1c её не делает —
// поэтому раньше ни победы, ни поражения не наступало.
/**
 * Обработчик цели миссии — РОВНО один раз на шаг, кратный 32. Живёт рядом с шагом, а не в кадре.
 *
 * Раньше его звал кадр, и это давало расхождение записи с партией. Кадров 60 в секунду, шагов 18:
 * на каждый шаг, кратный 32, проверка приходилась ТРИ-ЧЕТЫРЕ раза (замерено), а при просмотре —
 * один. Обработчик цели не только читает: он ведёт свои счётчики и подкрепления, поэтому лишние
 * вызовы двигали партию не туда, и свежая запись кампании расходилась с собственной сверкой на
 * первой же контрольной точке. При ускорении ×3 была и обратная беда: за такт проходило три шага,
 * и нужный шаг мог быть пропущен вовсе.
 *
 * В сетевой партии и скирмише условия другие (последний выживший) — их по-прежнему ведёт локстеп.
 */
function условияШага() {
  if (!running || net?.активна) return;
  if (сцена && сцена.безВрага) return;                                  // учебная сцена — не миссия
  // Сцена «трое»: мы зритель, своих войск у нас нет вовсе, и штатная проверка условий объявила бы
  // поражение на первом же шаге. Смотрим до конца, чем кончится у них между собой.
  if (бой.вкл) return;
  if ((mem.u32(G.step) & 0x1f) !== 0) return;
  try { call(eng, 0x17728, {}); } catch (e) { say(t('условия миссии: ') + e.message); }
}
function checkMission() {
  if (!running) return;
  if (бой.вкл) return;                                                  // сцена «трое» — зритель, исхода у нас нет
  // Учебная сцена в просмотре — не миссия. Соперника в ней может не быть вовсе, и проверка условий
  // объявляет победу на первом же кадре: просмотр обрывался на нулевой секунде.
  if (playing && playing.сцена) return;
  if (сцена && сцена.безВрага) return;
  if (net?.активна) { if ((mem.u16(G.step) & 0x1f) === 0) net.проверитьКонец(); return; }   // без сценарных условий: последний выживший
  const end = mem.u8(G.endcode);                                        // 1 поражение, 2 победа
  if (!end) return;
  if (playing) { endPlayback(); return; }                               // в просмотре исход не ведёт в оболочку
  running = false; say(end === 2 ? 'victory' : 'defeat');
  saveReplay(end === 2 ? 'victory' : 'defeat');                         // пишем и победу, и поражение
  shell.finish(end);
}

// ---- экранные кнопки (телефон): кнопка мыши, полный экран
function markButton(b) { for (const el of document.querySelectorAll('[data-mb]')) el.classList.toggle('on', +el.dataset.mb === b); }
for (const el of document.querySelectorAll('[data-mb]')) el.onclick = () => { input.touchButton = +el.dataset.mb; markButton(input.touchButton); };
markButton(0);
// ---- кнопка «тираннозавр»: ставит юнита типа 14 в центр экрана (отладочная, не из оригинала).
// Проверка места — та же, что у движка в 0x1e609 для наземного юнита: тайл в пределах карты,
// проходимый по таблице 0x3183c и никем не занятый в сетке BI.
const DINO = 14, BG_GRID = 0xf6e74, BI_GRID = 0x10ce74, TILE_INF = 0x3183c;
let marker = null;                                   // { x, y, ok, t0 } — отметка на карте
/** Можно ли поставить наземного юнита в эту точку мира: тайл проходим, ничего не занято. */
function canPlace(wx, wy) {
  const tx = wx >>> 5, ty = wy >>> 5;
  if (tx >= mem.u32(G.mapW) || ty >= mem.u32(G.mapH)) return false;
  const bg = mem.u16(BG_GRID + ty * 512 + tx * 2);
  if (bg & 0xf800) return false;                     // крупный объект (дерево, скала)
  if ((mem.u8(TILE_INF + bg) & 1) === 0) return false;   // непроходимый тайл (вода, обрыв)
  return (mem.u8(BI_GRID + tx + ty * 256) & 0xfc) === 0; // клетка занята другим юнитом
}
/** Дикое зверьё в движке — владелец 8 и слот 8 (так лежат все звери карт). Раньше тираннозавр
 *  создавался с владельцем-человеком и слотом его племени и становился нашим юнитом; владелец:
 *  «должен генерироваться просто как обычный зверь, как гиены и собаки, которые не относятся ни к
 *  какой расе, со своей логикой агрессии». С владельцем 8 он живёт по правилам дикого зверя:
 *  стережёт свой выпас (±3 клетки от места рождения, 0x1caf0), бросается на всех в радиусе
 *  нападения, а убитый возрождается на той же клетке (0x18058 → 0x1cfcb). */
const ДИКИЙ = 8;
const создатьТираннозавра = (x, y) => call(eng, 0x1caf0, { eax: DINO | (ДИКИЙ << 8), ecx: ДИКИЙ, edx: x, ebx: y });
/** Поставить тираннозавра в центр экрана (отладочная кнопка 🦖, в оригинале такого нет). */
function spawnDino() {
  if (playing) { say(t('идёт просмотр реплея')); return; }
  if (net?.активна) { say(t('в сетевой партии нельзя')); return; }
  if (shell.screen !== 'game' || !running) { say(t('только в игре')); return; }
  const wx = (mem.u32(0x31ae8) + (mem.u32(0x488c4) >> 1)) & ~31;   // центр видимой части карты
  const wy = (mem.u32(0x31aec) + 240) & ~31;
  const ok = canPlace(wx, wy);
  marker = { x: wx, y: wy, ok, t0: performance.now() };
  if (!ok) { say(t('здесь нельзя: занято или непроходимо')); return; }
  say(t('тираннозавр…'));
  setTimeout(() => {
    if (!canPlace(wx, wy)) { say(t('место занято')); marker = { x: wx, y: wy, ok: false, t0: performance.now() }; return; }
    const r = создатьТираннозавра(wx, wy);
    if (!(r && r.cf)) rec.event(mem.u32(G.step), Replay.KIND_DINO, wx, wy);
    say(t(r && r.cf ? 'нет места в списке юнитов' : 'тираннозавр на месте'));
  }, 1000);
}
document.getElementById('dino').onclick = spawnDino;

// Брахиозавр (тип 15) убран из игры по решению владельца 27.09.2026: кнопки 🦕 и ссылки ?brachio=1 больше нет,
// кадры beasts.bin не грузятся. Генератор кадров (tools/пак_зверей.py, js/port/новые_звери.js) остался в репозитории.

// ---- ТЕСТОВАЯ СЦЕНА ДЕМОНА: ссылка ?demon=1 (владелец 04.10.2026: «дай управлять им и дай зверей — разных,
// чтобы их убить и чтобы самому помереть»). Демон — тип 18, в оригинале не нарисован; кадры наши, из 3D-модели
// (out/новые_звери/модель, tools/пак_зверей.py). Как партия пошла: демон НАШ (владелец и слот человека — его
// можно выделять и водить), вокруг на 7–11 клетках дикое зверьё (владелец 8: стережёт выпас, нападает, убитый
// возрождается — можно драться сколько угодно). Только в этой вкладке и только по ссылке; в запись партии
// появление не пишется, такая запись проигрывается без демона.
const ДЕМОН = 18;
const ЗВЕРИ_ТЕСТА = [14, 19, 20, 21, 22, 23, 23, 9];      // тираннозавр, мамонт, носорог, тигр, леопард, 2 пса, раптор
function нашСлот() {
  const мой = mem.u8(G.humanOwner);
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT))
    if (!(mem.u8(UNITS + i + U.FLAGS5B) & 1) && mem.u8(UNITS + i + U.OWNER) === мой) return mem.u8(UNITS + i + U.SLOT);
  return мой;
}
/** Свободная клетка на кольце r вокруг (x0, y0), начиная с угла угол0 (радианы); null — нет. */
function клеткаНаКольце(x0, y0, r, угол0) {
  for (let k = 0; k < 24; k++) {
    const a = угол0 + k * Math.PI / 12;
    const x = (x0 + Math.round(Math.cos(a) * r) * 32) & ~31, y = (y0 + Math.round(Math.sin(a) * r) * 32) & ~31;
    if (x >= 0 && y >= 0 && canPlace(x, y)) return { x, y };
  }
  return null;
}
// ?bronto=1 — то же для бронтозавра (тип 15, кадры из 3D-модели), можно вместе с ?demon=1.
const ТЕСТ_ЗВЕРИ = [...(new URLSearchParams(location.search).get('demon') ? [ДЕМОН] : []), ...(new URLSearchParams(location.search).get('bronto') ? [15] : [])];
if (ТЕСТ_ЗВЕРИ.length) {
  Ввод.СВОЙ_ДЕМОН.вкл = true;            // приказы своему демону/бронтозавру — только на этой странице
  const ждём = setInterval(() => {
    if (shell.screen !== 'game' || !running || playing) return;
    clearInterval(ждём);
    if (!НовыеЗвери.есть()) { say('нет кадров демона (data/beasts.bin)'); return; }
    const мой = mem.u8(G.humanOwner);
    let у = 0;
    for (let i = mem.u32(G.unitHead); i && !у; i = mem.u32(UNITS + i + U.NEXT))
      if (!(mem.u8(UNITS + i + U.FLAGS5B) & 1) && mem.u8(UNITS + i + U.OWNER) === мой && mem.u8(UNITS + i + U.TYPE) < 0x1a) у = i;
    const x0 = у ? mem.u16(UNITS + у + U.X) & ~31 : (mem.u32(0x31ae8) + 320) & ~31;
    const y0 = у ? mem.u16(UNITS + у + U.Y) & ~31 : (mem.u32(0x31aec) + 240) & ~31;
    let где = null;
    for (let r = 2; r <= 5 && !где; r++) где = клеткаНаКольце(x0, y0, r, 0);
    if (!где) { say('некуда поставить демона'); return; }
    for (const [k, тип] of ТЕСТ_ЗВЕРИ.entries()) {
      const м = k === 0 ? где : клеткаНаКольце(где.x, где.y, 4, Math.PI);
      if (!м) continue;
      const r = call(eng, 0x1caf0, { eax: тип | (мой << 8), ecx: нашСлот(), edx: м.x, ebx: м.y });
      if (r && r.cf) { say(t('нет места в списке юнитов')); return; }
    }
    let зверей = 0;
    ЗВЕРИ_ТЕСТА.forEach((тип, k) => {
      const м = клеткаНаКольце(где.x, где.y, 7 + (k % 3) * 2, k * Math.PI * 2 / ЗВЕРИ_ТЕСТА.length);
      if (!м) return;
      const z = call(eng, 0x1caf0, { eax: тип | (ДИКИЙ << 8), ecx: ДИКИЙ, edx: м.x, ebx: м.y });
      if (!(z && z.cf)) зверей++;
    });
    // камера на демона
    mem.w32(0x31ae8, Math.max(0, Math.min(mem.u32(0x31b00), (где.x - 256) & ~31)));
    mem.w32(0x31aec, Math.max(0, Math.min(mem.u32(0x31b04), (где.y - 240) & ~31)));
    rend.drawFull?.();
    const кто = ТЕСТ_ЗВЕРИ.map(т => т === ДЕМОН ? 'демон' : 'бронтозавр').join(' и ');
    say(`${кто} на месте, зверей вокруг: ${зверей}`); toast(`${кто} на месте, зверей вокруг: ${зверей}`);
  }, 500);
}

// ---- задание миссии поверх партии.
// В оригинале посмотреть текст задания во время игры было нельзя: колесо игрового меню — это
// семь секторов (save, load, exit, restart, option, pause, center), а F1..F4 ведут в подсказку
// (пак 03), сетевой экран, загрузку и опции. Текст брифинга (пак 09, запись 80 + миссия*8 +
// племя) читался только на экране перед миссией. Поэтому показываем его сами — тем же шрифтом
// и по той же разметке, что и брифинг, поверх кадра и с паузой, чтобы читать было не страшно.
const BRIEF_OV = { x: 100, y: 46, lh: 22, lines: 18 };
const briefBtn = document.getElementById('brief');
let briefPage = -1, briefPaused = false;
/** Строки задания: разобранный брифинг оболочки или заглушка, если пак ещё не доехал. */
function briefLines() { return shell.brief && shell.brief.length ? shell.brief : [t('(текст задания не загружен)')]; }
/** Открыть задание поверх партии, а на повторное нажатие — перелистнуть или закрыть. */
function showBrief() {
  if (shell.screen !== 'game') return;                                    // вне партии показывать нечего
  if (briefPage < 0) { try { shell.loadBrief(); } catch {} briefPaused = shell.paused; shell.paused = true; briefPage = 0;
    tellStory(); }                                                        // задание читается и вслух
  else if ((briefPage + 1) * BRIEF_OV.lines < briefLines().length) briefPage++;
  else return hideBrief();
  updBriefBtn();
}
/** Убрать накладку задания и вернуть паузу в то состояние, в каком она была до неё. */
function hideBrief() {
  if (briefPage < 0) return;
  briefPage = -1; shell.paused = briefPaused; updBriefBtn(); tellStory();
  try { rend.drawFull(); } catch {}                                       // накладка затёрла кадр — рисуем заново
}
/** Подпись на кнопке brief: номер страницы, если страниц больше одной. */
function updBriefBtn() {
  const n = Math.ceil(briefLines().length / BRIEF_OV.lines);
  briefBtn.classList.toggle('on', briefPage >= 0);
  briefBtn.textContent = briefPage >= 0 && n > 1 ? `brief ${briefPage + 1}/${n}` : 'brief';
}
/** Нарисовать страницу задания шрифтом игры поверх кадра и перенести кадр на канву. */
function drawBrief() {
  if (briefPage < 0) return;
  if (shell.screen !== 'game') return hideBrief();                        // ушли в меню — накладку снимаем
  fill(mem, 0);
  const lines = briefLines(), from = briefPage * BRIEF_OV.lines;
  for (let i = 0; i < BRIEF_OV.lines && from + i < lines.length; i++)
    // Шрифт 1 обязателен: кириллицу дописывает в него js/ui/locale.js, в нулевом её нет, и
    // русский текст печатался вопросительными знаками. Оболочка на экране брифинга печатает им же.
    text(eng, lines[from + i], BRIEF_OV.x, BRIEF_OV.y + i * BRIEF_OV.lh, { font: 1, col: 0xf8 });
  text(eng, briefPage + 1 < Math.ceil(lines.length / BRIEF_OV.lines) ? 'click / brief - next page' : 'click / brief / esc - close',
       BRIEF_OV.x, 442, { font: 1, col: 0xc4 });
  // Кадр рисуется в закадровый буфер оригинала, а на канву уходит fb.px, куда движок копирует
  // только изменившиеся куски. Накладку он таким не считает, поэтому переносим кадр целиком —
  // построчно, как лежит: смещения строк берём из таблицы 0x122e74.
  // Кадр оболочки (меню, окна) всегда 640×480 и живёт в своём буфере: переносим его в канву как
  // есть, даже если канва сейчас шире — оболочка рисуется до перехода в игру.
  for (let y = 0; y < Math.min(480, fb.h); y++) { const o = FB + mem.u32(ROWS + y * 4); fb.px.set(mem.b.subarray(o, o + Math.min(640, fb.w)), y * fb.w); }
}
briefBtn.onclick = showBrief;

// ---- язык сюжетных текстов: брифинги и описания племён (js/ui/locale.js).
// Выбор языка — выпадающий список (в панели внизу и в лобби), а не кнопка по кругу.
const LANG_FULL = { en: 'English', ru: 'Русский', pl: 'Polski' };
const langSels = [document.getElementById('lang'), document.getElementById('lang2')].filter(Boolean);
/** Заполнить оба выпадающих списка языков (панель партии и лобби). */
function fillLang() { for (const s of langSels) { s.textContent = ''; for (const l of locale.available) { const o = document.createElement('option'); o.value = l; o.textContent = LANG_FULL[l] || LANG_NAME[l] || l; s.appendChild(o); } s.value = locale.lang; } }
/** Подтянуть выбранный язык в списки и перевести интерфейс. */
function updLangBtn() { for (const s of langSels) { s.value = locale.lang; s.title = t('язык'); } применитьЯзык(locale.lang);
  const p = document.getElementById('netp'); if (p && !p.hidden && typeof drawLobby === 'function') drawLobby(); }   // лобби объявлено ниже — только по id
fillLang();
/** Сменить язык сюжетных текстов и интерфейса; брифинг перечитывается на новом. */
function setLang(l) {
  if (!locale.has(l)) return say(t('перевод не загрузился'));
  locale.use(l, mem);
  localStorage.setItem('jw.lang', locale.lang);
  updLangBtn();

  if (shell.screen === 'briefing' || briefPage >= 0) shell.loadBrief();   // перечитать с новым языком
  shell.dirty = true;
  tellStory();
}
for (const s of langSels) s.onchange = () => { setLang(s.value); s.blur(); cv.focus(); };
updLangBtn();

// ---- патрулирование (js/port/patrol.js). Кнопка включает режим курсора: пока он включён, каждый
// щелчок по карте добавляет точку маршрута (до десяти). Второе нажатие кнопки, клавиша V или правая
// кнопка мыши ввод завершают — и отряд идёт по кругу; последняя допустимая точка завершает ввод
// сама. Точки уходят в игру приказами 0x34 (добавить)
// и 0x35 (пошёл) по одному за шаг: «ожидающий приказ» в 0x31acc всего один.
const patrolBtn = document.getElementById('patrolb');
let patrolPts = [], patrolQueue = [], patrolWasArmed = false;
/** Включён ли сейчас режим набора точек патруля (свой курсорный режим поверх оригинала). */
function patrolArmed() { return running && mem.u16(0x31aca) === PATROL_MODE; }
setPatrolHandler((x, y) => {
  if (patrolPts.length >= Patrol.MAX_POINTS) return say(t('патруль: больше {n} точек нельзя', { n: Patrol.MAX_POINTS }));
  patrolPts.push([x, y]);
  // Последняя допустимая точка сама завершает ввод: дальше щёлкать всё равно некуда, и просить
  // за этим ещё одно нажатие кнопки — лишний шаг.
  if (patrolPts.length >= Patrol.MAX_POINTS) { mem.w16(0x31aca, 0); updPatrolBtn(); return; }
  say(t('патруль: точка {a} из {b}, ещё раз «патруль» — готово', { a: patrolPts.length, b: Patrol.MAX_POINTS }));
});
/** Кнопка/клавиша «патруль»: первое нажатие начинает набор точек, второе заканчивает. */
function armPatrol() {
  if (shell.screen !== 'game' || !running) return;
  if (patrolArmed()) mem.w16(0x31aca, 0);          // второе нажатие — конец ввода
  else { patrolPts = []; mem.w16(0x31aca, PATROL_MODE); say(t('патруль: щёлкайте по карте точки маршрута')); }
  updPatrolBtn();
}
/** Ввод закончен: точки уходят приказами, дальше их разбирает js/port/patrol.js. */
function finishPatrol() {
  if (!patrolPts.length) { say(''); return; }
  for (const [x, y] of patrolPts) patrolQueue.push([Patrol.ORDER_POINT, x, y]);
  patrolQueue.push([Patrol.ORDER_GO, patrolPts[0][0], patrolPts[0][1]]);
  say(t('патруль: {n} {w} — пошли', { n: patrolPts.length, w: t(patrolPts.length === 1 ? 'точка' : 'точки') }));
  patrolPts = [];
}
/** Отдаём накопленные приказы по одному за шаг: слот «ожидающего приказа» один на всех. */
function pumpPatrol() {
  if (!patrolQueue.length || !running || shell.screen !== 'game') return;
  if (mem.u8(0x31acc) !== 0xff) return;                       // слот занят другим приказом
  const [code, x, y] = patrolQueue.shift();
  mem.w8(0x31acc, code); mem.w32(0x31ad0, 0); mem.w32(0x31ad4, x); mem.w32(0x31ad8, y);
}
/** Подсветить кнопку патруля и, если режим только что сняли, отправить набранный маршрут. */
function updPatrolBtn() {
  const armed = patrolArmed();
  /** Подсветить кнопку патруля и, если режим только что сняли, отправить набранный маршрут. */
  if (patrolWasArmed && !armed) finishPatrol();               // режим сняли кнопкой, клавишей или ПКМ
  patrolWasArmed = armed;
  patrolBtn.classList.toggle('on', armed);
}
patrolBtn.onclick = armPatrol;

// ---- планы стройки: отметить место, куда пойдёт заказанный строитель (js/port/buildplan.js)
function buildArmed() { return running && mem.u16(0x31aca) === BUILD_MODE; }
/** Включён ли режим отметки места постройки. */
function armBuild(вкл) {
  /** Включить или выключить отметку места: без заказанной постройки включать нечего. */
  if (!running) return;
  if (вкл === false || (вкл === undefined && buildArmed())) { mem.w16(0x31aca, 0); say(''); return; }
  if (видПостройки < 0) { say(t('сначала закажите постройку в Святилище')); return; }
  mem.w16(0x31aca, BUILD_MODE); say(t('отметьте место постройки; правая кнопка — выйти'));
}
setBuildHandler((x, y) => {
  if (видПостройки < 0) return;
  const вл = mem.u8(G.humanOwner);
  const свой = План.список(eng, вл).some(п => Math.abs(п.x - x) < 32 && Math.abs(п.y - y) < 32);
  if (свой) { План.приказСнятия(eng, mem.u32(0x31adc) || 0, вл, x, y); say(t('план снят')); return; }
  План.приказПлана(eng, mem.u32(0x31adc) || 0, вл, видПостройки, x, y);
  // Один заказ — одно место. Раньше режим оставался включённым, и каждый следующий щелчок по
  // карте ставил ещё один пунктирный квадрат: у тестера их набралось с десяток, а строитель
  // был один. Отметил — вышли из режима.
  видПостройки = -1; armBuild(false);
  say(t('место отмечено: строитель придёт сам'));
});

// ---- озвучка сюжета: брифинг стадии и описание племени читаются голосом (js/ui/narration.js).
// Дорожки лежат в out/audio/story/<язык>, имена те же, что у текстов: brief_<стадия>_<племя>,
// tribe_<племя>. Русский и польский читает Gemini, английский — ElevenLabs Flash.
const narr = new Narration(document.getElementById('narr-a'));
const narrBtn = document.getElementById('narr');
/** Подпись и подсветка кнопки озвучки сюжета. */
function updNarrBtn() { narrBtn.classList.toggle('on', narr.on); narrBtn.title = t(narr.on ? 'озвучка сюжета: вкл' : 'озвучка сюжета: выкл'); }
narrBtn.onclick = () => { narr.setOn(!narr.on); updNarrBtn(); tellStory(); };
/** Подпись и подсветка кнопки озвучки. */
updNarrBtn();
/** Что читается вслух прямо сейчас: экран сюжета или накладка задания в партии. */
function storyTrack() {
  const я = locale.lang;                           // дорожки есть на всех трёх языках
  if (briefPage >= 0) return `${я}/brief_${shell.mission}_${shell.tribe}`;   // накладка F2 поверх партии
  if (shell.screen === 'briefing') return `${я}/brief_${shell.mission}_${shell.tribe}`;
  if (shell.screen === 'clan') return `${я}/tribe_${shell.tribe}`;
  return null;
}
// Зовётся и на смене экрана, и каждый кадр: экран меняют несколько путей (goto, toGame,
// startMission, накладка F2), и рассказ должен обрываться сразу, как только сюжетный экран ушёл.
function tellStory() {
  const дорожка = storyTrack();
  if (дорожка) narr.play(дорожка); else narr.stop();
  music.duck(!!дорожка && narr.on);               // под рассказ музыка уходит на задний план
}
narr.el.addEventListener('ended', () => music.duck(false));
shell.onScreen = () => tellStory();


// ---- пауза: кнопка, клавиша P и заметный признак на экране.
// В оригинале пауза есть только пунктом игрового меню (колесо, сектор Pause), а клавиша P
// (скан-код 0x19 → 0x20bec) в одиночной игре ничего не делает — там это сетевой экран.
// Заметный признак на экране нужен потому, что замерший кадр иначе не отличить от зависания.
const pauseBtn = document.getElementById('pause');
/**
 * Пауза партии. В сетевой игре она общая: свою ставим и объявляем остальным.
 * @param {boolean} on   поставить или снять
 * @param {boolean} изСети пришла от соперника — обратно её не объявляем
 */
function setPaused(on, изСети = false) {
  if (shell.screen !== 'game' || !running) return;
  if (!изСети && net?.активна && !!on !== shell.paused) net.пауза(!!on);   // сетевая партия: пауза общая
  shell.paused = !!on;
  pauseBtn.classList.toggle('on', shell.paused);
  pauseBtn.textContent = shell.paused ? '▶' : '⏸';
  pauseBtn.title = t(shell.paused ? 'продолжить (P)' : 'пауза (P)');
}
pauseBtn.onclick = () => setPaused(!shell.paused);
// ---- короткие игровые уведомления (сдача, выход): строки над нижним краем сцены, тают за 6 с
const toasts = [];
/** Показать короткое уведомление над нижним краем сцены (живёт 6 секунд, больше четырёх не копим). */
function toast(текст) { toasts.push({ текст, до: performance.now() + 6000 }); if (toasts.length > 4) toasts.shift(); }
/** Нарисовать накопленные уведомления, гася их прозрачностью в последнюю секунду. */
function drawToasts() {
  const now = performance.now(); while (toasts.length && toasts[0].до < now) toasts.shift();
  if (!toasts.length || shell.screen !== 'game' || briefPage >= 0) return;
  ctx.save(); ctx.font = 'bold 13px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let y = cv.height - 34 - (toasts.length - 1) * 20;
  for (const т of toasts) {
    const a = Math.min(1, (т.до - now) / 1000); const w = ctx.measureText(т.текст).width + 14;
    ctx.fillStyle = `rgba(8,6,5,${0.72 * a})`; ctx.fillRect(8, y - 10, w, 20);
    ctx.fillStyle = `rgba(252,252,72,${0.95 * a})`; ctx.fillText(т.текст, 15, y + 1); y += 20;
  }
  ctx.restore();
}
// На паузе игра должна оставаться ЖИВОЙ для игрока: осмотреться, подвинуть карту, выделить отряд,
// раздать приказы и заказать юнитов. Просьба владельца дословно: «когда игра на паузе, перестают
// работать стрелки и горячие клавиши… чтобы можно было посмотреть, сориентироваться, раздать
// команды по-быстрому и стрелочками карту двигать».
//
// Ломалось это в двух разных местах, и оба — из-за остановленного времени:
//   • прокрутка (0x12acd) защищена от дребезга отметкой «в этот тик уже двигали»: она сравнивает
//     0x33860/0x33862 с таймером движка 0x46c. На паузе таймер стоит, отметка навсегда совпадает,
//     и после первого шага стрелки перестают двигать карту вовсе;
//   • клики (выделение, приказ, портрет в панели) кладутся в «ожидающий приказ» и разбираются
//     раздатчиком 0x1419e, а он живёт ВНУТРИ шага симуляции. Шага нет — разбора нет, и накопиться
//     может только один клик, остальные затираются.
// Поэтому на паузе сами сдвигаем отметку прокрутки (раз в три кадра — это примерно тот же темп,
// что и в игре) и сами зовём раздатчик. Симуляция при этом не идёт: приказы ложатся юнитам в поле
// «приказ» и начнут выполняться, как только паузу снимут.
let кадрПаузы = 0;
function наПаузеЖивём() {
  if (!shell.paused || !running || playing) return;
  if ((кадрПаузы++ % 3) === 0) {
    const т = (mem.u16(0x46c) + 1) & 0xffff;
    mem.w16(0x33860, т); mem.w16(0x33862, т);                 // «в этом тике ещё не двигали»
  }
  try { F[0x1419e](eng); } catch (e) { say(t('приказ: ') + e.message); }
}
/** Табличка «ПАУЗА» вверху сцены: замерший кадр иначе не отличить от зависшей игры. */
function drawPause() {
  if (!shell.paused || shell.screen !== 'game' || briefPage >= 0) return;
  const vw = mem.u32(0x488c4) || 640, w = 132, h = 26, x = (vw - w) >> 1;
  ctx.save();
  ctx.fillStyle = 'rgba(8,6,5,.72)'; ctx.fillRect(x, 8, w, h);
  ctx.strokeStyle = 'rgba(252,252,72,.85)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, 8.5, w - 1, h - 1);
  ctx.fillStyle = 'rgba(252,252,72,.95)';
  ctx.font = 'bold 14px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t('ПАУЗА'), x + w / 2, 8 + h / 2 + 1);
  ctx.restore();
}

// Пока задание открыто, клик по полю листает его, а не отдаёт приказ: слушатель в фазе
// перехвата отрабатывает раньше того, что вешает js/input.js на ту же канву.
cv.addEventListener('pointerdown', (e) => {
  if (briefPage < 0) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); showBrief();
}, true);

// Поиск пути в игре всегда astar — решение владельца, 2026-09-09: режим отлажен и работает,
// остальные два остаются только для сравнения на стенде /jw/path и для проигрывания старых
// записей, где в заголовке лежит другой режим. Переключателя в игре больше нет, залежавшийся
// выбор в localStorage игнорируется (был случай, когда он тихо возвращал orig и юниты тупили).
localStorage.removeItem('jw.path');
setPathMode(new URLSearchParams(location.search).get('path') || 'astar');
const pathBtn = document.getElementById('path');
/** Подпись на отладочной кнопке выбора поиска пути (в игре он всегда astar). */
const showPath = () => { if (pathBtn) pathBtn.textContent = 'path: ' + pathMode(); };
showPath();

// Прокрутка карты колесом, двумя пальцами и стиком. Границы те же, что у движка (0x1b3df):
// 0..карта*32 − размер окна просмотра.
// ВАЖНО: камера обязана быть кратна 32. Отрисовка тайлов (0x242d4) берёт строку сетки как
// `camY * 0x10 + (camX >> 4)`, и при camY не кратном 32 смещение перестаёт быть кратным длине
// строки (0x200) — карта уезжает на десятки тайлов, экран выглядит чёрным. Поэтому дробные
// пиксели копим здесь и отдаём движку только целыми клетками, ровно как его собственная
// прокрутка (0x20 за срабатывание).
let scrollAccX = 0, scrollAccY = 0;
/** Сдвинуть камеру на пиксели, накапливая дробь: движку камеру можно отдавать только клетками по 32. */
function scrollBy(dx, dy) {
  if (shell.screen !== 'game' || !running) return;
  if (следимЗаОтрядом) слежениеВыкл(t('колесо или тачпад'));
  scrollAccX += dx; scrollAccY += dy;
  const stepX = Math.trunc(scrollAccX / 32) * 32, stepY = Math.trunc(scrollAccY / 32) * 32;
  if (!stepX && !stepY) return;
  scrollAccX -= stepX; scrollAccY -= stepY;
  const maxX = Math.max(0, (mem.u32(0x31af8) << 5) - mem.u32(0x488c4));
  const maxY = Math.max(0, (mem.u32(0x31afc) << 5) - mem.u32(0x488c8));
  const x = Math.max(0, Math.min(maxX, (mem.u32(0x31ae8) + stepX) | 0));
  const y = Math.max(0, Math.min(maxY, (mem.u32(0x31aec) + stepY) | 0));
  mem.w32(0x31ae8, x & ~31); mem.w32(0x31aec, y & ~31);
}
/** Колесо мыши и два пальца на тачпаде — прокрутка карты. */
const onWheel = (e) => {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 320 : 1;
  if (!e.deltaX && !e.deltaY) return;
  e.preventDefault();
  scrollBy(e.deltaX * k, e.deltaY * k);
};
cv.addEventListener('wheel', onWheel, { passive: false });
document.getElementById('pad').addEventListener('wheel', onWheel, { passive: false });

// Прокрутка карты кнопками: шлём скан-коды стрелок, дальше работает родная прокрутка движка
// (0x12acd) со своей скоростью из опций.
for (const el of document.querySelectorAll('#dpad button')) {
  const code = el.dataset.key;
  const down = e => { e.preventDefault(); el.classList.add('on'); input.holdKey(code, true); };
  const up = () => { el.classList.remove('on'); input.holdKey(code, false); };
  el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
}

// ---- наведение на юнита: показать его здоровье, ничего не выделяя.
// Юнита под курсором движок ищет сам каждый кадр (0x130ae по сетке занятости). Полоску рисуем
// ровно там же и такой же, как родная у выделенного юнита (0x23f44): коробка берётся из фигуры
// 0x3d1b8[тип] со смещением +0x60, цвет рамки — 0x3054d[владелец], цвет заливки — 0x3e3d8[HP].
// Отличие одно: рисуем полупрозрачно, чтобы подсказка не спорила с настоящим выделением.
const rgbOf = (i) => `rgb(${fb.pal[i * 3]},${fb.pal[i * 3 + 1]},${fb.pal[i * 3 + 2]})`;
// Все наложения (рамки, полоски здоровья, цели ИИ, маршруты) должны резаться по КАДРУ СЦЕНЫ, а не
// по всей канве. Ширину уже резали правильно — 0x488c4, там справа панель; а по высоте стоял
// cv.height, и юнит, оказавшийся НИЖЕ отрисованной сцены, всё равно получал рамку с пустой
// полоской здоровья (жалоба владельца про уменьшенный зум). Высота кадра — 0x488c8.
function клипСцены() {
  const vw = mem.u32(0x488c4) || cv.width, vh = mem.u32(0x488c8) || cv.height;
  ctx.beginPath(); ctx.rect(0, 0, vw, Math.min(vh, cv.height)); ctx.clip();
}
/** Полупрозрачная рамка и полоска здоровья у юнита под курсором (выделенных рисует сама игра). */
function drawHover() {
  if (shell.screen !== 'game' || !running) return;
  let u = 0; try { u = (F[0x130ae](eng).esi >>> 0); } catch { return; }
  if (!u) return;
  if (mem.u8(UNITS + u + U.F07) & 0x80) return;              // выделенных рисует сама игра
  const hp = mem.u8(UNITS + u + U.HP), max = mem.u8(UNITS + u + U.HPMAX);
  if (!max || mem.u8(UNITS + u + U.STATE) === 0x60) return;   // мёртвым полоска не нужна
  const type = mem.u8(UNITS + u + U.TYPE);
  let sh = mem.u32(0x3d1b8 + type * 4); if (sh >= 0x110000) sh -= 0x100000;
  if (!sh) return;
  const rdx = mem.i32(sh + 0x60), rdy = mem.i32(sh + 0x64), rw = mem.i32(sh + 0x68), rh = mem.i32(sh + 0x6c);
  if (rw <= 2 || rh <= 0) return;
  const rx = юX(u) - mem.u32(0x31ae8) + rdx;
  const ry = юY(u) - mem.u32(0x31aec) + rdy;
  const vw = mem.u32(0x488c4), vh = mem.u32(0x488c8) || 480;
  if (rx + rw < 0 || ry + rh < 0 || rx > vw || ry + rh > vh) return;   // ниже кадра рамку не рисуем вовсе
  const len = Math.floor(((rw - 2) * hp) / max) & 0xff;
  ctx.save();
  // Карта занимает только [0..vw), справа панель. Рамка юнита у самого края вылезала на неё —
  // движок свой текст режет по тому же краю (клип 0x46ffc = vw − 1), режем и мы.
  клипСцены();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = rgbOf(mem.u8(0x3054d + mem.u8(UNITS + u + U.OWNER)));
  ctx.lineWidth = 1; ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
  if (len > 0) { ctx.fillStyle = rgbOf(mem.u8(0x3e3d8 + hp)); ctx.fillRect(rx + 1, ry + 1, len, rh - 2); }
  ctx.restore();
}

// ---- номер группы в углу рамки юнита.
// Группа лежит в младших семи битах того же байта +0x07, где старший бит — «выделен»
// (0x1107b по Ctrl+цифра пишет туда номер, 0x11093 по цифре им же и выбирает). Значения 1..10,
// где 10 — это клавиша «0», ноль означает «без группы». Углы рамки берём из фигуры выделения
// 0x3d1b8[тип]: запись 3 даёт правый край, запись 4 — нижний.
// Маршруты патруля: и те, что уже ходят у выделенных, и те, что игрок сейчас набирает.
// Рисуем поверх кадра, как рамки и номера групп, — в кадровый буфер оригинала не лезем.
// Очередь приказов (Shift): рисуем намеченную цепочку у выделенных — иначе непонятно, что она
// вообще есть. Ломаная от бойца по шагам, кружок с номером на каждом; атака помечается крестом,
// «подобрать» — точкой в центре.
function drawOrderQueue() {
  if (shell.screen !== 'game' || !running || показатьЗум()) return;
  const camX = mem.u32(0x31ae8), camY = mem.u32(0x31aec), vw = mem.u32(0x488c4);
  ctx.save();
  клипСцены();
  ctx.font = 'bold 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (!(mem.u8(UNITS + i + U.F07) & 0x80)) continue;                  // только выделенные
    const шаги = ОчередьПриказов.очередь(eng, i); if (!шаги.length) continue;
    const точки = [[юX(i) + 16 - camX, юY(i) + 16 - camY]];
    for (const ш of шаги) {
      const ц = ш.вид === ОчередьПриказов.ШАГ_АТАКА && ш.цель && !(mem.u8(UNITS + ш.цель + U.FLAGS5B) & 1)
        ? [юX(ш.цель) + 16 - camX, юY(ш.цель) + 16 - camY]
        : [(ш.x << 5) + 16 - camX, (ш.y << 5) + 16 - camY];
      точки.push(ц);
    }
    ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,220,255,.75)';
    ctx.beginPath(); ctx.moveTo(точки[0][0], точки[0][1]);
    for (const [x, y] of точки.slice(1)) ctx.lineTo(x, y);
    ctx.stroke(); ctx.setLineDash([]);
    точки.slice(1).forEach(([x, y], k) => {
      const ш = шаги[k];
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = ш.вид === ОчередьПриказов.ШАГ_АТАКА ? 'rgba(255,120,120,.95)' : 'rgba(120,220,255,.9)';
      ctx.stroke();
      if (ш.вид === ОчередьПриказов.ШАГ_ВЗЯТЬ) { ctx.fillStyle = 'rgba(120,220,255,.9)'; ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(0,0,0,.85)';
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(String(k + 1), x + dx, y + dy + 9);
      ctx.fillStyle = 'rgba(200,240,255,.95)'; ctx.fillText(String(k + 1), x, y + 9);
    });
  }
  ctx.restore();
}
/** Маршруты патруля: и уже ходящие у выделенных, и тот, что игрок набирает прямо сейчас. */
function drawPatrol() {
  updPatrolBtn();                       // режим мог сняться сам: щелчком по карте или правой кнопкой
  tellStory();                          // и рассказ мог пережить свой экран — обрываем
  pumpPatrol();                         // и накопленные точки пора отдавать в игру
  if (shell.screen !== 'game' || !running) return;
  const camX = mem.u32(0x31ae8), camY = mem.u32(0x31aec), vw = mem.u32(0x488c4);
  ctx.save();
  клипСцены();
  ctx.lineWidth = 1;
  ctx.font = 'bold 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const кольцо = (точки, ярко) => {
    if (!точки.length) return;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = ярко ? 'rgba(252,252,72,.85)' : 'rgba(252,252,72,.5)';
    if (точки.length > 1) {
      ctx.beginPath(); ctx.moveTo(точки[0][0], точки[0][1]);
      for (const [x, y] of точки.slice(1)) ctx.lineTo(x, y);
      if (точки.length > 2) ctx.closePath();                 // три и больше — обход по кругу
      ctx.stroke();
    }
    ctx.setLineDash([]);
    точки.forEach(([x, y], k) => {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = ярко ? 'rgba(252,252,72,.95)' : 'rgba(252,252,72,.7)'; ctx.stroke();
      if (точки.length > 1) {
        ctx.fillStyle = 'rgba(0,0,0,.85)';
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) ctx.fillText(String(k + 1), x + dx, y + dy + 8);
        ctx.fillStyle = 'rgba(252,252,72,.95)'; ctx.fillText(String(k + 1), x, y + 8);
      }
    });
  };
  const видели = new Set();
  for (let i = mem.u32(0x31b6c); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (!(mem.u8(UNITS + i + U.F07) & 0x80)) continue;                 // только выделенные
    const r = Patrol.route(eng, i); if (!r || !r.готов) continue;
    const ключ = r.pts.map(t => t.x + ',' + t.y).join(';');
    if (видели.has(ключ)) continue; видели.add(ключ);
    кольцо(r.pts.map(t => [(t.x << 5) + 16 - camX, (t.y << 5) + 16 - camY]), false);
  }
  кольцо(patrolPts.map(([x, y]) => [x + 16 - camX, y + 16 - camY]), true);   // то, что набирается сейчас
  // Охотничьи угодья: заданный участок — ровной рамкой, тот, что сейчас тянут мышью, — пунктиром.
  const рамка = угодья.тянем && угодья.конец
    ? { x0: Math.min(угодья.тянем.x, угодья.конец.x), y0: Math.min(угодья.тянем.y, угодья.конец.y),
        x1: Math.max(угодья.тянем.x, угодья.конец.x), y1: Math.max(угодья.тянем.y, угодья.конец.y) }
    : угодья.рект;
  // ЗНАЧОК ОХОТЫ над каждым, кто получил этот приказ: «когда отряд такую команду получает, должен
  // быть значок охоты над таким юнитом». Рисуем поверх головы, чтобы с одного взгляда было видно,
  // кто сейчас в охотничьей группе, а кто просто стоит рядом.
  // Рамки отрядов угодий — только у отряда, где кто-то выделен, тонким пунктиром.
  for (const о of охоты) {
    let выделен = false;
    for (const i of о.члены) if (mem.u8(UNITS + i + U.F07) & 0x80) { выделен = true; break; }
    if (!выделен) continue;
    const x = (о.рект.x0 << 5) - camX, y = (о.рект.y0 << 5) - camY;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(120,252,120,.7)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, ((о.рект.x1 - о.рект.x0 + 1) << 5) - 1, ((о.рект.y1 - о.рект.y0 + 1) << 5) - 1);
    ctx.setLineDash([]);
  }
  const вОхотах = охоты.length ? new Set(охоты.flatMap(о => [...о.члены])) : null;
  if ((угодья.рект && образецСлой.вкл) || вОхотах) {
    const охотники = вОхотах ? [...вОхотах, ...(угодья.рект && образецСлой.вкл ? (образецСлой.места || []) : [])]
                    : образецСлой.места && образецСлой.места.length ? образецСлой.места : null;
    for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
      if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
      if (mem.u8(UNITS + i + U.OWNER) !== mem.u8(G.humanOwner) || mem.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
      if (охотники && !охотники.includes(i)) continue;
      const x = mem.u16(UNITS + i + U.X) + 16 - camX, y = mem.u16(UNITS + i + U.Y) - camY;
      // ЛУК РИСУЕМ САМИ, а не символом 🏹. Эмодзи зависит от шрифта системы: там, где цветного
      // шрифта нет (а это и снимки для сайта, и чужие браузеры), вместо значка выходил пустой
      // квадратик, да и цвет у цветного эмодзи не меняется. Своя дуга со стрелой рисуется везде
      // одинаково и принимает нужный цвет.
      const лук = (цвет, толщина) => {
        ctx.strokeStyle = цвет; ctx.lineWidth = толщина; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x, y - 5, 4.5, -Math.PI * 0.62, Math.PI * 0.62); ctx.stroke();   // дуга лука
        ctx.beginPath(); ctx.moveTo(x + 2.2, y - 8.6); ctx.lineTo(x + 2.2, y - 1.4); ctx.stroke(); // тетива
        ctx.beginPath(); ctx.moveTo(x - 4, y - 5); ctx.lineTo(x + 5, y - 5); ctx.stroke();         // стрела
        ctx.beginPath(); ctx.moveTo(x + 2.5, y - 7); ctx.lineTo(x + 5, y - 5); ctx.lineTo(x + 2.5, y - 3); ctx.stroke();
      };
      лук('rgba(0,0,0,.85)', 3);                       // чёрная обводка, чтобы значок читался на траве
      лук('rgba(120,252,120,.95)', 1.4);
    }
  }
  if (рамка) {
    const x = (рамка.x0 << 5) - camX, y = (рамка.y0 << 5) - camY;
    const w = ((рамка.x1 - рамка.x0 + 1) << 5), h = ((рамка.y1 - рамка.y0 + 1) << 5);
    ctx.setLineDash(угодья.тянем ? [6, 4] : []);
    ctx.strokeStyle = 'rgba(120,252,120,.85)'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]); ctx.lineWidth = 1;
  }
  ctx.restore();
}

// Счётчики очереди производства у портретов на странице здания (prodqueue.js): прямоугольники
// кнопок — таблица 0x30d44 (x0,y0,x1,y1), кнопки 2.. — портреты.
function drawQueue() {
  // Страница панели у здания = тип − 0x19: Святилище 1, казарма 2, дом эльфов 6 и так далее.
  // Раньше здесь стояло «страница ровно 1», и счётчик очереди рисовался только у Святилища —
  // у дома эльфов или динозавров его не было видно вовсе, хотя очередь работала.
  if (shell.screen !== 'game' || !running || mem.u8(0x31ae4) < 1) return;
  const s = mem.u32(0x31adc); if (!s || mem.u8(UNITS + s + U.TYPE) < 0x1a) return;
  const q = Очередь.очередь(eng, s); if (!q.length) return;
  ctx.save(); ctx.font = 'bold 11px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  const seen = new Set();
  for (const k of q) { if (seen.has(k)) continue; seen.add(k);
    const b = 0x30d44 + (k + 2) * 8, x1 = mem.u16(b + 4) + СДВИГ_ПАНЕЛИ(), y1 = mem.u16(b + 6), n = q.filter(x => x === k).length;
    const t = '×' + n; const w = ctx.measureText(t).width + 4;
    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(x1 - w - 1, y1 - 13, w + 2, 13);
    ctx.fillStyle = '#ffe27a'; ctx.fillText(t, x1 - 1, y1 - 1); }
  ctx.restore();
}
/** Номер отряда в углу рамки юнита (1..9 и 0), по младшим битам байта +0x07. */
function drawGroups() {
  if (shell.screen !== 'game' || !running) return;
  const me = mem.u8(0x31b64), camX = mem.u32(0x31ae8), camY = mem.u32(0x31aec), vw = mem.u32(0x488c4), vh = mem.u32(0x488c8) || 480;
  ctx.save();
  клипСцены();
  ctx.font = 'bold 10px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  for (let i = mem.u32(0x31b6c); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.OWNER) !== me) continue;
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const g = mem.u8(UNITS + i + U.F07) & 0x7f;
    if (g < 1 || g > 10) continue;
    let sh = mem.u32(0x3d1b8 + mem.u8(UNITS + i + U.TYPE) * 4); if (sh >= 0x110000) sh -= 0x100000;
    if (!sh) continue;
    const x1 = mem.i32(sh + 36), y1 = mem.i32(sh + 52);                 // правый край и низ рамки
    const x = юX(i) - camX + x1, y = юY(i) - camY + y1;
    if (x < 6 || y < 8 || x > vw || y > vh) continue;
    const d = String(g === 10 ? 0 : g);
    ctx.fillStyle = 'rgba(0,0,0,.85)';                                   // тёмная обводка
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) ctx.fillText(d, x + dx, y + dy);
    ctx.fillStyle = 'rgba(252,252,72,.9)'; ctx.fillText(d, x, y);
  }
  ctx.restore();
}

// ---- колонка отрядов слева: портрет, цифра группы и полоска здоровья.
//
// Так это сделано в современных стратегиях, и просили ровно это: свежий юнит сам получает цифру
// (js/port/autogroups.js), а сбоку висит столбик его иконок. Показываем не больше десяти — цифр
// всего десять, 1..9 и 0; одиннадцатый юнит ни номера, ни ячейки не получает.
//
// Что в ячейке. Портрет из таблицы 0x424dc, обрезанный кружком с тонкой рамкой цвета владельца;
// цифра в правом нижнем углу; под кружком полоска здоровья тем же цветом, каким её красит сама
// игра (палитра 0x3e3d8 по текущему HP — от зелёного к красному). Щелчок по ячейке выделяет
// группу, как нажатие её цифры.
//
// Рисуем поверх кадра на канве наложений, как рамки и номера групп: в кадровый буфер оригинала
// не лезем, поэтому колонка не попадает ни в снимок, ни в запись партии.
// Колонка перерисовывается каждый кадр, а список юнитов на поздних стадиях — сотни записей.
// Первый вариант обходил его целиком по 60 раз в секунду и рисовал десять кружков заново: замер
// показал 1,3 мс из 2,5 мс всего кадра, то есть половину. Поэтому: список пересчитываем не чаще
// раза в СПИСОК_МС, а сам кружок (портрет, рамка, цифра) складываем в готовую канву и дальше
// только копируем. Каждый кадр меняется одна вещь — полоска здоровья, её и рисуем.
const ОТРЯДЫ = { вкл: localStorage.getItem('jw.hud') !== '0', ячейки: [], портреты: new Map(),
                 кэш: new Map(), список: [], когда: -1e9 };
const СПИСОК_МС = 150;
const ОТ_X = 6, ОТ_Y = 8, ОТ_R = 14, ОТ_ШАГ = 37, ОТ_ПОЛОСА = 4;   // кружок на 20 % меньше, шаг и полоска — соразмерно

/** Портрет типа кружком, готовой канвой. Кэш по типу и цвету племени: рисуем один раз. */
function портретОтряда(тип, владелец) {
  const цвет = mem.u8(0x30556 + владелец), ключ = тип * 256 + цвет;
  const было = ОТРЯДЫ.портреты.get(ключ); if (было !== undefined) return было;
  // У людей в панели есть портрет, у прирученных зверей его нет — там берём сам спрайт существа
  // (база 0x36dd6 по типу плюс смещение направления 0x36e06), как это делает tools/site_icons.mjs.
  const id = тип >= 9 ? (mem.u16(0x36dd6 + тип * 2) + mem.u16(0x36e06 + 2 * 2)) & 0xffff : mem.u32(0x424dc + тип * 4);
  const e = 0x16e5f4 + id * 16, p = mem.u32(e), w = mem.u16(e + 4), h = mem.u16(e + 6);
  if (!id || !w || !h || p < 0x30000 || p + w * h > mem.b.length) { ОТРЯДЫ.портреты.set(ключ, null); return null; }
  // Обрезаем пустые поля, иначе крошечный спрайт болтается в углу большого кадра.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mem.b[p + y * w + x] > 1) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { ОТРЯДЫ.портреты.set(ключ, null); return null; }
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  const к = document.createElement('canvas'); к.width = W; к.height = H;
  const c2 = к.getContext('2d'); const im = c2.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = mem.b[p + (y + y0) * w + (x + x0)]; const o = (y * W + x) * 4;
    if (v <= 1) continue;                                       // 0 — прозрачно, 1 — тень
    if (v >= 0xc0 && v < 0xc4) v = (v + цвет) & 0xff;            // цвет племени
    im.data[o] = fb.pal[v * 3]; im.data[o + 1] = fb.pal[v * 3 + 1]; im.data[o + 2] = fb.pal[v * 3 + 2]; im.data[o + 3] = 255;
  }
  c2.putImageData(im, 0, 0);
  ОТРЯДЫ.портреты.set(ключ, к); return к;
}

/**
 * Готовый кружок ячейки: подложка, портрет, рамка, цифра и «×N». Кэш по всему, что на нём видно,
 * поэтому в кадре остаётся один drawImage вместо десятка дуг, клипов и надписей.
 */
function ячейкаОтряда(тип, вл, цифра, сколько, выделен) {
  const ключ = `${тип}_${вл}_${цифра}_${сколько > 1 ? сколько : 0}_${выделен ? 1 : 0}`;
  const было = ОТРЯДЫ.кэш.get(ключ); if (было) return было;
  const к = document.createElement('canvas'); к.width = к.height = ОТ_R * 2;
  const g = к.getContext('2d');
  const cx = ОТ_R, cy = ОТ_R;
  g.beginPath(); g.arc(cx, cy, ОТ_R, 0, Math.PI * 2); g.fillStyle = 'rgba(10,8,6,.78)'; g.fill();
  const порт = портретОтряда(тип, вл);
  if (порт) {
    g.save(); g.beginPath(); g.arc(cx, cy, ОТ_R - 2, 0, Math.PI * 2); g.clip();
    // Портретов в игре нет: и в панели, и здесь это тот же спрайт существа во весь рост. Чтобы в
    // кружок попал бюст, а не фигурка целиком, увеличиваем по МЕНЬШЕЙ стороне (спрайт накрывает
    // круг) и прижимаем верхом к верхнему краю — голова на месте, ноги обрезаются.
    const k2 = (ОТ_R * 2 - 2) / Math.min(порт.width, порт.height);
    const w2 = порт.width * k2, h2 = порт.height * k2;
    g.imageSmoothingEnabled = false;
    g.drawImage(порт, cx - w2 / 2, 1, w2, h2);
    g.restore();
  }
  g.lineWidth = выделен ? 2 : 1;
  g.strokeStyle = выделен ? 'rgba(252,252,72,.95)' : rgbOf(mem.u8(0x3054d + вл));
  g.beginPath(); g.arc(cx, cy, ОТ_R - 1, 0, Math.PI * 2); g.stroke();
  g.font = 'bold 10px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const dx = cx + ОТ_R - 4, dy = cy + ОТ_R - 5;
  g.fillStyle = 'rgba(10,8,6,.85)'; g.beginPath(); g.arc(dx, dy, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(252,252,72,.95)'; g.fillText(String(цифра === 10 ? 0 : цифра), dx, dy + 0.5);
  if (сколько > 1) {
    g.fillStyle = 'rgba(10,8,6,.85)'; g.beginPath(); g.arc(4, 5, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(220,220,220,.9)'; g.fillText('×' + сколько, 4, 5.5);
  }
  ОТРЯДЫ.кэш.set(ключ, к); return к;
}

/** Что показывать: по одному представителю на каждую занятую цифру, в порядке 1..9, 0. */
function отрядыСписок() {
  const я = mem.u8(0x31b64); const по = new Array(11).fill(0); const счёт = new Array(11).fill(0);
  for (let i = mem.u32(0x31b6c); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.OWNER) !== я) continue;
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    // В колонку — только бойцы. Дом, доставшийся от конструктора вместе с его цифрой, сюда
    // попадать не должен: колонка про отряд, а не про постройки.
    const тип = mem.u8(UNITS + i + U.TYPE); if (тип < 1 || тип > 13) continue;
    const г = mem.u8(UNITS + i + U.F07) & 0x7f;
    if (г < 1 || г > 10) continue;
    счёт[г]++; if (!по[г]) по[г] = i;
  }
  const из = [];
  for (let г = 1; г <= 10 && из.length < 10; г++) if (по[г]) из.push({ г, u: по[г], сколько: счёт[г] });
  return из;
}

/** Колонка отрядов слева: портрет кружком, цифра и полоска здоровья. Заполняет ОТРЯДЫ.ячейки для кликов. */
function рисоватьОтряды() {
  ОТРЯДЫ.ячейки = [];
  // Наблюдателю колонка отрядов не нужна: он никем не командует, цифры 1..0 у него ничего не
  // выделяют, а место слева занято. Вместо неё ему рисуется сводка по племенам (ниже).
  if (!ОТРЯДЫ.вкл || shell.screen !== 'game' || !running || показатьЗум() || зрительЛи()) return;
  const сейчас = performance.now();
  if (сейчас - ОТРЯДЫ.когда >= СПИСОК_МС) { ОТРЯДЫ.список = отрядыСписок(); ОТРЯДЫ.когда = сейчас; }
  // Между пересчётами юнит мог погибнуть — мёртвых пропускаем сразу, не дожидаясь следующего.
  const список = ОТРЯДЫ.список.filter(я => !(mem.u8(UNITS + я.u + U.FLAGS5B) & 1));
  if (!список.length) return;
  ctx.save();
  ctx.font = 'bold 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  список.forEach((я, k) => {
    const u = я.u, тип = mem.u8(UNITS + u + U.TYPE), вл = mem.u8(UNITS + u + U.OWNER);
    const cx = ОТ_X + ОТ_R, cy = ОТ_Y + ОТ_R + k * ОТ_ШАГ;
    const выделен = (mem.u8(UNITS + u + U.F07) & 0x80) !== 0;
    ОТРЯДЫ.ячейки.push({ г: я.г, x: ОТ_X, y: cy - ОТ_R, w: ОТ_R * 2, h: ОТ_R * 2 + ОТ_ПОЛОСА + 3 });
    ctx.drawImage(ячейкаОтряда(тип, вл, я.г, я.сколько, выделен), cx - ОТ_R, cy - ОТ_R);
    // полоска здоровья — тем же цветом, каким её красит игра
    const hp = mem.u8(UNITS + u + U.HP), max = mem.u8(UNITS + u + U.HPMAX) || 1;
    const пx = ОТ_X, пy = cy + ОТ_R + 2, пш = ОТ_R * 2;
    ctx.fillStyle = 'rgba(10,8,6,.85)'; ctx.fillRect(пx, пy, пш, ОТ_ПОЛОСА);
    ctx.fillStyle = rgbOf(mem.u8(0x3e3d8 + hp));
    ctx.fillRect(пx + 1, пy + 1, Math.max(0, Math.floor((пш - 2) * hp / max)), ОТ_ПОЛОСА - 2);
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1; ctx.strokeRect(пx + 0.5, пy + 0.5, пш - 1, ОТ_ПОЛОСА - 1);
  });
  ctx.restore();
}

/** Смотрим ли партию со стороны: наблюдатель в сетевой комнате. */
const зрительЛи = () => !!(net?.активна && net.наблюдатель) || бой.вкл;

// Табло зрителя занимает место, а смотреть иногда хочется на карту, а не на цифры (владелец:
// «слишком большая панель, дай возможность её скукожить»). Три состояния по кругу: полное —
// племя, кто играет, еда, бойцы/дома; короткое — только цвет, еда и бойцы/дома; скрыто.
// Переключается щелчком по самому табло и кнопкой HUD в нижней панели (кружков у зрителя нет,
// так что кнопка всё равно простаивает). Выбор помнится между партиями.
const РЕЖИМЫ_СВОДКИ = ['полная', 'короткая', 'нет'];
// Табло доступно и ИГРОКУ, не только наблюдателю (предложение тестера: «видеть счёт соперников
// сбоку, как в Age of Empires»). Но по умолчанию у игрока оно ВЫКЛЮЧЕНО: это сведения о чужих
// племенах помимо тумана, и навязывать их никому нельзя — кто хочет, включает кнопкой HUD.
// У наблюдателя всё как было: табло сразу видно.
const СВОДКА = { режим: localStorage.getItem('jw.hudspec') || 'полная', рамка: null,
                 игроку: localStorage.getItem('jw.hudplayer') === '1' };
function переключитьСводку() {
  // У игрока кнопка сперва ВКЛЮЧАЕТ табло, и только потом крутит его вид: иначе включить его было
  // бы нечем, а колонка отрядов у игрока занята своим делом.
  if (!зрительЛи() && !СВОДКА.игроку) {
    СВОДКА.игроку = true; СВОДКА.режим = 'полная';
    try { localStorage.setItem('jw.hudplayer', '1'); localStorage.setItem('jw.hudspec', 'полная'); } catch {}
    return say(t('табло соперников: включено'));
  }
  const k = (РЕЖИМЫ_СВОДКИ.indexOf(СВОДКА.режим) + 1) % РЕЖИМЫ_СВОДКИ.length;
  СВОДКА.режим = РЕЖИМЫ_СВОДКИ[k];
  if (!зрительЛи() && СВОДКА.режим === 'нет') {                      // круг закончился — выключаем совсем
    СВОДКА.игроку = false; СВОДКА.режим = 'полная';
    try { localStorage.setItem('jw.hudplayer', '0'); localStorage.setItem('jw.hudspec', 'полная'); } catch {}
    return say(t('табло соперников: выключено'));
  }
  try { localStorage.setItem('jw.hudspec', СВОДКА.режим); } catch {}
  say(t(СВОДКА.режим === 'полная' ? 'табло: полное' : СВОДКА.режим === 'короткая' ? 'табло: короткое' : 'табло: скрыто'));
}

/**
 * Значок «чем управляется место»: человек, скриптовый компьютер, встроенный ИИ оригинала или
 * нейронка. Рисуем фигурками, а не словами: слов было бы до десяти знаков на строку, а вариантов
 * всего четыре (просьба владельца — «иконки вместо текста, чтобы места много не занимало»).
 *   человек  — голова и плечи;
 *   скрипт   — свиток: рамка с двумя строчками;
 *   родной   — монитор на ножке (та самая DOS-игра);
 *   нейронка — три узла, соединённые линиями.
 */
function значокУправления(ctx, x, y, вид, цвет) {
  ctx.save();
  ctx.strokeStyle = цвет; ctx.fillStyle = цвет; ctx.lineWidth = 1;
  const л = x + 0.5, в = y - 4.5;                       // левый верх поля 9×9
  if (вид === 'человек') {
    ctx.beginPath(); ctx.arc(л + 4, в + 3, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(л + 4, в + 9, 4, Math.PI, 0); ctx.fill();
  } else if (вид === 'скрипт') {
    ctx.strokeRect(л, в, 8, 9);
    ctx.fillRect(л + 2, в + 2, 4, 1); ctx.fillRect(л + 2, в + 4, 4, 1); ctx.fillRect(л + 2, в + 6, 3, 1);
  } else if (вид === 'родной') {
    ctx.strokeRect(л, в, 9, 6);
    ctx.fillRect(л + 3, в + 6, 3, 1); ctx.fillRect(л + 1, в + 7, 7, 1);
  } else if (вид === 'нейронка') {
    const узлы = [[л + 1, в + 1], [л + 1, в + 7], [л + 8, в + 4]];
    ctx.beginPath();
    ctx.moveTo(узлы[0][0], узлы[0][1]); ctx.lineTo(узлы[2][0], узлы[2][1]);
    ctx.moveTo(узлы[1][0], узлы[1][1]); ctx.lineTo(узлы[2][0], узлы[2][1]);
    ctx.moveTo(узлы[0][0], узлы[0][1]); ctx.lineTo(узлы[1][0], узлы[1][1]);
    ctx.stroke();
    for (const [ux, uy] of узлы) { ctx.beginPath(); ctx.arc(ux, uy, 1.4, 0, Math.PI * 2); ctx.fill(); }
  } else { ctx.fillRect(л + 1, в + 4, 7, 1); }          // свободное место — прочерк
  ctx.restore();
}

/** Домик рядом с числом построек: без него две цифры подряд читаются как «столько из стольких». */
function значокДома(ctx, x, y, цвет) {
  ctx.save();
  ctx.fillStyle = цвет;
  ctx.beginPath();
  ctx.moveTo(x + 3.5, y - 4); ctx.lineTo(x + 7, y - 1); ctx.lineTo(x, y - 1); ctx.closePath(); ctx.fill();
  ctx.fillRect(x + 1, y - 1, 5, 5);
  ctx.restore();
}

/**
 * Сводка по племенам — то, что вместо колонки отрядов видит наблюдатель. По строке на цвет:
 * квадратик цвета, племя, еда, живые бойцы и постройки, и кто за него играет (человек по имени
 * или компьютер с его мозгами). Владелец: «сколько денег и юнитов у каждой расы, когда в обсах».
 *
 * Считаем по всей карте, без тумана: зритель и так смотрит партию целиком (у него есть переключатель
 * тумана), а сводка нужна ему именно как табло, а не как разведданные.
 */
function рисоватьСводкуЗрителя() {
  СВОДКА.рамка = null;
  if ((!зрительЛи() && !СВОДКА.игроку) || shell.screen !== 'game' || !running || СВОДКА.режим === 'нет') return;
  const коротко = СВОДКА.режим === 'короткая';
  const п = net.параметры || {}, л = net.лобби || {};
  // В сцене «трое» лобби нет вовсе — состав берём из самой сцены, иначе табло не знает ни племён,
  // ни того, кто чем думает.
  const места = бой.вкл ? бой.места : ((п.места && п.места.length) ? п.места : (л.места || []));
  // Живое: бойцы, постройки и еда по цветам.
  const по = new Map();
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const ц = mem.u8(UNITS + i + U.OWNER); if (ц > 7) continue;
    const з = по.get(ц) || { бойцов: 0, домов: 0, сила: 0 };
    if (mem.u8(UNITS + i + U.TYPE) >= 0x1a) з.домов++;
    // Сумма ВСЕХ статов, а не только жизней с атакой и защитой. Так считает сама игра: опыт за
    // убитого = (сумма его статов)² >> 2 (js/port/combat.js). Тестеры (yanson_, m_mako)独 пришли к
    // тому же: «сложил бы все статы, ведь именно они дают опыт» — иначе племена с магией и
    // скоростью выглядят слабее, чем они есть на самом деле.
    else { з.бойцов++;
      з.сила += mem.u8(UNITS + i + U.HPMAX) + mem.u8(UNITS + i + U.ATK) + mem.u8(UNITS + i + U.DEF)
              + mem.u8(UNITS + i + U.MAG) + mem.u8(UNITS + i + U.SPD); }
    по.set(ц, з);
  }
  for (const м of места) if (м.кто !== 'закрыто' && !по.has(м.цвет)) по.set(м.цвет, { бойцов: 0, домов: 0, сила: 0 });
  if (!по.size) return;
  const цвета = [...по.keys()].sort((a, b) => a - b);
  // Очки — предложение тестера (m_mako): «как в Age of Empires, чтобы сразу видеть, кто силён,
  // кто выбыл и как ты на их фоне». Считаем из того, что в игре есть на самом деле: КАЧЕСТВО
  // армии (сумма жизней, атаки и защиты — прокачанный боец весит больше троих новобранцев, это
  // прямо следует из формулы урона), постройки и казна. Делители подобраны так, чтобы к середине
  // партии выходили сотни, а не единицы и не десятки тысяч.
  const очки = (з, ц) => Math.round(з.сила / 10 + з.домов * 50 + mem.u32(G.food + ц * 4) / 20);
  const ВЫС = коротко ? 11 : 15, ПАД = коротко ? 3 : 5, Ш = коротко ? 130 : 248;
  // Колонки задаём явно: правый край еды, правый край числа бойцов, левый край домика и правый
  // край числа домов. Иначе цифры наезжают на значок, и «5» с домиком читается как «5/3».
  const К = коротко ? { еда: 46, бойцы: 68, домик: 74, дома: 92, очки: 126 }
                    : { еда: 132, бойцы: 156, домик: 164, дома: 194, очки: 242 };
  СВОДКА.рамка = { x: ОТ_X, y: ОТ_Y, w: Ш, h: цвета.length * ВЫС + ПАД * 2 };
  ctx.save();
  ctx.font = `${коротко ? 9 : 11}px ui-monospace, monospace`; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(10,8,6,.72)';
  ctx.fillRect(ОТ_X, ОТ_Y, Ш, цвета.length * ВЫС + ПАД * 2);
  ctx.strokeStyle = 'rgba(255,215,140,.25)'; ctx.lineWidth = 1;
  ctx.strokeRect(ОТ_X + 0.5, ОТ_Y + 0.5, Ш - 1, цвета.length * ВЫС + ПАД * 2 - 1);
  // Кто сейчас ведёт — по очкам; его число подсвечиваем.
  let лидер = -1, лучше = -1;
  for (const ц of цвета) { const з = по.get(ц); if (!з.бойцов && !з.домов) continue;
    const о = очки(з, ц); if (о > лучше) { лучше = о; лидер = ц; } }
  цвета.forEach((ц, k) => {
    const y = ОТ_Y + ПАД + ВЫС * k + ВЫС / 2;
    const м = места.find(x => x.цвет === ц);
    const живо = по.get(ц), выбыл = !живо.бойцов && !живо.домов;
    ctx.fillStyle = rgbOf(mem.u8(0x3054d + ц));
    ctx.fillRect(ОТ_X + (коротко ? 3 : 5), y - 3, коротко ? 6 : 8, коротко ? 6 : 8);
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeRect(ОТ_X + (коротко ? 3.5 : 5.5), y - 2.5, коротко ? 5 : 7, коротко ? 5 : 7);
    // Кто играет: человек по имени, компьютер — своим набором из лобби.
    // Чем управляется место — значком, а не словом: вариантов всего четыре, а место дорого.
    const вид = !м ? 'нет' : м.кто === 'игрок' ? 'человек'
              : м.кто === 'компьютер' ? (м.ии === 'встроенный' ? 'родной'
                  : м.мозги === 'стратег' ? 'стратег' : (м.мозги && м.мозги !== 'скрипт') ? 'нейронка' : 'скрипт')
              : 'нет';
    const тускло = 'rgba(180,168,150,.45)';
    if (!коротко) {
      ctx.fillStyle = выбыл ? тускло : '#f0e2c4';
      ctx.textAlign = 'left';
      ctx.fillText((ПЛЕМЕНА_ИМЕНА[м?.племя ?? ц] || '?').slice(0, 9), ОТ_X + 18, y);
      значокУправления(ctx, ОТ_X + 82, y, вид, выбыл ? тускло : '#c9b48a');
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = выбыл ? тускло : '#e8c87a';
    ctx.fillText(String(mem.u32(G.food + ц * 4)), ОТ_X + К.еда, y);
    ctx.fillStyle = выбыл ? тускло : '#bfe0a0';
    ctx.fillText(String(живо.бойцов), ОТ_X + К.бойцы, y);
    значокДома(ctx, ОТ_X + К.домик, y, выбыл ? тускло : '#a9a090');
    ctx.fillStyle = выбыл ? тускло : '#cdbfa6';
    ctx.fillText(String(живо.домов), ОТ_X + К.дома, y);
    // Очки: у выбывшего — прочерк, у лидера — ярче остальных, чтобы взгляд цеплялся.
    ctx.fillStyle = выбыл ? тускло : (ц === лидер ? '#fcfc48' : '#e0d2b4');
    ctx.fillText(выбыл ? '—' : String(очки(живо, ц)), ОТ_X + К.очки, y);
  });
  ctx.restore();
}

/** Щелчок по ячейке — ровно то же, что нажатие её цифры на клавиатуре.
 *  Своей выборки здесь быть не должно: она ставила бит «выделен», но не обновляла панель, и юнит
 *  оказывался выбран наполовину — рамка есть, командовать нечем. Штатный 0x11093 делает всё:
 *  снимает прежнее выделение, ставит новое, назначает лидера и перерисовывает панель. Он же, через
 *  обёртку в js/port/autogroups.js, наводит камеру, если ту же группу выбрали второй раз. */
const выделитьГруппу = (г) => F[0x11093](eng, { eax: г });

// Слушатель в фазе перехвата: иначе щелчок по колонке уйдёт в js/input.js и станет приказом.
cv.addEventListener('pointerdown', (e) => {
  if (shell.screen !== 'game' || !running) return;
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
  // Щелчок по табло зрителя — свернуть его на ступеньку. Проверяем раньше кружков: у зрителя
  // колонки отрядов всё равно нет, а табло стоит ровно на её месте.
  const рм = СВОДКА.рамка;
  if (рм && x >= рм.x && x < рм.x + рм.w && y >= рм.y && y < рм.y + рм.h) {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    return переключитьСводку();
  }
  if (!ОТРЯДЫ.вкл || !ОТРЯДЫ.ячейки.length) return;
  const я = ОТРЯДЫ.ячейки.find(с => x >= с.x && x < с.x + с.w && y >= с.y && y < с.y + с.h);
  if (!я) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  выделитьГруппу(я.г);
}, true);

const hudBtn = document.getElementById('hudbtn');
/** Согласовать кнопку «отряды», колонку и автопривязку цифр между собой. */
function показатьHud() {
  if (hudBtn) hudBtn.classList.toggle('on', ОТРЯДЫ.вкл);
  Автогруппы.задать(eng, ОТРЯДЫ.вкл);
}
if (hudBtn) hudBtn.onclick = () => {
  // У зрителя кружков нет — той же кнопкой сворачиваем табло, иначе она у него простаивает.
  if (зрительЛи()) return переключитьСводку();
  ОТРЯДЫ.вкл = !ОТРЯДЫ.вкл; localStorage.setItem('jw.hud', ОТРЯДЫ.вкл ? '1' : '0');
  показатьHud(); say(t(ОТРЯДЫ.вкл ? 'колонка отрядов и автопривязка включены' : 'колонка отрядов и автопривязка выключены'));
};
показатьHud();
// Отдельная кнопка «счёт»: у игрока кнопка HUD занята колонкой отрядов, а табло соперников надо
// чем-то включать. Крутит то же кольцо: включить → полное → короткое → выключить.
// Отладочный слой ИИ: объявлен до кнопок, которые его переключают (иначе обращение к нему при
// разборе модуля падает во временную мёртвую зону).
let showAI = new URLSearchParams(location.search).has('aidebug');

// ---- автобой: наш компьютер играет ЗА ИГРОКА
//
// Кампанию мы учим проходить скриптом (js/ai/кампания.js читает условие победы прямо из таблиц
// игры), и смотреть на это надо глазами, а не только по числам стенда: владелец сказал — «я тоже
// буду смотреть на поведение и давать подсказки». Кнопка сажает наш штаб на место человека в
// текущей партии: приказы игрока при этом никуда не деваются, можно вмешаться и тут же отпустить.
let автобой = localStorage.getItem('jw.autoplay') === '1';
const автобойБтн = document.getElementById('aiplay');
/**
 * Посадить наш компьютер на место человека (или снять его).
 *
 * Чем именно играет автобой: стратег по правилу (он ведёт взаимовыручку, фокус на одной цели,
 * прикрытие своих и распорядок «кормиться — копить — идти волной») ПЛЮС обученная сеть бойца
 * (она решает за каждого юнита: кайт, отход, добивание). Это не вкусовщина, а замер первого
 * стейджа кампании (24 прогона: 8 рас × 3 сложности):
 *   голый скрипт            14 пройдено, высшая 1 из 8
 *   сеть бойца              16 пройдено, высшая 2 из 8
 *   стратег + сеть бойца    17 пройдено, высшая 3 из 8
 * Веса качаются заранее: внутри партии ждать их нельзя, а молча подменять сеть скриптом — значит
 * показывать не то, что выбрано.
 */
function применитьАвтобой(говорить = true) {
  if (!eng) return;
  const мой = mem.u8(G.humanOwner);
  if (автобой) {
    mem.w8(0x32aec + мой, 0);                                  // встроенный ИИ оригинала на этом месте не нужен
    // АВТОБОЙ ВЕДЁТ ОБРАЗЕЦ. Раньше тут сидел скриптовый штаб плюс обученная сеть бойца — та связка,
    // которую мерили по кампании ещё до образца. Владелец: «поправь кнопку автобой, она должна
    // использовать наш новый ИИ, который мы сейчас прописываем». Ставим образец ровно так же, как
    // это делает стенд: старый штаб и отрядную сеть снимаем, чтобы никто не перебивал приказы.
    ИИ.убрать(eng, мой);
    отрядПоставить(null);
    образецСлой.вкл = true;
    образецСлой.с = Образец.новое();
    if (ДЖЕВ_ВКЛ) образецСлой.с.джев = джевСпросить;
    образецСлой.с.угодья = угодья.рект;
    образецСлой.места = null; образецСлой.группа = null; образецСлой.последнее = null;
    if (говорить) {
      // Заодно называем, что считает победой сама игра: по этой же цели ИИ и играет.
      let з = null; try { з = Кампания.словами(Кампания.задание(mem)); } catch {}
      say(t('автобой: отрядом правит образец v{v}', { v: Образец.ВЕРСИЯ }) + (з ? ' · ' + з : ''));
    }
  } else {
    ИИ.убрать(eng, мой);
    образецСлой.вкл = false; образецСлой.с = null; образецСлой.места = null;
    образецСлой.группа = null; образецСлой.последнее = null;
    if (говорить) say(t('автобой выключен: управление ваше'));
  }
  if (автобойБтн) автобойБтн.classList.toggle('on', автобой);
}
if (автобойБтн) {
  автобойБтн.classList.toggle('on', автобой);
  автобойБтн.onclick = () => {
    автобой = !автобой; localStorage.setItem('jw.autoplay', автобой ? '1' : '0');
    применитьАвтобой(); cv.focus();
  };
}
// Кнопка отладочного слоя рядом с автобоем: без неё не видно, ПОЧЕМУ компьютер делает то, что
// делает (осанка, куда идёт армия, кого выбрал добычей). Та же галочка, что в сетевой панели.
const аиОтладкаБтн = document.getElementById('aidbg');
if (аиОтладкаБтн) {
  аиОтладкаБтн.classList.toggle('on', showAI);
  аиОтладкаБтн.onclick = () => { showAI = !showAI; аиОтладкаБтн.classList.toggle('on', showAI);
    try { netEl('netai').classList.toggle('on', showAI); } catch {}
    say(t(showAI ? 'слой ИИ: включён' : 'слой ИИ: выключен')); cv.focus(); };
}

// ---- часы миссии
// Просьба владельца: «добавь счётчик времени во время прохождения кампании тоже». Смотреть, как
// компьютер проходит миссию, без часов неудобно: непонятно, он её берёт за пять минут или за
// двадцать пять, а в кампании это и есть разница между «прошёл» и «не успел». Время игровое:
// шаг симуляции равен 55 мс и при ускорении ×3 идёт втрое быстрее реального — считаем по шагам,
// а не по часам браузера, иначе число ничего не значит.
const часыЭл = document.getElementById('mtime');
function обновитьЧасы() {
  if (!часыЭл) return;
  if (!eng || shell.screen !== 'game') { часыЭл.textContent = ''; return; }
  const сек = Math.floor(mem.u32(G.step) * 55 / 1000);
  const ч = `${Math.floor(сек / 60)}:${String(сек % 60).padStart(2, '0')}`;
  // В кампании рядом показываем, что считается победой: это же и есть цель, по которой видно,
  // близко ли дело к концу.
  let цель = '';
  try { if (mission !== null && mission < 100) цель = ' · ' + Кампания.словами(Кампания.задание(mem)); } catch {}
  часыЭл.textContent = ч + цель;
}
setInterval(обновитьЧасы, 500);

const счётБтн = document.getElementById('scoreboard');
if (счётБтн) счётБтн.onclick = () => { переключитьСводку(); счётБтн.classList.toggle('on', зрительЛи() || СВОДКА.игроку); cv.focus(); };
if (счётБтн) счётБтн.classList.toggle('on', СВОДКА.игроку);


// ---- буквы на кнопках команд и заклинаний.
//
// Панель показывает до девяти кнопок; что в каждой — лежит в 0x31b34+слот, значение это «номер
// команды» = номер бита умения + 1 (js/port/input.js, 0x2673d). Нажатие кнопки — F[0x13237] с этим
// номером, так что клавише достаточно позвать то же самое.
//
// Какая буква. Берём первую букву английского названия заклинания; если она уже занята — вторую,
// третью и так далее. Занятыми считаются и клавиши игры (WASD двигают карту, V патруль, T собрать,
// B отнести, P пауза, Z сон, A и G — команды панели, N следующий юнит, пробел — камера), и буквы,
// уже разобранные заклинаниями ЭТОГО класса. Классы не пересекаются: у эльфа лечения, у визарда
// удары, у варлока яд и землетрясение, у рейнджера разведка — поэтому внутри класса буквы
// уникальны, а между классами повторяются, и это никому не мешает.
//
// Названия — из подсказок курсора оригинала (notes/magic-spec.md §5): Heal, Mass heal,
// Regeneration, Protect, Resurrection; Framing-Ball, Roaring-Sound, Lighting, Ice; Poison-Gas,
// Fire-Dance, Earthquake, Self-destruction; Small Mapping, Grand Mapping, Space Shift.
const БУКВЫ_КОМАНД = {
  2: 'A', 3: 'Z', 4: 'G', 6: 'B',                    // родные команды: у них клавиши уже были
  9: 'H', 10: 'M', 11: 'R', 12: 'O', 13: 'E',        // эльф: Heal Mass Regeneration prOtect rEsurrection
  15: 'F', 16: 'R', 17: 'L', 18: 'I',                // визард: Framing-ball Roaring Lighting Ice
  20: 'O', 21: 'F', 22: 'E', 23: 'L',                // варлок: pOison Fire-dance Earthquake seLf-destruction
  25: 'M', 26: 'R', 27: 'C',                         // рейнджер: sMall Mapping, gRand Mapping, spaCe shift
};
// Буквы, которые обрабатываем сами. A, Z, G и B уже нажимаются штатно (таблица HOTKEYS движка и
// наши клавиши), второй раз их перехватывать нельзя — иначе команда уйдёт дважды.
const НАШИ_БУКВЫ = new Set(['H', 'M', 'R', 'O', 'E', 'F', 'L', 'I', 'C']);
// Сдвиг панели в широком окне (js/render/wide.js): координаты её кнопок в таблицах оригинала
// абсолютные и посчитаны от кадра 640, а сама панель уезжает к правому краю. Наши наложения
// рисуются поверх канвы, поэтому этот сдвиг к ним надо прибавлять руками — иначе буквы команд,
// счётчики очереди и подсказка по предмету оказываются посреди карты.
const СДВИГ_ПАНЕЛИ = () => (ШИРОКО.вкл ? Math.max(0, ШИРОКО.ш - 640) : 0);
/** Прямоугольник кнопки команд номер k: та же таблица, по которой игра ловит клики по панели. */
const КНОПКА_РАМКА = (k) => { const b = 0x30c64 + (19 + k) * 8, Δ = СДВИГ_ПАНЕЛИ();
  return { x0: mem.u16(b) + Δ, y0: mem.u16(b + 2), x1: mem.u16(b + 4) + Δ, y1: mem.u16(b + 6) }; };

/** Что сейчас в кнопках панели: [{ слот, команда, буква }] у выделенного своего юнита. */
function кнопкиКоманд() {
  const из = [];
  const s = mem.u32(0x31adc);
  if (!s || mem.u8(UNITS + s + U.OWNER) !== mem.u8(0x31b64)) return из;
  if (mem.u8(UNITS + s + U.TYPE) >= 0x1a) return из;                 // у здания панель другая
  for (let k = 0; k < 9; k++) {
    const v = mem.u8(0x31b34 + k); if (!v) continue;
    const б = БУКВЫ_КОМАНД[v]; if (!б) continue;
    из.push({ слот: k, команда: v, буква: б });
  }
  return из;
}

/** Подписать кнопки панели их клавишами. */
function рисоватьБуквыКоманд() {
  if (shell.screen !== 'game' || !running) return;
  const кнопки = кнопкиКоманд(); if (!кнопки.length) return;
  ctx.save();
  ctx.font = 'bold 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const { слот, буква } of кнопки) {
    const р = КНОПКА_РАМКА(слот);
    const x = р.x0 + 6, y = р.y0 + 6;
    ctx.fillStyle = 'rgba(10,8,6,.85)'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(252,252,72,.95)'; ctx.fillText(буква, x, y + 0.5);
  }
  ctx.restore();
}

/** Нажали букву: если у выделенного юнита есть такая команда — выполнить её. */
function командаПоБукве(буква) {
  const я = кнопкиКоманд().find(к => к.буква === буква);
  if (!я) return false;
  F[0x13237](eng, { eax: я.команда });
  return true;
}

// ---- камикадзе (клавиша K): выделенные бросаются убивать всё подряд, ближайших первыми.
// Сам режим живёт в js/port/kamikaze.js и держится приказом через общую очередь, поэтому работает
// и в сетевой партии, и в записи. Здесь только клавиша и пометка над юнитом.
function переключитьКамикадзе() {
  if (shell.screen !== 'game' || !running) return;
  const я = mem.u8(0x31b64); let сколько = 0, включаем = 0;
  for (let i = mem.u32(0x31b6c); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.OWNER) !== я) continue;
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (!(mem.u8(UNITS + i + U.F07) & 0x80)) continue;                 // только выделенные
    const т = mem.u8(UNITS + i + U.TYPE); if (т < 1 || т > 13) continue;
    if (!Камикадзе.включён(eng, i)) включаем++;
    Камикадзе.приказКамикадзе(eng, i); сколько++;
  }
  if (!сколько) return say(t('никто не выделен'));
  say(включаем ? t('камикадзе: {n}', { n: включаем }) : t('камикадзе отменён'));
}

/** Пометка над камикадзе: маленький красный клин, чтобы не гадать, кто уже сорвался. */
function рисоватьКамикадзе() {
  if (shell.screen !== 'game' || !running || показатьЗум()) return;
  const с = Камикадзе.бешеные(eng); if (!с.size) return;
  const camX = mem.u32(0x31ae8), camY = mem.u32(0x31aec), vw = mem.u32(0x488c4), vh = mem.u32(0x488c8) || 480;
  ctx.save(); клипСцены();
  for (const [i] of с) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    let sh = mem.u32(0x3d1b8 + mem.u8(UNITS + i + U.TYPE) * 4); if (sh >= 0x110000) sh -= 0x100000;
    if (!sh) continue;
    const x = юX(i) - camX + (mem.i32(sh + 36) >> 1);
    const y = юY(i) - camY + mem.i32(sh + 48) - 4;
    if (x < 0 || y < 0 || x > vw || y > vh) continue;
    ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.closePath();
    ctx.fillStyle = 'rgba(220,40,30,.9)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
}

// ---- двойной клик: оставить выделенным только юнита под курсором
function isolateUnderCursor() {
  if (shell.screen !== 'game' || !running) return;
  let u = 0; try { u = (F[0x130ae](eng).esi >>> 0); } catch { return; }
  if (!u || mem.u8(UNITS + u + U.OWNER) !== mem.u8(0x31b64)) return;
  for (let i = mem.u32(0x31b6c); i; i = mem.u32(UNITS + i + U.NEXT))
    mem.w8(UNITS + i + U.F07, mem.u8(UNITS + i + U.F07) & 0x7f);
  mem.w8(UNITS + u + U.F07, mem.u8(UNITS + u + U.F07) | 0x80);
  mem.w32(0x31adc, u); mem.w32(0x33be0, 1);
  if (F[0x2661c]) F[0x2661c](eng, {});
  say(t('выбран один юнит'));
}
cv.addEventListener('dblclick', (e) => { e.preventDefault(); isolateUnderCursor(); });

// Отметка: расходящиеся кольца внутри одной клетки, зелёные если можно, красные если нет.
// Отметки запланированных построек: рамка по отпечатку здания и вид под ней.
function drawPlans() {
  if (!running || shell.screen !== 'game') return;
  const вл = mem.u8(G.humanOwner); const планы = План.список(eng, вл); if (!планы.length) return;
  const camX = mem.u32(0x31ae8), camY = mem.u32(0x31aec), vw = mem.u32(0x488c4);
  ctx.save(); клипСцены();
  ctx.lineWidth = 1.5; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center';
  const мигание = 0.55 + 0.25 * Math.sin(performance.now() / 260);
  for (const п of планы) {
    const x = п.x - camX, y = п.y - camY;
    if (x < -64 || y < -64 || x > vw + 64 || y > 520) continue;
    ctx.strokeStyle = `rgba(232,192,125,${мигание.toFixed(2)})`;
    ctx.setLineDash([4, 3]); ctx.strokeRect(x + 2.5, y + 2.5, 27, 27); ctx.setLineDash([]);
    ctx.fillStyle = п.кому ? 'rgba(120,235,120,.95)' : 'rgba(232,192,125,.85)';
    ctx.fillText(п.кому ? '▼' : '·', x + 16, y + 24);
  }
  ctx.restore();
}
/**
 * Отладочный слой скриптового ИИ (галочка в панели или ?aidebug): у каждого компьютерного племени
 * рисуем точку, куда идёт армия, цель охоты и подпись с осанкой. Без этого настраивать ИИ вслепую.
 */
const ПРАВИЛА_ВЕРСИЯ = 3;                 // версия набора «правил партии» в записи
/**
 * Чем этот штаб думает и что сеть успела сделать — одной строкой.
 *
 * Просьба владельца: «когда нейронку выбираем в скирмише, надо показывать, какая именно выбрана и
 * что она делает, чтобы я был в ней уверен». Поэтому тут не только имя файла весов, но и счётчики
 * решений: сколько решений за бойцов приняла СЕТЬ, а сколько учитель. Если выбрана нейронка, а
 * счётчик сети стоит на нуле — значит она не работает, и это видно сразу, без догадок.
 */
const кратко = (ф) => String(ф || '').replace(/\.json$/, '').replace(/-20\d\d-\d\d-\d\d-?\d*$/, '');
function мозгиСтрокой(с) {
  const части = [];
  if (с.стратегПравило) части.push(`стратег (правила), фаза ${с.фаза}`);
  if (с.бойСеть) части.push(`боец ${кратко(с.весаБойцаИмя || Сети.ЛУЧШИЕ.боец)}: ${с.счётСеть || 0} решений`);
  if (с.тактик) части.push(`тактик ${кратко(с.весаТактикаИмя || Сети.ЛУЧШИЕ.тактик)}: ${с.счётТактик || 0}`);
  if (с.комдив) {
    const з = (с.комдивЗадачи || []).join('/') || '—';
    части.push(`комдив ${кратко(с.весаКомдиваИмя || Сети.ЛУЧШИЕ.комдив)}: ${с.счётКомдив || 0}, задачи ${з}`);
  }
  // Сеть заявлена, но её нет — самое важное, что тут можно показать.
  if (с.мозгиИмя && с.мозгиИмя !== 'скрипт' && с.мозгиИмя !== 'стратег' && !с.бойСеть && !с.тактик && !с.комдив)
    части.push(`ВЫБРАНА «${с.мозгиИмя}», НО СЕТЬ НЕ ПОДКЛЮЧИЛАСЬ — играет скрипт`);
  if (!части.length) части.push(`скрипт: ${с.счётУчитель || 0} решений`);
  else if (с.счётУчитель) части.push(`учитель ${с.счётУчитель}`);
  return части.join(' · ');
}
/** Подписать в панели партии, какие мозги у компьютерных мест. */
function обновитьМозги() {
  const el = document.getElementById('netbrains'); if (!el) return;
  const т = составМозгов();
  el.textContent = т ? '· ' + т : '';
  // Красным — если сеть заявлена, но не подключилась: это не мелочь, партия идёт не тем ИИ.
  el.style.color = /НЕ ПОДКЛЮЧИЛАСЬ/.test(т) ? '#e07a5f' : '';
}
/** Состав мозгов партии одной строкой: сколько мест на каких мозгах и с какими весами. */
function составМозгов() {
  const штабы = ИИ.все(eng); if (!штабы.length) return '';
  const по = new Map();
  for (const с of штабы) {
    const к = с.комдив ? `комдив ${кратко(с.весаКомдиваИмя || Сети.ЛУЧШИЕ.комдив)}`
            : (с.бойСеть || с.тактик) ? `нейронка ${кратко(с.весаБойцаИмя || Сети.ЛУЧШИЕ.боец)}${с.тактик ? ' + ' + кратко(с.весаТактикаИмя || Сети.ЛУЧШИЕ.тактик) : ''}`
            : с.стратегПравило ? 'стратег (правила)'
            : (с.мозгиИмя && с.мозгиИмя !== 'скрипт' && с.мозгиИмя !== 'стратег') ? `«${с.мозгиИмя}» НЕ ПОДКЛЮЧИЛАСЬ — скрипт` : 'скрипт';
    по.set(к, (по.get(к) || 0) + 1);
  }
  return [...по].map(([к, n]) => `${n}× ${к}`).join(', ');
}
/** Отладочный слой скриптового ИИ: цели, добыча, состав армии и строка состояния по каждому штабу. */
function drawAI() {
  if (!showAI || !running || shell.screen !== 'game') return;
  const штабы = ИИ.все(eng); if (!штабы.length) return;
  const camX = mem.u32(0x31ae8), camY = mem.u32(0x31aec), vw = mem.u32(0x488c4);
  ctx.save(); клипСцены();
  ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.lineWidth = 1.5;
  // Подложка под строки: поверх травы белый текст не читается.
  // Подложку меряем по самой длинной строке: на глаз выставленная ширина резала хвосты
  // («… · учител»), а хвост — это и есть счётчики, ради которых слой включают.
  const строки = штабы.map(с => `   ${мозгиСтрокой(с)}`);
  const ширина = Math.min(vw, 12 + Math.max(300, ...строки.map(т => ctx.measureText(т).width)));
  ctx.fillStyle = 'rgba(12,10,8,.72)'; ctx.fillRect(0, 0, ширина, 6 + штабы.length * 24);
  let строка = 0;
  for (const с of штабы) {
    const цвет = ЦВЕТА[с.цвет % 8];
    const точка = (т, знак) => {
      if (!т) return;
      const x = (т.x << 5) - camX + 16, y = (т.y << 5) - camY + 16;
      if (x < -32 || y < -32 || x > vw + 32 || y > 512) return;
      ctx.strokeStyle = цвет; ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.stroke();
      ctx.fillStyle = цвет; ctx.fillText(знак, x - 3, y + 4);
    };
    точка(с.цель, 'X');
    const д = с.добыча; if (д && !(mem.u8(UNITS + д + U.FLAGS5B) & 1)) точка({ x: mem.u16(UNITS + д + U.X) >> 5, y: mem.u16(UNITS + д + U.Y) >> 5 }, 'о');
    // Линия «кто в армии» — видно, собрана ли она в кулак или размазана по карте.
    ctx.strokeStyle = цвет; ctx.globalAlpha = .5; ctx.beginPath();
    let первый = true;
    for (const i of с.отряды.кулак) {
      if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
      const x = юX(i) - camX + 16, y = юY(i) - camY + 16;
      if (первый) { ctx.moveTo(x, y); первый = false; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = цвет;
    ctx.fillText(`${с.цвет} ${с.осанка} · ${ИИ.УРОВНИ[с.уровень]?.имя || '?'} · ${с.характер} · армия ${с.отряды.кулак.length} · раб ${с.отряды.рабочие.length} · еда ${mem.u32(G.food + с.цвет * 4)}`, 6, 12 + строка * 12);
    строка++;
    ctx.fillText('   ' + мозгиСтрокой(с), 6, 12 + строка * 12);
    строка++;
  }
  ctx.restore();
}
// ---------------------------------------------------------------- подсказка по предмету
// Своя, а не движковая: у оригинала на предмет есть только строка состояния с английским именем
// (таблица 0x420b0), а нам нужны характеристики, пояснение и три языка. Рисуем поверх канвы, там
// же, где рамки юнитов и планы стройки, и по тем же прямоугольникам панели, что и клики (0x30c9c).
let текстыПредметов = null;
let подписиПредметов = {};
fetch('../data/items_text.json').then(r => r.json()).then(j => { текстыПредметов = j.items; подписиПредметов = j.подписи || {}; }).catch(() => {});
// Что выпускает каждая кнопка в панели здания (разбор оригинала: цена 0x30eac, шаги 0x315ac,
// меню 0x4273c). Имена там английские, как в самой игре; цену и время считаем из памяти, чтобы
// показывать настоящие числа этого племени, а не табличные.
let домаМеню = null;
fetch('../data/economy_buildings.json').then(r => r.json())
  .then(j => { домаМеню = {}; for (const r of j.rows) домаМеню[r.type] = (r.menu || []).map(м => м.produces || ''); })
  .catch(() => {});
/** Подпись на текущем языке (свой словарь: у нашего t() польского нет). */
const пт = (k) => подписиПредметов[k]?.[locale.lang] || подписиПредметов[k]?.en || k;
/** К какой группе относится слот инвентаря: 0-2 оружие, 3-5 щит, 6-8 расходник, дальше украшения. */
const СЛОТ_ГРУППА = (k) => k < 3 ? 'оружие' : k < 6 ? 'щит' : k < 9 ? 'расходник' : 'украшение';
const ГРУППА_ИМЯ = { 'оружие': 'оружие', 'щит': 'щит', 'расходник': 'расходник', 'артефакт': 'украшение', 'украшение': 'украшение' };
const ПОЛЯ_ПРЕДМЕТА = [['hp', 'здоровье'], ['mag', 'магия'], ['mana', 'мана'], ['atk', 'атака'], ['def', 'защита'], ['spd', 'скорость']];
/** Что показывать про предмет: имя на текущем языке, группа, числа из памяти движка, пояснение. */
function описаниеПредмета(id) {
  const т = текстыПредметов?.[id];
  const я = locale.lang;
  const строка = 0x30954 + mem.u32(0x30a9e + id * 4);
  const числа = ПОЛЯ_ПРЕДМЕТА.map(([, имя], k) => [имя, mem.u8(строка + k)]).filter(([, v]) => v > 0);
  return {
    имя: т ? (т.имя[я] || т.имя.en) : '#' + id,
    группа: т ? (ГРУППА_ИМЯ[т.группа] || т.группа) : '',
    числа, цена: mem.u16(строка + 6),
    пояснение: т ? (т.о[я] || т.о.en || '') : '',
    украшение: т ? т.группа === 'артефакт' : false,
  };
}
/**
 * Подсказка по предмету — обычной строкой внизу, там же, где движок пишет «foods=N» и свои
 * сообщения, и тем же шрифтом (js/ui/screen.js text() умеет кириллицу и польские буквы). Рамки и
 * подложки нет нарочно: коробка посреди карты закрывала пол-экрана.
 */
function подсказкаПредмета() {
  if (shell.screen !== 'game' || !running || !текстыПредметов || briefPage >= 0) return;
  const mx = mem.u32(0x45098), my = mem.u32(0x4509c);
  let id = 0, слот = -1;
  for (let k = 0; k < 12; k++) {
    const b = 0x30c9c + k * 8, Δп = СДВИГ_ПАНЕЛИ();
    if (mx < mem.u16(b) + Δп || mx > mem.u16(b + 4) + Δп || my < mem.u16(b + 2) || my > mem.u16(b + 6)) continue;
    слот = k; const s = mem.u32(0x31adc);
    // Только у живого носителя вещей: у здания в этих же клетках панели стоят портреты
    // производства, а байты +0x1b заняты своим — и подсказка врала названиями предметов.
    if (s && mem.u8(UNITS + s + U.TYPE) < 0x1a && !(mem.u8(UNITS + s + U.FLAGS5B) & 1)) id = mem.u8(UNITS + s + U.INV + k);
    break;
  }
  // Здание: подсказка по кнопке заказа — что она делает и сколько это стоит. Раньше здесь не
  // показывалось ничего (штатная подсказка оригинала рисуется в панели и у нас не видна), и по
  // портретам приходилось угадывать. Оружейная выпускает предмет с номером «портрет + 1» — для
  // него берём полное описание с прибавками, остальным хватает имени, цены и времени.
  if (!id) { подсказкаЗдания(mx, my); return; }
  const о = описаниеПредмета(id);
  const гр = пт(слот >= 0 ? СЛОТ_ГРУППА(слот) : о.группа);
  const числа = о.числа.map(([имя, v]) => `${пт(имя)} +${v}`).join(', ');
  const шапка = [о.имя, гр, числа, о.цена ? `${пт('цена')} ${о.цена}` : '',
                 о.украшение ? пт(Артефакты.включено() ? 'прибавки работают' : 'прибавки выключены') : ''
                ].filter(Boolean).join(' - ');   // дефис, а не точка: точки-разделителя в шрифте игры нет
  const ширина = mem.u32(0x488c4) - 8;                  // до края карты: на панель заезжать нельзя
  const строки = [...wrapText(eng, шапка, ширина), ...wrapText(eng, о.пояснение || '', ширина)].slice(0, 4);
  // Снизу вверх над строкой движка (она на y = 0x1d0), тем же цветом, что и её сообщения.
  let y = 0x1d0 - 15 * строки.length;
  for (const стр of строки) { text(eng, стр, 2, y, { col: 0xf8, clip: [0, 0, ширина, 479] }); y += 15; }
}

/** Подсказка по кнопке заказа в здании: что выйдет, сколько стоит и сколько ждать. */
function подсказкаЗдания(mx, my) {
  const s = mem.u32(0x31adc);
  if (!s || mem.u8(UNITS + s + U.TYPE) < 0x1a || (mem.u8(UNITS + s + U.FLAGS5B) & 1)) return;
  if (mem.u8(UNITS + s + U.OWNER) !== mem.u8(0x31b64)) return;          // чужое здание не расписываем
  let k = -1;
  for (let i = 0; i < 15; i++) {
    const b = 0x30d54 + i * 8;
    if (mx < mem.u16(b) || mx >= mem.u16(b + 4) || my < mem.u16(b + 2) || my >= mem.u16(b + 6)) continue;
    k = i; break;
  }
  if (k < 0 || !mem.u8(0x31b49 + k)) return;                             // кнопки нет или она погашена
  const тип = mem.u8(UNITS + s + U.TYPE), вид = тип - 0x1a;
  const шагов = mem.u8(0x315ac + (вид << 5) + k);
  const цена = шагов * mem.u32(0x30eac + ((вид << 5) + k) * 4);
  const вОружейной = вид === 2 || вид === 3;
  const о = вОружейной ? описаниеПредмета(k + 1) : null;
  // Имя того, что выйдет. Оружейная — полное описание предмета (оно переведено). Склад выдаёт
  // еду кучкой, размер лежит в 0x37564. Святилище строит дом: в таблице это «Constructor -> X»,
  // берём вторую половину. Остальное — как в таблице, но только если это латиница: в шрифте игры
  // кириллицы нет, пока не выбран русский язык, и русская строка нарисовалась бы вопросиками.
  const изТаблицы = домаМеню?.[тип]?.[k] || '';
  const латиница = изТаблицы && !/[^\u0000-\u024f]/.test(изТаблицы) && !/[а-яА-ЯёЁ]/.test(изТаблицы);
  const имя = о ? о.имя
    : вид === 4 ? `${mem.u32(0x37564 + k * 4)} ${пт('еда')}`
    : вид === 0 ? `${пт('постройка')}: ${(изТаблицы.split('->').pop() || '').trim() || '#' + k}`
    : латиница ? изТаблицы : '#' + k;
  const числа = о ? о.числа.map(([и, v]) => `${пт(и)} +${v}`).join(', ') : '';
  const шапка = [имя, числа, цена ? `${пт('цена')} ${цена}` : '',
                 шагов ? `${пт('готовится')} ${Math.round(шагов * 55 / 100) / 10} ${пт('с')}` : ''].filter(Boolean).join(' - ');
  const ширина = mem.u32(0x488c4) - 8;
  const строки = [...wrapText(eng, шапка, ширина), ...wrapText(eng, о?.пояснение || '', ширина)].slice(0, 4);
  let y = 0x1d0 - 15 * строки.length;
  for (const стр of строки) { text(eng, стр, 2, y, { col: 0xf8, clip: [0, 0, ширина, 479] }); y += 15; }
}

// ---------------------------------------------------------------- отдаление карты (наблюдатель)
// В движке масштаба сцены нет: тайлы рисуются один в один, 32 точки на клетку. Поэтому отдаление
// делаем честно — прогоняем сцену по всей карте экран за экраном и складываем уменьшенную копию.
// Полная карта 64×64 обходится в двадцать отрисовок, это около 25 мс; обновляем несколько раз в
// секунду, а не каждый кадр. Включается только зрителю: у него нет приказов, и мышь никуда не бьёт.
const ЗУМ = { уровень: 1, обновлён: 0, img: null, ширина: 0, высота: 0, пауза: 250, камера: -1 };
const ЗУМ_МС = 250;
/** Во сколько раз надо уменьшить, чтобы карта влезла целиком. */
function зумМакс() {
  const vw = mem.u32(VW) || 512, vh = mem.u32(VH) || 480;
  return Math.max(2, Math.ceil(Math.max(mem.u32(G.mapW) * 32 / vw, mem.u32(G.mapH) * 32 / vh)));
}
/** Отдалять карту можно только зрителю сетевой партии: у него нет приказов и мышь никуда не бьёт. */
export function зумДоступен() { return !!((net?.активна && net.наблюдатель || бой.вкл) && running && shell.screen === 'game'); }
// Начиная с этой кратности сцену не гоняем вовсе: тайл ужимается в четыре точки, спрайт всё
// равно не разобрать, а вся карта складывается из цветов клеток — так же, как это делает
// мини-карта игры (таблицы 0x3e8aa по тайлу и 0x3e8a0 по владельцу). Разница огромная: полный
// обзор карты 256×176 — это 192 прохода сцены и 79 мс, а по сетке — один проход по пикселям
// кадра и пара миллисекунд.
const ЗУМ_СЕТКА = 8;
const ЦВЕТ_ТАЙЛА = 0x3e8aa, ЦВЕТ_ВЛАДЕЛЬЦА = 0x3e8a0;
/** Отдалённая карта по сетке клеток: дёшево и без спрайтов. */
function зумСеткой(z, rx0, ry0, шир, выс, ox0, oy0, ow, oh, vw, d) {
  const b = mem.b;
  for (let oy = 0; oy < oh; oy++) {
    const gy = ry0 + oy * z; const ряд = (oy0 + oy) * vw;
    const строкаКлеток = ((gy >> 5) & 0xff) << 8;
    for (let ox = 0; ox < ow; ox++) {
      const gx = rx0 + ox * z; const cell = строкаКлеток | ((gx >> 5) & 0xff);
      let вл = b[MO + cell] >> 4; if (вл === 0) вл = b[BI + cell] >> 2;
      const c = вл === 0 ? b[ЦВЕТ_ТАЙЛА + (mem.u16(BG + cell * 2) & 0x7ff)] : b[ЦВЕТ_ВЛАДЕЛЬЦА + вл];
      const p = PAL + c * 3, o = (ряд + ox0 + ox) * 4;
      d[o] = b[p]; d[o + 1] = b[p + 1]; d[o + 2] = b[p + 2]; d[o + 3] = 255;
    }
  }
}
/** Пересобрать отдалённую картинку карты: спрайтами до 8-кратного, дальше по сетке клеток. */
function перерисоватьЗум() {
  const z = ЗУМ.уровень; if (z <= 1) return;
  const vw = mem.u32(VW) || 512, vh = mem.u32(VH) || 480;
  const W = mem.u32(G.mapW) * 32, H = mem.u32(G.mapH) * 32;
  if (!ЗУМ.img || ЗУМ.ширина !== vw || ЗУМ.высота !== vh) { ЗУМ.img = ctx.createImageData(vw, vh); ЗУМ.ширина = vw; ЗУМ.высота = vh; }
  const d = ЗУМ.img.data; d.fill(0);
  const camX = mem.u32(0x31ae8), camY = mem.u32(0x31aec);
  const maxX = Math.max(0, W - vw), maxY = Math.max(0, H - vh);
  // Показываем кусок мира вокруг камеры: vw·z на vh·z пикселей. Раньше сюда всегда складывалась
  // вся карта целиком, а лишнее просто обрезалось — на большой карте при кратности 2 был виден
  // левый верхний угол, и камера на картинку никак не влияла (жалоба владельца: «нельзя сдвинуть
  // камеру и не сориентироваться по миникарте»). Заодно это и скорость: при ×2 надо обойти
  // четыре экрана, а не сто девяносто два.
  const шир = Math.min(W, vw * z), выс = Math.min(H, vh * z);
  let rx0 = Math.round(camX + vw / 2 - шир / 2), ry0 = Math.round(camY + vh / 2 - выс / 2);
  rx0 = Math.max(0, Math.min(W - шир, rx0)); ry0 = Math.max(0, Math.min(H - выс, ry0));
  const ow = Math.ceil(шир / z), oh = Math.ceil(выс / z);
  const ox0 = (vw - ow) >> 1, oy0 = (vh - oh) >> 1;
  if (z >= ЗУМ_СЕТКА) { зумСеткой(z, rx0, ry0, шир, выс, ox0, oy0, ow, oh, vw, d); return; }
  const base = mem.u32(XBASE);
  for (let sy = ry0; sy < ry0 + выс; sy += vh) {
    const y0 = Math.min(sy, maxY);
    for (let sx = rx0; sx < rx0 + шир; sx += vw) {
      const x0 = Math.min(sx, maxX);
      mem.w32(0x31ae8, x0); mem.w32(0x31aec, y0);
      drawScene(eng, SCENE_FULL);
      // Берём каждую z-ю точку — и сразу шагаем по ним, а не перебираем все двести сорок тысяч
      // пикселей экрана с проверкой остатка: при кратности 16 это в 256 раз меньше работы.
      const пY = (z - ((y0 - ry0) % z + z) % z) % z, пX = (z - ((x0 - rx0) % z + z) % z) % z;
      for (let y = пY; y < vh; y += z) {
        const gy = y0 + y; if (gy < ry0 || gy >= ry0 + выс) continue;
        const oy = oy0 + (gy - ry0) / z; if (oy < 0 || oy >= vh) continue;
        // Строку кадра берём по ДЕЙСТВУЮЩЕЙ таблице: в широком окне шаг не 640, и по родной
        // таблице чтение расползалось по кадру — картинка превращалась в кашу из полос.
        const строка = base + mem.u32(ряды(mem) + y * 4), ряд = oy * vw;
        for (let x = пX; x < vw; x += z) {
          const gx = x0 + x; if (gx < rx0 || gx >= rx0 + шир) continue;
          const ox = ox0 + (gx - rx0) / z; if (ox < 0 || ox >= vw) continue;
          const c = mem.b[строка + x], p = PAL + c * 3, o = (ряд + ox) * 4;
          d[o] = mem.b[p]; d[o + 1] = mem.b[p + 1]; d[o + 2] = mem.b[p + 2]; d[o + 3] = 255;
        }
      }
    }
  }
  mem.w32(0x31ae8, camX); mem.w32(0x31aec, camY);
}
/** Нарисовать отдалённую карту поверх области сцены (панель остаётся своя). */
function показатьЗум() {
  if (ЗУМ.уровень <= 1 || !зумДоступен()) return false;
  const t = performance.now();
  // Картинка пересобирается не чаще, чем сама рисуется: на карте 256×176 полный обзор — это
  // почти двести проходов сцены, и при жёстких 250 мс кадр вставал колом, а юниты дёргались.
  // Поэтому пауза между пересборками — вчетверо больше её же стоимости (но не меньше 250 мс).
  const надо = !ЗУМ.img || t - ЗУМ.обновлён > ЗУМ.пауза
            || ЗУМ.камера !== (mem.u32(0x31ae8) << 16 | mem.u32(0x31aec));   // камеру двинули — обновить сразу
  if (надо) {
    const t0 = performance.now();
    перерисоватьЗум();
    ЗУМ.обновлён = performance.now();
    ЗУМ.пауза = Math.max(ЗУМ_МС, Math.min(2000, Math.round((ЗУМ.обновлён - t0) * 4)));
    ЗУМ.камера = mem.u32(0x31ae8) << 16 | mem.u32(0x31aec);
  }
  if (ЗУМ.img) ctx.putImageData(ЗУМ.img, 0, 0);
  return true;
}

// ---------------------------------------------------------------- полоски прокрутки у края
// В оригинале карта ехала, когда курсор упирался в край экрана: в DOS мышь из окна не выходила.
// В браузере так не получится, поэтому у края рисуем узкие серые полоски и расширяем зону
// срабатывания ровно на их ширину. Видно, куда вести мышь, и случайно не заденешь.
const КРАЯ = { вкл: false, ширина: 22, анимация: null, t0: 0 };
/**
 * Включить прокрутку карты от края экрана и запомнить выбор.
 * @param {boolean} тихо не писать в строку состояния (вызов при старте миссии)
 */
function задатьКрая(вкл, тихо = false) {
  КРАЯ.вкл = !!вкл;
  Ввод.КРАЙ.ширина = вкл ? КРАЯ.ширина : 0;
  mem.w16(0x3009c, вкл ? 2 : 6);                     // «Scroll Auto Speed»: 6 — выключено совсем
  localStorage.setItem('jw.edge', вкл ? '1' : '0');
  if (!тихо) { КРАЯ.анимация = вкл ? 'мигание' : 'угасание'; КРАЯ.t0 = performance.now(); }
  обновитьКрайБтн();
}
/** Подсветить полосу у края экрана, пока курсор в ней: иначе непонятно, почему карта поехала. */
function рисоватьКрая() {
  if (shell.screen !== 'game' || !running || briefPage >= 0) return;
  let сила = КРАЯ.вкл ? 0.30 : 0;
  if (КРАЯ.анимация) {
    const t = (performance.now() - КРАЯ.t0) / 1000;
    if (КРАЯ.анимация === 'мигание') {
      if (t > 0.9) КРАЯ.анимация = null; else сила = 0.15 + 0.5 * Math.abs(Math.sin(t * Math.PI * 3));
    } else {
      if (t > 0.6) { КРАЯ.анимация = null; сила = 0; } else сила = 0.7 * (1 - t / 0.6);
    }
  }
  if (сила <= 0.001) return;
  // Полоски рисуем по краям ЭКРАНА, а не окна карты: прокрутка теперь срабатывает только там,
  // в том числе поверх боковой панели (см. 0x12be6 в js/port/input.js).
  const vw = cv.width, vh = cv.height, ш = КРАЯ.ширина;
  ctx.save();
  const полоса = (x, y, w, h, напр) => {
    const g = напр === 'x' ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h);
    const к0 = `rgba(190,190,190,${сила.toFixed(3)})`, к1 = 'rgba(190,190,190,0)';
    g.addColorStop(0, напр === 'x' ? (w > 0 ? к0 : к1) : к0);
    g.addColorStop(1, к1);
    ctx.fillStyle = g; ctx.fillRect(x, y, Math.abs(w), h);
  };
  полоса(0, 0, ш, vh, 'x');                                     // слева
  const g = ctx.createLinearGradient(vw, 0, vw - ш, 0);
  g.addColorStop(0, `rgba(190,190,190,${сила.toFixed(3)})`); g.addColorStop(1, 'rgba(190,190,190,0)');
  ctx.fillStyle = g; ctx.fillRect(vw - ш, 0, ш, vh);            // справа
  полоса(0, 0, vw, ш, 'y');                                     // сверху
  const g2 = ctx.createLinearGradient(0, vh, 0, vh - ш);
  g2.addColorStop(0, `rgba(190,190,190,${сила.toFixed(3)})`); g2.addColorStop(1, 'rgba(190,190,190,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, vh - ш, vw, ш);           // снизу
  // Тонкая яркая кромка у самого края: без неё полоса читается как тень, а не как элемент.
  ctx.fillStyle = `rgba(220,220,220,${Math.min(1, сила * 1.7).toFixed(3)})`;
  ctx.fillRect(0, 0, 2, vh); ctx.fillRect(vw - 2, 0, 2, vh);
  ctx.fillRect(0, 0, vw, 2); ctx.fillRect(0, vh - 2, vw, 2);
  ctx.restore();
}

/** Расходящиеся кольца в точке отметки: зелёные если поставить можно, красные если нет. */
function drawMarker() {
  if (!marker) return;
  const age = (performance.now() - marker.t0) / 1000;
  if (age > 1.6) { marker = null; return; }
  const sx = marker.x - mem.u32(0x31ae8) + 16, sy = marker.y - mem.u32(0x31aec) + 16;
  const vw = mem.u32(0x488c4);
  if (sx < -32 || sy < -32 || sx > vw + 32 || sy > 512) return;
  const blink = 0.7 + 0.3 * Math.sin(age * 14);       // мигание, но не до нуля — иначе не видно
  const fade = age > 1.2 ? (1.6 - age) / 0.4 : 1;
  const rgb = marker.ok ? '90,235,90' : '245,70,70';
  ctx.save(); клипСцены(); ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) {                        // три кольца вразнобой — «капля на воде»
    const t = (age * 1.6 + k / 3) % 1;
    const rr = 3 + t * 13, a = (1 - t) * blink * fade;
    ctx.strokeStyle = `rgba(${rgb},${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = `rgba(${rgb},${(0.5 * blink * fade).toFixed(3)})`;
  ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Полный экран. Три случая, и все три надо обслужить руками:
//   * Chrome/Firefox — обычный Fullscreen API;
//   * Safari (macOS, старые сборки) — те же вызовы с приставкой webkit;
//   * Safari на iPad/iPhone — Fullscreen API для произвольного элемента не поддерживается вовсе,
//     есть только webkitEnterFullscreen у <video>, а игре это не годится (в видео нет ввода).
//     Поэтому там включаем «свой» полный экран: страница становится фиксированной на всю высоту
//     видимой области (100dvh), панель сжимается, прокрутка гасится. Панели браузера так не
//     убрать — по-настоящему без них iPad открывает только ярлык с рабочего стола, для этого
//     рядом лежит manifest.webmanifest и apple-mobile-web-app-capable. Про ярлык подсказываем.
const ЕСТЬ_ПОЛНЫЙ = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
/** Сейчас настоящий полный экран (с приставкой webkit — ради Safari). */
const вПолном = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
/** Сейчас наш «свой» полный экран — там, где настоящего API нет (Safari на iPad). */
const своёПолноэ = () => document.documentElement.classList.contains('своёполно');
/** Кнопка ⛶: настоящий полный экран, а где его нет — свой на всю видимую область. */
function переключитьПолный() {
  if (ЕСТЬ_ПОЛНЫЙ) {
    if (вПолном()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const э = document.documentElement;
      const р = (э.requestFullscreen || э.webkitRequestFullscreen).call(э, { navigationUI: 'hide' });
      // Safari отдаёт undefined, Chrome — промис; отказ (жест не тот, iframe без allow) не должен
      // валиться в консоль молча: подстраховываемся своим режимом.
      Promise.resolve(р).catch(() => включитьСвоё(true));
    }
  } else включитьСвоё(!своёПолноэ());
  setTimeout(fit, 60);
}
/** Свой полноэкранный режим: страница на 100dvh, панель ужата, прокрутка выключена. */
function включитьСвоё(вкл) {
  document.documentElement.classList.toggle('своёполно', вкл);
  document.getElementById('fs').classList.toggle('on', вкл);
  if (вкл) {
    scrollTo(0, 0);
    // Подсказку про ярлык показываем один раз: на iPad это единственный способ убрать панели.
    if (!localStorage.getItem('jw.ярлык') && /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && !localStorage.getItem('jw.ярлык'))) {
      localStorage.setItem('jw.ярлык', '1');
      toast(t('Safari сам панели не убирает: «Поделиться» → «На экран «Домой»» — оттуда игра открывается без них'));
    }
  }
  setTimeout(fit, 60);
}
document.getElementById('fs').onclick = переключитьПолный;
for (const с of ['fullscreenchange', 'webkitfullscreenchange'])
  document.addEventListener(с, () => { document.getElementById('fs').classList.toggle('on', вПолном()); setTimeout(fit, 60); });
document.getElementById('menu').onclick = () => { saveReplay('exit'); if (net?.фаза !== 'нет') net.выйти(); running = false; shell.goto('menu'); say(''); };
// Переход на страницу выбора уровня и расы. Она лежит рядом с game.html, ссылка относительная —
// так работает и по короткому адресу /jw/, и при запуске прямо из reimpl/web/.
document.getElementById('levels').onclick = async () => {
  if (running && !confirm(t('Выйти к выбору уровня? Текущая партия не сохранится.'))) return;
  await saveReplay('exit');                       // уходим со страницы — запись успеет уехать
  свойУход = true;
  location.href = 'levels.html';
};

// Esc/F10 в игровом меню закрывают его. Ловим в фазе перехвата и гасим событие: иначе его
// подберёт js/input.js, порт увидит скан-код Esc и через 0x20acb тут же откроет меню заново.
// WASD двигают карту наравне со стрелками: об этом просили тестеры. Подменяем скан-код на
// стрелочный и гасим событие, иначе движок увидит W (у него это переключение панели) или A.
const WASD = { KeyW: 'ArrowUp', KeyA: 'ArrowLeft', KeyS: 'ArrowDown', KeyD: 'ArrowRight' };
/** Курсор в поле ввода (чат, имя игрока): горячие клавиши там не работают. */
const вПоле = (e) => { const т = e.target; return т && (т.tagName === 'INPUT' || т.tagName === 'TEXTAREA' || т.isContentEditable); };
addEventListener('keydown', e => {
  if (shell.screen === 'game' && running && WASD[e.code] && !e.ctrlKey && !e.metaKey && !e.altKey && !вПоле(e)) {
    e.preventDefault(); e.stopImmediatePropagation(); input.holdKey(WASD[e.code], true); return;
  }
}, true);
addEventListener('keyup', e => {
  if (WASD[e.code] && !вПоле(e)) { input.holdKey(WASD[e.code], false); }
  Ввод.ШИФТ.нажат = e.shiftKey;
}, true);
// Shift держим отдельным флагом: щелчок мыши в порт приходит без модификаторов, а решать, класть
// приказ в очередь или отдавать сразу, надо именно в момент щелчка.
addEventListener('keydown', e => { Ввод.ШИФТ.нажат = e.shiftKey; }, true);
addEventListener('pointerdown', e => { Ввод.ШИФТ.нажат = e.shiftKey; }, true);
addEventListener('blur', () => { Ввод.ШИФТ.нажат = false; });
addEventListener('keydown', e => {
  // В поле ввода (чат комнаты, имя игрока) горячие клавиши не работают: иначе буква «b» в
  // сообщении отправляла бы всех выделенных на склад.
  if (вПоле(e)) return;
  if (shell.screen === 'game' && running) {
    if (e.code === 'F2') { e.preventDefault(); return showBrief(); }
    if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return armPatrol();
    }
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return собратьМясо();
    }
    if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return отнестиЕду();
    }
    if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return setPaused(!shell.paused);
    }
    // K — камикадзе: выделенные бросаются на всех подряд, ближайших первыми. Буква свободна:
    // ни в таблице движка, ни среди наших клавиш, ни среди букв заклинаний её нет.
    if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return отходНазад();
    }
    if (e.code === 'KeyG' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return раздатьВещи();
    }
    if (e.code === 'KeyY' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return скинутьЛишнее();
    }
    if (e.code === 'KeyK' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return переключитьКамикадзе();
    }
    // Буквы заклинаний: то же, что клик по кнопке панели. Проверяем последними из букв, чтобы
    // не перебить уже занятые клавиши (их обрабатывают ветки выше и таблица движка).
    if (/^Key[A-Z]$/.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey && !вПоле(e)) {
      const б = e.code.slice(3);
      if (НАШИ_БУКВЫ.has(б) && командаПоБукве(б)) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return;
      }
    }
    // «+» и «−» — скорость игры. Клавиши свободны: в таблице горячих клавиш оригинала
    // (HOTKEYS в js/port/input.js) скан-кодов 0x0c и 0x0d нет, заняты только Numpad+ (0x4e).
    // Меняем ту же настройку 0x30098, что и ползунок Game Speed в окне настроек: 1 — быстрее
    // всего, 5 — медленнее. То есть это просто короткий путь к тому, что и так разрешено.
    if ((e.code === 'Equal' || e.code === 'Minus' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract')
        && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const быстрее = e.code === 'Equal' || e.code === 'NumpadAdd';
      const было = Math.max(1, Math.min(5, mem.u16(OPTS.speed) || 3));
      const стало = Math.max(1, Math.min(5, было + (быстрее ? -1 : 1)));
      if (стало !== было) { mem.w16(OPTS.speed, стало); saveOpts(); }
      return say(t('скорость игры: {v}', { v: СКОРОСТИ[стало] || стало }));
    }
    if (briefPage >= 0) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return e.code === 'Escape' ? hideBrief() : showBrief(); }
  }
  if (!shell.key(e.code)) return; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }, true);

// ---- раскладка: картинка в своём соотношении сторон вверху, свободное место внизу — тачпаду
// Тачпад занимает то свободное место, которое остаётся от картинки 4:3: в портрете это полоса
// снизу, в ландшафте — колонка сбоку. Если места меньше PAD_MIN, тачпада нет и палец водит
// по самой картинке, как раньше.
const main = document.getElementById('main'), padwrap = document.getElementById('padwrap'), padcv = document.getElementById('pad');
const PAD_MIN = 64;
/**
 * Разложить картинку и тачпад по окну: в портрете тачпад снизу, в ландшафте сбоку.
 * Соотношение сторон берём у САМОЙ канвы, а не 4:3: в широком окне карты кадр другой формы
 * (js/render/wide.js), и если растягивать его в коробку 640×480, картинка искажается — именно
 * это и увидел владелец. С родным кадром 640×480 всё считается ровно как раньше.
 */
function fit() {
  const W = main.clientWidth, H = main.clientHeight;
  const кw = cv.width || 640, кh = cv.height || 480;    // пиксели кадра, они же пропорции
  const side = padMode && W / H > кw / кh;              // экран шире картинки — свободное место сбоку
  main.classList.toggle('side', side);
  let padW = 0, padH = 0;
  if (padMode) {
    if (side) { padW = Math.floor(W - (H - 12) / кh * кw - 14); padW = padW < PAD_MIN ? 0 : Math.min(padW, Math.round(W * 0.4), 320); }
    else { padH = Math.floor(H - (W - 12) / кw * кh - 14); padH = padH < PAD_MIN ? 0 : Math.min(padH, Math.round(H * 0.55), 420); }
  }
  padwrap.classList.toggle('on', padW > 0 || padH > 0);
  if (padW > 0) { padwrap.style.width = padW + 'px'; padcv.style.height = (H - 12) + 'px'; }
  else if (padH > 0) { padwrap.style.width = ''; padcv.style.height = padH + 'px'; }
  const availW = W - (padW ? padW + 8 : 0), availH = H - (padH ? padH + 8 : 0);
  let k = Math.min((availW - 8) / кw, (availH - 8) / кh);
  // Широкий кадр и так подогнан под окно, поэтому растягивать его ещё и средствами CSS незачем:
  // при k чуть больше единицы часть пикселей удваивалась бы, а смысл всей затеи — показать
  // картинку один к одному. Родной кадр 640×480 растягиваем как раньше — он для того и мелкий.
  if ((кw > 640 || кh > 480) && k > 1) k = 1;
  const w = Math.max(160, Math.floor(кw * k)) + 'px', h = Math.max(120, Math.floor(кh * k)) + 'px';
  cv.style.width = w; cv.style.height = h; vid.style.width = w; vid.style.height = h;
  if (padwrap.classList.contains('on')) { padcv.width = Math.max(64, padcv.clientWidth); padcv.height = Math.max(48, padcv.clientHeight); }
  drawPad();
}

// ---- область делится пополам: ближняя половина — тачпад (ведение курсора), дальняя — стик
// прокрутки карты, как в мобильных играх: куда нажал — там центр, куда тянешь — туда едет карта,
// скорость от нуля до той, что стоит в настройках (Scroll Speed). В портрете полоса делится по
// вертикали (слева тачпад, справа стик), в ландшафте колонка — по горизонтали (сверху тачпад).
const pctx = padcv.getContext('2d');
let padGlow = null;                                     // { x, y, a } — точка и яркость
/** Зона стика — четверть в правом нижнем углу области, в координатах канвы. */
function stickZone() {
  const w = padcv.width, h = padcv.height;
  return { x: w / 2, y: h / 2, w: w / 2, h: h / 2 };
}
/** Палец попал в круг стика прокрутки на тачпаде. */
const inStick = (e) => {
  const r = padcv.getBoundingClientRect();
  return (e.clientX - r.left) > r.width / 2 && (e.clientY - r.top) > r.height / 2;
};
/** Радиус полного отклонения — по короткой стороне четверти, в разумных пределах. */
function stickRadius() {
  const r = padcv.getBoundingClientRect();
  return Math.max(36, Math.min(110, Math.min(r.width, r.height) / 2 * 0.42));
}
/** Отклонение стика 0..1 по каждой оси. Мёртвая зона нужна, чтобы ноль был достижим. */
function stickPull() {
  if (!stick) return null;
  const R = stickRadius(), мёртвая = 6, len = Math.hypot(stick.dx, stick.dy);
  if (len <= мёртвая) return null;
  const доля = (v) => { const a = Math.abs(v) - мёртвая; return a <= 0 ? 0 : Math.min(1, a / Math.max(1, R - мёртвая)); };
  return { kx: доля(stick.dx) * Math.sign(stick.dx), ky: доля(stick.dy) * Math.sign(stick.dy),
           k: Math.min(1, (len - мёртвая) / Math.max(1, R - мёртвая)) };
}
// Скорость стика ограничена ровно тем же, чем и стрелки. Движок (0x12acd) двигает камеру на
// 32 px за срабатывание, и срабатывание ему разрешено: при Scroll Speed = 1 — каждый кадр,
// иначе — раз в (значение − 1) изменений таймера BIOS [0x46c]. Повторяем это правило вместо
// того, чтобы считать пиксели в секунду: тогда стик не может обогнать стрелки ни при какой
// настройке и ни при какой частоте кадров, а отклонение задаёт долю от этого максимума.
let stickAccX = 0, stickAccY = 0, stickTick = -1, stickWait = 0;
/** Шаг прокрутки стиком: копим дробные клетки и отдаём движку целыми по 32, с темпом настройки. */
function stickStep() {
  const p = stickPull();
  if (!p) { stickAccX = stickAccY = 0; return; }
  const v = mem.u16(0x3009a) || 2;
  if (v > 1) {                                        // медленные настройки: раз в (v−1) тиков
    const t = mem.u32(0x46c); if (t === stickTick) return; stickTick = t;
    if (--stickWait > 0) return; stickWait = v - 1;
  }
  stickAccX += Math.abs(p.kx); stickAccY += Math.abs(p.ky);
  let dx = 0, dy = 0;
  if (stickAccX >= 1) { stickAccX -= 1; dx = 32 * Math.sign(p.kx); }
  if (stickAccY >= 1) { stickAccY -= 1; dy = 32 * Math.sign(p.ky); }
  if (dx || dy) scrollBy(dx, dy);
}
/** Нарисовать тачпад: круг стика, палец на нём и подписи режимов. */
function drawPad() {
  if (!padcv.width || !padcv.height) return;
  const w = padcv.width, h = padcv.height, z = stickZone();
  pctx.clearRect(0, 0, w, h);
  pctx.fillStyle = '#141210'; pctx.fillRect(0, 0, w, h);
  pctx.fillStyle = 'rgba(232,192,125,0.03)'; pctx.fillRect(z.x, z.y, z.w, z.h);
  if (padGlow && padGlow.a > 0.01) {
    const g = pctx.createRadialGradient(padGlow.x, padGlow.y, 0, padGlow.x, padGlow.y, padGlow.r);
    g.addColorStop(0, `rgba(232,192,125,${0.16 * padGlow.a})`);
    g.addColorStop(1, 'rgba(232,192,125,0)');
    pctx.fillStyle = g; pctx.fillRect(0, 0, w, h);
  }
  pctx.strokeStyle = 'rgba(141,130,116,0.35)'; pctx.lineWidth = 1;   // угол зоны карты
  pctx.beginPath(); pctx.moveTo(z.x + 0.5, h); pctx.lineTo(z.x + 0.5, z.y + 0.5); pctx.lineTo(w, z.y + 0.5);
  pctx.stroke();
  pctx.font = '11px ui-monospace, monospace'; pctx.textAlign = 'center';
  const пад = [w / 4, h / 4 + 4];        // подпись в свободном углу, чтобы не спорить с зоной карты
  const карта = [z.x + z.w / 2, z.y + z.h / 2 + 4];
  pctx.fillStyle = padGlow ? 'rgba(232,192,125,0.20)' : 'rgba(141,130,116,0.30)';
  pctx.fillText('touchpad', пад[0], пад[1]);
  if (!stick) { pctx.fillStyle = 'rgba(141,130,116,0.30)'; pctx.fillText('карта', карта[0], карта[1]); }
  else {                                                             // сам стик: основание и головка
    const r = padcv.getBoundingClientRect();
    const bx = (stick.cx - r.left) * w / r.width, by = (stick.cy - r.top) * h / r.height;
    const R = stickRadius() * w / r.width;
    const p = stickPull(), k = p ? p.k : 0;
    let hx = stick.dx * w / r.width, hy = stick.dy * h / r.height;
    const len = Math.hypot(hx, hy); if (len > R) { hx = hx / len * R; hy = hy / len * R; }
    pctx.strokeStyle = 'rgba(232,192,125,0.30)'; pctx.beginPath(); pctx.arc(bx, by, R, 0, 7); pctx.stroke();
    pctx.strokeStyle = `rgba(232,192,125,${0.25 + 0.5 * k})`; pctx.lineWidth = 2;
    pctx.beginPath(); pctx.moveTo(bx, by); pctx.lineTo(bx + hx, by + hy); pctx.stroke();
    pctx.fillStyle = `rgba(232,192,125,${0.35 + 0.45 * k})`;
    pctx.beginPath(); pctx.arc(bx + hx, by + hy, 13, 0, 7); pctx.fill();
    pctx.lineWidth = 1;
  }
}
input.attachPad(padcv, { skip: inStick, onPaint: (cx, cy, state) => {
  const r = padcv.getBoundingClientRect();
  if (state === 'up') { padGlow = null; drawPad(); return; }
  const x = (cx - r.left) * padcv.width / r.width, y = (cy - r.top) * padcv.height / r.height;
  padGlow = { x, y, a: state === 'tap' ? 1 : 0.55, r: state === 'tap' ? 90 : 60 };
  drawPad();
  if (state === 'tap') {                                // вспышка гаснет за ~250 мс
    const t0 = performance.now();
    const fade = () => { if (!padGlow) return; const k = 1 - (performance.now() - t0) / 250;
      if (k <= 0) { padGlow = null; drawPad(); return; } padGlow.a = k; drawPad(); requestAnimationFrame(fade); };
    requestAnimationFrame(fade);
  }
} });
// Стик: центр — там, где палец коснулся, а не в середине половины.
padcv.addEventListener('pointerdown', (e) => {
  if (!inStick(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
  stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY, dx: 0, dy: 0 };
  try { padcv.setPointerCapture(e.pointerId); } catch {}
  drawPad(); e.preventDefault();
});
padcv.addEventListener('pointermove', (e) => {
  if (!stick || e.pointerId !== stick.id) return;
  stick.dx = e.clientX - stick.cx; stick.dy = e.clientY - stick.cy;
  drawPad(); e.preventDefault();
});
/** Палец со стика убрали — прокрутка останавливается. */
const stickUp = (e) => {
  if (!stick || e.pointerId !== stick.id) return;
  stick = null; drawPad();
  try { padcv.releasePointerCapture(e.pointerId); } catch {}
};
padcv.addEventListener('pointerup', stickUp); padcv.addEventListener('pointercancel', stickUp);
fit(); addEventListener('resize', fit); addEventListener('orientationchange', fit);
new ResizeObserver(fit).observe(document.getElementById('stage'));

// ---- ролики (пак 11, перекодированы в out/video): webm первым, mp4 запасным.
// Звука в FLI нет, поэтому muted-автовоспроизведение разрешено и на iOS.
function playVideo(name) {
  return new Promise(res => {
    let done = false; const end = () => { if (done) return; done = true;
      vid.pause(); vid.removeAttribute('src'); vid.innerHTML = ''; vid.hidden = true; vid.onended = vid.onerror = vid.onclick = null; res(); };
    vid.innerHTML = `<source src="../../video/${name}.webm" type="video/webm"><source src="../../video/${name}.mp4" type="video/mp4">`;
    vid.hidden = false; vid.onended = end; vid.onerror = end; vid.onclick = end;   // нажатие — пропустить
    vid.load(); fit();
    vid.play().catch(end);
  });
}
shell.playVideo = playVideo;

// ---- реплеи: запись каждой партии и просмотр (js/ui/replay.js)
// Пишем только приказы игрока. Все они, из любого места интерфейса, проходят через одну
// функцию 0x14895 — ту самую, что в оригинале складывала 10-байтовые записи в очередь и
// отправляла их сопернику по COM-порту. ИИ очередью не пользуется вообще (замерено: ноль
// вызовов за 3000 шагов симуляции), поэтому перехват даёт ровно ввод человека.
// Начальное состояние кладём снимком: повторная загрузка миссии поверх уже игранной памяти
// оставляет хвосты в служебных ячейках (счётчики поиска пути, состояние второго ГСЧ), а от
// них зависит расстановка врагов у ИИ.
const rec = new Replay.Recorder();
let playing = null;                                  // не null — идёт просмотр записи
const addOrder = F[0x14895];
// Заказ в Святилище (0x7f) — это заказ строителя, уже настроенного на здание: номер портрета и
// есть вид постройки. Запоминаем его и предлагаем отметить место: дальше план доведёт строителя.
let видПостройки = -1;
// Запрет «строим по одному дому» отсюда убран. Он считал, что стройка идёт, пока жив ЛЮБОЙ
// юнит-строитель, — а строитель после постройки никуда не девается, и Святилище блокировалось
// насовсем: заказать второй дом было нельзя до конца партии. Очередь производства (prodqueue.js)
// и так не даёт заказать больше, чем дом успевает делать, а сколько строителей держать — дело
// игрока, как в оригинале.
F[0x14895] = (e, r) => {
  if (playing) { if (!playing.injecting) return; }    // при просмотре клики зрителя в симуляцию не идут
  else if (net?.активна && !внедрение.внедряем) {      // сетевая партия: свой приказ едет в пакет хода, а не в очередь
    if (!net.наблюдатель) net.лс?.прикажи(r.esi & 0xffff, r.eax & 0xff, r.edi & 0xffff, r.edx & 0xffff, r.ebx & 0xffff);   // наблюдатель никем не командует
    return;
  }
  // ПРИКАЗ, ОТДАННЫЙ НА ПАУЗЕ, кладём в свой карман, а не в очередь движка. Очередь обнуляется в
  // начале каждого шага (0x13f4c), поэтому всё, положенное между шагами, стирается — и приказ
  // просто пропадал. Слова владельца: «если я протыкал, все мои задания должны быть положены в
  // очередь; сейчас сказал одному, выделил другого, сказал ему — первый не отреагировал». Карман
  // выкладываем в очередь на первом же шаге после снятия паузы, по порядку.
  // В сетевой партии и скирмише этого не нужно: там приказ уходит в пакет хода (ветка выше), а его
  // никто не обнуляет.
  // ПАНЕЛЬНЫЕ ПРИКАЗЫ НА ПАУЗЕ НЕ КАРМАНИМ. Карман нужен приказам ЮНИТАМ: их копят кликами и
  // выкладывают разом, когда пауза снята. А нажатие кнопки панели (0xe1 — переключатели прокачки,
  // инвентарь) должно сработать здесь и сейчас: юнит уже выделен, приказ адресован ему, и ждать
  // нечего. Пока их клало в карман, счётчик нажатий рос, приказ «выкладывался», а маска не
  // менялась — владелец: «нажимаю эту хрень, не меняется ничего».
  // На паузе приказ применяем, только если мы ВНУТРИ шага; иначе — в карман и просим шаги.
  else if (shell.paused && !внедрение.внедряем && !вШаге) {
    приказыПаузы.push({ eax: r.eax, esi: r.esi, edi: r.edi, edx: r.edx, ebx: r.ebx });
    шаговПаузы = Math.max(шаговПаузы, ШАГИ_НА_ПАУЗЕ); return;
  }
  else rec.order(mem.u32(G.step), r.eax, r.esi, r.edi, r.edx, r.ebx);   // в сети сюда приходят уже применяемые приказы всех
  // Наши коды (планы стройки) движок не знает: кладём их в свою очередь, она применяется в том же
  // месте шага, что и штатные приказы.
  if (НАШИ_КОДЫ.has(r.eax & 0xff)) { вОчередьПриказов(e, r.esi & 0xffff, r.eax & 0xff, r.edi & 0xffff, r.edx & 0xffff, r.ebx & 0xffff); return; }
  return addOrder(e, r);
};
// Раздача приказов интерфейса живёт внутри шага: 0x13f4c обнуляет очередь и зовёт 0x1419e,
// который снимает «ожидающий клик» и раскладывает его по обработчикам. Значит и вносить записи
// надо ровно здесь — запись, положенная в очередь до тика, была бы стёрта сбросом указателя.
const dispatchOrders = F[0x1419e];
/** Приказы, отданные на паузе: ждут первого шага после её снятия. */
const приказыПаузы = [];
let выложеноНаПаузе = 0;   // счётчик для проверок: сколько приказов кармана реально применено
let панельныхКликов = 0, диспВсего = 0, диспСКликом = 0, последнийСлот = -1;
// Щелчок «изнутри», в обход DOM: нужен для проверок. Безголовый браузер шлёт клики по канве, но до
// игры они не доходят (свои перехватчики, тач-схема, фокус), и проверить путь «нажал кнопку панели
// → приказ → шаг → применилось» иначе нечем. Координаты — логические, как у кадра 640×480.
globalThis.jwЩелчок = async (x, y, кнопка = 0) => {
  input.mouseMove(x, y); input.mouseDown(кнопка, x, y);
  await new Promise(r => setTimeout(r, 150));   // движок опрашивает мышь раз в шаг: отпускать сразу нельзя
  input.mouseUp(кнопка, x, y);
};
globalThis.jwПамять = { u8: (a) => mem.u8(a), u16: (a) => mem.u16(a), u32: (a) => mem.u32(a) };   // для проверок
// ЛЮБОЕ НАЖАТИЕ ПО КАНВЕ НА ПАУЗЕ ПРОВОРАЧИВАЕТ НЕСКОЛЬКО ШАГОВ. Это и есть то место, где клик
// ещё «живой»: дальше он уходит в состояние мыши, которое читает только шаг движка. Трёх шагов
// хватает на всю цепочку — разбор мыши, раскладка приказа, исполнение, — и игра снова замирает.
// Работает во всей игре, не только на стенде: владелец — «это для всей игры надо».
for (const событие of ['pointerdown', 'pointerup'])
  cv.addEventListener(событие, () => {
    if (shell.paused && running && !playing && !net?.активна && shell.screen === 'game')
      шаговПаузы = Math.max(шаговПаузы, ШАГИ_НА_ПАУЗЕ);
  }, true);

// Где на экране первый свой юнит — для проверок: безголовому браузеру надо во что-то целиться.
globalThis.jwГдеСвой = () => {
  if (!mem || !eng) return null;
  const мой = mem.u8(G.humanOwner), camX = mem.u32(0x31ae8), camY = mem.u32(0x31aec);
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (mem.u8(UNITS + i + U.OWNER) !== мой || mem.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
    return { юнит: i, x: mem.u16(UNITS + i + U.X) - camX, y: mem.u16(UNITS + i + U.Y) - camY };
  }
  return null;
};

globalThis.jwПауза = () => {
  const s = mem ? mem.u32(0x31adc) : 0;   // UI.sel: выделенный юнит
  return { вКармане: приказыПаузы.length, шаговПаузы, пауза: !!shell.paused, выложено: выложеноНаПаузе,
           выделен: s, маска: s ? mem.u8(UNITS + s + U.STAT0B) : null, ожидает: mem ? mem.u8(0x31acc) : null,
           приказЮнита: s ? mem.u8(UNITS + s + U.ORDER) : null,
           поле47: s ? mem.u8(UNITS + s + 0x47) : null, поле4b: s ? mem.u8(UNITS + s + 0x4b) : null,
           панельныхКликов, диспВсего, диспСКликом, последнийСлот };
};
// ОДИН ТИК НА ПАУЗЕ. Слова владельца: «во время паузы, если какие-то действия делаем, удобно на
// один тик запускать игру, чтобы изменения успели примениться» — и отдельно про переключатели
// HP/OP/DP/MP/VP: «дай возможность выбирать эти штуки во время паузы». Приказ, отданный на паузе,
// лежит в кармане до снятия паузы, и на экране ничего не меняется: кнопка не загорается, потому
// что её состояние живёт в самом юните. Поэтому после любого приказа на паузе проворачиваем
// РОВНО ОДИН шаг симуляции — он выкладывает карман, применяет нажатие и снова останавливается.
// В сетевой партии этого делать нельзя: там темп задаёт локстеп, и лишний шаг ломает сверку.
// Сколько шагов надо провернуть на паузе. Счётчик, а не флаг: одного шага не хватает. Полная
// цепочка нажатия такая — движок разбирает мышь ВНУТРИ шага (0x29352), разбор превращает клик в
// «ожидающий приказ», следующий проход раскладывает его по обработчикам, и лишь потом приказ
// исполняется. Пока шагов нет, клик лежит мёртвым грузом: именно поэтому переключатели
// HP/OP/DP/MP/VP на паузе не реагировали, хотя тик от них я уже заказывал — заказывал я его из
// места, до которого управление на паузе просто не доходило.
// ПАУЗА — ЭТО ПАУЗА. Раньше нажатие на паузе проворачивало несколько шагов, чтобы приказ успел
// разобраться и примениться. Владелец: «убери проигрывание, когда пауза нажата и команда
// выполняется, слишком много шагов проигрывается, отключи это совсем». Ноль — ни одного шага;
// приказ, отданный на паузе, лежит в кармане и применится на первом настоящем шаге после снятия
// паузы. Число оставлено одной ручкой на случай, если он попросит вернуть.
const ШАГИ_НА_ПАУЗЕ = 0;
let шаговПаузы = 0;
// ВНУТРИ ЛИ МЫ НАСТОЯЩЕГО ШАГА. Раздача кликов (0x1419e) зовётся не только из шага, но и из
// отрисовки — на паузе она продолжает работать, и приказ, положенный в очередь движка оттуда,
// стирался в начале следующего шага (0x13f4c обнуляет очередь). Отсюда и загадка: нажатие
// доходило, счётчики росли, а маска прокачки не менялась. Поэтому приказы применяем только когда
// точно идёт шаг, а всё остальное время держим в кармане.
let вШаге = false;
F[0x1419e] = (e) => {
  if (!playing) {
    диспВсего++; if (mem.u8(0x31acc) !== 0xff) { диспСКликом++; последнийСлот = mem.u8(0x31acc); }
    // Мы внутри шага, сразу после обнуления очереди, — самое место выложить накопленное.
    if (приказыПаузы.length && (!shell.paused || вШаге)) {
      // НУЖЕН ВТОРОЙ ШАГ. Этот шаг только ВЫКЛАДЫВАЕТ приказ в очередь движка, а исполняется он
      // позже по ходу шага — и переключатель прокачки, например, применяется уже на следующем.
      // Владелец: «может, им два тика надо». Да, два: поэтому, выложив карман на паузе, просим
      // ещё один шаг.
      if (shell.paused) шаговПаузы = Math.max(шаговПаузы, ШАГИ_НА_ПАУЗЕ);
      for (const з of приказыПаузы.splice(0)) {
        выложеноНаПаузе++;
        rec.order(mem.u32(G.step), з.eax, з.esi, з.edi, з.edx, з.ebx);
        if (НАШИ_КОДЫ.has(з.eax & 0xff)) вОчередьПриказов(e, з.esi & 0xffff, з.eax & 0xff, з.edi & 0xffff, з.edx & 0xffff, з.ebx & 0xffff);
        else addOrder(e, з);
      }
    }
    return dispatchOrders(e);
  }
  const p = playing, step = mem.u32(G.step);
  mem.w16(0x33c86, 0);                               // как в оригинале — контрольная сумма очереди
  while (p.i < p.ord.length && p.ord[p.i].step <= step) {
    const z = p.ord[p.i++];
    p.injecting = true;
    try { F[0x14895](e, { eax: z.code, esi: z.unit, edi: z.tgt, edx: z.x, ebx: z.y }); }
    catch (err) { say(t('реплей: ') + err.message); }
    p.injecting = false;
  }
  mem.w8(0x31acc, 0xff);                             // клики зрителя до симуляции не доходят
};
F[0x1419e].наш = true;                               // inject.js: наша обёртка внутри, заново не ставить

// Идентификатор текущей записи для промежуточной отправки: свой на каждую партию, иначе вторая
// партия перезаписала бы на сервере первую.
let живойID = null;
/**
 * Начать запись партии: снимок памяти плюс правила, без которых её не воспроизвести.
 * @param {string} from откуда партия началась: 'mission', 'save', 'net', 'skirmish'
 */
function beginRecording(from) {
  if (playing) return;
  живойID = 'live-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  промежуточнаяКогда = 0;
  // Правила партии, без которых запись не воспроизвести один в один: какие механики включены и
  // какой компьютер сидел на каждом месте. Они фиксируются при создании партии и не меняются.
  // `правилаВерсия` растёт, когда в этот набор добавляются поля, — по нему читатель поймёт,
  // чего в старой записи просто нет.
  const правила = {
    правилаВерсия: ПРАВИЛА_ВЕРСИЯ,
    украшения: Артефакты.включено(),
    автоеда: Автоеда.включено(),
    ии: ИИ.все(eng).map(с => ({ цвет: с.цвет, вид: 'скрипт', уровень: с.уровень, характер: с.характер,
                                кайт: с.кайт || 'всегда',   // без него старая запись переигрывалась бы с другим поведением стрелков
                                мозги: с.мозгиИмя || 'скрипт', весаБойца: с.весаБойцаИмя || null, весаТактика: с.весаТактикаИмя || null,
                                весаКомдива: с.весаКомдиваИмя || null })),
    встроенныйИИ: [...Array(8)].map((_, s) => mem.u8(0x32aec + s)),
  };
  // Снимок памяти движка — это только половина партии: маршруты патрулей, очереди построек, планы
  // строек, украшения, камикадзе, цели магов, очередь приказов и всё состояние компьютерных штабов
  // живут в JS. По сети ровно этот набор едет вошедшему в комнату (lockstep.состояниеJS), а в
  // запись клался только огрызок — четыре поля из тринадцати, причём `шаги` терялись ещё и по
  // дороге в файл. Кладём целиком тем же вызовом: что хватает сетевому игроку, хватит и записи.
  // Старые поля пишем рядом — чтобы файл открывался и прежними сборками игры.
  rec.begin({ mission, tribe, difficulty: shell.difficulty ?? 1, path: pathMode(), build: BUILD, from,
              состояние: состояниеJS(eng),
              patrols: Patrol.dump(eng), queues: Очередь.dump(eng), следом: Следом.dump(eng), шаги: ОчередьПриказов.dump(eng), правила },
            mem.b.slice(Replay.SIM_LO, Replay.SIM_HI));
}
/** Закрыть запись и сохранить. Зовётся на победе, поражении, рестарте, выходе и загрузке сейва. */
async function saveReplay(outcome) {
  if (playing || !rec.on) return;
  const steps = mem.u32(G.step), r = rec.build(outcome, steps); rec.reset();
  статистика('конец', { исход: String(outcome || '').slice(0, 20), секунд: Math.round(steps * 55 / 1000) });
  if (!r) return;
  if (steps < 200 && !r.orders) return;              // вышли сразу же — хранить нечего
  try {
    const meta = await Replay.save(r); await Replay.prune();
    say(t('реплей сохранён: {name}, {d}', { name: meta.name, d: Replay.duration(steps) }));
    if (!repsPanel.hidden) fillReplays();
    await отправитьРеплей(meta.id);                  // и сразу на сервер, чтобы не пропал с вкладкой
    // Ждём отправку, а не просто запускаем: с кнопки «уровни» страница тут же уходит на другой
    // адрес, и незавершённый запрос браузер отменяет — запись терялась именно так.
  } catch (e) { say(t('реплей не сохранён: ') + e.message); }
}

// ---- реплеи на сервере (релей хранит их у себя, см. tools/net_server.mjs)
// Запись живёт в браузере, в IndexedDB, и умирает вместе с очищенным профилем. Поэтому сразу
// после партии копию отправляем релею: оттуда её видно с любого устройства и другим людям.
// Молча: если релея нет или он не отвечает, партия от этого не страдает.
const серверРеплеев = () => {
  const а = (netEl('netaddr')?.value || '').trim() || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/jw/net');
  return а.replace(/^ws/, 'http').replace(/\/$/, '') + '/replays';
};
// null — не знаем, false — не отвечал. Запоминаем неудачу НЕ на весь сеанс, а на минуту и для
// конкретного адреса: у релея бывает секундный перерыв, адрес можно поменять в поле лобби, — а
// прежняя версия после одной осечки молчала до перезагрузки страницы, и записи партий пропадали.
let релейОтвечает = null, релейАдрес = null, релейДо = 0;
/** Отправить запись релею. Молча: нет релея — партия от этого не страдает. */
async function отправитьРеплей(id) {
  if (релейОтвечает === false && серверРеплеев() === релейАдрес && Date.now() < релейДо) return;
  try {
    const r = await Replay.load(id); if (!r) return;
    const тело = Replay.encode(r);
    const ответ = await fetch(серверРеплеев(), { method: 'POST', body: тело,
      headers: { 'content-type': 'application/octet-stream', 'x-replay-id': String(id) } });
    if (!ответ.ok) throw new Error(ответ.status);
    релейОтвечает = true; отправленные.add(id);
    if (!repsPanel.hidden) fillReplays();
  } catch (e) { релейОтвечает = false; релейАдрес = серверРеплеев(); релейДо = Date.now() + 60000; }
}
const отправленные = new Set();                      // что уже уехало на сервер в этом сеансе
// Закрытая вкладка и перезагрузка. Обычная отправка тут не годится: браузер убивает страницу
// раньше, чем `fetch` уйдёт, и запись партии пропадает — а это как раз самый частый способ
// закончить игру. Поэтому собираем запись из памяти (это синхронно) и отдаём её `sendBeacon`:
// он для того и сделан — отправить последний пакет с уходящей страницы.
function реплейМаяком() {
  if (playing || !rec.on || !running) return;
  try {
    const steps = mem.u32(G.step), r = rec.build('exit', steps);
    if (!r || (steps < 200 && !r.orders)) return;
    const тело = Replay.encode(r);
    // Тип у маяка нарочно text/plain: с ним запрос считается «простым» и уходит без предварительной
    // проверки CORS. С application/octet-stream браузер сначала шлёт OPTIONS, а маяку это
    // недоступно — и на чужом порту (стенд, свой релей) запись молча пропадала. Релею тип не важен,
    // он читает тело как есть.
    navigator.sendBeacon?.(серверРеплеев(), new Blob([тело], { type: 'text/plain;charset=UTF-8' }));
    Replay.save(r).catch(() => {});                 // и в браузер, если успеет
    rec.reset();
  } catch {}
}
addEventListener('pagehide', реплейМаяком);

// Защита партии от случайного ухода (владелец, 03.10.2026: боковые кнопки мыши «назад/вперёд»
// выкидывали из миссии). Три слоя:
//  1) кнопки мыши 4 и 5 (button 3/4) глушим на всех событиях — Chrome, Edge и Firefox тогда никуда не идут;
//  2) если «назад» всё же сработал (драйвер мыши шлёт его клавишей, свайп тачпада), под страницей
//     лежит пустая запись истории: в миссии ставим её заново и остаёмся, вне миссии уходим дальше.
//     Запись ставится по первому нажатию — без жеста пользователя Chrome такие записи пропускает;
//  3) закрытие вкладки, перезагрузка и переход во время миссии — стандартный вопрос браузера
//     «Покинуть сайт?». Свои переходы (выбор уровня, сцены, выход) ставят свойУход и идут без вопроса.
let свойУход = false, ловушкаИстории = false;
window.jwСвойУход = () => { свойУход = true; };     // для перезагрузки по новому коду в game.html
const вМиссии = () => shell.screen === 'game' && running && !playing;
for (const тип of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'])
  addEventListener(тип, (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation(); } }, { capture: true });
const поставитьЛовушку = () => {
  if (ловушкаИстории) return;
  try { history.pushState({ jwЛовушка: 1 }, '', location.href); ловушкаИстории = true; } catch {}
};
addEventListener('pointerdown', поставитьЛовушку, { capture: true });
addEventListener('keydown', поставитьЛовушку, { capture: true });
addEventListener('popstate', () => {
  ловушкаИстории = false;
  if (вМиссии()) поставитьЛовушку(); else history.back();
});
addEventListener('beforeunload', (e) => {
  // Пока спрашиваем, запись партии не отправляем и не сбрасываем: если игрок останется, она
  // продолжится как была. При настоящем уходе её увезёт pagehide.
  if (вМиссии() && !свойУход) { e.preventDefault(); e.returnValue = ''; return; }
  реплейМаяком();
});
// Партия уезжает на сервер не только в конце, но и по ходу — раз в минуту. Причина простая:
// `sendBeacon` умеет отправить не больше ~64 КБ, а запись партии весит сотни, и при закрытой
// вкладке она бы пропала целиком. Промежуточная отправка идёт под тем же идентификатором, релей
// перезаписывает файл — в итоге на сервере всегда лежит партия «по крайней мере до этой минуты».
const ПРОМЕЖУТОК_МС = 60000;
let промежуточнаяКогда = 0;
setInterval(async () => {
  if (playing || !rec.on || !running || shell.paused) return;
  const steps = mem.u32(G.step);
  // Первая отправка — сразу, как партия набрала 400 шагов (это ~22 секунды игры), дальше раз в
  // минуту. Сравнивать с нулём нельзя: `performance.now()` в начале сеанса сам меньше минуты, и
  // условие «прошла минута» ложно срабатывало как «ещё рано» — первая копия уезжала только через
  // минуту после ЗАГРУЗКИ страницы, а не после начала партии.
  if (steps < 400) return;
  if (промежуточнаяКогда && performance.now() - промежуточнаяКогда < ПРОМЕЖУТОК_МС) return;
  промежуточнаяКогда = performance.now();
  try {
    const r = rec.build('идёт', steps);                 // копия записи, сама запись продолжается
    if (!r) return;
    const тело = Replay.encode(r);
    await fetch(серверРеплеев(), { method: 'POST', body: тело,
      headers: { 'content-type': 'application/octet-stream', 'x-replay-id': живойID || 'live' } });
  } catch {}
}, 15000);
/** Список записей, которые лежат на релее (их видно с любого устройства). */
async function списокСервера() {
  try {
    const ответ = await fetch(серверРеплеев(), { cache: 'no-store' });
    if (!ответ.ok) { релейОтвечает = false; релейАдрес = серверРеплеев(); релейДо = Date.now() + 60000; return null; }
    релейОтвечает = true;
    return await ответ.json();
  } catch { релейОтвечает = false; релейАдрес = серверРеплеев(); релейДо = Date.now() + 60000; return null; }
}
/** Скачать запись с релея и сразу открыть её на просмотр. */
async function смотретьСРервера(id) {
  say(t('реплей: качаю с сервера…'));
  try {
    const ответ = await fetch(серверРеплеев() + '/' + encodeURIComponent(id), { cache: 'no-store' });
    if (!ответ.ok) throw new Error(ответ.status);
    const r = Replay.decode(new Uint8Array(await ответ.arrayBuffer()));
    await playReplay(r);
  } catch (e) { say(t('не удалось скачать реплей: ') + e.message); }
}

// ---- сохранение партии на сервер (кнопка ☁ внизу)
// Владелец: «добавь сохранение на сервер, кнопочку снизу». Зачем: заметил странное в партии —
// нажал, и разработчик открывает ровно это положение по ссылке game.html?save=<id>, а не гадает
// по описанию. В файл идёт то же, что в обычный сейв: снимок всей памяти движка (сжатый) и
// JS-состояние слоёв (маршруты, очереди, планы, ИИ, украшения). Хранит релей (tools/net_server.mjs,
// каталог out/saves), адрес — соседний с реплеями.
const серверСейвов = () => серверРеплеев().replace(/\/replays$/, '/saves');
const в64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const из64 = (s) => { const b = atob(s), u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i); return u8; };
async function сейвНаСервер() {
  if (!running || shell.screen !== 'game' || playing) { say(t('сохранять нечего: партия не идёт')); return; }
  const кн = document.getElementById('cloudsave'); кн.disabled = true;
  try {
    const снимок = await Сейвы.deflate(mem.b.slice(0x30000));
    const meta = { mission, tribe, difficulty: shell.difficulty ?? 1, date: Date.now(), build: BUILD, step: mem.u32(G.step),
                   состояние: состояниеJS(eng), patrols: Patrol.dump(eng), queues: Очередь.dump(eng), шаги: ОчередьПриказов.dump(eng) };
    const ответ = await fetch(серверСейвов(), { method: 'POST', body: JSON.stringify({ meta, data: в64(снимок) }),
                                               headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    if (!ответ.ok) throw new Error(ответ.status + ' ' + await ответ.text());
    const { id } = await ответ.json();
    const ссылка = location.origin + location.pathname + '?save=' + id;
    try { await navigator.clipboard?.writeText(ссылка); } catch {}
    say(t('сохранено на сервер: {id}', { id })); toast(t('сохранено на сервер: {id}', { id }));
  } catch (e) { say(t('не удалось сохранить на сервер: ') + e.message); toast(t('не удалось сохранить на сервер: ') + e.message); }
  finally { кн.disabled = false; }
}
document.getElementById('cloudsave').onclick = () => сейвНаСервер();
/** Открыть сохранение с сервера: ссылка game.html?save=<id>. */
async function сейвССервера(id) {
  const ответ = await fetch(серверСейвов() + '/' + encodeURIComponent(id), { cache: 'no-store' });
  if (!ответ.ok) throw new Error(ответ.status);
  const { meta, data } = await ответ.json();
  const снимок = await Сейвы.inflate(из64(data));
  shell.onLeaveGame?.('load');
  shell.mission = meta.mission; shell.tribe = meta.tribe; shell.difficulty = meta.difficulty ?? 1;
  shell.toGame(); shell.onRestore(снимок, meta);
}

// ---- воспроизведение
async function playReplay(что) {
  // Принимаем и номер записи в браузере, и уже готовую запись (скачанную с сервера).
  const r = (что && typeof что === 'object') ? { ...что, snapshot: что.snapshot || await Replay.распаковать(что.snap) } : await Replay.load(что);
  if (!r) { say(t('реплей не найден')); return; }
  closeReps(); say(t('реплей: загрузка ресурсов…'));
  // Паки под саму запись. Раньше грузились только эти пять — и запись СЕТЕВОЙ партии (карты 100+
  // лежат в _PWAR13.TRC, демо-карты 200+ в _PWAR10.TRC) открывалась лишь в той вкладке, где до
  // этого играли в скирмиш: в свежей падало «нет пака _PWAR13.TRC». Заметно это стало, когда в
  // списке появились учебные сцены — они все на сетевых картах.
  const паки = ['_PWAR08.TRC', '_PWAR09.TRC', '_PWAR04.TRS', '_PWAR05.TRS', '_PWAR06.TRW'];
  if (r.mission >= 200) паки.push('_PWAR10.TRC'); else if (r.mission >= 100) паки.push('_PWAR13.TRC');
  for (const f of паки) await need(f);
  enableSound();
  eng = loadMission(mem, files, r.mission, r.tribe, r.difficulty);   // тайлсет, спрайты племени, палитра
  mem.b.set(r.snapshot, Replay.SIM_LO);                              // и точное состояние на старте партии
  eng.files = files; shell.eng = eng; rend.eng = eng;
  mission = r.mission; tribe = r.tribe; shell.mission = r.mission; shell.tribe = r.tribe;
  const пр = r.правила || {};
  if (r.состояние) {
    // Новая запись: поднимаем весь JS-мир одним вызовом — тем же, каким входят в сетевую комнату.
    // Сюда входят и штабы компьютера целиком (уровень, характер, кайт, СТРАТЕГ-ПРАВИЛО, фаза,
    // разведанное, отряды, курьеры) — раньше их собирали заново из куцего блока «правила», и место
    // «компьютер: стратег» переигрывалось обычным скриптом, то есть запись расходилась сразу.
    восстановитьJS(eng, r.состояние);
  } else {
    // Старая запись: что было, то и поднимаем.
    Patrol.restore(eng, r.patrols); Очередь.restore(eng, r.queues); Следом.restore(eng, r.следом); ОчередьПриказов.restore(eng, r.шаги);
    Артефакты.задать(eng, !!пр.украшения); Автоеда.задать(eng, !!пр.автоеда);
    ИИ.сброс(eng);
    // `кайт` в старых записях отсутствует — там стрелки отскакивали всегда, поэтому умолчание.
    for (const к of (пр.ии || [])) ИИ.задать(eng, к.цвет, { уровень: к.уровень, характер: к.характер, кайт: к.кайт || 'всегда', ...Сети.дляМеста(к) });
  }
  // Записи с нейросетями: сами веса в файл не кладутся (мегабайты), в снимке только имена файлов.
  // Скачиваем и подставляем объекты сетей поверх поднятых штабов.
  const нужныВеса = (пр.ии || []).some(к => к.весаБойца || к.весаТактика || к.весаКомдива);
  for (const к of (пр.ии || [])) { const с = ИИ.состояние(eng, к.цвет); if (с) Object.assign(с, Сети.дляМеста(к)); }
  if (нужныВеса) Сети.подготовить(пр.ии).then((беда) => {
    for (const к of (пр.ии || [])) { const с = ИИ.состояние(eng, к.цвет); if (!с) continue; Object.assign(с, Сети.дляМеста(к)); }
    // Без весов запись переигрывается ДРУГИМ компьютером — это надо видеть, а не догадываться.
    const нет = беда.length ? беда : Сети.чегоНеХватает(пр.ии);
    if (нет.length) { const т = t('реплей пойдёт вразнос: не подключилась нейросеть — {e}', { e: нет.join(', ') });
      say(т); toast(т); console.error(т); }
  });
  if (пр.встроенныйИИ) for (let sl = 0; sl < 8; sl++) mem.w8(0x32aec + sl, пр.встроенныйИИ[sl] | 0);
  if (r.path && r.path !== pathMode()) { setPathMode(r.path); showPath(); }   // алгоритм пути тоже часть записи
  const dv = new DataView(r.recs.buffer, r.recs.byteOffset, r.recs.byteLength), ord = [], ev = [];
  for (let k = 0; k < r.recs.length / Replay.REC_SIZE; k++) {
    const o = k * Replay.REC_SIZE;
    const z = { step: dv.getUint32(o, true), kind: dv.getUint8(o + 4), code: dv.getUint8(o + 5),
                unit: dv.getUint16(o + 8, true), tgt: dv.getUint16(o + 10, true),
                x: dv.getUint16(o + 12, true), y: dv.getUint16(o + 14, true) };
    (z.kind === Replay.KIND_ORDER ? ord : ev).push(z);
  }
  playing = {
    r, ord, ev, i: 0, ei: 0, si: 0, speed: 1, paused: false, injecting: false, mismatch: null, done: false,
    сцена: !!(r.правила && r.правила.сцена),                          // учебная сцена, а не миссия
    sv: new DataView(r.sync.buffer, r.sync.byteOffset, r.sync.byteLength), sn: r.sync.length / 8 | 0,
  };
  shell.screen = 'game'; shell.tune('game'); shell.paused = false; running = true;
  rend.drawFull(); setPaused(false);
  rpbar.hidden = false; rpseek.max = String(r.steps || 1); updateRpBar();
  say(`реплей: ${r.name}`);
}
/** Один шаг записи. События мимо очереди приказов (тираннозавр) идут между тиками — там же,
 *  где их и записали; сами приказы вносятся внутри тика, см. подмену 0x1419e ниже. */
function replayStep() {
  const p = playing, step = mem.u32(G.step);
  while (p.ei < p.ev.length && p.ev[p.ei].step <= step) {
    const z = p.ev[p.ei++]; p.injecting = true;
    try { if (z.kind === Replay.KIND_DINO) создатьТираннозавра(z.x, z.y); }   // KIND_BRACHIO из старых записей пропускаем
    catch (err) { say(t('реплей: ') + err.message); }
    p.injecting = false;
  }
  eng.timer++; eng.tick();
  // Сверка с записью — то же, что делал сетевой пакет 0xf8 в оригинале. Важно, что хеш берётся
  // сразу после тика: при записи в этот момент тоже ещё ничего другого не выполнялось.
  const now = mem.u32(G.step);
  while (p.si < p.sn) {
    const s = p.sv.getUint32(p.si * 8, true); if (s > now) break;
    // Записи первой версии считали хеш по другой формуле (в него входил «нарисован в кадре»),
    // поэтому их контрольные суммы с нынешними несравнимы — сверку по ним не делаем.
    if (s === now && (p.r.ver | 0) >= Replay.ВЕРСИЯ
        && Replay.stateHash(mem) !== (p.sv.getUint32(p.si * 8 + 4, true) >>> 0) && p.mismatch == null) {
      p.mismatch = s; say(`реплей разошёлся с записью на шаге ${s}`);
    }
    p.si++;
  }
  // Условия миссии в живой партии проверяются из кадра, а при просмотре кадров на шаг приходится
  // сколько угодно — зовём проверку сами, на тех же шагах, кратных 32. Только после сверки:
  // проверка досчитывает суммы еды, а в записи на этот момент их ещё не было.
  // Учебная сцена — не миссия: в ней соперника может не быть вовсе, и обычная проверка условий
  // объявила бы победу на первом же тике, оборвав просмотр на нулевой секунде (ровно это и
  // случилось со сценами «качалка»). Поэтому для сцен условия не считаем и конец не слушаем.
  if (!p.сцена && (now & 0x1f) === 0) { try { call(eng, 0x17728, {}); } catch { /* посчитается на следующем */ } }
  if (!p.сцена && mem.u8(G.endcode)) return false;
  return p.i < p.ord.length || p.ei < p.ev.length || now < p.r.steps;
}
/** Тик просмотра: прокрутить столько шагов, сколько успеем за 12 мс, чтобы не ронять кадры. */
function driveReplay() {
  const p = playing;
  if (shell.screen === 'menu') return exitReplay();          // вышли в меню — просмотр закончен
  if (p.done || p.paused || shell.paused || shell.screen !== 'game') return;
  const t0 = performance.now(); let n = p.speed > 0 ? p.speed : 1 << 20;
  while (n-- > 0) {
    if (!replayStep()) { endPlayback(); return; }
    if (performance.now() - t0 >= 12) break;          // кадр держать нельзя даже на «максимуме»
  }
  updateRpBar();
}
/** Запись досмотрена: остановиться и написать исход. */
function endPlayback() {
  const p = playing; if (!p) return;
  p.done = true; running = false;
  const end = mem.u8(G.endcode);
  say(end === 2 ? 'реплей досмотрен: победа' : end === 1 ? 'реплей досмотрен: поражение' : 'реплей закончился');
  updateRpBar();
}
/** Выйти из просмотра в главное меню. */
function exitReplay() {
  if (!playing) return;
  playing = null; running = false; rpbar.hidden = true; rec.reset();
  shell.toMenu(); say('');
}
/** Перемотка — это пересчёт с начала: 20 тысяч шагов проходят примерно за секунду. */
function seekReplay(step) {
  const p = playing; if (!p) return;
  const t0 = performance.now();
  mem.b.set(p.r.snapshot, Replay.SIM_LO);
  eng = new Engine(mem); eng.files = files; shell.eng = eng; rend.eng = eng;
  p.i = 0; p.ei = 0; p.si = 0; p.mismatch = null; p.done = false;
  while (mem.u32(G.step) < step) if (!replayStep()) { endPlayback(); break; }
  rend.drawFull(); updateRpBar();
  say(t('перемотка на {d} за {ms} мс', { d: Replay.duration(mem.u32(G.step)), ms: (performance.now() - t0) | 0 }));
}

// ---- панель просмотра поверх игры
const rpbar = document.getElementById('rpbar'), rpplay = document.getElementById('rpplay');
const rpseek = document.getElementById('rpseek'), rptime = document.getElementById('rptime');
const rpspeed = document.getElementById('rpspeed');
/** Подтянуть полосу просмотра: шаг, скорость, кнопки паузы и перемотки. */
function updateRpBar() {
  const p = playing; if (!p) return;
  const step = mem.u32(G.step);
  if (document.activeElement !== rpseek) rpseek.value = String(step);
  rptime.textContent = `${Replay.duration(step)} / ${Replay.duration(p.r.steps)}` + (p.mismatch != null ? ' ⚠' : '');
  rpplay.textContent = p.done ? '⟲' : p.paused ? '▶' : '⏸';
  rpspeed.textContent = p.speed === 0 ? '×max' : '×' + p.speed;
}
rpplay.onclick = () => { const p = playing; if (!p) return;
  if (p.done) return seekReplay(0);
  p.paused = !p.paused; updateRpBar(); };
rpspeed.onclick = () => { const p = playing; if (!p) return;
  p.speed = { 1: 2, 2: 4, 4: 8, 8: 0, 0: 1 }[p.speed]; updateRpBar(); };
rpseek.oninput = () => { const p = playing; if (!p) return; rptime.textContent = Replay.duration(+rpseek.value) + ' …'; };
rpseek.onchange = () => { if (playing) seekReplay(+rpseek.value); };
document.getElementById('rpexit').onclick = exitReplay;

// ---- список реплеев (обвязка страницы; в игровые экраны это пока не встроено)
const repsPanel = document.getElementById('reps'), repsList = document.getElementById('repslist');
const repsSum = document.getElementById('repssum');
/** Перебрать список записей — свои из браузера и серверные — и разложить их в панель. */
/**
 * Показывать только сцены. Сцена — это подготовленное положение (стадо и никого вокруг, отряд
 * врассыпную, чужой отряд у дома), записанное как обычная партия: её видно в том же списке и
 * можно посмотреть с паузой и перемоткой. Имя у таких записей начинается со слова «сцена».
 */
let толькоСцены = false;
const этоСцена = (r) => String(r?.name || '').startsWith('сцена');

async function fillReplays() {
  const свои = await Replay.list();
  repsSum.textContent = свои.length
    ? `${свои.length} шт., ${(свои.reduce((s, r) => s + (r.bytes || 0), 0) / 1048576).toFixed(1)} МБ`
    : t('пока пусто — сыграй партию, она запишется сама');
  repsList.innerHTML = '';
  const фильтр = (сп) => (толькоСцены ? сп.filter(этоСцена) : сп);
  if (толькоСцены) заголовокРеплеев(t('показаны только учебные сцены'));
  else await строкиСейвов();
  строкиРеплеев(t('мои записи'), фильтр(свои), false);
  // Серверные тянем следом: сеть может и не ответить, а свои показать надо сразу.
  const сервер = await списокСервера();
  if (сервер === null) { заголовокРеплеев(t('на сервере: нет связи с релеем')); return; }
  строкиРеплеев(t('на сервере ({n})', { n: фильтр(сервер).length }), фильтр(сервер), true);
}
/** Раздел «сохранения на сервере» (кнопка ☁): загрузить в один щелчок или скопировать ссылку. */
async function строкиСейвов() {
  let список;
  try { const о = await fetch(серверСейвов(), { cache: 'no-store' }); список = о.ok ? await о.json() : null; } catch { список = null; }
  if (список === null) { заголовокРеплеев(t('сохранения на сервере: нет связи с релеем')); return; }
  заголовокРеплеев(t('сохранения на сервере ({n})', { n: список.length }) + (список.length ? '' : t(' — пусто')));
  for (const r of список.slice(0, 30)) {
    const row = document.createElement('div'); row.className = 'rprow';
    const d = new Date(r.date);
    row.innerHTML = `<div class="rpname"></div><div class="rpmeta"></div>`;
    row.querySelector('.rpname').textContent = `☁ ${ПЛЕМЕНА_ИМЕНА[r.tribe] || r.tribe} · ${t('стадия')} ${(r.mission ?? 0) + 1} · ${Replay.СЛОЖНОСТИ[r.difficulty] || r.difficulty}`;
    row.querySelector('.rpmeta').textContent = `${Replay.duration(r.step || 0)} ${t('от начала')} · ${((r.bytes || 0) / 1024) | 0} КБ · ` +
      `${d.toLocaleDateString()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const btns = document.createElement('div'); btns.className = 'rpbtns';
    const mk = (t2, title, fn) => { const b = document.createElement('button'); b.textContent = t2; b.title = title; b.onclick = fn; btns.appendChild(b); };
    mk('▶', t('загрузить'), async () => {
      if (running && !playing && !confirm(t('Загрузить сохранение? Текущая партия не сохранится.'))) return;
      closeReps();
      try { await сейвССервера(r.id); } catch (e) { say(t('не удалось открыть сохранение: ') + e.message); }
    });
    mk('🔗', t('скопировать ссылку'), async () => {
      try { await navigator.clipboard.writeText(location.origin + location.pathname + '?save=' + r.id); say(t('ссылка скопирована')); } catch { say(r.id); }
    });
    row.appendChild(btns); repsList.appendChild(row);
  }
}
/** Заголовок над списком записей (сколько их и откуда). */
function заголовокРеплеев(текст) {
  const h = document.createElement('div'); h.className = 'rphead'; h.textContent = текст; repsList.appendChild(h);
}
/** Нарисовать раздел списка: свои записи (из браузера) или серверные (только смотреть и скачать). */
function строкиРеплеев(заголовок, список, серверные) {
  заголовокРеплеев(список.length ? заголовок : заголовок + t(' — пусто'));
  for (const r of список) {
    const row = document.createElement('div'); row.className = 'rprow';
    const d = new Date(r.date);
    row.innerHTML = `<div class="rpname"></div><div class="rpmeta"></div>`;
    row.querySelector('.rpname').textContent = (r.name || '') + (!серверные && отправленные.has(r.id) ? ' ↑' : '');
    row.querySelector('.rpmeta').textContent =
      `${Replay.duration(r.steps)} · ${r.orders} приказов · ${Replay.СЛОЖНОСТИ[r.difficulty] || r.difficulty}` +
      ` · путь ${r.path} · ${((r.bytes || 0) / 1024) | 0} КБ · ${d.toLocaleDateString()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const btns = document.createElement('div'); btns.className = 'rpbtns';
    const mk = (t2, title, fn) => { const b = document.createElement('button'); b.textContent = t2; b.title = title; b.onclick = fn; btns.appendChild(b); };
    if (серверные) {
      mk('▶', t('смотреть'), () => смотретьСРервера(r.id));
      mk('⤓', t('скачать файл .jwr'), () => { const a = document.createElement('a'); a.href = серверРеплеев() + '/' + encodeURIComponent(r.id); a.download = (r.name || r.id) + '.jwr'; a.click(); });
    } else {
      mk('▶', t('смотреть'), () => playReplay(r.id));
      mk('⤓', t('скачать файл .jwr'), () => downloadReplay(r.id));
      if (!отправленные.has(r.id)) mk('↑', t('отправить на сервер'), async () => { await отправитьРеплей(r.id); fillReplays(); });
      mk('✕', t('удалить'), async () => { await Replay.remove(r.id); fillReplays(); });
    }
    row.appendChild(btns); repsList.appendChild(row);
  }
}

/** Сохранить запись файлом .jwr на диск. */
async function downloadReplay(id) {
  const r = await Replay.load(id); if (!r) return;
  const blob = new Blob([Replay.encode(r)], { type: 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${r.name.replace(/[^\w.-]+/g, '_')}.jwr`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/** Открыть панель записей. */
function openReps() { repsPanel.hidden = false; fillReplays(); }
/** Закрыть панель записей. */
function closeReps() { repsPanel.hidden = true; }
// ---- тач-схема: одно место, откуда включается всё «пальцевое» управление.
// Просьба владельца: «это дополнительная штука, которая должна быть отключаема, по умолчанию
// включается на телефонах и планшетах, на десктопах старое управление сохраняем».
const touchuiБтн = document.getElementById('touchui');
let тачСхема = (localStorage.getItem('jw.touchui') ?? (matchMedia('(pointer: coarse)').matches ? '1' : '0')) === '1';
/** Применить тач-схему: замок выделения в движке и наши жесты по карте. */
function применитьТач() {
  Ввод.ТАЧСХЕМА.замок = тачСхема;
  // Тач-схема — это ПРЯМОЕ касание по карте: палец тыкает туда, куда смотрит, и тащит карту за
  // собой. Режим «pad» (палец водит курсор, как по тачпаду ноутбука) с этим несовместим — там
  // жест до карты просто не доходит. Поэтому при включении схемы переводим ввод в прямой режим,
  // а при выключении возвращаем то, что человек выбирал сам.
  if (тачСхема && padMode) { padMode = false; input.setPad(false); markMode(); fit(); }
  else if (!тачСхема) {
    const хочет = (localStorage.getItem('jw.pmode') ?? (matchMedia('(pointer: coarse)').matches ? 'pad' : 'tap')) === 'pad';
    if (хочет !== padMode) { padMode = хочет; input.setPad(padMode); markMode(); fit(); }
  }
  input.тащитьКарту = тачСхема ? (x) => shell.screen === 'game' && running && x < (mem.u32(0x488c4) || 640) : null;
  // Камеру везём сами: палец тянет карту «за собой», поэтому знак обратный. Пределы те же, что у
  // прокрутки стрелками — дальше края карты не уедем.
  // Что начинается под пальцем: протяжка ОТ своего юнита — приказ, всё остальное — камера.
  input.жестСюда = тачСхема ? (x, y) => {
    const мир = { x: (x + mem.u32(0x31ae8)) | 0, y: (y + mem.u32(0x31aec)) | 0 };
    const i = подПальцем(мир.x, мир.y);
    return (i && mem.u8(UNITS + i + U.OWNER) === mem.u8(G.humanOwner) && mem.u8(UNITS + i + U.TYPE) < 0x1a) ? 'приказ' : 'рамка';
  } : null;
  input.ведётПриказ = тачСхема ? (x0, y0, x1, y1) => { жестПриказа = (x0 === null) ? null : { x0, y0, x1, y1 }; } : null;
  // Долгий тап: выделить того, кто под пальцем, в обход замка.
  // Кнопки панели, переназначенные под палец: «отнести на базу» → отступление (короткий тап),
  // мясо в инвентаре → собрать всё (долгое нажатие).
  Ввод.ТАЧКНОПКИ.отступление = тачСхема ? () => отходНазад() : null;
  Ввод.ТАЧКНОПКИ.сборМяса = тачСхема ? () => собратьМясо() : null;
  input.кругОткрыть = тачСхема ? (x, y) => кругОткрыть(x, y) : null;
  input.кругВести = тачСхема ? (x, y) => кругВести(x, y) : null;
  input.кругВыбрать = тачСхема ? (x, y) => кругВыбрать(x, y) : null;
  input.выделитьСилой = тачСхема ? (x, y) => {
    try { Ввод.выделитьСилой(eng, (x + mem.u32(0x31ae8)) | 0, (y + mem.u32(0x31aec)) | 0); } catch {}
  } : null;
  input.отдатьПриказ = тачСхема ? (x0, y0, x1, y1) => приказЖестом(x0, y0, x1, y1) : null;
  // Камеру двигаем ТОЛЬКО по границам клеток. Отрисовка сцены считает строку карты как camY×16 —
  // это верно лишь для значений, кратных 32; при попиксельном сдвиге индекс уезжает, и поле
  // становится чёрным (жалоба владельца со снимком: панель цела, карта пропала). Поэтому копим
  // остаток пальца в `хвостПальца` и переносим камеру целыми клетками — на глаз это та же плавность.
  input.везтиКарту = тачСхема ? (dx, dy) => {
    хвостПальца.x += dx; хвостПальца.y += dy;
    const клx = (хвостПальца.x / 32) | 0, клy = (хвостПальца.y / 32) | 0;
    if (!клx && !клy) return;
    хвостПальца.x -= клx * 32; хвостПальца.y -= клy * 32;
    const окнШ = mem.u32(0x31af0) || 16, окнВ = mem.u32(0x31af4) || 15;
    const прX = Math.max(0, (mem.u32(G.mapW) - окнШ) << 5), прY = Math.max(0, (mem.u32(G.mapH) - окнВ) << 5);
    mem.w32(0x31ae8, Math.min(прX, Math.max(0, mem.u32(0x31ae8) - клx * 32)));
    mem.w32(0x31aec, Math.min(прY, Math.max(0, mem.u32(0x31aec) - клy * 32)));
    rend.drawFull();
  } : null;
  touchuiБтн.classList.toggle('on', тачСхема);
  document.getElementById('retreat').hidden = !тачСхема;
}
touchuiБтн.onclick = () => { тачСхема = !тачСхема; localStorage.setItem('jw.touchui', тачСхема ? '1' : '0');
  применитьТач(); say(t(тачСхема ? 'управление пальцем: включено' : 'управление пальцем: выключено')); cv.focus(); };
применитьТач();
document.getElementById('retreat').onclick = () => { отходНазад(); cv.focus(); };
document.getElementById('giveitems').onclick = () => { раздатьВещи(); cv.focus(); };
document.getElementById('dropitems').onclick = () => { скинутьЛишнее(); cv.focus(); };
document.getElementById('repsbtn').onclick = () => { толькоСцены = false; return repsPanel.hidden ? openReps() : closeReps(); };

// ---- панель учебных сцен: не список записей, а сами сцены — их запускают живьём
const scPanel = document.getElementById('scenes'), scList = document.getElementById('sceneslist');
const scBrain = document.getElementById('scenesbrain'), scSum = document.getElementById('scenessum');
/** Разложить сцены в панель: имя, что смотрим, карта и длительность, кнопка «запустить». */
function fillScenes() {
  scList.innerHTML = '';
  const имена = Object.keys(СЦЕНЫ);
  scSum.textContent = t('{n} шт. · обе стороны ведёт компьютер, идёт вживую', { n: имена.length });
  for (const имя of имена) {
    const сц = СЦЕНЫ[имя];
    const row = document.createElement('div'); row.className = 'scrow';
    const лев = document.createElement('div');
    лев.innerHTML = '<div class="scname"></div><div class="scwhat"></div>';
    лев.querySelector('.scname').textContent = имя;
    лев.querySelector('.scwhat').textContent = t(сц.что);
    const мета = document.createElement('div'); мета.className = 'scmeta';
    мета.textContent = t('карта {m} · ~{s} с', { m: сц.карта, s: сц.секунд }) + (сц.безВрага ? ' · ' + t('без врага') : '');
    const b = document.createElement('button'); b.textContent = t('запустить');
    b.onclick = () => { closeScenes(); startScene(имя, scBrain.value); };
    row.append(лев, мета, b); scList.appendChild(row);
  }
}
function openScenes() { scPanel.hidden = false; fillScenes(); }
function closeScenes() { scPanel.hidden = true; }
// «сцены» — сцены ТРЕНИРОВКИ НЕЙРОНОК: полсотни арен из reimpl/js/ai/scenes.js, на которых учится
// сеть одного бойца. Просмотрщик у них свой (arena.html): там видно выбранное действие, награду и
// её разбор, можно переключить политику со скрипта на любые веса. Слова владельца: «кнопка сцена
// должна вести на сцены тренировки нейронок».
document.getElementById('scenesbtn').onclick = () => { свойУход = true; location.href = 'arena.html'; };
// «сцены племени» — другое: целое племя на настоящей карте, обе стороны ведёт компьютер.
document.getElementById('tribescbtn').onclick = () => (scPanel.hidden ? openScenes() : closeScenes());
document.getElementById('scenesclose').onclick = closeScenes;
try { scBrain.value = localStorage.getItem('jw.scenebrain') || 'скрипт'; } catch {}
scBrain.onchange = () => { try { localStorage.setItem('jw.scenebrain', scBrain.value); } catch {} };
document.getElementById('repsclose').onclick = closeReps;
document.getElementById('repsimport').onclick = () => document.getElementById('repsfile').click();
document.getElementById('repsclear').onclick = async () => { if (confirm(t('Удалить все реплеи?'))) { await Replay.clear(); fillReplays(); } };
document.getElementById('repsfile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const r = Replay.decode(new Uint8Array(await f.arrayBuffer())); await Replay.save(r); fillReplays(); say(t('реплей загружен')); }
  catch (err) { say(t('не удалось прочитать файл: ') + err.message); }
  e.target.value = '';
};

// ---- сетевая игра (js/net/игра.js): лобби в панели #netp, партия — локстеп поверх обычного цикла.
const netPanel = document.getElementById('netp'), netBar = document.getElementById('netbar');
/** Короткий доступ к элементам панели сетевой игры. */
const netEl = (id) => document.getElementById(id);
const NET_FILES = ['_PWAR08.TRC', '_PWAR13.TRC', '_PWAR10.TRC', '_PWAR09.TRC', '_PWAR04.TRS', '_PWAR05.TRS', '_PWAR06.TRW'];
/** Догрузить всё, без чего сетевую партию не начать: карты, тайлы, спрайты, звук, полный пак экранов. */
async function ensureNetFiles() {
  for (const f of NET_FILES) { netEl('netstat').textContent = 'загрузка ' + f + '…'; await need(f, (p) => { netEl('netstat').textContent = `${f} ${p}%`; }); }
  await ensureFull02(); shell.fullPack = true; enableSound();
}
// Ключ игрока: по нему релей отдаёт то же место после обрыва. Свой на каждую комнату, живёт в
// localStorage; ?key= — для проверок.
function netKey() {
  const q = new URLSearchParams(location.search); if (q.get('key')) return q.get('key');
  const room = document.getElementById('netroom').value.trim() || 'общая', k = 'jw.ключ.' + room;
  let v = localStorage.getItem(k);
  if (!v) { v = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(k, v); }
  return v;
}
net = new СетеваяИгра({
  движок: () => eng, память: () => mem, отладка: new URLSearchParams(location.search).has('debug'), т: t,
  get ключ() { return netKey(); },
  наОжидание: () => drawWait(),
  загрузить: async (миссия, племя, сложность) => { await ensureNetFiles(); netLoading = true; try { startMission(миссия, племя, сложность); } finally { netLoading = false; } return eng; },
  /** Какие племена есть на карте: миссия грузится в копию памяти, чтобы не трогать меню. */
  владельцы: async (миссия, племя) => {
    await ensureNetFiles();
    const копия = new Mem(mem.b.slice()); loadMission(копия, files, миссия, племя, 1);
    const есть = new Set();
    for (let i = копия.u32(G.unitHead); i; i = копия.u32(UNITS + i + U.NEXT)) {
      if (копия.u8(UNITS + i + U.FLAGS5B) & 1) continue;
      const t = копия.u8(UNITS + i + U.TYPE), вл = копия.u8(UNITS + i + U.OWNER);
      if (t >= 1 && t <= 13 && вл < 8) есть.add(вл);
    }
    return [...есть].sort((a, b) => a - b);
  },
  наСтатус: (т) => { netEl('netstat').textContent = т; netEl('netinfo').textContent = т; if (т) { netEl('netlog').textContent += т + '\n'; say(т); } },
  наЛобби: () => { drawLobby(); chatRoomChanged(); },
  наРежим: () => { const tg = document.getElementById('netbartag');
    if (tg) tg.textContent = t(net.локальная ? 'СКИРМИШ' : 'МУЛЬТИПЛЕЕР') + ' · ' + t(имяСложности(net.лобби?.сложность ?? net.параметры?.сложность ?? 1)); },
  наСообщение: (текст) => toast(текст),
  наЧат: (м) => chatPush('комната', м),
  наНачало: () => { shell.подписьИтога = null; netPanel.hidden = true; netBar.hidden = false; rpbar.hidden = true; drawLobby();
    // Кто чем думает — отдельной надписью в панели партии, а не строкой состояния: строку тут же
    // перебивает следующее сообщение («start: map 101…»), и увидеть её нельзя. Надпись висит всю
    // партию, поэтому вопрос «выбрал нейронку — а играет ли она?» снимается одним взглядом.
    setTimeout(обновитьМозги, 400);
    // Скирмиш: снимок для записи берём ЗДЕСЬ, а не в startMission. Карту грузит тот же
    // startMission, и запись начиналась сразу за загрузкой — то есть ДО расстановки мест и до
    // настройки компьютерных штабов. В снимок попадала голая карта, а список ИИ был пуст: запись
    // скирмиша воспроизводилась с другого начального состояния и вообще без компьютера.
    // В сетевой партии этим занимается наСнимок (там состояние приезжает от хоста), а в локальной
    // снимка никто не шлёт — значит и звать некому, кроме как отсюда.
    if (net?.локальная) beginRecording('skirmish'); },
  наСнимок: () => { beginRecording('net'); drawLobby(); },          // запись партии — с состояния, которое пришло от хоста
  наПауза: (вкл) => setPaused(вкл, true),
  // Итог партии показываем родным экраном игры (картинка из пака), только подпись своя:
  // «победил такой-то». Рисовать своё окно поверх браузером не годится — выпадает из игры.
  наКонец: (исход) => {
    say(исход === 'victory' ? 'victory' : 'defeat');
    saveReplay(исход === 'victory' ? 'victory' : 'defeat');   // сдача и конец сетевой партии тоже пишутся
    const моё = net.лобби?.места?.find(м => м.кто === 'игрок' && м.игрок === net.я);
    shell.подписьИтога = исход === 'victory'
      ? t('Победа: {t} — нажмите, чтобы продолжить', { t: имяСтороны(моё?.цвет ?? net.моёПлемя) })
      : t('Поражение — нажмите, чтобы продолжить');
    setTimeout(() => { if (net.активна && shell.screen === 'game') shell.goto(исход); }, 1500);
  },
  // Зритель: своей победы у него нет, но партия кончилась — показываем, кто выиграл.
  наПобедитель: (цвет) => {
    say(t('победил {t}', { t: имяСтороны(цвет) }));
    shell.подписьИтога = t('Победил {t} — нажмите, чтобы продолжить', { t: имяСтороны(цвет) });
    setTimeout(() => { if (net.активна && shell.screen === 'game') shell.goto('victory'); }, 1500);
  },
  наВыход: () => { netBar.hidden = true; netWait.hidden = true; netEl('netnamedlg').hidden = true; chatRoomChanged();
    // Запись сохраняем по факту «партия шла», не глядя на экран: после сдачи выход приходит уже
    // с экрана поражения, и прежнее условие `screen === 'game'` молча съедало реплей.
    if (running) { saveReplay('exit'); running = false; if (shell.screen === 'game') shell.toMenu(); }
    drawLobby(); },
});
// Окно ожидания вылетевших: таймер и кнопка «не ждать» на каждого.
const netWait = document.getElementById('netwait');
/** Экран ожидания соперников: кто уже готов, кто ещё нет. */
function drawWait() {
  const list = document.getElementById('netwaitlist'); list.textContent = '';
  netWait.hidden = !net.активна || net.ожидание.size === 0;
  if (netWait.hidden) return;
  for (const [игрок, о] of net.ожидание) {
    const row = document.createElement('div'); row.className = 'row';
    const мойГолос = о.голоса.has(net.я);
    const ост = net.осталосьЖдать(игрок), мм = Math.floor(ост / 60000), сс = Math.floor(ост / 1000) % 60;
    row.innerHTML = `<span>${net.имя(игрок)}</span><span class="t">${мм}:${String(сс).padStart(2, '0')} · ${t('не ждут')} ${о.голоса.size}</span>`;
    const b = document.createElement('button'); b.textContent = t(мойГолос ? 'вы не ждёте' : 'не ждать'); b.disabled = мойГолос;
    b.onclick = () => net.неЖдать(игрок); row.appendChild(b); list.appendChild(row);
  }
}
setInterval(() => { if (!netWait.hidden) drawWait(); }, 1000);
const netAuto = new URLSearchParams(location.search);
const ПЛЕМЕНА_ИМЕНА = ['Tyrano', 'Ka-noo-se', 'Romack', 'Masai', 'Moospell', 'Koomba', 'RaDumBa', 'Koaka'];
// Сложность в строке состояния: раньше показывали только номер миссии и племя, и по ходу партии
// было не вспомнить, на какой сложности она начата.
const СЛОЖНОСТИ = ['лёгкая', 'обычная', 'трудная'];
/** Название сложности по её номеру. */
const имяСложности = (d) => СЛОЖНОСТИ[d] || СЛОЖНОСТИ[1];
const MINIMAP = '../../ui/minimap/';
let mapIndex = null;                                  // размеры и племена карт (tools/minimaps.mjs)
fetch(MINIMAP + 'index.json').then(r => r.ok ? r.json() : null).then(j => { mapIndex = j; if (!netPanel.hidden) { fillMissions(netEl('netmission2')); drawLobby(); drawRooms(); } }).catch(() => {});
/** Короткая строка про карту: размер и сколько на ней племён. */
const mapInfo = (м) => { const i = mapIndex?.[м]; return i ? `${i.w}×${i.h}, племён ${i.племена.length}` : ''; };
/** Адрес релея по HTTP — из того же поля, где задан адрес для сокета. */
const relayHttp = () => netEl('netaddr').value.trim().replace(/^ws/, 'http').replace(/\/$/, '');
// Карты: id < 100 — кампания, 100+ — сетевые карты оригинала (пак 13); имена — data/maps.json → index.json
const mapIds = () => mapIndex ? Object.keys(mapIndex).map(Number).sort((a, b) => a - b) : [...Array(12).keys()];
/** Название карты: своё из index.json, иначе «сетевая N» или «миссия N». */
const mapName = (м) => mapIndex?.[м]?.name || (м >= 100 ? t('сетевая {n}', { n: м - 99 }) : t('миссия {n}', { n: м + 1 }));
/** Сколько племён стоит на карте (столько мест в лобби). */
const mapPlayers = (м) => mapIndex?.[м]?.племена.length ?? 0;
/** Подпись карты в списке: название и число игроков. */
const mapLabel = (м) => { const n = mapPlayers(м); return mapName(м) + (n ? ` (${t(n === 1 ? '{n} игрок' : n < 5 ? '{n} игрока' : '{n} игроков', { n })})` : ''); };
/** Заполнить выпадающий список карт в лобби. */
function fillMissions(sel) {
  const было = sel.value; sel.textContent = '';
  for (const k of mapIds()) { const o = document.createElement('option'); o.value = k; o.textContent = mapLabel(k); sel.appendChild(o); }
  if (было !== '') sel.value = было;
}
/** Строка под списком карт: размер, откуда карта и сколько мест. */
function mapInfoLine(k) { const i = mapIndex?.[k]; return i ? `${i.w}×${i.h} · ${i.pack === '_PWAR13.TRC' ? t('сетевая карта') : i.pack === '_PWAR10.TRC' ? t('демо-карта') : t('кампания, миссия {n}', { n: k + 1 })} · ${t('племён {n}', { n: i.племена.length })}: ${i.племена.map(т => ПЛЕМЕНА_ИМЕНА[т]).join(', ')}` : ''; }
/** Выпадающий список карт в лобби: иконка + имя + игроки; наведение — большая карта в карточке справа. */
function drawMapDropdown() {
  const л = net.лобби, cur = л.миссия;
  netEl('netmapico').src = `${MINIMAP}m${cur}.png`; netEl('netmapname').textContent = mapLabel(cur);
  netEl('netmapbtn').disabled = !net.яХост || !!л.идёт;
  const list = netEl('netmaplist'); list.textContent = '';
  let группа = null;
  for (const k of mapIds()) {
    const г = t(k >= 100 ? 'сетевые карты' : 'кампания');
    if (г !== группа) { группа = г; const h = document.createElement('div'); h.className = 'netmaph'; h.textContent = г; list.appendChild(h); }
    const o = document.createElement('div'); o.className = 'netmapo' + (k === cur ? ' sel' : '');
    const img = document.createElement('img'); img.src = `${MINIMAP}m${k}.png`; o.appendChild(img);
    const tx = document.createElement('span'); tx.textContent = mapName(k); o.appendChild(tx);
    const n = document.createElement('span'); n.className = 'n'; n.textContent = `${t('{n} игр.', { n: mapPlayers(k) })} · ${mapIndex?.[k]?.w ?? '?'}×${mapIndex?.[k]?.h ?? '?'}`; o.appendChild(n);
    o.onmouseenter = () => showLobbyMap(k); o.onclick = () => { list.hidden = true; showLobbyMap(cur); net.задатьМиссию(k, +netEl('netdiff2').value); };
    list.appendChild(o);
  }
}
/** Показать мини-карту выбранной карты в лобби. */
function showLobbyMap(k) { netEl('netlobbymap').src = `${MINIMAP}m${k}.png`; netEl('netlobbymapinfo').textContent = `${mapName(k)} · ${mapInfoLine(k)}`; }
netEl('netmapbtn').onclick = () => { const l = netEl('netmaplist'); l.hidden = !l.hidden; if (l.hidden) showLobbyMap(net.лобби.миссия); };
netEl('netmaplist').onmouseleave = () => showLobbyMap(net.лобби.миссия);
document.addEventListener('click', (e) => { if (!netEl('netmapdd').contains(e.target)) netEl('netmaplist').hidden = true; });
/** Подставить в поля лобби разумные значения: адрес релея из адреса страницы, имя из localStorage. */
function netDefaults() {
  netEl('netaddr').value = netAuto.get('net') || localStorage.getItem('jw.relay') || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/jw/net');
  if (!netEl('netroom').value) netEl('netroom').value = netAuto.get('room') || (t('комната') + '-' + Math.random().toString(36).slice(2, 6));
  if (!netEl('netname').value) netEl('netname').value = netAuto.get('name') || localStorage.getItem('jw.name') || (t('игрок') + '-' + Math.random().toString(36).slice(2, 5));
  fillMissions(netEl('netmission2'));
}
/** Открыть панель сетевой игры: лобби, список комнат и общий чат. */
function openNet() { netDefaults(); netPanel.hidden = false; drawLobby(); refreshRooms(); ensureHall(); }

// ---- чат: общий (холл релея — все, у кого открыта панель) и чат комнаты (через канал партии)
const chat = { вкладка: 'общий', общий: [], комната: [], люди: [], холл: null, связь: false, непрочитано: { общий: false, комната: false } };
/** Постоянный цвет ника в чате: по номеру места, а без места — по хешу имени. */
function chatColor(имя, игрок) {
  if (игрок !== undefined && игрок !== null && net.фаза !== 'нет') {         // цвет места, если игрок сидит на цвете
    const м = (net.лобби?.места || []).find(м => м.кто === 'игрок' && м.игрок === игрок); if (м) return ЦВЕТА[м.цвет % 8];
  }
  let h = 0; for (const c of String(имя)) h = (Math.imul(h, 131) + c.charCodeAt(0)) | 0;
  return `hsl(${(Math.abs(h) * 137.508) % 360}, ${62 + (Math.abs(h) >> 3) % 22}%, ${62 + (Math.abs(h) >> 5) % 14}%)`;
}
/** Подключиться к общему чату «холла», если ещё не подключены. */
function ensureHall() {
  const адрес = netEl('netaddr').value.trim(); if (!адрес) return;
  if (chat.холл && chat.холл.адрес !== адрес) { chat.холл.закрыть(); chat.холл = null; }
  if (!chat.холл) {
    const х = new Холл(адрес); chat.холл = х;
    х.наОнлайн = (люди) => { chat.люди = люди; drawChat(); };
    х.наЧат = (м) => chatPush('общий', м);
    х.наСвязь = (есть) => { chat.связь = есть; drawChat(); };
    х.подключить();
  }
  chat.холл.привет(netEl('netname').value.trim() || t('игрок'), net.фаза !== 'нет' ? netEl('netroom').value.trim() : null);
}
/** Вошли в комнату или вышли: вкладка комнаты, история комнаты, отметка в холле. */
function chatRoomChanged() {
  const вКомнате = net.фаза !== 'нет';
  if (!вКомнате) { chat.комната = []; chat.вкладка = 'общий'; chat.непрочитано.комната = false; }
  else if (chat.вкладка === 'общий' && !chat.комнатаБыла) chat.вкладка = 'комната';
  chat.комнатаБыла = вКомнате;
  if (chat.холл) chat.холл.привет(netEl('netname').value.trim() || t('игрок'), вКомнате ? netEl('netroom').value.trim() : null);
  drawChat();
}
/** Добавить сообщение в чат комнаты или холла и перерисовать ленту. */
function chatPush(куда, м) {
  const список = chat[куда]; список.push({ имя: м.имя, игрок: м.игрок, текст: м.текст, t: м.t || Date.now(), sys: !!м.sys });
  if (список.length > 200) список.shift();
  if (chat.вкладка !== куда) chat.непрочитано[куда] = true;
  drawChat();
}
/** Перерисовать ленту чата: своя вкладка на комнату и на холл. */
function drawChat() {
  const box = netEl('netchat'); if (!box) return;
  box.hidden = net.локальная;                         // скирмиш: разговаривать не с кем
  if (net.локальная) return;
  const вКомнате = net.фаза !== 'нет';
  const дом = вКомнате ? netEl('netlobbyside') : netEl('netside'); if (box.parentElement !== дом) дом.appendChild(box);
  netEl('nettabroom').hidden = !вКомнате; if (!вКомнате) chat.вкладка = 'общий';
  for (const [id, к] of [['nettabhall', 'общий'], ['nettabroom', 'комната']]) { const b = netEl(id); b.classList.toggle('sel', chat.вкладка === к); b.classList.toggle('new', chat.непрочитано[к] && chat.вкладка !== к); }
  chat.непрочитано[chat.вкладка] = false;
  // кто здесь: в холле — все на релее (с комнатой), в комнате — участники с ролями
  const who = netEl('netchatwho'); who.textContent = '';
  const ник = (имя, игрок) => { const s = document.createElement('span'); s.className = 'nick'; s.textContent = имя; s.style.color = chatColor(имя, игрок); return s; };
  if (chat.вкладка === 'общий') {
    if (!chat.связь) who.textContent = t('нет связи с релеем');
    else { const n = document.createElement('span'); n.textContent = t('в сети: {n}', { n: chat.люди.length }); who.appendChild(n);
      for (const ч of chat.люди) { const s = ник(ч.имя); if (ч.комната) s.title = t('в комнате «{r}»', { r: ч.комната }); who.appendChild(s); } }
  } else {
    for (const у of net.участники || []) { const s = ник(у.имя, у.игрок); if (у.роль === 'наблюдатель') { s.style.opacity = '.7'; s.title = t('зритель'); } if (у.игрок === net.канал?.хост) s.textContent = '★ ' + у.имя; who.appendChild(s); }
  }
  const log = netEl('netchatlog'); const внизу = log.scrollTop + log.clientHeight >= log.scrollHeight - 4; log.textContent = '';
  for (const м of chat[chat.вкладка]) {
    const row = document.createElement('div'); if (м.sys) { row.className = 'sys'; row.textContent = м.текст; }
    else { row.appendChild(ник(м.имя, м.игрок)); row.appendChild(document.createTextNode(м.текст)); }
    log.appendChild(row);
  }
  if (внизу) log.scrollTop = log.scrollHeight;
}
netEl('nettabhall').onclick = () => { chat.вкладка = 'общий'; drawChat(); };
netEl('nettabroom').onclick = () => { chat.вкладка = 'комната'; drawChat(); };
netEl('netchatin').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.blur(); return; }
  if (e.key !== 'Enter') return;
  const текст = e.target.value.trim(); if (!текст) return; e.target.value = '';
  if (chat.вкладка === 'комната' && net.фаза !== 'нет') net.сказать(текст); else chat.холл?.сказать(текст);
});
netEl('netname').addEventListener('change', () => { if (chat.холл) ensureHall(); });
// ---- список комнат: релей отдаёт JSON по /rooms; обновляем, пока панель открыта и мы не в комнате
let roomsCache = [], roomsSel = null, roomsTimer = null;
/** Спросить у релея список комнат и показать его. */
async function refreshRooms() {
  if (netPanel.hidden || net.фаза !== 'нет') return;
  try { roomsCache = await fetch(relayHttp() + '/rooms', { cache: 'no-store' }).then(r => r.json()); }
  catch { roomsCache = []; netEl('netroomsum').textContent = t('релей недоступен'); drawRooms(); return; }
  drawRooms();
}
/** Строка состояния комнаты: сколько мест занято, идёт ли партия. */
function roomStatus(r) {
  if (r.вылетевших) return [t('вылетел {n}', { n: r.вылетевших }), 'drop'];
  if (r.статус === 'игра') return [t(r.открытая ? 'идёт игра, вход открыт' : 'идёт игра'), 'game'];
  return [t('ожидание'), ''];
}
/** Наш ключ в этой комнате: по нему релей отдаёт то же место после обрыва. */
function myKeyFor(room) { return localStorage.getItem('jw.ключ.' + room); }
/** Список комнат: карта, занятость, кнопки «войти» и «смотреть». */
function drawRooms() {
  const list = netEl('netroomlist'); list.textContent = '';
  const rooms = roomsCache.slice().sort((a, b) => (a.создана || 0) - (b.создана || 0));
  netEl('netroomsum').textContent = rooms.length ? `${rooms.length} · ${t('игроков {n}', { n: rooms.reduce((n, r) => n + r.игроков, 0) })}` : '';
  if (!rooms.length) { list.innerHTML = `<div class="netempty">${t('пока ни одной комнаты — создайте свою')}</div>`; return; }
  for (const r of rooms) {
    const row = document.createElement('div'); row.className = 'netroom' + (roomsSel === r.имя ? ' sel' : '');
    const img = document.createElement('img'); if (r.миссия !== null) img.src = `${MINIMAP}m${r.миссия}.png`; row.appendChild(img);
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.имя; row.appendChild(nm);
    const [текст, кл] = roomStatus(r); const st = document.createElement('span'); st.className = 'st ' + кл; st.textContent = текст; row.appendChild(st);
    const cnt = document.createElement('span'); cnt.className = 'cnt';
    cnt.textContent = `${r.миссия !== null ? mapName(r.миссия) : '?'} · ${t('игроков {a} из {b}', { a: r.игроков, b: r.мест ?? '?' })}` + (r.наблюдателей ? ` · ${t('зрителей {n}', { n: r.наблюдателей })}` : ''); row.appendChild(cnt);
    if (r.состояние) { const g = document.createElement('span'); g.className = 'cnt'; g.style.marginLeft = '0'; g.textContent = gameIndicator(r.состояние); row.appendChild(g); }
    const mine = myKeyFor(r.имя) && r.места.some(м => !м.живой);
    const свободно = r.мест == null || (r.места.length < r.мест);
    // Одна кнопка — в лобби комнаты; за кого играть или смотреть, решается уже там
    const можно = mine || (r.статус !== 'игра' && свободно) || (r.статус === 'игра' && (r.открытая && свободно || r.зрители !== false));
    const b = document.createElement('button'); b.textContent = t(mine ? 'вернуться' : 'войти'); b.disabled = !можно;
    b.title = можно ? '' : t(r.статус === 'игра' ? 'хост не пускает посторонних' : 'мест нет');
    b.onclick = (e) => { e.stopPropagation(); joinRoom(r.имя, mine || r.статус !== 'игра' || (r.открытая && свободно) ? 'игрок' : 'наблюдатель'); }; row.appendChild(b);
    row.onmouseenter = () => drawPreview(r); row.onclick = () => { roomsSel = r.имя; drawRooms(); drawPreview(r); };
    row.ondblclick = () => { if (можно) b.onclick(new Event('click')); };      // в узком окне кнопка не всегда на виду
    b.title = b.title || t('или двойной клик по строке');
    list.appendChild(row);
  }
}
/** Индикатор идущей партии: время, живые стороны. */
function gameIndicator(с) {
  if (!с) return '';
  const мин = Math.floor((с.секунд || 0) / 60), сек = (с.секунд || 0) % 60;
  const стороны = Object.entries(с.живые || {}).filter(([, з]) => з.бойцов + з.зданий > 0).length;
  return `${мин}:${String(сек).padStart(2, '0')} · ${t('сторон в бою {n}', { n: стороны })}`;
}
/** Мини-карта и подпись под строкой комнаты в списке. */
function drawPreview(r) {
  const pv = netEl('netpreview'); pv.textContent = '';
  const img = document.createElement('img'); img.className = 'netmap'; if (r.миссия !== null) img.src = `${MINIMAP}m${r.миссия}.png`; pv.appendChild(img);
  const h = document.createElement('div'); h.innerHTML = `<b>${r.имя}</b>`; pv.appendChild(h);
  const d = document.createElement('div'); d.className = 'netdim';
  d.textContent = `${r.миссия !== null ? mapName(r.миссия) + ' · ' + mapInfoLine(r.миссия) : '?'} · ${['easy', 'normal', 'hard'][r.сложность] || ''} · ${roomStatus(r)[0]}` + (r.открытая ? ' · ' + t('пускает незнакомцев') : '') + (r.зрители === false ? ' · ' + t('без зрителей') : ''); pv.appendChild(d);
  if (r.состояние) { const g = document.createElement('div'); g.className = 'netdim'; g.textContent = gameIndicator(r.состояние) + (r.состояние.подИИ?.length ? ` · ${t('под ИИ {n}', { n: r.состояние.подИИ.length })}` : ''); pv.appendChild(g); }
  for (const м of r.места) { const s = document.createElement('div'); s.className = 'netseat' + (м.живой ? '' : ' dead');
    const з = r.состояние?.живые?.[м.племя]; if (з) s.title = `${з.бойцов} ${t('бойцов')}, ${з.зданий} ${t('зданий')}`;
    s.textContent = `${м.игрок === r.хост ? '★ ' : ''}${м.имя} — ${м.племя !== undefined && м.племя !== null ? ПЛЕМЕНА_ИМЕНА[м.племя] : '—'}${м.живой ? '' : ' (' + t('ВЫЛЕТЕЛ').toLowerCase() + ')'}`; pv.appendChild(s); }
  if (r.наблюдателей) { const s = document.createElement('div'); s.className = 'netdim'; s.textContent = t('зрителей: {n}', { n: r.наблюдателей }); pv.appendChild(s); }
}
/** Войти в комнату игроком или наблюдателем. */
async function joinRoom(room, роль) {
  localStorage.setItem('jw.name', netEl('netname').value); localStorage.setItem('jw.relay', netEl('netaddr').value);
  netEl('netroom').value = room;
  netEl('netstat').textContent = t('подключение…');
  try { await net.войти(netEl('netaddr').value.trim(), room, netEl('netname').value.trim(), роль); }
  catch (e) { netEl('netstat').textContent = e.message; drawLobby(); return; }

  drawLobby();
}
/** Перерисовать лобби целиком: места, племена, цвета, правила, мини-карта, кнопки. */
function drawLobby() {
  const вКомнате = net.фаза === 'лобби' && !!net.канал;
  const tag = document.getElementById('netbartag');
  if (tag) tag.textContent = t(net.локальная ? 'СКИРМИШ' : 'МУЛЬТИПЛЕЕР') + ' · ' + t(имяСложности(net.лобби?.сложность ?? net.параметры?.сложность ?? 1));
  // Скирмиш — это то же лобби, но в комнате мы одни: имя комнаты, хост, гости и зрители тут ни к чему.
  const мест = net.локальная;
  const пок = (id, видно) => { const e = document.getElementById(id); if (e) (e.closest('label') || e).hidden = !видно; };
  document.getElementById('netphead').textContent = t(мест ? 'скирмиш' : 'сетевая игра');
  const покКноп = (id, видно) => { const e = document.getElementById(id); if (e) e.hidden = !видно; };
  покКноп('netopen2', !мест); покКноп('netobs2', !мест); пок('netname', !мест); пок('netadv', !мест);
  netEl('netleave').textContent = t(мест ? 'выйти' : 'выйти из комнаты');
  if (netEl('netchat')) drawChat();
  netEl('netmain').hidden = вКомнате || net.активна; netEl('netlobby').hidden = !вКомнате;
  // Наблюдателю в сетевой комнате запускать нечего, а в скирмише он же и хост — кнопка нужна.
  netEl('netfoot').hidden = !вКомнате || (net.наблюдатель && !net.лобби.идёт && !net.локальная);
  netEl('nethostme').hidden = !(вКомнате && net.яХост && !net.лобби.идёт) || net.локальная;   // в скирмише хост очевиден
  drawCountdown();
  if (вКомнате) { const b = netEl('netready'); b.disabled = false; b.classList.remove('off');
    if (net.лобби.идёт) {                                    // партия уже идёт: одна кнопка входа, без готовности
      if (net.наблюдатель) b.textContent = t('смотреть партию');
      else { const моё = net.лобби.племена?.[net.я]; b.textContent = t(моё !== undefined ? 'вернуться в игру' : 'войти в игру'); }
    }
    else if (net.яХост) { b.textContent = net.отсчёт ? t('отменить запуск') : t('запустить'); b.classList.toggle('off', !!net.отсчёт); }
    else { b.textContent = t(net.яГотов ? 'не готов' : 'готов'); b.classList.toggle('off', net.яГотов); } }
  netEl('netrestart').hidden = !(net.активна && net.локальная);
  netEl('netfogl').hidden = !(net.активна && net.наблюдатель);
  if (net.активна && net.наблюдатель) drawFog();
  if (!вКомнате) { if (!netPanel.hidden) refreshRooms(); return; }
  const л = net.лобби, ms = netEl('netmission2'), ds = netEl('netdiff2');
  ms.value = String(л.миссия); ds.value = String(л.сложность);
  const хозяин = net.яХост && !л.идёт;
  задатьВкл('netopen2', !!л.открытая, хозяин); задатьВкл('netobs2', л.зрители !== false, хозяин);
  ms.disabled = ds.disabled = !net.яХост || л.идёт; netEl('netstart').hidden = true;
  netEl('netrole').textContent = t(net.наблюдатель ? 'стать игроком' : 'стать наблюдателем');
  netEl('netlobbytitle').textContent = net.локальная ? t('партия против компьютера') : `${t('комната «{r}»', { r: netEl('netroom').value })} · ${t('хост {h}', { h: net.имя(net.канал.хост) })}` + (л.идёт ? ' · ' + t('ИДЁТ ИГРА') : '') + (net.наблюдатель ? ' · ' + t('вы наблюдатель') : '');
  drawMapDropdown(); showLobbyMap(л.миссия);
  const list = netEl('netlist'); list.textContent = '';
  netEl('netmode').value = л.режим || 'армии'; netEl('netmode').disabled = !хозяин;
  задатьВкл('netfast', !!л.быстрый, хозяин); задатьВкл('netarts', !!л.украшения, хозяин); задатьВкл('netfood', !!л.автоеда, хозяин);
  netEl('netevil').disabled = !хозяин;
  if (!л.идёт && л.места?.length) { drawPlaces(list, л); return; }               // наборы и армии карты: места-строки
  // Идущая партия: кто за кого уже играет (в том числе вылетевшие — их места заняты), мне — свободное племя и кнопка «играть»
  const моёМесто = л.идёт ? л.племена[net.я] : undefined;
  netEl('netplay').hidden = true; netEl('netspect').hidden = true;
  netEl('netgame').textContent = л.идёт && л.состояние ? gameIndicator(л.состояние) + (л.состояние.подИИ?.length ? ` · ${t('под ИИ {n}', { n: л.состояние.подИИ.length })}` : '') : '';
  if (л.идёт && л.режим === 'наборы') { drawPlacesRunning(list, л, моёМесто); return; }
  if (л.идёт) {
    for (const [k, т] of Object.entries(л.племена)) { if (+k === net.я) continue;
      const row = document.createElement('div'); row.className = 'netpl'; const живой = net.участники.some(у => у.игрок === +k);
      row.innerHTML = `<span class="who">${net.имя(+k)} (${k})</span>${+k === net.канал.хост ? `<span class="tag">${t('ХОСТ')}</span>` : ''}`; row.appendChild(tribeControl(т, false)); if (!живой) { const tg = document.createElement('span'); tg.className = 'tag'; tg.style.color = '#f08a6b'; tg.textContent = t('ВЫЛЕТЕЛ'); row.appendChild(tg); } list.appendChild(row); }
    const row = document.createElement('div'); row.className = 'netpl';
    const who = document.createElement('span'); who.className = 'who'; who.textContent = `${netEl('netname').value} (${net.я})`; row.appendChild(who);
    const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t(net.наблюдатель ? 'НАБЛЮДАТЕЛЬ' : 'Я'); row.appendChild(tg);
    if (л.идёт) drawMapDropdown();
    if (!net.наблюдатель) {
      const sel = document.createElement('select'); sel.id = 'netmytribe';
      if (моёМесто !== undefined) { const o = document.createElement('option'); o.textContent = ПЛЕМЯ(моёМесто) + ' · ' + t('моё место'); sel.appendChild(o); sel.disabled = true; }
      else { const занято = new Set(Object.values(л.племена)); const свободные = л.доступные.filter(т => !занято.has(т));
        for (const т of свободные) { const o = document.createElement('option'); o.value = т; o.textContent = ПЛЕМЯ(т); sel.appendChild(o); }
        if (!свободные.length) { const o = document.createElement('option'); o.textContent = t('свободных племён нет'); sel.appendChild(o); netEl('netplay').disabled = true; }
        else netEl('netplay').disabled = !л.открытая;
        if (!л.открытая && свободные.length) netEl('netplay').title = t('хост не пускает новых игроков'); else netEl('netplay').title = ''; }
      row.appendChild(sel);
    }
    list.appendChild(row);
    for (const у of net.наблюдатели) { const r2 = document.createElement('div'); r2.className = 'netpl'; r2.innerHTML = `<span class="who">${у.имя} (${у.игрок})</span><span class="tag">${t('НАБЛЮДАТЕЛЬ')}</span>`; if (у.игрок !== net.я) list.appendChild(r2); }
    netEl('netstat').textContent = t('идёт игра · игроков {a} из {b}', { a: Object.keys(л.племена).length, b: л.доступные.length || '?' }) + (net.наблюдатели.length ? ` · ${t('зрителей {n}', { n: net.наблюдатели.length })}` : '');
    return;
  }
  for (const у of net.участники) {
    const row = document.createElement('div'); row.className = 'netpl';
    const who = document.createElement('span'); who.className = 'who'; who.textContent = `${у.имя} (${у.игрок})`; row.appendChild(who);
    if (у.игрок === net.канал.хост) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('ХОСТ'); row.appendChild(tg); }
    if (у.игрок === net.я) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('Я'); row.appendChild(tg); }
    if (у.роль === 'наблюдатель') continue;                    // наблюдатели — отдельной группой ниже
    if (у.игрок !== net.канал.хост) { const rd = document.createElement('span'); rd.className = 'netready'; rd.textContent = л.готовы?.[у.игрок] ? t('ГОТОВ') : t('не готов'); rd.style.color = л.готовы?.[у.игрок] ? '#7ad37a' : '#8a7f70'; row.appendChild(rd); }
    if (net.яХост && у.игрок !== net.я && !л.идёт) { const kb = document.createElement('button'); kb.textContent = t('выгнать'); kb.style.marginLeft = 'auto'; kb.onclick = () => net.выгнать(у.игрок); row.appendChild(kb); }
    const занято = new Set(Object.entries(л.племена).filter(([k]) => +k !== у.игрок).map(([, v]) => v));
    const тек = л.племена[у.игрок];
    if (тек === undefined) { const s = document.createElement('span'); s.className = 'netdim'; s.textContent = '— ' + t('нет места') + ' —'; row.appendChild(s); }
    else if (у.игрок !== net.я) row.appendChild(tribeControl(тек, false));
    else { const wrap = tribeControl(тек, true, (т) => net.выбрать(т));
      for (const [k, o] of [...wrap.querySelectorAll('.nettro')].entries()) if (!л.доступные.includes(k) || занято.has(k)) { o.style.opacity = '.4'; o.onclick = (e) => e.stopPropagation(); }
      row.appendChild(wrap); }
    list.appendChild(row);
  }
  if (net.наблюдатель) { const row = document.createElement('div'); row.className = 'netpl'; const b = document.createElement('button'); b.textContent = t('сесть игроком'); b.onclick = () => net.сестьИгроком(); row.appendChild(b); list.appendChild(row); }
  drawObserverSlots(list);
  netEl('netstat').textContent = t('игроков {a} из {b}', { a: net.игрокиКомнаты.length, b: л.доступные.length || '?' }) + (net.наблюдатели.length ? ` · ${t('зрителей {n}', { n: net.наблюдатели.length })}` : '');
  // Авто-режим (?net=…&room=…&auto=1): хост стартует, когда собралось players (по умолчанию 2), клиент берёт tribe.
  if (netAuto.get('auto')) {
    if (net.яХост) {
      const хочу = +(netAuto.get('mission') ?? -1); if (хочу >= 0 && хочу !== л.миссия) return net.задатьМиссию(хочу);
      if (net.игрокиКомнаты.length >= +(netAuto.get('players') || 2) && !net.__стартовал) { net.__стартовал = true; setTimeout(() => net.старт(), 300); }
    }
    const t = netAuto.get('tribe'); if (t !== null && л.доступные.includes(+t) && л.племена[net.я] !== +t && !занятоКем(л, +t)) net.выбрать(+t);
  }
}
/** Кто из других игроков уже взял это племя (одно племя — один игрок). */
const занятоКем = (л, т) => Object.entries(л.племена).find(([k, v]) => v === т && +k !== net.я);
// Иконки племён — те же, что на странице выбора уровня (out/ui/icons)
const ИКОНКИ = ['tyrano', 'kanoose', 'romack', 'masai', 'moospell', 'koomba', 'radumba', 'koaka'];
// Версия значков: без неё браузер тянет png из кеша и после перерисовки показывает старый
// (у RaDumBa так и оставался карнотавр). Поднимать при смене картинок в out/ui/icons.
const ЗНАЧКИ_В = 2;
/** Значок строки: «глаз» для пустого места наблюдателя и человечек для занятого. Рисуем вектором —
 *  в паках игры подходящей картинки нет, а масштабировать пиксельную мелочь некрасиво. */
function значок(вид) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'netic');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', вид === 'игрок'
    ? 'M8 2a2.6 2.6 0 1 1 0 5.2A2.6 2.6 0 0 1 8 2zm0 6.4c2.9 0 5.2 1.7 5.2 3.8V14H2.8v-1.8c0-2.1 2.3-3.8 5.2-3.8z'
    : 'M8 3.2c3.2 0 5.9 2 7.2 4.8-1.3 2.8-4 4.8-7.2 4.8S2.1 10.8.8 8C2.1 5.2 4.8 3.2 8 3.2zm0 2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z');
  s.appendChild(p); return s;
}
/** Кнопка-переключатель в блоке правил: нажата — правило включено. Заменяет галочку, но ведёт
 *  себя так же: `вкл()` читает, `задатьВкл()` ставит. */
const вкл = (id) => netEl(id).classList.contains('on');
const задатьВкл = (id, v, можно = true) => { const b = netEl(id); b.classList.toggle('on', !!v); b.disabled = !можно; b.setAttribute('aria-pressed', v ? 'true' : 'false'); };
/** Кнопка-галочка в лобби: щёлкнули — переключили и сообщили остальным. */
const переключатель = (id, fn) => { netEl(id).onclick = () => { if (netEl(id).disabled) return; задатьВкл(id, !вкл(id)); fn(); cv.focus(); }; };

/** Значок племени для списка мест. */
const tribeImg = (т) => { const i = document.createElement('img'); i.src = `../../ui/icons/${ИКОНКИ[т] || 'tyrano'}.png?v=${ЗНАЧКИ_В}`; i.alt = ''; return i; };
/** Племя с иконкой: выпадающий список, если можно менять, иначе просто иконка и имя. */
function tribeControl(текущий, можно, onChange) {
  if (!можно) { const s = document.createElement('span'); s.className = 'nettrname'; s.appendChild(tribeImg(текущий)); s.appendChild(document.createTextNode(ПЛЕМЕНА_ИМЕНА[текущий] || '')); return s; }
  const wrap = document.createElement('span'); wrap.className = 'nettr';
  const btn = document.createElement('button'); btn.appendChild(tribeImg(текущий)); btn.appendChild(document.createTextNode((ПЛЕМЕНА_ИМЕНА[текущий] || '') + ' ▾')); wrap.appendChild(btn);
  const lst = document.createElement('div'); lst.className = 'lst'; lst.hidden = true;
  for (let т = 0; т < 8; т++) { const o = document.createElement('div'); o.className = 'nettro' + (т === текущий ? ' sel' : ''); o.appendChild(tribeImg(т)); o.appendChild(document.createTextNode(ПЛЕМЕНА_ИМЕНА[т]));
    o.onclick = (e) => { e.stopPropagation(); lst.hidden = true; if (т !== текущий) onChange(т); }; lst.appendChild(o); }
  wrap.appendChild(lst);
  btn.onclick = (e) => { e.stopPropagation(); for (const l of document.querySelectorAll('.nettr .lst')) if (l !== lst) l.hidden = true; lst.hidden = !lst.hidden; };
  return wrap;
}
document.addEventListener('click', () => { for (const l of document.querySelectorAll('.nettr .lst')) l.hidden = true; });
// Цвета мест — как у владельцев на мини-карте оригинала (таблица 0x3e8a0 → палитра)
// Цвета мест — те же, что у юнитов на карте. В палитре игры каждому владельцу отведены четыре
// записи подряд, начиная с 0xc0 + владелец·4 (спрайт красится сдвигом [0x30556 + владелец], см.
// render/scene.js), и опознавательный из них — первый, самый насыщенный. Раньше здесь стоял
// придуманный список, и он не совпадал с картой ни одним цветом: в лобби «белый», а на карте
// зелёный. Читать палитру прямо в лобби нельзя — она заполняется только при загрузке миссии,
// до старта там мусор; поэтому значения сняты с работающей партии и записаны сюда.
const ЦВЕТА = ['#00ff00', '#00ffff', '#ffc2ff', '#b220b2', '#ff8231', '#ff1000', '#0010ff', '#ffff00'];
const ЦВЕТА_ИМЕНА = ['зелёный', 'голубой', 'белый', 'пурпурный', 'оранжевый', 'красный', 'синий', 'жёлтый'];
/** Как назвать сторону в итоговой надписи: имя игрока, если он был, иначе племя и цвет. */
function имяСтороны(цвет) {
  const м = net.лобби?.места?.find(x => x.цвет === цвет);
  const цв = t(ЦВЕТА_ИМЕНА[цвет % 8] || String(цвет));
  if (м?.кто === 'игрок') return `${net.имя(м.игрок)} (${цв})`;
  const племя = м?.племя ?? цвет;
  return `${ПЛЕМЕНА_ИМЕНА[племя] || ''} (${цв})`.trim();
}
/** Идущая партия в режиме наборов: места как есть; сесть можно только на место компьютера; своё место — без выбора. */
function drawPlacesRunning(list, л, моёМесто) {
  const занято = new Set(Object.values(л.племена));
  let выбор = null;
  for (const м of л.места) {
    const row = document.createElement('div'); row.className = 'netpl';
    const sw = document.createElement('span'); sw.className = 'netsw'; sw.style.background = ЦВЕТА[м.цвет % 8]; row.appendChild(sw);
    const кто = м.кто === 'игрок' ? `${net.имя(м.игрок)} (${м.игрок})` : t(м.кто === 'компьютер' ? 'компьютер' : м.кто);
    const who = document.createElement('span'); who.className = 'who'; who.textContent = кто; row.appendChild(who);
    row.appendChild(tribeControl(м.племя ?? 0, false));
    const з = л.состояние?.живые?.[м.цвет]; if (з) { const st = document.createElement('span'); st.className = 'st'; st.textContent = `${з.бойцов} ${t('бойцов')} · ${з.зданий} ${t('зданий')}`; row.appendChild(st); }
    if (м.кто === 'игрок' && !net.участники.some(у => у.игрок === м.игрок)) { const tg = document.createElement('span'); tg.className = 'tag'; tg.style.color = '#f08a6b'; tg.textContent = t('ВЫЛЕТЕЛ'); row.appendChild(tg); }
    if (л.состояние?.подИИ?.includes(м.цвет)) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('ИИ'); row.appendChild(tg); }
    if (моёМесто === м.цвет) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('МОЁ МЕСТО'); row.appendChild(tg); }
    else if (моёМесто === undefined && !net.наблюдатель && м.кто === 'компьютер' && !занято.has(м.цвет) && л.открытая) {
      const ctl = document.createElement('div'); ctl.className = 'ctl'; const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'netseat'; rb.value = м.цвет; rb.id = 'seat' + м.цвет;
      if (!выбор) { rb.checked = true; выбор = м.цвет; } const lb = document.createElement('label'); lb.htmlFor = rb.id; lb.textContent = t('занять'); ctl.appendChild(rb); ctl.appendChild(lb); row.appendChild(ctl);
    }
    list.appendChild(row);
  }
  // скрытый select для кнопки входа: выбранное место
  let sel = document.getElementById('netmytribe'); if (!sel) { sel = document.createElement('select'); sel.id = 'netmytribe'; sel.hidden = true; list.appendChild(sel); } else list.appendChild(sel);
  sel.textContent = ''; const o = document.createElement('option'); o.value = выбор ?? ''; sel.appendChild(o); sel.value = String(выбор ?? ''); sel.disabled = моёМесто !== undefined;
  list.addEventListener('change', (e) => { if (e.target.name === 'netseat') { sel.textContent = ''; const o2 = document.createElement('option'); o2.value = e.target.value; sel.appendChild(o2); sel.value = e.target.value; } });
  if (моёМесто === undefined && !net.наблюдатель && выбор === null) netEl('netready').disabled = true;
  if (моёМесто === undefined && net.наблюдатель) { const row = document.createElement('div'); row.className = 'netpl'; const b = document.createElement('button'); b.textContent = t('сесть игроком'); b.onclick = () => net.сестьИгроком(); row.appendChild(b); list.appendChild(row); }
  drawObserverSlots(list);
  netEl('netstat').textContent = t('идёт игра · игроков {a} из {b}', { a: Object.keys(л.племена).length, b: л.места.length }) + (net.наблюдатели.length ? ` · ${t('зрителей {n}', { n: net.наблюдатели.length })}` : '');
}
/** Группа наблюдателей: четыре слота; сесть на слот — стать наблюдателем, сесть на место-цвет — снова игроком. */
const ЗРИТЕЛЕЙ = 4;
/** Четыре места наблюдателей: сесть туда — перестать быть игроком. */
function drawObserverSlots(list) {
  if (net.локальная) return;                       // в скирмише смотреть некому
  const h = document.createElement('div'); h.className = 'netrow nethdr'; h.style.marginTop = '8px'; h.innerHTML = `<span>${t('наблюдатели')}</span>`; list.appendChild(h);
  const слоты = net.лобби.слотыЗрителей || {};
  for (let k = 0; k < ЗРИТЕЛЕЙ; k++) {
    const игрок = Object.entries(слоты).find(([, v]) => v === k)?.[0]; const у = игрок !== undefined ? net.участники.find(п => п.игрок === +игрок) : null;
    const row = document.createElement('div'); row.className = 'netpl';
    const num = document.createElement('span'); num.className = 'netsw'; num.style.background = '#3a332a'; num.style.color = 'var(--dim)'; num.style.fontSize = '10px'; num.style.textAlign = 'center'; num.style.lineHeight = '14px'; num.textContent = String(k + 1); row.appendChild(num);
    const who = document.createElement('span'); who.className = 'who'; who.textContent = у ? `${у.имя} (${у.игрок})` : t('свободно'); row.appendChild(who);
    if (у && у.игрок === net.я) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('Я'); row.appendChild(tg); }
    const ctl = document.createElement('div'); ctl.className = 'ctl';
    if (!у) { const b = document.createElement('button'); b.textContent = t('сесть'); b.onclick = () => net.сестьНаблюдателем(k); ctl.appendChild(b); }
    if (у && net.яХост && у.игрок !== net.я) { const b = document.createElement('button'); b.textContent = t('выгнать'); b.onclick = () => net.выгнать(у.игрок); ctl.appendChild(b); }
    row.appendChild(ctl); list.appendChild(row);
  }
}
/** Режим «наборы»: список мест-цветов — кто сидит, племя, кнопки. */
function drawPlaces(list, л) {
  const моё = л.места.findIndex(м => м.кто === 'игрок' && м.игрок === net.я);
  for (const [i, м] of л.места.entries()) {
    const row = document.createElement('div'); row.className = 'netpl' + (м.кто === 'закрыто' ? ' closed' : '');
    const sw = document.createElement('span'); sw.className = 'netsw'; sw.style.background = ЦВЕТА[м.цвет % 8]; sw.title = t('цвет {n}', { n: м.цвет + 1 }); row.appendChild(sw);
    const who = document.createElement('span'); who.className = 'who';
    who.textContent = м.кто === 'игрок' ? `${net.имя(м.игрок)} (${м.игрок})` : t(м.кто === 'компьютер' ? 'компьютер' : м.кто === 'закрыто' ? 'закрыто' : л.режим !== 'наборы' ? 'свободно · ИИ карты' : 'свободно'); row.appendChild(who);
    if (м.кто === 'игрок' && м.игрок === net.канал.хост && !net.локальная) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('ХОСТ'); row.appendChild(tg); }
    if (м.кто === 'игрок' && м.игрок === net.я) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('Я'); row.appendChild(tg); }
    const армии = л.режим !== 'наборы';                                     // племя закреплено за армией карты
    if (м.кто === 'игрок' || м.кто === 'компьютер' || армии) {
      const своё = !армии && ((м.кто === 'игрок' && м.игрок === net.я) || (м.кто === 'компьютер' && net.яХост));
      row.appendChild(tribeControl(м.племя ?? 0, своё, (т) => net.место(i, 'племя', т)));
      if (м.кто === 'игрок' && м.игрок !== net.канал.хост) { const rd = document.createElement('span'); rd.className = 'netready'; rd.textContent = л.готовы?.[м.игрок] ? t('ГОТОВ') : t('не готов'); rd.style.color = л.готовы?.[м.игрок] ? '#7ad37a' : '#8a7f70'; row.appendChild(rd); }
    }
    const ctl = document.createElement('div'); ctl.className = 'ctl';
    const кн = (текст, fn) => { const b = document.createElement('button'); b.textContent = t(текст); b.onclick = fn; ctl.appendChild(b); };
    if (м.кто === 'открыто' && моё !== i) кн('сесть', () => net.сестьИгроком(i));
    if (м.кто === 'игрок' && м.игрок === net.я && л.места.filter(x => x.кто === 'открыто').length) кн('встать', () => net.место(i, 'встать'));
    if (net.яХост && м.кто === 'игрок' && м.игрок !== net.я) кн('выгнать', () => net.выгнать(м.игрок));
    // Компьютерное место: один список вместо четырёх. Раньше тут стояли «вид ИИ», «уровень»,
    // «характер» и «мозги» — шестнадцать сочетаний на место, и, по замеру и по игре, разницы
    // между ними почти не чувствуется: уровень и характер сдвигают пороги, а не меняют замысел,
    // а «сеть бойца» отдельно от «сети тактика» никто не выбирал. Владелец решил оставить то,
    // между чем действительно есть разница, и это:
    //   скрипт   — наш ИИ на максимальной сложности, ровный, без кайта стрелками;
    //   нейронка — тот же ИИ, но бой и решения отряда ведут обученные сети (обе сразу);
    //   родной   — встроенный ИИ оригинала, как в DOS-игре.
    // Разнообразие поведения придёт от слоя стратега (js/ai/strategy.js), а не от пресетов.
    if (м.кто === 'компьютер') {
      const выбор = (м.ии === 'встроенный') ? 'родной'
                  : м.мозги === 'стратег' ? 'стратег'
                  : м.мозги === 'комдив' ? 'комдив'
                  : ((м.мозги || 'скрипт') === 'скрипт' ? 'скрипт' : 'нейронка');
      const вид = document.createElement('select'); вид.className = 'netsel';
      // «стратег» — новый скриптовый ИИ: он переключает уклад по ходу партии (кормиться, качать
      // костяк, оборонять дом, идти волной), выручает своих и добивает подбитое. Старый «скрипт»
      // оставлен рядом нарочно: их надо сравнивать, в том числе живой игрой.
      // «комдив» — сеть, которая раздаёт задачи ГРУППАМ (охота, дом, штурм, враг, отход, мясо,
      // разведка, стоять), а бойцов внутри группы по-прежнему ведёт скрипт. Это другой слой, чем
      // «нейронка» (там сети боя и тактики), поэтому и пункт отдельный.
      for (const [v, т] of [['скрипт', t('компьютер: скрипт')], ['стратег', t('компьютер: стратег')],
                            ['нейронка', t('компьютер: нейронка')], ['комдив', t('компьютер: комдив')],
                            ['родной', t('компьютер: родной')]]) {
        const o = document.createElement('option'); o.value = v; o.textContent = т; вид.appendChild(o);
      }
      вид.value = выбор; вид.disabled = !net.яХост || !!л.идёт;
      вид.onchange = () => {
        const v = вид.value;
        // Уровень и характер больше не спрашиваем: скриптовый компьютер всегда максимальной
        // силы (3) и ровного нрава — слабые ступеньки в игре никому не нужны, а для замеров они
        // остались в tools/ai_tourney.mjs и в таблицах УРОВНИ/ХАРАКТЕРЫ.
        // ТАКТИКУ ВЕДЁТ СКРИПТ. Сеть тактика — это клон решений того же скрипта (тактик-bc,
        // 28 031 решение), то есть в связке «обе» она ничего не добавляет, а на проверочных
        // сценах уступает оригиналу. Владелец: «поставь копию или вообще можно скриптового
        // поставить». Ставим скриптовую тактику, а сеть остаётся в бойце.
        net.место(i, 'набор', undefined, { ии: v === 'родной' ? 'встроенный' : 'скрипт',
          мозги: v === 'нейронка' ? 'боец' : v === 'стратег' ? 'стратег' : v === 'комдив' ? 'комдив' : 'скрипт', уровень: 3,   // характер не шлём: лобби подставит своё умолчание
          весаБойца: Сети.ЛУЧШИЕ.боец, весаТактика: Сети.ЛУЧШИЕ.тактик, весаКомдива: Сети.ЛУЧШИЕ.комдив });
      };
      row.appendChild(вид);
    }
    if (net.яХост && м.кто !== 'игрок' && !армии) {
      if (м.кто !== 'компьютер') кн('компьютер', () => net.место(i, 'компьютер'));
      if (м.кто !== 'закрыто') кн('закрыть', () => net.место(i, 'закрыть'));
      if (м.кто !== 'открыто') кн('открыть', () => net.место(i, 'открыть'));
    }
    // Армии карты: место закрывать нечего (армия уже стоит), но выбрать, кто ею правит, надо.
    // «ИИ карты» — как в оригинале, иначе наш компьютер с уровнем и характером.
    if (net.яХост && м.кто !== 'игрок' && армии) {
      if (м.кто !== 'компьютер') кн('компьютер', () => net.место(i, 'компьютер'));
      else кн('ИИ карты', () => net.место(i, 'ии_карты'));
    }
    row.appendChild(ctl); list.appendChild(row);
  }
  drawObserverSlots(list);
  // Скирмиш: строка наблюдателя — такое же место, как цветные, только смотровое. Пустая — «глаз»
  // и слово «наблюдатель»; занятая мной — человечек и моё имя. Кнопки «стать игроком» тут нет
  // намеренно: чтобы вернуться в игру, достаточно щёлкнуть по любому цветному месту.
  if (net.локальная && !л.идёт) {
    const я = net.наблюдатель;
    const row = document.createElement('div'); row.className = 'netpl netobs' + (я ? ' сижу' : '');
    row.appendChild(значок(я ? 'игрок' : 'глаз'));
    const who = document.createElement('span'); who.className = 'who';
    who.textContent = я ? (netEl('netname').value.trim() || t('игрок')) : t('наблюдатель');
    row.appendChild(who);
    if (я) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = t('Я'); row.appendChild(tg); }
    row.title = t(я ? 'вы смотрите со стороны; чтобы играть, щёлкните по месту' : 'смотреть за боем со стороны');
    if (!я) row.onclick = async () => { try { await net.сменитьРоль('наблюдатель'); } catch (e) { netEl('netstat').textContent = e.message; } drawLobby(); };
    list.appendChild(row);
  }
  const занятых = л.места.filter(м => м.кто === 'игрок' || м.кто === 'компьютер').length;
  netEl('netstat').textContent = t('игроков {a} из {b}', { a: net.игрокиКомнаты.length, b: л.места.length }) + (занятых > net.игрокиКомнаты.length ? ` · ${t('компьютеров {n}', { n: занятых - net.игрокиКомнаты.length })}` : '') + (net.наблюдатели.length ? ` · ${t('зрителей {n}', { n: net.наблюдатели.length })}` : '');
}
netEl('netmode').onchange = () => net.задатьРежим(netEl('netmode').value, вкл('netfast'));
переключатель('netfast', () => net.задатьРежим(netEl('netmode').value, вкл('netfast')));
переключатель('netarts', () => net.задатьУкрашения(вкл('netarts')));
переключатель('netfood', () => net.задатьАвтоеду(вкл('netfood')));
// Чёрт: разом посадить зверский ИИ на все места, кроме занятых людьми. Не переключатель, а
// действие — нажал и все места перерисовались.
netEl('netevil').onclick = () => { net.место(0, 'всекомпы'); say(t('все свободные места — компьютер')); };
// ---- наблюдатель: режим тумана
function drawFog() {
  const sel = netEl('netfog'); const cur = net.туман.режим === 'племя' ? 'п' + net.туман.племя : net.туман.режим;
  sel.textContent = '';
  const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
  add('нет', t('без тумана')); add('все', t('за всех игроков'));
  // Все стороны, а не только люди: за компьютером тоже надо уметь посмотреть.
  for (const т of net.стороныВИгре()) add('п' + т, t('глазами {t}', { t: ПЛЕМЯ(т) }));
  sel.value = cur;
}
// После выбора в списке фокус остаётся на нём, и стрелки листают список вместо карты — возвращаем фокус игре
netEl('netfog').onchange = () => { const v = netEl('netfog').value; if (v.startsWith('п')) net.задатьТуман('племя', +v.slice(1)); else net.задатьТуман(v); netEl('netfog').blur(); cv.focus(); };
for (const id of ['netpause', 'netquit']) netEl(id).addEventListener('click', () => { netEl(id).blur(); cv.focus(); });
// Создать игру: большая кнопка → окно с именем → комната; все настройки — уже внутри лобби
netEl('netcreatebtn').onclick = () => { netEl('netnewname').value = ''; netEl('netnamedlg').hidden = false; setTimeout(() => netEl('netnewname').focus(), 50); };
netEl('netnewcancel').onclick = () => { netEl('netnamedlg').hidden = true; };
netEl('netnewok').onclick = () => { const имя = netEl('netnewname').value.trim(); if (!имя) { netEl('netnewname').focus(); return; } netEl('netnamedlg').hidden = true; joinRoom(имя, 'игрок'); };
netEl('netnewname').addEventListener('keydown', (e) => { if (e.key === 'Enter') netEl('netnewok').onclick(); if (e.key === 'Escape') netEl('netnewcancel').onclick(); });
netEl('netready').onclick = () => {
  if (net.лобби.идёт) {
    if (net.наблюдатель) { net.хочуСмотреть(); netEl('netstat').textContent = t('подключаемся к партии…'); return; }
    const s = document.getElementById('netmytribe'); net.хочуИграть(s && !s.disabled && s.value !== '' ? +s.value : undefined); netEl('netstat').textContent = t('входим в партию…'); return;
  }
  if (net.яХост) net.запустить(); else net.готов(!net.яГотов);
};
let cdTimer = null;
/** Обратный отсчёт до старта партии поверх лобби. */
function drawCountdown() {
  const el = netEl('netcountdown'); const о = net.отсчёт;
  if (!о || net.фаза !== 'лобби') { el.hidden = true; if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } return; }
  el.hidden = false; const ост = Math.max(0, Math.ceil((о.до - Date.now()) / 1000)); el.textContent = t('старт через {n} с', { n: ост });
  if (!cdTimer) cdTimer = setInterval(drawCountdown, 250);
}
netEl('netstart').onclick = () => net.старт();
netEl('netplay').onclick = () => { const s = document.getElementById('netmytribe'); net.хочуИграть(s && !s.disabled && s.value !== '' ? +s.value : undefined); netEl('netstat').textContent = t('входим в партию…'); };
netEl('netspect').onclick = () => { net.хочуСмотреть(); netEl('netstat').textContent = t('подключаемся к партии…'); };
netEl('netrole').onclick = async () => { try { await net.сменитьРоль(net.наблюдатель ? 'игрок' : 'наблюдатель'); } catch (e) { netEl('netstat').textContent = e.message; } drawLobby(); };
netEl('netleave').onclick = () => { net.выйти(); roomsSel = null; drawLobby(); refreshRooms(); };
netEl('netclose').onclick = () => { netPanel.hidden = true; };
netEl('netmission2').onchange = () => net.задатьМиссию(+netEl('netmission2').value, +netEl('netdiff2').value);
// музыка: кнопка в панели (главное меню и партия), состояние помнится в localStorage (js/ui/music.js)
const musBtn = document.getElementById('musbtn');
/** Подпись и подсветка кнопки музыки. */
const updMusBtn = () => { musBtn.classList.toggle('on', music.on); musBtn.title = music.on ? 'музыка: вкл' : 'музыка: выкл'; };
musBtn.onclick = () => { music.setOn(!music.on); updMusBtn(); cv.focus(); }; updMusBtn();

// Плавное движение: переключатель рядом с музыкой (само сглаживание — в present, см. ПЛАВНО).
const smoothBtn = document.getElementById('smoothbtn');
/** Подпись и подсветка кнопки плавного движения. */
const updSmoothBtn = () => { smoothBtn.classList.toggle('on', ПЛАВНО.вкл);
  smoothBtn.title = t(ПЛАВНО.вкл ? 'плавное движение: вкл' : 'плавное движение: выкл'); };
smoothBtn.onclick = () => {
  ПЛАВНО.вкл = !ПЛАВНО.вкл; ПЛАВНО.дорого = 0; if (!ПЛАВНО.вкл) { вернутьПозиции(); ПЛАВНО.было.clear(); }
  localStorage.setItem('jw.smooth', ПЛАВНО.вкл ? '1' : '0'); updSmoothBtn(); cv.focus();
};
updSmoothBtn();

// Украшения (артефакты): в сетевой партии это правило комнаты, а в кампании включать было нечем —
// флажок жил только в localStorage. Кнопка рядом с музыкой; активации у украшений нет и не будет,
// они дают прибавку, пока надеты (см. js/port/artifacts.js).
const artBtn = document.getElementById('artbtn');
/** Подпись и подсветка кнопки украшений (прибавки от артефактов). */
const updArtBtn = () => {
  const вкл = Артефакты.включено();
  artBtn.classList.toggle('on', вкл);
  artBtn.disabled = !!net?.активна;                    // в партии это правило комнаты, а не моя кнопка
  artBtn.title = t(вкл ? 'украшения: прибавки работают' : 'украшения: прибавки выключены');
};
artBtn.onclick = () => {
  if (net?.активна) return;
  const вкл = !Артефакты.включено();
  localStorage.setItem('jw.artifacts', вкл ? '1' : '0');
  Артефакты.задать(eng, вкл);
  updArtBtn(); say(t(вкл ? 'украшения: прибавки работают' : 'украшения: прибавки выключены')); cv.focus();
};
Артефакты.задать(null, localStorage.getItem('jw.artifacts') !== '0');   // кнопка горит сразу, ещё до партии
updArtBtn();

// Схема управления. Классика — как в оригинале: левая кнопка и выделяет, и приказывает (что под
// курсором, то и будет). Современная — как в нынешних стратегиях: левая только выделяет, правая
// приказывает, и промах по своему зданию больше не стоит отряда.
const schemeBtn = document.getElementById('schemebtn');
/** Подпись и подсветка кнопки схемы управления (ЛКМ/ПКМ). */
const updSchemeBtn = () => {
  const с = Ввод.СХЕМА.современная;
  schemeBtn.classList.toggle('on', с);
  schemeBtn.textContent = t(с ? 'ПКМ' : 'ЛКМ');
  schemeBtn.title = t(с ? 'управление: левая выделяет, правая приказывает' : 'управление: как в оригинале, всё левой кнопкой');
};
schemeBtn.onclick = () => {
  const с = Ввод.задатьСхему(!Ввод.СХЕМА.современная);
  localStorage.setItem('jw.scheme', с ? '1' : '0');
  updSchemeBtn(); say(t(с ? 'управление: левая выделяет, правая приказывает' : 'управление: как в оригинале, всё левой кнопкой')); cv.focus();
};
Ввод.задатьСхему(localStorage.getItem('jw.scheme') === '1');
updSchemeBtn();

// Прокрутка у края: кнопка рядом со схемой управления. При включении полоски быстро мигают,
// при выключении вспыхивают и гаснут — видно, что режим сменился.
const edgeBtn = document.getElementById('edgebtn');
/** Подпись и подсветка кнопки прокрутки от края экрана. */
function обновитьКрайБтн() {
  edgeBtn.classList.toggle('on', КРАЯ.вкл);
  edgeBtn.title = t(КРАЯ.вкл ? 'прокрутка у края: включена' : 'прокрутка у края: выключена');
}
edgeBtn.onclick = () => { задатьКрая(!КРАЯ.вкл); say(t(КРАЯ.вкл ? 'прокрутка у края: включена' : 'прокрутка у края: выключена')); cv.focus(); };
задатьКрая(localStorage.getItem('jw.edge') === '1', true);

// Лупы. Первая ступень «отдалить» — широкое окно карты: кадр растёт под размер браузера и
// рисуется один к одному, родными пикселями (js/render/wide.js). Дальше идут прежние ступени
// отдаления для зрителя, где сцена уже прореживается.
const zoomIn = document.getElementById('zoomin'), zoomOut = document.getElementById('zoomout');
/** Кратности отдаления: обычная, вдвое и «вся карта целиком». */
function ступениЗума() { return [1, 2, зумМакс()]; }
/** Поставить кратность отдаления карты (только для зрителя сетевой партии). */
function задатьЗум(n) {
  const ст = ступениЗума();
  ЗУМ.уровень = ст[Math.max(0, Math.min(ст.length - 1, n))];
  ЗУМ.обновлён = 0;
  обновитьЛупы();
  say(ЗУМ.уровень === 1 ? t('масштаб: обычный') : ЗУМ.уровень >= зумМакс() ? t('масштаб: вся карта') : t('масштаб: вдвое дальше'));
  cv.focus();
}
/** Включить или выключить широкое окно карты и сразу перестроить кадр. */
function задатьШироко(вкл) {
  ШИРОКО.вкл = !!вкл;
  const н = желаемыйКадр(); задатьКадр(н.ш, н.в);
  обновитьЛупы();
  say(t(ШИРОКО.вкл ? 'широкое окно карты: включено' : 'масштаб: обычный'));
  cv.focus();
}
/** Показать или спрятать кнопки лупы и подтянуть их состояние. */
function обновитьЛупы() {
  // Лупы нужны и игроку (широкое окно), и зрителю (дальше — прореживание сцены).
  const вИгре = shell.screen === 'game' && running;
  zoomIn.hidden = zoomOut.hidden = !вИгре;
  if (!вИгре) { if (ЗУМ.уровень !== 1) ЗУМ.уровень = 1; return; }
  const ст = ступениЗума(), i = ст.indexOf(ЗУМ.уровень);
  // Ступени: обычное окно → широкое окно → (зрителю) вдвое → вся карта.
  zoomIn.disabled = !ШИРОКО.вкл && i <= 0;
  zoomOut.disabled = ШИРОКО.вкл ? (!зумДоступен() || i >= ст.length - 1) : false;
}
zoomIn.onclick = () => {
  const i = ступениЗума().indexOf(ЗУМ.уровень);
  if (i > 0) return задатьЗум(i - 1);                    // сперва убираем прореживание
  if (ШИРОКО.вкл) return задатьШироко(false);            // потом широкое окно
};
zoomOut.onclick = () => {
  if (!ШИРОКО.вкл) return задатьШироко(true);            // первая ступень — широкое окно
  if (зумДоступен()) return задатьЗум(ступениЗума().indexOf(ЗУМ.уровень) + 1);
};
setInterval(обновитьЛупы, 1000);
обновитьЛупы();

// ---- очередь приказов по Shift (js/port/orderqueue.js)
// Щелчок с зажатым Shift не отдаёт приказ, а добавляет шаг каждому выделенному: так можно сразу
// наметить обход нескольких точек, добить двух врагов по очереди или подобрать мясо и уйти.
// Щелчок без Shift очередь стирает — новое решение человека всегда важнее старого плана.
// Коды, которые очередь не трогают: это работа с панелью, а не приказ бойцу.
const НЕ_ОТМЕНЯЮТ = new Set([0xe0, 0xe1, 0x7e, 0x7f]);
const ВИД_ШАГА = { 0x0f: ОчередьПриказов.ШАГ_ИДТИ, 0x1f: ОчередьПриказов.ШАГ_АТАКА, 0x4c: ОчередьПриказов.ШАГ_ВЗЯТЬ };
/** Выделенные свои живые юниты (не здания). */
function выделенные() {
  const из = [];
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (!(mem.u8(UNITS + i + U.F07) & 0x80)) continue;
    if (mem.u8(UNITS + i + U.OWNER) !== mem.u8(G.humanOwner)) continue;
    if (mem.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
    из.push(i);
  }
  return из;
}
Ввод.setQueueHandler((код, цель, x, y, шифт) => {
  // ЛЮБОЙ КЛИК НА ПАУЗЕ ПРОСИТ ОДИН ШАГ. Кнопки панели (переключатели HP/OP/DP/MP/VP, инвентарь,
  // заказ в доме) идут НЕ через очередь приказов, а через «ожидающий клик» в памяти движка
  // (0x31acc): его разбирает сам шаг. Пока шагов нет, нажатие просто лежит в слоте, и на экране
  // ничего не меняется — владелец: «я нажал, ничего не произошло». Флаг одного шага для этого
  // пути не взводился вовсе: он стоял только в ветке приказов юнитам (0x14895). Ставим здесь —
  // сюда приходят все клики, ставшие «ожидающим приказом», и панельные тоже.
  if (код === 0xe1) панельныхКликов++;                     // счётчик для проверок
  // РУЧНАЯ КОМАНДА ВЫВОДИТ ИЗ ОХОТНИЧЬЕЙ ГРУППЫ. Правило владельца: «если я выделяю любого
  // участника отряда и даю ему другую команду, охотничьи угодья должны сброситься для этого
  // участника — он исключается из группы; либо выделяю всю группу и даю любую команду, тогда то
  // же самое». Исключения — приказы, которые не спорят с охотой: кнопки панели (прокачка,
  // инвентарь) и «добывать» (мясо), потому что «не должно сбрасываться мясо: убили — мясо
  // забрали».
  if (охоты.length && !ИЗ_ГРУППЫ_НЕ_ВЫВОДЯТ.has(код)) {
    let вывели = 0;
    for (const i of выделенные()) for (const о of охоты) if (о.члены.delete(i)) { вывели++; if (о.с) { о.с.цель = 0; о.с.вцепились = false; } }
    for (let k = охоты.length - 1; k >= 0; k--) if (!охоты[k].члены.size) охоты.splice(k, 1);
    if (вывели) say(t('из охоты выведено: {n}', { n: вывели }));
  }
  if (образецСлой.вкл && !ИЗ_ГРУППЫ_НЕ_ВЫВОДЯТ.has(код)) {
    const свои = выделенные();
    if (свои.length) {
      let вывели = 0;
      for (const i of свои) if (!угодья.исключены.has(i)) { угодья.исключены.add(i); вывели++; }
      if (вывели) {
        if (образецСлой.с) { образецСлой.с.цель = 0; образецСлой.с.вцепились = false; }
        const осталось = ((образецСлой.группа && образецСлой.группа.length) ? образецСлой.группа : всеСвои())
          .filter(i => !угодья.исключены.has(i)).length;
        say(осталось ? t('из охоты выведено: {n}, осталось {m}', { n: вывели, m: осталось })
                     : t('охота отменена: команду получили все'));
        лабНарисовать();
      }
    }
  }
  if (shell.paused && !playing && !net?.активна) шаговПаузы = Math.max(шаговПаузы, ШАГИ_НА_ПАУЗЕ);
  if (!running || playing) return false;
  const свои = выделенные();
  if (!свои.length) return false;
  if (!шифт) {                                   // обычный приказ — план отменяем
    if (НЕ_ОТМЕНЯЮТ.has(код)) return false;      // возня в панели (надеть вещь, заказ в доме) — не приказ юниту
    for (const i of свои) if (ОчередьПриказов.очередь(eng, i).length) ОчередьПриказов.приказОчистить(eng, i);
    return false;
  }
  const вид = ВИД_ШАГА[код];
  if (!вид) return false;                        // не приказ по карте (панель, магия) — пропускаем
  let сколько = 0;
  for (const i of свои) {
    if (вид === ОчередьПриказов.ШАГ_АТАКА && (!цель || цель === i)) continue;
    ОчередьПриказов.приказШаг(eng, i, вид, вид === ОчередьПриказов.ШАГ_АТАКА ? цель : 0, x, y);
    сколько = Math.max(сколько, ОчередьПриказов.очередь(eng, i).length + 1);
  }
  say(t('шаг {n} в очереди', { n: сколько }));
  return true;
});

// «Собрать мясо рядом» (клавиша T): выделенным раздаётся очередь из ближайших кусков мяса в
// радиусе СБОР_РАДИУС клеток. Мясо разбирается по одному на юнита по кругу, чтобы двое не бежали
// за одним куском.
const СБОР_РАДИУС = 10, МЯСО = 0x1e, ITEMS_БАЗА = 0xf4f34, ГОЛОВА_ПРЕДМЕТОВ = 0x31b7c;
/** Клавиша T: разослать выделенных подбирать мясо и предметы вокруг, каждого к своему. */
function собратьМясо() {
  if (!running || playing) return;
  const свои = выделенные();
  if (!свои.length) return say(t('никто не выделен'));
  const куски = [];
  for (let it = mem.u32(ГОЛОВА_ПРЕДМЕТОВ); it; it = mem.u32(ITEMS_БАЗА + it + 0xc))
    if (mem.u8(ITEMS_БАЗА + it) === МЯСО) куски.push({ x: mem.u8(ITEMS_БАЗА + it + 1), y: mem.u8(ITEMS_БАЗА + it + 2) });
  const кл = (i) => ({ x: mem.u16(UNITS + i + U.X) >> 5, y: mem.u16(UNITS + i + U.Y) >> 5 });
  const свободные = куски.slice();
  let взято = 0;
  for (let круг = 0; круг < ОчередьПриказов.ПРЕДЕЛ && свободные.length; круг++) {
    for (const i of свои) {
      if (!свободные.length) break;
      const c = кл(i);
      let лучший = -1, d0 = 1e9;
      for (let k = 0; k < свободные.length; k++) {
        const d = Math.abs(свободные[k].x - c.x) + Math.abs(свободные[k].y - c.y);
        if (d < d0) { d0 = d; лучший = k; }
      }
      if (лучший < 0 || d0 > СБОР_РАДИУС) continue;
      const п = свободные.splice(лучший, 1)[0];
      ОчередьПриказов.приказШаг(eng, i, ОчередьПриказов.ШАГ_ВЗЯТЬ, 0, п.x << 5, п.y << 5);
      взято++;
    }
  }
  say(взято ? t('собираем мясо: {n}', { n: взято }) : t('мяса рядом нет'));
}

// «Отнести еду на базу» (клавиша B): всем выделенным, кто что-то несёт, — приказ сдать на склад.
// В оригинале это делается по одному: ячейка еды в панели, потом щелчок по складу. Приказ тот же
// (0x51 + номер ячейки, цель — склад), просто выдаём его сразу всем.
// ---- вещи отряда: раздать бесхозное (G) и скинуть лишнее (Y)
//
// Просьба владельца: «кнопку, чтобы если у кого-то не одет щит или меч — передать его ближайшему
// безоружному, быстрое распределение бесхозных вещей по армии; и кнопку, чтобы быстро скинуть всё
// лишнее, что не одето».
//
// Приказ движковый, свой велосипед не нужен: 0x51 + номер ячейки (js/port/economy.js, 0x19229).
// Цель — юнит: вещь переходит ему в руки. Цель ноль: вещь кладётся на землю в указанной точке.
// Ячейки 0..2 — оружие, 3..5 — щиты (так же их различает панель, invRight); надетое лежит в той
// же ячейке, номер которой записан в +0x15 (оружие) и +0x16 (щит).
const ВЕЩЬ_ЯЧЕЕК = 6;
/** Надета ли вещь из этой ячейки. */
const надета = (i, n) => (n < 3 ? mem.u8(UNITS + i + U.WEAPON) : mem.u8(UNITS + i + U.SHIELD)) === n;
/** Первая ячейка с ненадетой вещью (или −1). */
function лишняяЯчейка(i) {
  for (let n = 0; n < ВЕЩЬ_ЯЧЕЕК; n++) if (mem.u8(UNITS + i + U.INV + n) && !надета(i, n)) return n;
  return -1;
}
/** Нужна ли юниту вещь этого рода: оружие (n<3) или щит — и есть ли куда её положить. */
function нужнаВещь(i, n) {
  const своя = n < 3 ? mem.u8(UNITS + i + U.WEAPON) : mem.u8(UNITS + i + U.SHIELD);
  if (своя !== 0xff) return false;                                  // уже одет
  const от = n < 3 ? 0 : 3, до = n < 3 ? 3 : ВЕЩЬ_ЯЧЕЕК;
  for (let k = от; k < до; k++) if (!mem.u8(UNITS + i + U.INV + k)) return true;   // есть свободная ячейка
  return false;
}
/**
 * G — раздать бесхозное. У кого лежит ненадетое оружие или щит, отдаёт его ближайшему в отряде,
 * у кого этого рода вещи нет вовсе. За одно нажатие каждый отдаёт одну вещь (приказ у юнита один);
 * нажал ещё раз — пойдёт следующая.
 */
function раздатьВещи() {
  if (!running || playing) return;
  const свои = выделенные();
  if (!свои.length) return say(t('никто не выделен'));
  const кл2 = (i) => ({ x: mem.u16(UNITS + i + U.X) >> 5, y: mem.u16(UNITS + i + U.Y) >> 5 });
  const занято = new Set();                                          // кому уже пообещали вещь
  let отдано = 0, осталось = 0;
  for (const i of свои) {
    const n = лишняяЯчейка(i); if (n < 0) continue;
    const c = кл2(i);
    let кому = 0, d0 = 1e9;
    for (const j of свои) {
      if (j === i || занято.has(j) || !нужнаВещь(j, n)) continue;
      const c2 = кл2(j), d = Math.max(Math.abs(c2.x - c.x), Math.abs(c2.y - c.y));
      if (d < d0) { d0 = d; кому = j; }
    }
    if (!кому) { осталось++; continue; }
    занято.add(кому);
    вОчередьПриказов(eng, i, (0x51 + n) & 0xff, кому, mem.u16(UNITS + кому + U.X), mem.u16(UNITS + кому + U.Y));
    отдано++;
  }
  say(отдано ? t('раздают вещи: {n}', { n: отдано }) + (осталось ? ' · ' + t('некому отдать: {n}', { n: осталось }) : '')
             : (осталось ? t('некому отдать: {n}', { n: осталось }) : t('лишних вещей нет')));
}
// Линия приказа, которую игрок тянет пальцем: рисуется поверх карты, пока палец ведёт.
let жестПриказа = null;
// Остаток хода пальца между переносами камеры на целую клетку.
const хвостПальца = { x: 0, y: 0 };
/** Юнит под точкой мира (тот же поиск, что у движка под курсором). */
function подПальцем(x, y) { try { return F[0x130c6](eng, { edx: x >>> 0, ebx: y >>> 0 }).esi >>> 0; } catch { return 0; } }
/**
 * Приказ протяжкой: палец начал на своём юните и довёл линию до цели.
 *   • довели до чужого — атаковать его;
 *   • довели до пустого места — идти туда.
 * Если юнит, с которого начали, не был выделен, он выделяется сам — иначе пришлось бы делать два
 * движения вместо одного, а ради этого жест и заводился.
 */
function приказЖестом(x0, y0, x1, y1) {
  жестПриказа = null;
  if (!running || playing) return;
  const камX = mem.u32(0x31ae8), камY = mem.u32(0x31aec);
  const откуда = подПальцем(x0 + камX, y0 + камY);
  if (!откуда) return;
  let свои = выделенные();
  if (!свои.includes(откуда)) {                                        // начали с невыделенного — берём его одного
    for (const i of свои) mem.w8(UNITS + i + U.F07, mem.u8(UNITS + i + U.F07) & 0x7f);
    mem.w8(UNITS + откуда + U.F07, mem.u8(UNITS + откуда + U.F07) | 0x80);
    mem.w32(0x31adc, откуда);
    свои = [откуда];
  }
  const мх = (x1 + камX) | 0, му = (y1 + камY) | 0;
  const цель = подПальцем(мх, му);
  const чужой = цель && mem.u8(UNITS + цель + U.OWNER) !== mem.u8(G.humanOwner);
  for (const i of свои) {
    ОчередьПриказов.снять(eng, i);
    if (чужой) вОчередьПриказов(eng, i, 0x1f, цель, мх & ~0x1f, му & ~0x1f);   // 0x1f — атака
    else вОчередьПриказов(eng, i, 0x0f, 0, мх & ~0x1f, му & ~0x1f);            // 0x0f — идти
  }
  say(чужой ? t('в атаку: {n}', { n: свои.length }) : t('идут: {n}', { n: свои.length }));
}
// ---- круговое меню по долгому нажатию на землю
//
// Просьба владельца: «если долго держать на земле — появляется круговое меню, выбирать не тапом, а
// тянущим движением, и это движение не должно двигать карту или тянуть рамку». Поэтому пока круг
// открыт, палец только водит по нему курсор (см. ветку 'круг' в js/input.js), а отпускание
// выполняет выбранный сектор. Ничего нового круг не умеет — он собирает в одно место действия,
// которые и так есть на клавишах, но на телефоне их взять неоткуда.
const КРУГ_R1 = 34, КРУГ_R2 = 96;        // мёртвая зона в середине и внешний край
const КРУГ = { открыт: false, x: 0, y: 0, сектор: -1 };
const КРУГ_ПУНКТЫ = [
  { имя: 'собрать мясо', цвет: '#e8734a', дело: () => собратьМясо(), значок: мясоЗначок },
  { имя: 'вооружиться', цвет: '#d8c15a', дело: () => раздатьВещи(), значок: оружиеЗначок },
  { имя: 'сбросить лишнее', цвет: '#9aa0a6', дело: () => скинутьЛишнее(), значок: сброситьЗначок },
  { имя: 'отступить', цвет: '#6fb3e0', дело: () => отходНазад(), значок: отходЗначок },
  { имя: 'берсерк', цвет: '#e05c5c', дело: () => переключитьКамикадзе(), значок: берсеркЗначок },
];
/** Большой кусок мяса на кости — как предмет еды в самой игре. */
function мясоЗначок(g, x, y, r) {
  // мякоть: пухлая капля
  g.beginPath();
  g.moveTo(x - r * 0.15, y - r * 0.85);
  g.bezierCurveTo(x + r * 0.85, y - r * 0.85, x + r * 0.95, y + r * 0.35, x + r * 0.15, y + r * 0.55);
  g.bezierCurveTo(x - r * 0.45, y + r * 0.7, x - r * 0.9, y + r * 0.1, x - r * 0.15, y - r * 0.85);
  g.closePath(); g.fill();
  // кость с двумя головками
  g.beginPath(); g.moveTo(x - r * 0.15, y + r * 0.45); g.lineTo(x - r * 0.85, y + r * 0.95); g.stroke();
  g.beginPath(); g.arc(x - r * 0.95, y + r * 0.8, r * 0.22, 0, 7); g.stroke();
  g.beginPath(); g.arc(x - r * 0.78, y + r * 1.02, r * 0.22, 0, 7); g.stroke();
}
/** Круглый щит, поверх него копьё. */
function оружиеЗначок(g, x, y, r) {
  // щит: круг с умбоном и ободом
  g.beginPath(); g.arc(x, y, r * 0.78, 0, 7); g.stroke();
  g.beginPath(); g.arc(x, y, r * 0.52, 0, 7); g.stroke();
  g.beginPath(); g.arc(x, y, r * 0.17, 0, 7); g.fill();
  // копьё поверх: древко по диагонали и наконечник
  g.beginPath(); g.moveTo(x - r * 0.95, y + r * 0.95); g.lineTo(x + r * 0.62, y - r * 0.62); g.stroke();
  g.beginPath();
  g.moveTo(x + r * 0.55, y - r * 0.55); g.lineTo(x + r * 1.05, y - r * 1.05);
  g.lineTo(x + r * 0.95, y - r * 0.5); g.lineTo(x + r * 0.5, y - r * 0.95);
  g.closePath(); g.fill();
}
/** Корзина: сюда складывают лишнее. */
function сброситьЗначок(g, x, y, r) {
  // тулово корзины — трапеция
  g.beginPath();
  g.moveTo(x - r * 0.85, y - r * 0.25); g.lineTo(x + r * 0.85, y - r * 0.25);
  g.lineTo(x + r * 0.58, y + r * 0.9); g.lineTo(x - r * 0.58, y + r * 0.9);
  g.closePath(); g.stroke();
  // плетение
  g.beginPath(); g.moveTo(x - r * 0.75, y + r * 0.18); g.lineTo(x + r * 0.75, y + r * 0.18); g.stroke();
  g.beginPath(); g.moveTo(x - r * 0.3, y - r * 0.25); g.lineTo(x - r * 0.42, y + r * 0.9); g.stroke();
  g.beginPath(); g.moveTo(x + r * 0.3, y - r * 0.25); g.lineTo(x + r * 0.42, y + r * 0.9); g.stroke();
  // ручка
  g.beginPath(); g.arc(x, y - r * 0.25, r * 0.5, Math.PI, 0); g.stroke();
}
/** Стрелка назад к дому. */
function отходЗначок(g, x, y, r) {
  g.beginPath(); g.moveTo(x + r * 0.8, y); g.lineTo(x - r * 0.5, y); g.stroke();
  g.beginPath(); g.moveTo(x - r * 0.05, y - r * 0.5); g.lineTo(x - r * 0.6, y); g.lineTo(x - r * 0.05, y + r * 0.5); g.stroke();
  g.beginPath(); g.moveTo(x + r * 0.35, y - r * 0.75); g.lineTo(x + r * 0.35, y + r * 0.75); g.stroke();
}
/** Языки пламени: ярость. */
function берсеркЗначок(g, x, y, r) {
  g.beginPath();
  g.moveTo(x, y + r * 0.85);
  g.bezierCurveTo(x - r * 0.95, y + r * 0.2, x - r * 0.35, y - r * 0.35, x - r * 0.18, y - r * 0.85);
  g.bezierCurveTo(x + r * 0.05, y - r * 0.3, x + r * 0.5, y - r * 0.5, x + r * 0.38, y - r * 0.05);
  g.bezierCurveTo(x + r * 0.95, y + r * 0.15, x + r * 0.5, y + r * 0.6, x, y + r * 0.85);
  g.closePath(); g.stroke();
}
/** Открыть круг в точке кадра. */
function кругОткрыть(x, y) {
  const vw = mem.u32(0x488c4) || cv.width, vh = Math.min(mem.u32(0x488c8) || cv.height, cv.height);
  КРУГ.открыт = true; КРУГ.сектор = -1;
  КРУГ.x = Math.max(КРУГ_R2 + 6, Math.min(vw - КРУГ_R2 - 6, x));
  КРУГ.y = Math.max(КРУГ_R2 + 6, Math.min(vh - КРУГ_R2 - 6, y));
  sfx.play?.(0x68);
}
/** Какой сектор под пальцем (−1 — мёртвая зона в середине). */
function кругВести(x, y) {
  if (!КРУГ.открыт) return;
  const dx = x - КРУГ.x, dy = y - КРУГ.y, d = Math.hypot(dx, dy);
  if (d < КРУГ_R1) { КРУГ.сектор = -1; return; }
  const n = КРУГ_ПУНКТЫ.length;
  let a = Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / n;        // отсчёт от «вверх», серединой сектора
  while (a < 0) a += Math.PI * 2;
  КРУГ.сектор = Math.floor((a % (Math.PI * 2)) / (Math.PI * 2 / n)) % n;
}
/** Отпустили палец: выполнить выбранное. */
function кругВыбрать(x, y) {
  кругВести(x, y);
  const к = КРУГ.сектор; КРУГ.открыт = false; КРУГ.сектор = -1;
  if (к >= 0 && КРУГ_ПУНКТЫ[к]) { try { КРУГ_ПУНКТЫ[к].дело(); } catch (e) { say(t('не вышло: ') + e.message); } }
}
/** Нарисовать круг. */
function drawКруг() {
  if (!КРУГ.открыт) return;
  const g = ctx, n = КРУГ_ПУНКТЫ.length, шаг = Math.PI * 2 / n;
  g.save(); клипСцены();
  g.translate(КРУГ.x, КРУГ.y);
  for (let k = 0; k < n; k++) {
    const a0 = -Math.PI / 2 - шаг / 2 + k * шаг, a1 = a0 + шаг;
    const выбран = k === КРУГ.сектор;
    g.beginPath();
    g.arc(0, 0, КРУГ_R2, a0 + 0.02, a1 - 0.02);
    g.arc(0, 0, КРУГ_R1, a1 - 0.02, a0 + 0.02, true);
    g.closePath();
    g.fillStyle = выбран ? 'rgba(252,252,72,.30)' : 'rgba(8,6,5,.74)';
    g.fill();
    g.strokeStyle = выбран ? 'rgba(252,252,72,.95)' : 'rgba(180,160,110,.55)';
    g.lineWidth = выбран ? 2 : 1; g.stroke();
    // значок в середине сектора
    const ac = (a0 + a1) / 2, rr = (КРУГ_R1 + КРУГ_R2) / 2;
    const ix = Math.cos(ac) * rr, iy = Math.sin(ac) * rr;
    g.save(); g.strokeStyle = выбран ? '#fcfc48' : КРУГ_ПУНКТЫ[k].цвет; g.fillStyle = g.strokeStyle;
    g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
    КРУГ_ПУНКТЫ[k].значок(g, ix, iy, 13);
    g.restore();
  }
  // середина и подпись выбранного
  g.beginPath(); g.arc(0, 0, КРУГ_R1 - 2, 0, 7); g.fillStyle = 'rgba(8,6,5,.82)'; g.fill();
  g.strokeStyle = 'rgba(180,160,110,.5)'; g.lineWidth = 1; g.stroke();
  g.font = 'bold 12px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(252,252,72,.95)';
  const подпись = КРУГ.сектор >= 0 ? t(КРУГ_ПУНКТЫ[КРУГ.сектор].имя) : '';
  if (подпись) { const w = g.measureText(подпись).width + 12;
    g.fillStyle = 'rgba(8,6,5,.82)'; g.fillRect(-w / 2, КРУГ_R2 + 6, w, 18);
    g.fillStyle = 'rgba(252,252,72,.95)'; g.fillText(подпись, 0, КРУГ_R2 + 15); }
  g.restore();
}
/** Линия приказа под пальцем. */
function drawЖест() {
  if (!жестПриказа) return;
  const ж = жестПриказа;
  ctx.save(); клипСцены();
  ctx.strokeStyle = 'rgba(252,252,72,.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ж.x0, ж.y0); ctx.lineTo(ж.x1, ж.y1); ctx.stroke();
  ctx.beginPath(); ctx.arc(ж.x1, ж.y1, 7, 0, 7); ctx.stroke();
  ctx.restore();
}
/**
 * Отход (кнопка «отход» и клавиша R). Выделенные бросают всё и отходят к базе.
 *
 * Зачем отдельной командой: на пальце «отвести раненого» — самое частое и самое неудобное
 * действие, ровно на нём и случаются промахи. Одна кнопка снимает всю возню: не надо ни целиться
 * в свободную клетку, ни переключать кнопку мыши. Приказ обычный, движковый — «идти» к дому.
 */
/** Все свои бойцы, попадающие в кадр карты: отход без выделения работает по видимому полю. */
function видимыеСвои() {
  const мой = mem.u8(G.humanOwner), камX = mem.u32(0x31ae8), камY = mem.u32(0x31aec);
  const шир = (mem.u32(0x31af0) || 16) << 5, выс = (mem.u32(0x31af4) || 15) << 5;
  const из = [];
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (mem.u8(UNITS + i + U.OWNER) !== мой) continue;
    const t = mem.u8(UNITS + i + U.TYPE); if (t < 1 || t > 13) continue;
    const x = mem.u16(UNITS + i + U.X) - камX, y = mem.u16(UNITS + i + U.Y) - камY;
    if (x < -32 || y < -32 || x > шир || y > выс) continue;
    из.push(i);
  }
  return из;
}
/**
 * Отход. Слова владельца: «нажал ретрит — и все юниты, у кого мало жизней, начали выходить из боя;
 * или вообще все, кто сейчас в рамке видимости».
 *
 * Поэтому: кого отводить — берём выделенных, а если не выделено никого, то всех своих В КАДРЕ.
 * Из них уходят только подраненные (меньше половины здоровья) — целым в тылу делать нечего, они и
 * держат бой. С Shift уходят все выбранные,, без разбора: бывает, что надо увести отряд целиком.
 */
function отходНазад() {
  if (!running || playing) return;
  const выбраны = выделенные();
  // Отход срабатывает ВСЕГДА, а не только у подраненных (уточнение владельца). Я было оставил
  // только раненых — «целым в тылу делать нечего», — но это лишняя догадка за игрока: команда
  // «назад» должна слушаться сразу и всех, кого он выбрал.
  const свои = выбраны.length ? выбраны : видимыеСвои();
  if (!свои.length) return say(t('отводить некого'));
  const кандидаты = свои;
  const мой = mem.u8(G.humanOwner);
  let дом = 0;
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (mem.u8(UNITS + i + U.OWNER) !== мой || mem.u8(UNITS + i + U.TYPE) < 0x1a) continue;
    дом = i; if (mem.u8(UNITS + i + U.TYPE) === СКЛАД) break;          // склад — середина хозяйства
  }
  if (!дом) return say(t('отходить некуда: домов нет'));
  const дx = mem.u16(UNITS + дом + U.X), дy = mem.u16(UNITS + дом + U.Y);
  let n = 0;
  for (const i of свои) {
    ОчередьПриказов.снять(eng, i);                                    // свои шаги отменяем: это срочный приказ
    вОчередьПриказов(eng, i, 0x0f, 0, дx, дy);   // 0x0f — «идти» (js/port/inject.js, КОД.ИДТИ)
    n++;
  }
  say(t('отходят к базе: {n} из {в}', { n, в: кандидаты.length }));
}
/** Y — скинуть лишнее: всё ненадетое кладётся на землю под ноги. По одной вещи за нажатие. */
function скинутьЛишнее() {
  if (!running || playing) return;
  const свои = выделенные();
  if (!свои.length) return say(t('никто не выделен'));
  let скинули = 0;
  for (const i of свои) {
    const n = лишняяЯчейка(i); if (n < 0) continue;
    вОчередьПриказов(eng, i, (0x51 + n) & 0xff, 0, mem.u16(UNITS + i + U.X), mem.u16(UNITS + i + U.Y));
    скинули++;
  }
  say(скинули ? t('скидывают лишнее: {n}', { n: скинули }) : t('лишних вещей нет'));
}
const СКЛАД = 0x1a + 4;
const ВОКРУГ_ДОМА = [[-1, 0], [2, 0], [0, -1], [0, 2], [-1, -1], [2, -1], [-1, 2], [2, 2], [1, -1], [1, 2], [-1, 1], [2, 1]];
/** Свободная клетка рядом со зданием, ближайшая к бойцу: в само здание маршрут не строится. */
function подходКДому(здание, откуда) {
  const bx = mem.u16(UNITS + здание + U.X) >> 5, by = mem.u16(UNITS + здание + U.Y) >> 5;
  let лучшая = { x: bx, y: by }, d0 = 1e9;
  for (const [dx, dy] of ВОКРУГ_ДОМА) {
    const x = bx + dx, y = by + dy;
    if (!canPlace(x << 5, y << 5)) continue;
    const d = Math.abs(x - откуда.x) + Math.abs(y - откуда.y);
    if (d < d0) { d0 = d; лучшая = { x, y }; }
  }
  return лучшая;
}
/**
 * Клавиша B — «отнести в хранилище» всему выделенному отряду.
 *
 * Слова владельца: «когда я выделяю группу юнитов и нажимаю B, скрипт должен симулировать нажатие
 * кнопки „отнести в хранилище“ для каждого юнита в группе… в движке для этого есть встроенная
 * функция, вот её и надо использовать — не перепутай, как было со сном».
 *
 * Поэтому здесь ровно то же, что делает вторая кнопка боковой панели (storeBtn в js/port/input.js):
 *   • ближайший склад ищет САМ движок (0x23da0) — не наш перебор;
 *   • приказ — родной 0x51 + номер руки с мясом, цель склад, точка — его клетка.
 * Прежняя версия вместо этого подмешивала нашу очередь приказов и, если руки пусты, сперва гнала
 * бойца подбирать кусок. Из-за этого на отряде без мяса под ногами B выглядела мёртвой.
 */
function отнестиЕду() {
  if (!running || playing) return;
  const свои = выделенные();
  if (!свои.length) return say(t('никто не выделен'));
  let послали = 0, несут = 0, пустых = 0, безСклада = 0;
  for (const i of свои) {
    // Рука с мясом: слоты 6..8 записи юнита — те же, что читает панель.
    let слот = -1;
    for (let k = 6; k <= 8; k++) if (mem.u8(UNITS + i + U.INV + k) === МЯСО) { слот = k; break; }
    if (слот < 0) { пустых++; continue; }
    const r = call(eng, 0x23da0, { esi: i });            // ближайший склад — движковый поиск
    if (r.cf || !r.edi) { безСклада++; continue; }
    const склад = r.edi >>> 0;
    ОчередьПриказов.снять(eng, i);                        // свои шаги, если были, отменяем — команда прямая
    вОчередьПриказов(eng, i, (0x51 + слот) & 0xff, склад, mem.u16(UNITS + склад + U.X), mem.u16(UNITS + склад + U.Y));
    несут += mem.u16(UNITS + i + U.FOOD); послали++;
  }
  const части = [];
  if (послали) части.push(t('несут на склад: {n} ({m} мяса)', { n: послали, m: несут }));
  if (пустых) части.push(t('с пустыми руками: {n}', { n: пустых }));
  if (безСклада) части.push(t('склада нет: мясо принимает только склад'));
  say(части.join(' · ') || t('никто не выделен'));
}

// «Следовать за ним»: правая кнопка по своему бойцу. Приказ уходит каждому выделенному через
// общую очередь — значит доедет и по сети, и в запись партии.
Ввод.setFollowHandler((цель) => {
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (!(mem.u8(UNITS + i + U.F07) & 0x80)) continue;            // только выделенные
    if (i === цель || mem.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
    Следом.приказСледовать(eng, i, цель);
  }
  say(t('идём за ним'));
});
netEl('netdiff2').onchange = () => net.задатьМиссию(+netEl('netmission2').value, +netEl('netdiff2').value);
переключатель('netopen2', () => net.задатьОткрытость(вкл('netopen2'), вкл('netobs2')));
переключатель('netobs2', () => net.задатьОткрытость(вкл('netopen2'), вкл('netobs2')));
netEl('netbtn').onclick = () => { if (net.активна) netBar.hidden = !netBar.hidden; else if (netPanel.hidden) openNet(); else netPanel.hidden = true; };
// Скирмиш: то же лобби, но без релея — комната на одного, соперники компьютерные (js/net/локальный.js).
async function openSkirmish() {
  if (net.активна) { netBar.hidden = false; return; }
  const b = document.getElementById('skirmbtn'); if (b) b.disabled = true;
  try {
    await ensureNetFiles();
    netDefaults(); netPanel.hidden = false;
    await net.войтиЛокально(netEl('netname').value.trim() || t('игрок'));
  } catch (e) { netEl('netstat').textContent = e.message; }
  finally { if (b) b.disabled = false; drawLobby(); }
}
document.getElementById('skirmbtn').onclick = openSkirmish;
// Кнопка отладочного слоя ИИ — инструмент разработки, игроку она ничего не говорит (что за «ИИ»
// посреди партии, если противник выбран в лобби). Показываем только по ?aidebug в адресе.
// Кнопка «ИИ» была спрятана за отладочной ссылкой ?aidebug. Теперь она в панели всегда: по ней
// видно, какие мозги у каждого компьютерного места и сколько решений успела принять сеть —
// владелец просил быть уверенным в том, что выбранная нейронка действительно работает.
netEl('netai').onclick = () => { showAI = !showAI; netEl('netai').classList.toggle('on', showAI);
  обновитьМозги();
  if (showAI) toast(составМозгов() || t('компьютерных мест нет')); };
// Скирмиш можно переиграть на месте: та же карта, те же места и правила, состояние с нуля.
netEl('netrestart').onclick = () => {
  if (!net.активна || !net.локальная) return;
  saveReplay('restart');
  if (net.перезапустить()) { shell.подписьИтога = null; say(t('скирмиш заново')); }
  cv.focus();
};
netEl('netpause').onclick = () => setPaused(!shell.paused);
netEl('netquit').onclick = () => { if (net.активна) { net.выйти(); } };
netEl('netsurrender').onclick = () => { if (net.активна && !net.наблюдатель && confirm(t('Сдаться? Ваши войска и постройки погибнут.'))) net.сдаться(); };
roomsTimer = setInterval(refreshRooms, 2500);
if (netAuto.get('net') && !netAuto.get('nojoin')) setTimeout(() => { openNet(); joinRoom(netAuto.get('room') || netEl('netroom').value, netAuto.get('watch') ? 'наблюдатель' : 'игрок'); }, 1500);

// Отметка сборки. Вкладку с игрой держат открытой подолгу, а код меняется — поэтому раз в
// минуту (и при возвращении на вкладку) сверяемся с data/build.json и перезагружаем страницу,
// если сборка сменилась и человек сейчас в меню, а не в партии.
const BUILD = await fetch('../data/build.json', { cache: 'no-store' }).then(r => r.json()).then(j => j.build).catch(() => null);
/** Сверить версию собранных модулей с сервером: устаревшая вкладка ведёт себя странно. */
async function checkBuild() {
  if (!BUILD || shell.screen === 'game') return;
  const b = await fetch('../data/build.json', { cache: 'no-store' }).then(r => r.json()).then(j => j.build).catch(() => null);
  if (b && b !== BUILD) location.reload();
}
setInterval(checkBuild, 60000);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkBuild(); });

// ---------------------------------------------------------------- учебная сцена «кусок карты»
//
// Прямая ссылка на ту самую сцену, на которой учится сеть: кусок карты Тирано 32×32 клетки
// (вариант, выбранный владельцем по картинкам), высшая сложность, 25 секунд на попытку.
// Смотреть её надо так же, как её видит обучение, поэтому здесь ровно те же три вещи, что и в
// tools/ai_кусок_прогон.mjs: всё живое за пределами квадрата убирается с карты (и помечается
// «не возрождать» — иначе движок вернёт зверя через минуту), туман снимается целиком, и наше
// место ведёт компьютер.
const КУСОК_СЦЕНЫ = { миссия: 0, племя: 0, сложность: 2, рект: [1, 12, 32, 43], секунд: 30 };
let сценаКуска = false;
let сценаПлемя = null;            // сцена за целое племя: /jw/scene/<племя>[/<миссия>]
let сценаМиссия = 0;
let первыйЗапускСцены = true;
// Что считаем на глаз, пока смотрим сцену: ровно то, за что платит обучение (tools/ai_кусок_прогон.mjs).
// Владелец смотрит и даёт подсказки — без цифр «боятся ударить зверя» приходится оценивать по
// ощущению, а тут видно: сколько очков урона нанесли, скольких добили, кого потеряли и на какой
// секунде убит первый (норма — 8 секунд, второй — 20).
let счёт = null;
const живЮ = (i) => i && !(mem.u8(UNITS + i + U.FLAGS5B) & 1) && mem.u8(UNITS + i + U.HP) > 0
                    && (mem.u8(UNITS + i + U.STATE) & 0xf0) !== 0x60;

/** Снять начальный срез сцены: кто наш, кто зверь, сколько у зверья здоровья. */
function счётНачать([x0, y0, x1, y1]) {
  const мой = mem.u8(G.humanOwner), звери = [], наши = [], hp0 = new Map();
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const x = mem.u16(UNITS + i + U.X) >> 5, y = mem.u16(UNITS + i + U.Y) >> 5;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const т = mem.u8(UNITS + i + U.TYPE);
    if (mem.u8(UNITS + i + U.OWNER) === мой && т < 0x1a) { наши.push(i); continue; }
    if (т >= 14 && т <= 23) { звери.push(i); hp0.set(i, mem.u8(UNITS + i + U.HP)); }
  }
  // «павшие» — множество, а не пересчёт живых: движок возвращает зверя по таймеру, и он
  // занимает ТОТ ЖЕ слот, отчего счётчик убитых откатывался назад (видно было на сцене:
  // «первый 6.2 с» при «убито 0»). Убитый раз — убит навсегда.
  счёт = { звери, наши, hp0, павшие: new Set(), первый: null, второй: null, шаг0: mem.u32(G.step) };
}

/** Текущие цифры сцены. Зовётся раз в секунду из строки состояния стенда. */
function счётСейчас() {
  if (!счёт) return null;
  const сек = (mem.u32(G.step) - счёт.шаг0) * 55 / 1000;
  let урон = 0;
  for (const з of счёт.звери) {
    const было = счёт.hp0.get(з) || 0;
    if (!живЮ(з)) счёт.павшие.add(з);
    урон += счёт.павшие.has(з) ? было : Math.max(0, было - mem.u8(UNITS + з + U.HP));
  }
  const убито = счёт.павшие.size;
  if (счёт.первый === null && убито >= 1) счёт.первый = сек;
  if (счёт.второй === null && убито >= 2) счёт.второй = сек;
  const потеряно = счёт.наши.filter(i => !живЮ(i)).length;
  return { сек, убито, всего: счёт.звери.length, урон, потеряно, наших: счёт.наши.length,
           первый: счёт.первый, второй: счёт.второй };
}

/** Снять туман со всей карты: смотреть сцену сквозь него бессмысленно. */
function открытьКарту() {
  const W = mem.u32(G.mapW), H = mem.u32(G.mapH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = x + (y << 8); mem.w8(BI + c, mem.u8(BI + c) | 1); }
}

/** Вырезать кусок: всё живое вне квадрата убрать насовсем. */
function вырезатьКусок([x0, y0, x1, y1]) {
  const мой = mem.u8(G.humanOwner);
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const x = mem.u16(UNITS + i + U.X) >> 5, y = mem.u16(UNITS + i + U.Y) >> 5;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
    if (mem.u8(UNITS + i + U.OWNER) === мой) continue;              // своих не трогаем никогда
    mem.w8(UNITS + i + U.FLAGS5B, mem.u8(UNITS + i + U.FLAGS5B) | 1);
    mem.w16(UNITS + i + U.ANIM, 0xffff);                            // метка «не возрождать»
  }
}

/** Запустить сцену заново: миссия, обрезка, туман, мозги. Пауза и «заново» — кнопками стенда. */
async function запуститьКусок() {
  const с = КУСОК_СЦЕНЫ;
  // Паки карт и спрайтов могут быть ещё не скачаны: по прямой ссылке человек попадает сюда
  // раньше, чем меню успевает их подтянуть. Без этого startMission падает на «нет пака».
  say(t('сцена: загрузка ресурсов…'));
  for (const f of ['_PWAR08.TRC', '_PWAR09.TRC', '_PWAR04.TRS', '_PWAR05.TRS', '_PWAR06.TRW']) {
    try { await need(f); } catch (e) { say(t('сцена: не скачался пак ') + f); return; }
  }
  // Владелец, посмотрев сцену: «ты ведь при загрузке страницы всегда последнюю показываешь
  // нейронку?» — «потому что я там ничего не выбирал». Не показывала: по умолчанию бралась
  // замороженная «лучшая на сегодня» (js/ai/нейросети.js, ЛУЧШИЕ.боец от 13 сентября), обученная
  // совсем на другой задаче, а свежая итерация подхватывалась только руками, кнопкой в ряду
  // «учится». Теперь сцена сама берёт последнее из идущего обучения.
  // ВХОД ПО ССЫЛКЕ ВСЕГДА НАЧИНАЕТСЯ С ОБРАЗЦА — рукописного эталона боя за первую гиену
  // (просьба владельца: «закинь это поведение на сцену»). Проверки «а вдруг он что-то выбирал
  // раньше» не хватило: в его браузере лежал выбор с прошлых заходов, и он открыл ссылку, увидел
  // отрядную сеть и написал «пацаны сразу врассыпную побежали». Поэтому на ПЕРВОМ запуске сцены
  // мозги ставим принудительно; дальше кнопки в панели работают как обычно и «заново» их уважает.
  if (первыйЗапускСцены) { лаб.мозги = 'образец'; первыйЗапускСцены = false; }
  await свежиеВесаПоУмолчанию();
  await saveReplay('restart');
  shell.difficulty = с.сложность;
  startMission(с.миссия, с.племя, с.сложность);
  вырезатьКусок(с.рект);
  открытьКарту();
  счётНачать(с.рект);
  сценаКуска = true;
  // Автобой и ×3 включаем ТОЛЬКО В ПАМЯТИ, без записи в хранилище: иначе обычная игра потом
  // открывалась с включённым автобоем, то есть компьютер играл за человека без спроса.
  автобой = true;
  следимЗаОтрядом = true;                       // камера ходит за четвёркой
  if (ускорение < 3) { ускорение = 3; обновитьУскорение(); }     // сразу ×3, как просил владелец
  await лабМозгиПоставить(false);
  rend.drawFull();
  say(t('сцена: кусок карты Тирано {a}×{b}, {s} секунд, туман снят',
        { a: с.рект[2] - с.рект[0] + 1, b: с.рект[3] - с.рект[1] + 1, s: с.секунд }));
}

/**
 * СЦЕНА ЗА ЛЮБОЕ ПЛЕМЯ: /jw/scene/moospell и так далее. Просьба владельца — «сделай сразу ссылки,
 * чтобы можно было запускать симуляцию на каждой расе, как сейчас для тиранов». Отличие от
 * /jw/scene только в том, что карта не режется: идёт настоящая первая миссия выбранного племени
 * на трудной сложности. Всё остальное так же — образец за рулём, автобой, ×3, камера за отрядом.
 */
async function запуститьПлемя(племя, миссия = 0) {
  say(t('сцена: загрузка ресурсов…'));
  for (const f of ['_PWAR08.TRC', '_PWAR09.TRC', '_PWAR04.TRS', '_PWAR05.TRS', '_PWAR06.TRW']) {
    try { await need(f); } catch (e) { say(t('сцена: не скачался пак ') + f); return; }
  }
  if (первыйЗапускСцены) { лаб.мозги = 'образец'; первыйЗапускСцены = false; }
  await свежиеВесаПоУмолчанию();
  await saveReplay('restart');
  shell.difficulty = 2;
  startMission(миссия, племя, 2);
  открытьКарту();
  сценаКуска = false; сценаПлемя = племя; сценаМиссия = миссия;
  автобой = true;
  следимЗаОтрядом = true;
  if (ускорение < 3) { ускорение = 3; обновитьУскорение(); }
  await лабМозгиПоставить(false);
  rend.drawFull();
  сценаПанельПостроить();
  панельВыбораСцены(племя, миссия);
  say(t('сцена: {t}, миссия {n}, трудная — образец ведёт отряд',
        { t: ПЛЕМЕНА_ИМЕНА[племя] || племя, n: миссия + 1 }));
}

/**
 * НИЖНЯЯ ПАНЕЛЬ СЦЕНЫ: две кнопки и журнал ДЖЕВА. Владелец: «убери снизу все кнопки, не нужны они
 * для этого стенда; пусть там будет две кнопки — ×3 скорость и пауза — и статусные сообщения, что
 * запросили у ДЖЕВА, когда запросили и что он ответил».
 *
 * Обычный ряд кнопок игры и панель стенда прячем целиком, вместо них — своя полоса внизу: слева
 * кнопки, справа последние обращения к модели с игровым временем, темами вопроса и ответами.
 */
let сценаПанель = null;
function сценаПанельПостроить() {
  // Прячем насовсем: строку состояния игра сама показывает обратно каждым сообщением, поэтому
  // ей мало hidden — ставим display:none.
  // Строка сообщений игры — это #noteline (в ней время миссии и текст say), а не «say»:
  // прежний список прятал несуществующий элемент, и полоса оставалась на экране.
  for (const id of ['bar', 'noteline', 'netbar']) {
    const э = document.getElementById(id);
    if (э) { э.hidden = true; э.style.display = 'none'; }
  }
  if (лабЭл) { лабЭл.hidden = true; лабЭл.style.display = 'none'; }
  if (сценаПанель) return сценаПанель;
  сценаПанель = document.createElement('div');
  сценаПанель.id = 'scenebar';
  сценаПанель.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:55;display:flex;gap:10px;'
    + 'align-items:flex-start;background:rgba(0,0,0,.72);color:#eee;font:12px/1.35 system-ui;padding:6px 8px';
  const кнопки = document.createElement('div');
  кнопки.style.cssText = 'display:flex;gap:6px;flex:0 0 auto';
  const сделать = (подпись, действие) => {
    const б = document.createElement('button');
    б.textContent = подпись;
    б.style.cssText = 'background:#222;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 10px;cursor:pointer';
    б.onclick = () => { действие(); сценаПанельОбновить(); };
    кнопки.appendChild(б); return б;
  };
  сценаПанель.кнПауза = сделать('⏸', () => setPaused(!shell.paused));
  // ×1 → ×3 → ×10 → ×1, как и главная кнопка скорости (владелец: «переключатель должен быть 1, 3, 10»).
  сценаПанель.кнСкорость = сделать('×3', () => { ускорение = ускорение === 1 ? 3 : ускорение === 3 ? 10 : 1; обновитьУскорение(); });
  const журнал = document.createElement('div');
  журнал.style.cssText = 'flex:1 1 auto;white-space:pre-line;max-height:120px;overflow:auto;color:#cfcfcf';
  сценаПанель.журнал = журнал;
  сценаПанель.appendChild(кнопки); сценаПанель.appendChild(журнал);
  document.body.appendChild(сценаПанель);
  return сценаПанель;
}

/** Перерисовать полосу: состояние кнопок и последние обращения к ДЖЕВУ. */
function сценаПанельОбновить() {
  if (!сценаПанель) return;
  сценаПанель.кнПауза.textContent = shell.paused ? '▶' : '⏸';
  сценаПанель.кнСкорость.textContent = '×' + ускорение;
  const сек = Math.round(mem.u32(G.step) * 0.055);
  const с = образецСлой.с;
  const строки = [];
  const д = с?.директива;
  строки.push(`${Math.floor(сек / 60)}:${String(сек % 60).padStart(2, '0')} · ${t('штаб')}: `
    + (д ? `${д.вид}${д.точка ? ` → ${д.точка.x},${д.точка.y}` : ''} · ${д.почему}` : t('выключен'))
    + (ДЖЕВ_ВКЛ ? ` · ${t('джев: спрашиваем раз в {n} с', { n: Math.round(ТАКТ_ДЖЕВА * 0.055) })}`
                : ` · ${t('джев выключен')}`)
    + (с?.стройка?.экономика ? ` · ${t('еда')} ${с.стройка.экономика.запас}`
        + ` (+${с.стройка.экономика.доход_в_секунду}/с)` : ''));
  for (const з of джевЖурнал.slice(0, 6)) {
    const t0 = `${Math.floor(з.сек / 60)}:${String(з.сек % 60).padStart(2, '0')}`;
    строки.push(`  ${t0} → ${з.темы}` + (з.ошибка ? ` · ⚠ ${з.ошибка}`
      : ` · ${з.ответы || t('ждём ответа')}` + (з.мс !== undefined ? ` · ${з.изКэша ? t('из кэша') : з.мс + ' мс'}` : '')));
  }
  сценаПанель.журнал.textContent = строки.join('\n');
}
наШаг.push(() => { if (сценаПанель && !(mem.u32(G.step) % 18)) сценаПанельОбновить(); });
const ТАКТ_ДЖЕВА = 90;   // столько тиков между вопросами (js/ai/штаб.js, ПЕРЕСМОТР)

/**
 * ПЕРЕКЛЮЧАТЕЛЬ СЦЕНЫ: племя и уровень, не трогая адресную строку руками.
 * Просьба владельца — «чтобы я мог посмотреть, как это будет работать на разных уровнях для всех
 * рас». Ссылки /jw/scene/<племя>/<уровень> и так есть, но набирать их в браузере неудобно;
 * здесь те же ссылки, только списком. Галочка «штаб» включает верхний слой директив
 * (js/ai/штаб.js): он пока опытный и по умолчанию выключен, чтобы не портить пройденный первый
 * уровень.
 */
function панельВыбораСцены(племя, миссия) {
  let э = document.getElementById('scenepick');
  if (!э) {
    э = document.createElement('div'); э.id = 'scenepick';
    э.style.cssText = 'position:fixed;right:8px;top:8px;z-index:60;display:flex;gap:6px;align-items:center;'
      + 'background:rgba(0,0,0,.6);color:#eee;font:12px system-ui;padding:5px 7px;border-radius:6px';
    document.body.appendChild(э);
  }
  const адрес = new URLSearchParams(location.search);
  const штаб = (адрес.get('hq') ?? адрес.get('JW_ОБР_ШТАБ')) === '1';
  э.innerHTML = '';
  const выбор = (опции, текущее) => {
    const s2 = document.createElement('select');
    s2.style.cssText = 'background:#222;color:#eee;border:1px solid #555;border-radius:4px';
    for (const [зн, им] of опции) { const o = document.createElement('option'); o.value = зн; o.textContent = им; s2.appendChild(o); }
    s2.value = String(текущее); return s2;
  };
  const пл = выбор(ПЛЕМЕНА_ИМЕНА.map((им, i) => [i, им]), племя);
  const ми = выбор(Array.from({ length: 12 }, (_, i) => [i, t('уровень {n}', { n: i + 1 })]), миссия);
  const галка = (подпись, вкл) => {
    const л = document.createElement('label'); л.style.cssText = 'display:flex;gap:3px;align-items:center;cursor:pointer';
    const в = document.createElement('input'); в.type = 'checkbox'; в.checked = вкл;
    л.appendChild(в); л.appendChild(document.createTextNode(подпись)); л.ввод = в; return л;
  };
  // Одна галочка: штаб с ДЖЕВОМ за рулём. Отдельная «джев» была путаницей — ДЖЕВ и ЕСТЬ мозг
  // штаба, а скрипт в нём лишь запасной на те доли секунды, пока ответ в пути.
  const шт = галка(t('штаб'), штаб);
  // ДЖЕВ выключен (владелец: бесполезен) — галочки «без сети» больше нет.
  const кам = галка(t('камера'), следимЗаОтрядом);
  кам.title = t('вести камеру за отрядом; любое движение камеры руками её отключает');
  кам.ввод.onchange = () => {
    следимЗаОтрядом = кам.ввод.checked; нашаКамера = null;
    say(следимЗаОтрядом ? t('камера: ведём за отрядом') : t('камера: свободная'));
  };
  const пойти = () => {
    const ручки = [];
    // Только латиница: ссылку владелец пересылает и открывает руками.
    if (шт.ввод.checked) ручки.push('hq=1');
    // Пресет ручек ИИ переносим на новое племя (владелец переключал племя списком — ?preset=t2g терялся,
    // и на других картах играл голый ИИ: «штаб выключен», отряд у базы).
    const было = new URLSearchParams(location.search);
    if (было.get('preset')) ручки.push('preset=' + encodeURIComponent(было.get('preset')));
    else for (const [к, з] of было) if (к.startsWith('JW_')) ручки.push(encodeURIComponent(к) + '=' + encodeURIComponent(з));
    свойУход = true;
    location.href = `/jw/scene/${ПЛЕМЕНА_ИМЕНА[+пл.value].toLowerCase()}/${+ми.value + 1}`
                    + (ручки.length ? '?' + ручки.join('&') : '');
  };
  пл.onchange = ми.onchange = шт.ввод.onchange = пойти;
  for (const у of [пл, ми, шт, кам]) э.appendChild(у);
}

/**
 * СЦЕНА «ТРОЕ НА AShfall»: предстартовый набор, как в схватке, и три компьютера разных мозгов.
 *
 * Просьба владельца: одна ссылка, по которой сразу идёт партия на карте Ashfall между тремя
 * случайными племенами, где первым правит связка нейросетей (тактик плюс сеть бойца плюс
 * стратег по правилу), вторым — прежний скриптовый компьютер, а третьим — РОДНОЙ ИИ оригинала,
 * причём у родного войска те, что даёт сама карта, а у первых двух — обычные стартовые наборы.
 * Мы смотрим со стороны: туман снят, панель зрителя, отдаление карты, ×3.
 */
// Само состояние демо-схватки объявлено выше, у проверок условий: к нему обращаются функции,
// которые срабатывают ещё до того, как выполнится этот кусок файла (отсюда была ошибка страницы
// «Cannot access 'бой' before initialization»).
/** Случайная перестановка (для выбора племён и мест). */
const вразброс = (сп) => { const a = сп.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function запуститьБой() {
  say(t('сцена: загрузка ресурсов…'));
  for (const f of ['_PWAR08.TRC', '_PWAR09.TRC', '_PWAR04.TRS', '_PWAR05.TRS', '_PWAR06.TRW', '_PWAR13.TRC']) {
    try { await need(f); } catch (e) { say(t('сцена: не скачался пак ') + f); return; }
  }
  // Веса качаем ДО старта: сеть, приехавшая в середине партии, — это уже другая партия.
  const местоСети = { мозги: 'боец' };            // сеть бойца, тактика и штаб — скриптовые
  try { await Сети.подготовить([местоСети]); } catch {}
  await saveReplay('restart');
  const племена = вразброс([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, 3);
  shell.difficulty = 2;
  startMission(бой.карта, племена[0], 2);
  const цвета = вразброс(Object.keys(стартовыеПозиции(mem)).map(Number));
  const [цA, цB, цC] = цвета;
  // Двое играют стартовыми наборами, третьему армию оставляем ту, что стоит на карте.
  расставитьМеста(eng, [{ цвет: цA, племя: племена[0], кто: 'компьютер' },
                        { цвет: цB, племя: племена[1], кто: 'компьютер' }], { родные: [цC] });
  ИИ.сброс(eng);
  mem.w8(0x32aec + цA, 0);
  // СЕТЬ ТОЛЬКО У БОЙЦА. Владелец: «мы нормально научили только бойца; тактика и стратег не
  // учены, пусть это будут обычные скрипты». Поэтому штаб и тактика — штатный скриптовый
  // компьютер, сеть подключается ровно на уровне решений отдельного юнита.
  ИИ.задать(eng, цA, { уровень: 3, характер: 'ровный', ...Сети.дляМеста(местоСети) });
  mem.w8(0x32aec + цB, 0);
  ИИ.задать(eng, цB, { уровень: 3, характер: 'ровный' });               // прежний скриптовый компьютер
  включитьИИ(mem, цC);                                                   // родной ИИ оригинала, армия с карты
  // Мы — зритель: человеку отдаём цвет, за которым никто не играет, и снимаем туман.
  const свободный = [0, 1, 2, 3, 4, 5, 6, 7].find(ц => ц !== цA && ц !== цB && ц !== цC);
  mem.w8(G.humanOwner, свободный);
  открытьКарту();
  автобой = false; образецСлой.вкл = false; образецСлой.с = null; следимЗаОтрядом = false;
  сценаКуска = false; сценаПлемя = null;
  бой.вкл = true;
  // ДЕМО — ТОЛЬКО ИГРА. Владелец: «на демо скирмиша убери нижнюю панель совсем, только игра
  // должна быть видна на весь экран, больше ничего». Прячем нижний ряд кнопок и строку состояния;
  // кадр после этого сам растянется под окно (следитьЗаКадром в цикле кадров).
  for (const id of ['bar', 'say', 'netbar']) { const э = document.getElementById(id); if (э) э.hidden = true; }
  document.body.classList.add('демо');
  // Для табло зрителя: тот же вид записи, что приходит из лобби, — по ней рисуются племя и значок
  // управления (нейронка / скрипт / родной).
  бой.места = [
    { цвет: цA, племя: племена[0], кто: 'компьютер', мозги: 'боец' },
    { цвет: цB, племя: племена[1], кто: 'компьютер', мозги: 'скрипт' },
    { цвет: цC, племя: цC, кто: 'компьютер', ии: 'встроенный' },
  ];
  бой.состав = [
    { цвет: цA, племя: племена[0], кто: 'нейросети', подпись: t('сеть бойца, тактика и штаб скриптовые') },
    { цвет: цB, племя: племена[1], кто: 'скрипт', подпись: t('прежний скриптовый компьютер') },
    { цвет: цC, племя: цC, кто: 'родной', подпись: t('родной ИИ оригинала, армия с карты') },
  ];
  shell.screen = 'game'; shell.tune('game'); rend.drawFull();
  running = true; shell.paused = false; setPaused(false);
  if (ускорение < 3) { ускорение = 3; обновитьУскорение(); }
  // Камеру ставим на середину между базами всех троих: первая попавшаяся база бывает у самого
  // края карты, и зритель открывал сцену, глядя в чёрное поле за границей.
  try { кСерединеБоя(); } catch {}
  // ПЕРЕРИСОВАТЬ ПОСЛЕ ТОГО, КАК РАСКЛАДКА УСТОЯЛАСЬ. Обычный кадр рисует только изменившееся
  // (rend.drawTick), а размер кадра подстраивается под окно уже после запуска: без полной
  // перерисовки сцена оставалась чёрной, хотя игра шла и мини-карта обновлялась.
  setTimeout(() => { try { кСерединеБоя(); rend.drawFull(); } catch {} }, 300);
  лабНарисовать();
  say(бой.состав.map(м => `${ПЛЕМЕНА_ИМЕНА[м.племя] || м.племя} — ${м.подпись}`).join(' · '));
}

// ---------------------------------------------------------------- дуэль: вождь на Haiku+ДЖЕВ против скрипта
// Ссылка ?duel=llm (владелец 08.10.2026: «прототип ИИ на Haiku 5.5 в связке с джевом; карта, где два компьютера
// устраивают махач»). Сторона A — скриптовый компьютер, которым правит вождь (js/ai/вождь.js): Haiku задаёт замысел
// раз в ~20 с, ДЖЕВ раз в ~3 с решает «бить/отходить». Сторона B — тот же скриптовый компьютер без вождя.
// Мы зрители: туман снят, справа панель вождя. Решения вождя приходят асинхронно — запись такой партии
// не воспроизводится один в один (в запись ответы вождя не пишутся).
async function запуститьДуэль() {
  say(t('сцена: загрузка ресурсов…'));
  for (const f of ['_PWAR08.TRC', '_PWAR09.TRC', '_PWAR04.TRS', '_PWAR05.TRS', '_PWAR06.TRW', '_PWAR13.TRC']) {
    try { await need(f); } catch (e) { say(t('сцена: не скачался пак ') + f); return; }
  }
  await saveReplay('restart');
  // Честное сравнение: ?a=&b= — номера племён 0..7 (места тогда тоже постоянные, ?swap=1 — поменять
  // местами), ?duel=script — на месте вождя обычный ВОЕВОДА (та же партия без Haiku).
  const заданы = netAuto.has('a') && netAuto.has('b');
  const племена = заданы ? [+netAuto.get('a') & 7, +netAuto.get('b') & 7] : вразброс([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, 2);
  shell.difficulty = 2;
  startMission(бой.карта, племена[0], 2);
  const позиции = Object.keys(стартовыеПозиции(mem)).map(Number);
  let [цA, цB] = заданы ? позиции.slice(0, 2) : вразброс(позиции);
  if (netAuto.get('swap') === '1') [цA, цB] = [цB, цA];
  расставитьМеста(eng, [{ цвет: цA, племя: племена[0], кто: 'компьютер' }, { цвет: цB, племя: племена[1], кто: 'компьютер' }]);
  ИИ.сброс(eng);
  mem.w8(0x32aec + цA, 0); ИИ.задать(eng, цA, { уровень: 3, характер: 'ровный' });
  mem.w8(0x32aec + цB, 0); ИИ.задать(eng, цB, { уровень: 3, характер: 'ровный' });
  // ?duel=llm — вождь v3 (план партии + шаги, картбланш); ?duel=llm2 — прежний командир отрядов
  const v3 = netAuto.get('duel') !== 'llm2', безВождя = netAuto.get('duel') === 'script';
  const вождь = (v3 ? Вождь3 : Вождь).создать(цA, '/jw/jev', `${v3 ? 'v3' : 'v2'}_${ПЛЕМЕНА_ИМЕНА[племена[0]]}-vs-${ПЛЕМЕНА_ИМЕНА[племена[1]]}`);
  if (!безВождя) {
    ИИ.состояние(eng, цA).вождь = вождь;
    ИИ.состояние(eng, цA).комдив = { вождь: true };        // уровень комдива: отрядами командует вождь
  }
  window.jwДуэль = { цA, цB, племена };
  window.jwСчёт = () => { const сторона = (ц) => { let б = 0, д = 0;
      for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
        if ((mem.u8(UNITS + i + U.FLAGS5B) & 1) || mem.u8(UNITS + i + U.OWNER) !== ц) continue;
        if (mem.u8(UNITS + i + U.TYPE) >= 0x1a) д++; else б++; }
      return { юнитов: б, домов: д, еда: mem.u32(G.food + ц * 4) }; };
    return { мин: +(mem.u32(G.step) / 1080).toFixed(1), A: сторона(цA), B: сторона(цB) }; };
  const свободный = [0, 1, 2, 3, 4, 5, 6, 7].find(ц => ц !== цA && ц !== цB);
  mem.w8(G.humanOwner, свободный);
  открытьКарту();
  автобой = false; образецСлой.вкл = false; образецСлой.с = null; следимЗаОтрядом = false;
  сценаКуска = false; сценаПлемя = null;
  бой.вкл = true;
  for (const id of ['bar', 'say', 'netbar']) { const э = document.getElementById(id); if (э) э.hidden = true; }
  document.body.classList.add('демо');
  бой.места = [{ цвет: цA, племя: племена[0], кто: 'компьютер', мозги: 'вождь' }, { цвет: цB, племя: племена[1], кто: 'компьютер', мозги: 'скрипт' }];
  бой.состав = [{ цвет: цA, племя: племена[0], кто: 'вождь', подпись: 'вождь: Haiku 5.5 + ДЖЕВ' },
                { цвет: цB, племя: племена[1], кто: 'скрипт', подпись: 'скриптовый компьютер' }];
  shell.screen = 'game'; shell.tune('game'); rend.drawFull();
  running = true; shell.paused = false; setPaused(false);
  // Обычная скорость: Haiku думает 5–12 с, на ×3 каждое решение опаздывало на полминуты игры (журнал 08.10).
  ускорение = 1; обновитьУскорение();
  try { кСерединеБоя(); } catch {}
  setTimeout(() => { try { кСерединеБоя(); rend.drawFull(); } catch {} }, 300);
  if (!безВождя) (v3 ? панельВождя3 : панельВождя)(вождь, племена, [цA, цB]);
}
/** Панель вождя v3: стратегия, этапы (текущий подсвечен), заметка, последние шаги. */
/** Сворачивание панели вождя до полоски: щелчок по ▾/▸, состояние помнит браузер. */
function свёрткаПанели(п, ширина) {
  let св = false; try { св = localStorage.getItem('jwВождьСвёрнут') === '1'; } catch {}
  п.addEventListener('click', (e) => { if (!e.target.closest('[data-свернуть]')) return;
    св = !св; try { localStorage.setItem('jwВождьСвёрнут', св ? '1' : '0'); } catch {} п.обновить?.(); });
  return (заголовок, тело) => {
    п.style.width = св ? 'auto' : ширина; п.style.padding = св ? '3px 10px' : '10px 12px'; п.style.overflow = св ? 'hidden' : 'auto';
    const кн = `<span data-свернуть style="float:right;cursor:pointer;margin-left:10px;color:#f0c060;user-select:none" title="${св ? 'развернуть' : 'свернуть'}">${св ? '▸' : '▾'}</span>`;
    return св ? `${кн}<span data-свернуть style="cursor:pointer">${заголовок}</span>` : `${кн}${заголовок}${тело}`;
  };
}
function панельВождя3(в, племена, цвета) {
  let п = document.getElementById('вождьПанель');
  if (!п) { п = document.createElement('div'); п.id = 'вождьПанель'; document.body.appendChild(п); }
  п.style.cssText = 'position:fixed;top:8px;right:8px;width:380px;max-height:94vh;overflow:auto;z-index:50;background:rgba(10,12,8,.9);' +
    'color:#e8e2c8;font:12px/1.4 sans-serif;padding:10px 12px;border:1px solid #6a5a2a;border-radius:8px';
  const рамка = свёрткаПанели(п, '380px');
  const esc = (x) => String(x ?? '').replace(/[&<>]/g, ч => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ч]));
  const живых = (ц) => { let n = 0; for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT))
    if (!(mem.u8(UNITS + i + U.FLAGS5B) & 1) && mem.u8(UNITS + i + U.OWNER) === ц && mem.u8(UNITS + i + U.TYPE) < 0x1a) n++; return n; };
  const обновить = () => {
    if (!document.body.contains(п)) return;
    const пл = в.план;
    п.innerHTML = рамка(`<b style="color:#f0c060">ВОЖДЬ — ${esc(ПЛЕМЕНА_ИМЕНА[племена[0]])}</b> <span style="color:#a8a088">${живых(цвета[0])} : ${живых(цвета[1])}${в.ждём ? ' · думает…' : ''}</span>`, `<br>(Haiku 5.5, картбланш; юнитов ${живых(цвета[0])})<br>
      против <b>${esc(ПЛЕМЕНА_ИМЕНА[племена[1]])}</b> (скрипт; юнитов ${живых(цвета[1])})<hr style="border-color:#4a4020">
      ${в.реплика ? `<div style="font-size:14px;color:#ffd890">«${esc(в.реплика)}»</div>` : ''}
      ${пл ? `<div><b>Стратегия:</b> ${esc(пл.стратегия)}</div>
        <ol style="margin:4px 0 4px 18px;padding:0">${пл.этапы.map((э, k) => `<li style="${k === в.этап ? 'color:#ffd890;font-weight:bold' : 'color:#a8a088'}">${esc(э.цель)}${э.срок ? ' — к ' + esc(э.срок) : ''}<br><span style="font-weight:normal">${esc(э.делать)}</span></li>`).join('')}</ol>`
        : `<div>${в.ждём ? 'вождь составляет план…' : 'ждём плана'}</div>`}
      ${в.заметка ? `<div style="color:#b8c8a8">заметка: ${esc(в.заметка)}</div>` : ''}
      ${в.почему ? `<div style="color:#b8b098">${esc(в.почему)}</div>` : ''}
      <div style="color:#9ab0d0">знания: ${esc((в.темы || []).join(' · ') || '—')}</div>
      <div style="color:#8a8470">запросов ${в.вызовов}, ошибок ${в.ошибок}, последний ${в.мс} мс · приказов у бойцов ${в.приказы.size}${в.ждём ? ' · думает…' : ''}</div>
      <hr style="border-color:#4a4020"><div style="color:#b8b098">${в.журнал.slice(0, 10).map(ж => `${esc(ж.время)} ${esc(ж.что)}${ж.реплика ? ` «${esc(ж.реплика)}»` : ''}`).join('<br>')}</div>`);
    clearTimeout(п.таймер); п.таймер = setTimeout(обновить, 700);
  };
  п.обновить = обновить;
  обновить();
}
/** Панель вождя справа сверху: замысел, итоговая осанка, реплика, ответы ДЖЕВа, счётчики. */
function панельВождя(в, племена, цвета) {
  let п = document.getElementById('вождьПанель');
  if (!п) { п = document.createElement('div'); п.id = 'вождьПанель'; document.body.appendChild(п); }
  п.style.cssText = 'position:fixed;top:8px;right:8px;width:340px;max-height:92vh;overflow:auto;z-index:50;background:rgba(10,12,8,.88);' +
    'color:#e8e2c8;font:12px/1.4 sans-serif;padding:10px 12px;border:1px solid #6a5a2a;border-radius:8px;pointer-events:auto';
  const рамка = свёрткаПанели(п, '340px');
  const esc = (x) => String(x ?? '').replace(/[&<>]/g, ч => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ч]));
  const обновить = () => {
    if (!document.body.contains(п)) return;
    const з = в.замысел, д = в.джев, и = в.итог;
    const сек = (шаг) => Math.floor(шаг / 18);
    const живых = (ц) => { let n = 0; for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT))
      if (!(mem.u8(UNITS + i + U.FLAGS5B) & 1) && mem.u8(UNITS + i + U.OWNER) === ц && mem.u8(UNITS + i + U.TYPE) < 0x1a) n++; return n; };
    const пр = в.приказ;
    const отряды = в.отряды.map((сп, g) => `<div>отряд ${g + 1}: ${сп.length} бойц. — <b>${esc(в.задачи[g])}</b>${в.куда[g] ? ' → ' + esc(в.места[в.куда[g]]?.описание || в.куда[g]) : ''}</div>`).join('');
    п.innerHTML = рамка(`<b style="color:#f0c060">ВОЖДЬ — ${esc(ПЛЕМЕНА_ИМЕНА[племена[0]])}</b> <span style="color:#a8a088">${живых(цвета[0])} : ${живых(цвета[1])}</span>`, `<br>(Haiku 5.5 + ДЖЕВ, бойцов ${живых(цвета[0])})<br>
      против <b>${esc(ПЛЕМЕНА_ИМЕНА[племена[1]])}</b> (скрипт, бойцов ${живых(цвета[1])})<hr style="border-color:#4a4020">
      ${пр ? `<div style="font-size:14px;color:#ffd890">«${esc(пр.реплика)}»</div>
      <div>замысел: <b>${esc(пр.замысел)}</b></div><div style="color:#b8b098">${esc(пр.почему)}</div>
      ${отряды}<div>строить: ${esc(в.стройка)} · заказывать: ${esc(в.производство)} · новых в отряд ${в.новыхВ + 1}</div>
      <div style="color:#9ab0d0">знания: ${esc((пр.темы || []).join(' · ') || '—')} (отбор ${пр.мсОтбора || 0} мс)</div>`
        : `<div>${в.ждёмВождя ? 'вождь думает…' : 'ждём первого решения'}</div>`}
      <div style="color:#8a8470">вождь: ${в.вызовов} решений, ${в.ошибок} ошибок, последнее ${в.мсВождя} мс</div>
      <hr style="border-color:#4a4020"><div style="color:#b8b098">${в.журнал.slice(1, 8).map(ж => `${esc(ж.время)} «${esc(ж.реплика)}» — ${esc(ж.кратко)}`).join('<br>')}</div>`);
    clearTimeout(п.таймер); п.таймер = setTimeout(обновить, 700);
  };
  п.обновить = обновить;
  обновить();
}

// ---------------------------------------------------------------- слой отрядной сети
//
// Одна сеть на четверых: замысел владельца «нейронка должна на выходе отдавать команду сразу для
// четырёх юнитов, не четыре отдельных, а одна, которая всеми управляет». Она не встраивается в
// скриптовый штаб (тот спрашивает решение по одному бойцу), поэтому здесь свой ход: раз в ТАКТ
// шагов смотрим сцену её глазами и раздаём четыре действия. Ровно то же самое делает её прогон
// (tools/ai_отряд_прогон.mjs) — иначе смотреть на сцене было бы не то, что учится.
// Образец — рукописный эталон поведения (js/ai/образец.js): вся четвёрка валит ближайшую гиену,
// отходит только тот, кого бьют, и возвращается, как только с него сняли агр. Живёт в том же
// ходу, что и отрядная сеть: оба ведут бойцов сами, без скриптового штаба.
const образецСлой = { вкл: false, с: null, места: null, группа: null, последнее: null };

/**
 * ДЖЕВ КАК ШТАБ. Ключ живёт на сервере, страница ходит через свой прокси /jw/jev
 * (tools/jev_прокси.mjs, служба jw_jev в supervisor): он подписывает запрос, кэширует одинаковые
 * состояния и держит потолок запросов в минуту. Включается ссылкой ?JW_ДЖЕВ=1 или галочкой в
 * переключателе сцены — по умолчанию выключено, потому что каждый вопрос стоит денег.
 *
 * Спрашиваем ровно одно: что делать отряду прямо сейчас. Варианты даёт сам ШТАБ (Штаб.ВАРИАНТЫ),
 * поэтому ДЖЕВ не может ответить того, чего мы не умеем исполнить. Ответ кладётся в с.приказ —
 * дальше это обычная директива, и 'отдых' среди них: «нейронка штаба должна уметь это решение
 * принимать, то есть звери вокруг, их сила и всё такое» — сила округи лежит в сводке.
 */
// На странице мозг штаба по умолчанию — ДЖЕВ: скрипт держит руль только те доли секунды, пока
// ответ в пути, и в безголовых прогонах, где сети нет вовсе. Выключить его насовсем:
// ?JW_ДЖЕВ=0 (тогда штаб решает скриптом — так меряем и сравниваем).
// Журнал обращений к ДЖЕВУ: что спросили, когда и что он ответил. Владелец: «надо где-то выводить
// информацию и данные по ней, и когда сейчас чекаем».
const джевЖурнал = [];
// ВЫКЛЮЧЕН ПО УМОЛЧАНИЮ (владелец, 25.09.2026: «отключи джев, я проверил — он бесполезен»). Включить
// можно только явно: ?jev=1. Штаб решает скриптом.
const ДЖЕВ_ВКЛ = (new URLSearchParams(location.search).get('jev')
                  ?? new URLSearchParams(location.search).get('JW_ДЖЕВ') ?? '0') === '1';
let джевПоследний = null;
// Место под дом у ДЖЕВА не спрашиваем. Владелец: «надо скриптом выбирать место строительства,
// так как это алгоритмически стабильное решение» — одни и те же цифры должны давать одно и то же
// место, иначе строитель будет ходить кругами от ответа к ответу.
async function джевСпросить(сводка, варианты, угодья, заказы) {
  // Оба вопроса уходят ОДНИМ запросом: ДЖЕВ считает их параллельно, это дешевле и быстрее,
  // чем спрашивать по одному.
  const вопросы = {
    что_делать: {
      type: 'choice',
      instructions: 'Ты штаб племени в игре про первобытные племена. Отряд охотится на зверьё,'
        + ' мясо кормит племя, лечение идёт само по одной жизни в секунду, раненый отряд гибнет целиком.'
        + ' В состоянии: «ктоРядом» — зверьё вокруг, у каждого «наш_удар» (сколько мы снимаем с него),'
        + ' «его_удар» (сколько он снимает с нашего бойца) и «по_зубам» (справимся ли мы с ним по расчёту);'
        + ' «непосильныхРядом» — сколько таких, с кем не справимся.'
        + ' «чужие» — другие племена: «бойцов», «домов», «их_сила» против «наша_сила», «перевес_наш»'
        + ' (больше единицы — мы сильнее), «наш_удар» и «его_удар» по их лучшему бойцу, «далеко».'
        + ' Слабого соседа имеет смысл добить и занять его место; с сильным лучше не ссориться.'
        + ' Что делать отряду прямо сейчас?',
      criteria: варианты,
    },
  };
  if (угодья && угодья.length > 1) вопросы.какое_угодье = {
    type: 'choice',
    instructions: 'В какое угодье вести отряд? Там он и добывает мясо, и растит бойцов: удары по'
      + ' зверью поднимают им силу. Бить надо тех, кто по зубам — зверь, который снимает с нашего'
      + ' бойца больше, чем мы с него, убьёт отряд. Ближе значит меньше бега без дела.',
    criteria: Object.fromEntries(угодья.map((у, i) => [String(i),
      `${у.зверей} зверей, из них по зубам ${у.по_зубам}, не по зубам ${у.не_по_зубам}; `
      + `мяса ${у.мясо_по_зубам} из ${у.мясо}; `
      + (у.самый_злой ? `самый злой — ${у.самый_злой.кто} (${у.самый_злой.жизни} жизней, `
          + `мы бьём его на ${у.самый_злой.наш_удар}, он нас на ${у.самый_злой.его_удар})` : 'зверья нет')
      + (у.чужих_рядом ? `; там же чужих бойцов ${у.чужих_рядом} (племя ${у.чьих.join(',')})` : '; чужих нет')
      + `; идти ${у.далеко} клеток`])),
  };
  // ЗАКАЗЫ — ДВУМЯ УЗКИМИ ВОПРОСАМИ, а не одним общим. Опыт (tools/jev_стройка.mjs) показал: в
  // общей куче «дом или боец» цифры тонут и ДЖЕВ всегда берёт самое дешёвое действие, а на узкий
  // вопрос отвечает верно — «кого заказать» с боевыми цифрами даёт воина с уверенностью 90 %,
  // «какой дом на излишек» — загон вместо второй казармы. Оба вопроса уходят одним запросом.
  const домаМожно = (заказы?.дома || []).filter(д => д.вид !== 0);
  const бойцыМожно = (заказы?.бойцы || []).filter(б => !б.занят);
  // Эталон расчёта — самый частый зверь карты (его считает ПРОРАБ), иначе ближайший.
  const зверьРядом = (сводка.ктоРядом || [])[0] || null;
  const эталон = заказы?.зверь || (зверьРядом ? { кто: зверьРядом.кто, атака: зверьРядом.атака ?? 0,
    защита: зверьРядом.защита ?? 0, жизни: зверьРядом.жизни ?? 0, скорость: зверьРядом.скорость ?? 0 } : null);
  const эк = заказы?.экономика || null;
  if (домаМожно.length) вопросы.какой_дом = {
    type: 'choice',
    // Порог «нужен ли ещё дом» считает скрипт (tools: стройка.экономика) — это арифметика,
    // она должна быть устойчивой. ДЖЕВУ остаётся выбор, КАКОЙ дом, и право сказать «не нужен».
    // НЕГЛАСНЫЕ ПРАВИЛА СТРОЙКИ — словами владельца: «он просто строит кучу бараков и просирает
    // все деньги, хотя лучше бы построить для начала армию и вооружить её… он же должен знать,
    // сколько у нас армии, и понимать, что лучше — строить армию или больше зданий».
    instructions: `В казне ${сводка.еда} еды.`
      + ` У нас ${заказы?.бойцовЕсть ?? '?'} бойцов, из них без оружия ${заказы?.безоружных ?? '?'},`
      + ` без щита ${заказы?.безЩита ?? '?'}.`
      + (заказы?.сильнейшийЧужой ? ` Наша сила ${заказы.нашаСила} против ${заказы.сильнейшийЧужой}`
          + ` у сильнейшего соседа — пока мы слабее, он приходит и убивает нас.` : '')
      + ` Уже стоят: ${(домаМожно.filter(д => д.есть).map(д => `${д.имя}×${д.есть}`).join(', ')) || 'только Святилище'}.`
      + (эк ? ` Дома тратят ${эк.пропускная_в_секунду} еды в секунду и сейчас ${эк.нужен_ещё_дом
              ? 'НЕ УСПЕВАЮТ переработать запас' : 'СПРАВЛЯЮТСЯ — второй дом того же вида не нужен'}.` : '')
      + ' ПРАВИЛА: дом нужен только ради тех, кого он делает; сам по себе он ничего не даёт.'
      + ' Пока армии мало или она без оружия, еда нужнее на бойцов и на оружие, а не на стены.'
      + ' Второй дом того же вида нужен лишь тогда, когда первый не успевает тратить доход.'
      + ` Какой дом заказать в Святилище?`
      + (эк ? ` Считано: охота приносит ${эк.доход_в_секунду} еды в секунду; рабочих домов ${эк.домов_рабочих}`
              + ` (заняты ${эк.из_них_заняты}), вместе они способны тратить ${эк.пропускная_в_секунду} еды в секунду,`
              + ` то есть нынешний запас переработают за ${эк.запас_переработаем_за_секунд} с.`
              + ` Расчёт говорит: ещё один дом ${эк.нужен_ещё_дом ? 'НУЖЕН' : 'не нужен'} — ${эк.почему}.` : '')
      + ' Дом нужен ради тех, кого он делает: смотри, сколько урона его боец приносит на 1000 еды.'
      + ' Второй дом того же вида удваивает темп выпуска.',
    criteria: Object.assign({ ничего: 'дом сейчас не нужен' },
      Object.fromEntries(домаМожно.map(д => [String(д.вид), описаниеДома(д, эталон)]))),
  };
  if (бойцыМожно.length) вопросы.кого_заказать = {
    type: 'choice',
    instructions: (заказы?.бойцовЕсть !== undefined
        ? `Бойцов уже ${заказы.бойцовЕсть}, без оружия ${заказы.безоружных ?? '?'},`
          + ` без щита ${заказы.безЩита ?? '?'}. ` : '')
      + (заказы?.сильнейшийЧужой ? `Наша сила ${заказы.нашаСила} против ${заказы.сильнейшийЧужой} у соседа. ` : '')
      + ((заказы?.домаЖдут) ? 'Задание миссии ещё требует построек, и еда нужна на них — лишние бойцы тут мешают. ' : '')
      + ((заказы?.хватитНарода) ? 'Для охоты четырёх бойцов достаточно; больше нужно только под задачу — оборону или штурм. ' : '')
      + 'Кого заказать в уже построенных домах? В описаниях посчитано по движку: урон в секунду,'
      + ' сколько боец продержится, сколько урона успеет нанести за жизнь и сколько это на 1000 еды.'
      + ' Бойцы растут в бою: выживший становится сильнее, погибший не растёт вовсе.'
      + ' Вещи из оружейной кладутся на землю, их надевают только люди.',
    criteria: Object.assign({ ничего: 'бойца сейчас не заказывать' },
      Object.fromEntries(бойцыМожно.map(б => [`${б.дом}:${б.k}`,
        описаниеБойца(б, эталон, бойцыМожно.filter(x => !x.вещь).sort((a, b) => a.цена - b.цена)[0])]))),
  };
  const шагИгры = mem.u32(G.step);
  const запись = { шаг: шагИгры, сек: +(шагИгры * 0.055).toFixed(0), вопросов: Object.keys(вопросы).length,
                   темы: Object.keys(вопросы).join(', '), когда: Date.now() };
  джевЖурнал.unshift(запись); if (джевЖурнал.length > 12) джевЖурнал.pop();
  const о = await fetch('/jw/jev', { method: 'POST', headers: { 'content-type': 'application/json' },
                                     body: JSON.stringify({ state: сводка, questions: вопросы }) }).then(r => r.json());
  запись.мс = о.мс; запись.изКэша = !!о.изКэша;
  if (о.ошибка) запись.ошибка = о.ошибка;
  else {
    const a = о.ответ?.answers || {};
    запись.ответы = Object.entries(a).map(([к, в]) => `${к}: ${в.choice ?? в.noul ?? в.score}`
      + (в.confidence !== undefined ? ` (${Math.round(в.confidence * 100)}%)` : '')).join(' · ');
  }
  сценаПанельОбновить();
  if (о.ошибка) { джевПоследний = { ошибка: о.ошибка }; return null; }
  const выбор = о.ответ?.answers?.что_делать;
  const угодье = о.ответ?.answers?.какое_угодье;
  const домОтвет = о.ответ?.answers?.какой_дом?.choice;
  const боецОтвет = о.ответ?.answers?.кого_заказать?.choice;
  const дом = (домОтвет && домОтвет !== 'ничего') ? +домОтвет : null;
  let боец = null;
  if (боецОтвет && боецОтвет !== 'ничего') {
    const ч = String(боецОтвет).split(':');
    боец = { дом: +ч[0], k: +ч[1] };
  }
  джевПоследний = { выбор: выбор?.choice, уверенность: выбор?.confidence, угодье: угодье?.choice,
                    заказ: [домОтвет && домОтвет !== 'ничего' ? 'дом ' + домОтвет : null,
                            боецОтвет && боецОтвет !== 'ничего' ? 'боец ' + боецОтвет : null]
                           .filter(Boolean).join(' + ') || null,
                    изКэша: !!о.изКэша, мс: о.мс };
  return { вид: выбор?.choice || null, угодье: угодье ? +угодье.choice : null, дом, боец };
}
// ОХОТНИЧЬИ УГОДЬЯ: прямоугольник на карте, внутри которого отряд сам бьёт всё зверьё. Просьба
// владельца: «нажал кнопку, рамкой выделил ограничения — и отряд в пределах этой рамки будет сразу
// агриться на любое зверьё, что выйдет». Рамка тянется мышью прямо по карте; пока её тянут, игра
// не должна принять это за выделение юнитов, поэтому перехватываем события в фазе захвата.
const угодья = { рект: null, режим: false, тянем: null, исключены: new Set(), группа: 0, подняла: false };
/**
 * Включить/выключить задание охотничьих угодий. Одна и та же ручка на двух кнопках: в стенде и в
 * ОБЫЧНОЙ панели — владелец: «обычной панели не хватает рамки для охоты указывать».
 * Первое нажатие — режим рамки (тянешь по карте), второе при заданном участке — снять участок.
 */
// ОТРЯДЫ УГОДИЙ В ОБЫЧНОЙ ИГРЕ (владелец: «угодья должны быть для каждого отряда свои; показываться,
// только когда отряд выделен; кнопка не должна быть активна всё время — нажали, выбрали, кнопка
// отключилась, рамка пропала или тонкий пунктир»). У каждого отряда — свой участок, свои бойцы и свой
// ВОЖАК (только охота, без стройки). Боец состоит не больше чем в одном отряде угодий.
const охоты = [];                                       // { рект, члены: Set, с }
const старыеУгодья = () => образецСлой.вкл && !угодья.подняла;   // автобой и стенд: прежняя одна рамка
function переключитьУгодья() {
  if (!старыеУгодья()) {
    угодья.режим = !угодья.режим;
    say(t(угодья.режим ? 'угодья: тяни рамку по карте' : 'угодья: отмена'));
    const б = document.getElementById('huntb'); if (б) б.classList.toggle('on', угодья.режим);
    лабНарисовать(); return;
  }
  if (угодья.рект && !угодья.режим) {
    угодья.рект = null;
    if (образецСлой.с) { образецСлой.с.угодья = null; образецСлой.с.угодьяРучные = false; }
    угодья.исключены.clear(); образецСлой.группа = null; угодья.группа = 0;
    // Слой, поднятый самой рамкой, гасим вместе с ней: человек снова водит отряд руками.
    if (угодья.подняла) { образецСлой.вкл = false; образецСлой.с = null; образецСлой.последнее = null; угодья.подняла = false; }
    say(t('угодья сняты'));
  } else {
    угодья.режим = !угодья.режим;
    say(t(угодья.режим ? 'угодья: тяни рамку по карте' : 'угодья: отмена'));
  }
  const б = document.getElementById('huntb');
  if (б) б.classList.toggle('on', угодья.режим || !!угодья.рект);
  лабНарисовать();
}
{
  const б = document.getElementById('huntb');
  if (б) б.onclick = () => { переключитьУгодья(); cv.focus(); };
}
// Эти приказы охоту не отменяют: панель (прокачка, инвентарь) и сбор мяса.
const ИЗ_ГРУППЫ_НЕ_ВЫВОДЯТ = new Set([0xe1, 0x4c]);
// Кого ручная команда вывела из охоты: обратно их возвращает только новое задание угодий.
/** Все наши живые бойцы (не здания) — состав охотничьей группы по умолчанию. */
function всеСвои() {
  const из = [];
  if (!mem || !eng) return из;
  const мой = mem.u8(G.humanOwner);
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (mem.u8(UNITS + i + U.OWNER) !== мой || mem.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
    if (mem.u8(UNITS + i + U.HP) <= 0 || (mem.u8(UNITS + i + U.STATE) & 0xf0) === 0x60) continue;
    из.push(i);
  }
  return из;
}
/** Экранная точка → клетка карты. */
function клеткаПод(e) {
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
  return { x: (mem.u32(0x31ae8) + x) >> 5, y: (mem.u32(0x31aec) + y) >> 5 };
}
for (const [событие, дело] of [
  ['pointerdown', (e) => { угодья.тянем = клеткаПод(e); }],
  ['pointermove', (e) => { if (угодья.тянем) угодья.конец = клеткаПод(e); }],
  ['pointerup', (e) => {
    if (!угодья.тянем) return;
    const a = угодья.тянем, b = клеткаПод(e); угодья.тянем = null; угодья.конец = null; угодья.режим = false;
    const рект = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
    if (!старыеУгодья()) {
      // Свой отряд угодий: выделенные (никого — все свои, кто ещё не в другом отряде угодий).
      const выд = выделенные();
      const члены = выд.length ? выд : всеСвои().filter(i => !охоты.some(о => о.члены.has(i)));
      if (!члены.length) { say(t('угодья: некому охотиться')); const б0 = document.getElementById('huntb'); if (б0) б0.classList.remove('on'); return; }
      for (const о of охоты) for (const i of члены) о.члены.delete(i);
      for (let k = охоты.length - 1; k >= 0; k--) if (!охоты[k].члены.size) охоты.splice(k, 1);
      const с = Образец.новое(); с.угодья = рект; с.угодьяРучные = true; с.безСтройки = true;
      с.отнестиОт = 5000;                                // мясо несёт боец, у кого набралось 5000 (или он полон)
      if (!охоты.length) ИИ.убрать(eng, mem.u8(G.humanOwner));     // встроенный штаб не перебивает приказы
      охоты.push({ рект, члены: new Set(члены), с });
      say(t('угодья: {w}×{h} клеток, отряд {n}', { w: рект.x1 - рект.x0 + 1, h: рект.y1 - рект.y0 + 1, n: члены.length }));
      const б = document.getElementById('huntb'); if (б) б.classList.remove('on');
      лабНарисовать(); return;
    }
    угодья.рект = рект;
    // РАМКА САМА ВКЛЮЧАЕТ ОТРЯДНЫЙ СЛОЙ. Владелец: «угодья не работают, если я просто играю и
    // угодья ставлю — ничего не происходит». И правда: рамка ложилась в состояние слоя, а сам слой
    // в обычной игре выключен, вести отряд было некому. Теперь обозначенный участок поднимает
    // ВОЖАКА для этой группы (и только для неё), а снятая рамка его гасит, если он был поднят
    // именно рамкой. Автобой и стенд этим не затрагиваются.
    if (!образецСлой.вкл) {
      образецСлой.вкл = true; угодья.подняла = true;
      образецСлой.с = Образец.новое();
      if (ДЖЕВ_ВКЛ) образецСлой.с.джев = джевСпросить;
      ИИ.убрать(eng, mem.u8(G.humanOwner));            // старый штаб не должен перебивать приказы
    }
    if (образецСлой.с) { образецСлой.с.угодья = угодья.рект; образецСлой.с.угодьяРучные = true; }
    // Угодья задаются ВЫДЕЛЕННОЙ ГРУППЕ, если она есть: «допустим, я группу из пяти юнитов
    // выделил, для них обозначил радиус охоты». Если никто не выделен — работает весь отряд.
    // Новое задание угодий собирает группу заново и прощает всех выведенных ранее.
    угодья.исключены.clear();
    const группа = выделенные();
    образецСлой.группа = группа.length ? группа.slice() : null;
    угодья.группа = группа.length;
    say(t('угодья: {w}×{h} клеток, отряд {n}', { w: угодья.рект.x1 - угодья.рект.x0 + 1,
          h: угодья.рект.y1 - угодья.рект.y0 + 1, n: угодья.группа || t('весь') }));
    const б = document.getElementById('huntb'); if (б) б.classList.add('on');
    лабНарисовать();
  }],
]) cv.addEventListener(событие, (e) => {
  if (!угодья.режим) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  дело(e);
}, true);
const ОТРЯД_ТАКТ = 4;
const отрядСлой = { сеть: null, места: null, наб: null, шаг: -1, решений: 0, действия: null };

/** Поставить (или снять) отрядную сеть. Места закрепляются на партию: голова k ведёт место k. */
function отрядПоставить(сеть) {
  отрядСлой.сеть = сеть; отрядСлой.решений = 0; отрядСлой.действия = null;
  отрядСлой.наб = сеть ? Отряд.пустое() : null;
  отрядСлой.места = null;
}

/** Ход образца: каждый шаг движка, как и в его замере (tools/образец_прогон.mjs). */
function образецХод(e) {
  if (!образецСлой.вкл || !e || e !== eng) return;
  const m = e.m;
  // Состав охоты: либо заданная рамкой группа, либо все наши. Выведенные ручной командой
  // исключаются ВСЕГДА — иначе слой пересобирал состав и молча возвращал их обратно в охоту.
  let места = (образецСлой.группа && образецСлой.группа.length) ? образецСлой.группа : всеСвои();
  места = места.filter(i => Образец.жив(m, i) && !угодья.исключены.has(i));
  // Бойцов отрядов угодий ведёт их собственный ВОЖАК — автобой их не трогает, иначе одному бойцу
  // приказывали бы двое.
  if (охоты.length) места = места.filter(i => !охоты.some(о => о.члены.has(i)));
  образецСлой.места = места;
  // ПУСТОЙ СОСТАВ — НЕ ПОВОД МОЛЧАТЬ. На вторых миссиях партия начинается с одного строителя:
  // отряда нет, и шаг сюда не доходил — значит ни заказов в Святилище, ни решений штаба. А решать
  // надо именно тогда (владелец: «Муспелов открыл, здание сразу построено, однако в нём не было
  // заказано ничего»). Сам образец пустой состав переносит: стройка и штаб у него идут до боя.
  образецСлой.последнее = Образец.шаг(e, места, образецСлой.с);
}
наШаг.push(образецХод);
/** Ход отрядов угодий обычной игры: у каждого свой ВОЖАК. */
function охотыХод(e) {
  if (!e || e !== eng || !охоты.length) return;
  const m = e.m;
  for (let k = охоты.length - 1; k >= 0; k--) {
    const о = охоты[k];
    for (const i of [...о.члены]) if (!Образец.жив(m, i)) о.члены.delete(i);
    if (!о.члены.size) { охоты.splice(k, 1); continue; }
    о.последнее = Образец.шаг(e, [...о.члены], о.с);
  }
}
наШаг.push(охотыХод);

// КАМЕРА ЗА ОТРЯДОМ. На учебной сцене смотреть надо за четвёркой, а она убегает через полкарты —
// иначе бой уезжает за край экрана и приходится возить карту руками. Центрируем вид на середине
// живых своих, но не каждый шаг, а когда они заметно сместились: камеру движку можно отдавать
// только клетками по 32, и дёргать её каждый тик незачем.
let следимЗаОтрядом = false;
let камераШаг = -1;
let камераЮнит = 0;                 // за кем именно ведём камеру
let нашаКамера = null;             // что мы сами в последний раз поставили: чужое значение = человек подвинул
/**
 * Выключить слежение. Владелец: «как только я подвигал сам камеру кнопками — либо кнопку поставь,
 * чтобы не следить камерой автоматом за отрядом». Сделано и так, и так: любое движение камеры
 * руками (колесо, стик, клавиши, мини-карта) снимает слежение, а вернуть его можно галочкой
 * «камера» в переключателе сцены.
 */
function слежениеВыкл(почему) {
  if (!следимЗаОтрядом) return;
  следимЗаОтрядом = false; нашаКамера = null;
  // Панель обновляем, только если она уже на экране: в обычной игре её быть не должно.
  if (document.getElementById('scenepick')) {
    try { панельВыбораСцены(сценаПлемя ?? 0, сценаМиссия ?? 0); } catch {}
  }
  say(t('камера: слежение за отрядом выключено ({p})', { p: почему }));
}
function камераЗаОтрядом(e) {
  if (!следимЗаОтрядом || !e || e !== eng || shell.screen !== 'game') return;
  // Камеру мог подвинуть человек — клавишами (их отрабатывает сам движок), мини-картой или
  // тачпадом. Узнаём это по тому, что текущее значение не то, которое поставили мы.
  if (нашаКамера && (e.m.u32(0x31ae8) !== нашаКамера.x || e.m.u32(0x31aec) !== нашаКамера.y))
    return слежениеВыкл(t('подвинули вручную'));
  const m = e.m, шаг = m.u32(G.step);
  if (шаг === камераШаг || (шаг % 6)) return;
  камераШаг = шаг;
  const мой = m.u8(G.humanOwner);
  // Камера — за ОДНИМ бойцом, а не за серединой (владелец: «когда группа делится, камера уходит в
  // середину между тем, кто на базе, и тем, кто бегает»). Строитель и охранник — не в счёт: стал
  // бойца охранником или он погиб — переключаемся на другого.
  const годен = (i) => i && !(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.OWNER) === мой
    && m.u8(UNITS + i + U.TYPE) < 0x1a && m.u8(UNITS + i + U.TYPE) !== 4 && m.u8(UNITS + i + U.HP) > 0
    && (m.u8(UNITS + i + U.STATE) & 0xf0) !== 0x60 && i !== образецСлой.с?.главный;
  if (!годен(камераЮнит)) {
    камераЮнит = 0;
    for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) if (годен(i)) { камераЮнит = i; break; }
  }
  let сx = 0, сy = 0, n = 0;
  if (камераЮнит) { сx = m.u16(UNITS + камераЮнит + U.X); сy = m.u16(UNITS + камераЮнит + U.Y); n = 1; }
  else for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {   // остались строитель/охранник — за ними
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (m.u8(UNITS + i + U.OWNER) !== мой || m.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
    if (m.u8(UNITS + i + U.HP) <= 0 || (m.u8(UNITS + i + U.STATE) & 0xf0) === 0x60) continue;
    сx += m.u16(UNITS + i + U.X); сy += m.u16(UNITS + i + U.Y); n++;
  }
  if (!n) return;
  const окнШ = m.u32(0x488c4), окнВ = m.u32(0x488c8);
  const макX = Math.max(0, (m.u32(0x31af8) << 5) - окнШ), макY = Math.max(0, (m.u32(0x31afc) << 5) - окнВ);
  const x = Math.max(0, Math.min(макX, Math.round(сx / n) - (окнШ >> 1)));
  const y = Math.max(0, Math.min(макY, Math.round(сy / n) - (окнВ >> 1)));
  m.w32(0x31ae8, x & ~31); m.w32(0x31aec, y & ~31);
  нашаКамера = { x: x & ~31, y: y & ~31 };
}
наШаг.push(камераЗаОтрядом);

/** Ход отрядной сети: зовётся на каждом шаге движка, работает раз в ОТРЯД_ТАКТ шагов. */
function отрядХод(e) {
  if (!отрядСлой.сеть || !e || e !== eng) return;
  const m = e.m, шаг = m.u32(G.step);
  if (шаг === отрядСлой.шаг || (шаг % ОТРЯД_ТАКТ)) return;
  отрядСлой.шаг = шаг;
  const мой = m.u8(G.humanOwner);
  const жив2 = (i) => i && !(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.HP) > 0
                      && (m.u8(UNITS + i + U.STATE) & 0xf0) !== 0x60;
  if (!отрядСлой.места || !отрядСлой.места.some(жив2)) {
    const свои = [];
    for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
      if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
      if (m.u8(UNITS + i + U.OWNER) === мой && m.u8(UNITS + i + U.TYPE) < 0x1a && жив2(i)) свои.push(i);
    }
    отрядСлой.места = свои.slice(0, Отряд.МЕСТ).sort((a, b) => a - b);
    while (отрядСлой.места.length < Отряд.МЕСТ) отрядСлой.места.push(0);
    if (!отрядСлой.места.some(жив2)) return;
  }
  Образец.прокачкаВАтаку(m, отрядСлой.места);   // только атака, как у образца и в её прогоне
  const доля = сценаКуска && счёт ? Math.min(1, (шаг - счёт.шаг0) * 55 / 1000 / КУСОК_СЦЕНЫ.секунд) : 0;
  Отряд.наблюдать(e, отрядСлой.места, доля, отрядСлой.наб);
  const р = отрядСлой.сеть(отрядСлой.наб);
  отрядСлой.действия = Array.from(р.действия);
  отрядСлой.решений += Отряд.МЕСТ;
  for (let s = 0; s < Отряд.МЕСТ; s++) {
    const i = отрядСлой.места[s]; if (!жив2(i)) continue;
    выполнитьДействие(e, i, р.действия[s], { роль: 'ATTACK_TO_DEATH', вес: 2, точка: null, цель: 0, кайт: 'всегда' });
  }
}
наШаг.push(отрядХод);

// ---------------------------------------------------------------- стенд мозгов
//
// Второй интерфейс, заказанный владельцем: «убрать все боковые кнопки, оставить выбор нейронки в
// один клик, паузу и рестарт». Порядок работы у него такой: щёлкнул мозги — рестарт — посмотрел —
// щёлкнул другие — рестарт. За несколько минут так проходятся все наши слои на одной и той же
// миссии, и видно, от чего отталкиваться. Поэтому никаких выпадающих списков: всё кнопками, и
// рядом же выбор миссии, племени и сложности — они меняются вместе с перезапуском.
//
// Отдельной страницы не делаю нарочно: движок, загрузка паков, кампания, запись партии и пауза
// здесь уже работают, а второй экземпляр всего этого пришлось бы чинить дважды. Панель просто
// подменяет нижний ряд кнопок и живёт в той же вкладке.
// Зоопарк слоёв убран из панели по прямому распоряжению владельца: «удали все варианты, они все
// гавно, спрячь в долгий ящик». НИЧЕГО не удалено — все обученные сети лежат там же
// (out/ai/weights), все слои в коде живы и доступны стендам в tools/. В панели остаётся одно:
// «ИИ» — лучшая на сегодня связка (стратег по правилу плюс обученная сеть бойца; замер первого
// стейджа кампании: 17 пройденных прогонов из 24 против 14 у голого скрипта), и «родной» —
// встроенный ИИ 1993 года как точка отсчёта.
// Вернуть весь список и ряд моделей: добавить к адресу ?все=1 (или jw.lab.всё=1 в хранилище).
const ЛАБ_ВСЁ = new URLSearchParams(location.search).get('все') === '1' || localStorage.getItem('jw.lab.всё') === '1';
const ЛАБ_МОЗГИ_ВСЕ = [
  { имя: 'скрипт',       слой: null,       место: () => null,                                          опции: () => ({}) },
  { имя: 'стратег',      слой: null,       место: () => null,                                          опции: () => ({ стратегПравило: true }) },
  { имя: 'боец',         слой: 'боец',     место: () => ({ мозги: 'боец', весаБойца: лаб.веса.боец }),  опции: (м) => ({ ...Сети.дляМеста(м) }) },
  { имя: 'обе',          слой: 'боец',     место: () => ({ мозги: 'обе', весаБойца: лаб.веса.боец, весаТактика: лаб.веса.тактик }), опции: (м) => ({ ...Сети.дляМеста(м) }) },
  { имя: 'стратег+боец', слой: 'боец',     место: () => ({ мозги: 'боец', весаБойца: лаб.веса.боец }),  опции: (м) => ({ стратегПравило: true, ...Сети.дляМеста(м) }) },
  { имя: 'комдив',       слой: 'комдив',   место: () => ({ мозги: 'комдив', весаКомдива: лаб.веса.комдив }), опции: (м) => ({ ...Сети.дляМеста(м) }) },
  { имя: 'отряд',        слой: 'отряд',    место: () => ({ мозги: 'отряд', весаОтряда: лаб.веса.отряд }), опции: (м) => ({ ...Сети.дляМеста(м) }) },
  { имя: 'образец',      слой: null,       место: () => null,                                          опции: () => ({ образец: true }), подпись: () => `образец v${Образец.ВЕРСИЯ}` },
  { имя: 'родной',       слой: null,       место: () => null,                                          опции: null },   // встроенный ИИ оригинала 1993 года
];
// Что показывать в панели: одна рабочая связка и оригинал. Имя «ИИ» — чтобы не выбирать между
// вариантами, которых всё равно не отличить на глаз.
const ЛАБ_МОЗГИ = ЛАБ_ВСЁ ? ЛАБ_МОЗГИ_ВСЕ : [
  { ...ЛАБ_МОЗГИ_ВСЕ.find(x => x.имя === 'стратег+боец'), имя: 'ИИ' },   // веса берёт из лаб.веса.боец
  ЛАБ_МОЗГИ_ВСЕ.find(x => x.имя === 'отряд'),                            // одна сеть на четверых
  ЛАБ_МОЗГИ_ВСЕ.find(x => x.имя === 'образец'),                          // рукописный эталон
  ЛАБ_МОЗГИ_ВСЕ.find(x => x.имя === 'родной'),
];
const лаб = { вкл: false, мозги: localStorage.getItem('jw.lab.мозги') || (ЛАБ_ВСЁ ? 'стратег+боец' : 'ИИ'), построен: false,
  // Какие веса взяты для каждого слоя. null — «лучшие на сегодня» (js/ai/нейросети.js, ЛУЧШИЕ).
  веса: { боец: localStorage.getItem('jw.lab.весаБойца') || null, тактик: null, комдив: localStorage.getItem('jw.lab.весаКомдива') || null, отряд: localStorage.getItem('jw.lab.весаОтряда') || null },
  список: null };
const лабЭл = document.getElementById('lab');

// Поколение вызовов: у постановки мозгов внутри есть ожидание (скачивание весов), и медленный
// вызов, начатый раньше, доезжал до конца ПОСЛЕ более свежего — и переставлял мозги обратно.
// Ловится это только на медленной сети: владелец открывал сцену с планшета и видел «стратег +
// сеть бойца» при подсвеченной кнопке «образец» («снова разбежались»), а у меня веса лежали в
// кэше, ожидание было нулевым и гонки не возникало. Теперь устаревший вызов молча выходит.
let лабПоколение = 0;

/** Поставить выбранные мозги на место человека. Сети при нужде дожидаемся и доставляем. */
async function лабМозгиПоставить(говорить = true) {
  if (!eng) return;
  const моё = ++лабПоколение;
  const мой = mem.u8(G.humanOwner);
  const м = ЛАБ_МОЗГИ.find(x => x.имя === лаб.мозги) || ЛАБ_МОЗГИ[0];
  лаб.мозги = м.имя;                                           // выбор мог остаться от старого списка
  ИИ.убрать(eng, мой);
  отрядПоставить(null);
  образецСлой.вкл = false; образецСлой.с = null; образецСлой.места = null;
  mem.w8(0x32aec + мой, 0);
  if (!м.опции) { включитьИИ(mem, мой); if (говорить) say(t('стенд: играет встроенный ИИ оригинала')); лабНарисовать(); return; }
  // Гасим берсерка, если он остался от игрока: режим камикадзе живёт своей жизнью и продолжает
  // гонять юнитов поверх любых мозгов — на стенде это выглядело как «переключение не работает,
  // всегда одно и то же». Сам компьютер этим режимом больше не пользуется (убрано по просьбе
  // владельца: правильно распорядиться им скрипт не смог).
  Камикадзе.restore(eng, []);
  const место = м.место();
  if (место) { const беда = await Сети.подготовить([место]);
    if (моё !== лабПоколение) return;                          // пока качали веса, выбор сменился
    const нет = беда.length ? беда : Сети.чегоНеХватает([место]);
    // Молча подменять сеть скриптом нельзя: на стенде это значит смотреть не на то, что выбрано.
    if (нет.length) { const т = t('сеть не подключилась: {e}', { e: нет.join(', ') }); say(т); toast(т); return; } }
  if (моё !== лабПоколение) return;
  const опц = м.опции(место);
  // Отрядная сеть ведёт бойцов сама, скриптовый штаб ей не нужен и будет мешать — перебивать
  // приказы своим ходом. Поэтому либо она, либо штаб.
  отрядПоставить(опц.отряд || null);
  образецСлой.вкл = !!опц.образец;
  образецСлой.с = опц.образец ? Образец.новое() : null;
  if (образецСлой.с && ДЖЕВ_ВКЛ) образецСлой.с.джев = джевСпросить;
  if (образецСлой.с) образецСлой.с.угодья = угодья.рект;
  образецСлой.места = null; образецСлой.группа = null; образецСлой.последнее = null; угодья.исключены.clear();
  if (!опц.отряд && !опц.образец) ИИ.задать(eng, мой, { уровень: 3, характер: 'ровный', ...опц });
  if (говорить) say(t('стенд: мозги — {m}', { m: лаб.мозги }));
  лабНарисовать();
}

/**
 * Перезапустить текущую миссию теми же настройками и сразу посадить выбранные мозги.
 *
 * Запись предыдущей партии СОХРАНЯЕМ. Кнопка «заново» звала startMission напрямую, минуя обычный
 * выход из партии, и запись просто пропадала — а в стенде именно она и нужна: посмотрел, как
 * прошло, и отложил интересное. Обычный рестарт в скирмише это делает (saveReplay('restart')),
 * теперь делает и стенд.
 */
async function лабРестарт() {
  if (сценаКуска) return запуститьКусок();                   // в сцене «заново» перезапускает её же
  if (сценаПлемя !== null) return запуститьПлемя(сценаПлемя, сценаМиссия); // сцена за племя — так же
  if (mission === null || mission === undefined) return;
  await saveReplay('restart');
  startMission(mission, tribe, shell.difficulty ?? 1);
  лабМозгиПоставить(false);
  say(t('стенд: заново — миссия {m}, {t}, {d}, мозги {b}',
        { m: mission + 1, t: ПЛЕМЕНА_ИМЕНА[tribe] || tribe, d: t(имяСложности(shell.difficulty ?? 1)), b: лаб.мозги }));
}

/** Построить панель стенда: мозги, миссия, племя, сложность, пауза и рестарт. */
function лабПостроить() {
  лабЭл.innerHTML = '';
  const ряд = (имя) => { const д = document.createElement('div'); д.className = 'ряд';
    const п = document.createElement('span'); п.className = 'имя'; п.textContent = имя; д.appendChild(п); лабЭл.appendChild(д); return д; };
  const кн = (куда, текст, дело, класс = '') => { const b = document.createElement('button');
    b.textContent = текст; if (класс) b.className = класс; b.onclick = () => { дело(); cv.focus(); }; куда.appendChild(b); return b; };

  const рМозги = ряд(t('мозги'));
  // На кнопке образца пишем номер версии: так видно, что страница взяла свежий скрипт.
  for (const м of ЛАБ_МОЗГИ) кн(рМозги, м.подпись ? м.подпись() : м.имя, () => { лаб.мозги = м.имя; localStorage.setItem('jw.lab.мозги', м.имя); лабМозгиПоставить(); }).dataset.мозги = м.имя;

  // Ряд моделей: какие именно веса взять для выбранного слоя. Перебирать модели — это и есть
  // работа на стенде, поэтому они тоже кнопками. Несовместимые по размеру сети показываем
  // погашенными и с подписью: старые веса под прежний вход/выход просто не грузятся, и молча
  // прятать их нельзя — иначе непонятно, куда делись двадцать обученных сетей.
  // Ряд моделей — часть того же зоопарка, поэтому по умолчанию его нет.
  if (ЛАБ_ВСЁ) { лабРядМоделей = ряд(t('модель')); лабМоделиНарисовать(); }
  // А вот идущее обучение показываем всегда: владелец смотрит именно на него («там ведь каждая
  // итерация где-то сохраняется на диске, можно сразу делать доступной»). Веса берутся прямо из
  // рабочей папки обучения и перекачиваются при каждом нажатии — то есть это всегда та итерация,
  // которая посчитана к этой минуте.
  лабРядУчёбы = ряд(t('учится'));
  лабУчёбаНарисовать();

  // Смена миссии, племени и сложности — это тоже конец партии, поэтому запись сохраняем.
  const начать = async (мис, пл, сл) => { await saveReplay('restart'); startMission(мис, пл, сл); лабМозгиПоставить(false); лабНарисовать(); };
  const рМиссия = ряд(t('миссия'));
  for (let i = 0; i < 12; i++) кн(рМиссия, String(i + 1), () => начать(i, tribe, shell.difficulty ?? 1), 'мелк').dataset.миссия = i;

  const рПлемя = ряд(t('племя'));
  for (let i = 0; i < 8; i++) кн(рПлемя, ПЛЕМЕНА_ИМЕНА[i], () => начать(mission, i, shell.difficulty ?? 1), 'мелк').dataset.племя = i;

  const рПрочее = ряд(t('партия'));
  for (let d = 0; d < 3; d++) кн(рПрочее, t(СЛОЖНОСТИ[d]), () => { shell.difficulty = d; начать(mission, tribe, d); }, 'мелк').dataset.сложность = d;
  кн(рПрочее, '⏸ / ▶', () => { setPaused(!shell.paused); лабНарисовать(); }).id = 'labpause';
  кн(рПрочее, '⟲ ' + t('заново'), () => лабРестарт()).id = 'labrestart';
  кн(рПрочее, '×3', () => { fast3Btn.click(); лабНарисовать(); }).id = 'labfast';
  // Запись прямо посреди партии: сохранить то, что уже отыграно, и продолжить дальше. Это тот же
  // механизм, что и в конце партии, только запись после сохранения начинается заново — со снимка
  // текущего положения, поэтому продолжение тоже записывается.
  кн(рПрочее, '⏺ ' + t('запись'), async () => { await saveReplay('ручная'); beginRecording('mission'); }).id = 'labrec';
  кн(рПрочее, t('записи'), () => { толькоСцены = false; return repsPanel.hidden ? openReps() : closeReps(); }).id = 'labreps';
  // Отдельная кнопка самой сцены: она же запускает её и с нуля, если сейчас идёт обычная партия.
  кн(рПрочее, '▶ ' + t('сцена'), () => запуститьКусок()).id = 'labscene';
  // Кнопка охотничьих угодий: нажал — тянешь рамку по карте; нажал ещё раз — снял участок.
  кн(рПрочее, '⬚ ' + t('угодья'), () => переключитьУгодья()).id = 'labугодья';
  кн(рПрочее, t('обычная панель'), () => лабВключить(false)).id = 'labexit';
  // Строка «что сейчас на самом деле работает». Без неё стенд врёт молчанием: владелец
  // переключает скрипт на стратега и не видит разницы — а разницы на охотничьей миссии и правда
  // почти нет (стратег отдаёт охоту тому же коду), и понять это можно только по числам: кто
  // принял решения — сеть или учитель, какая осанка, какая фаза, сколько кого в отрядах.
  const п = document.createElement('div'); п.className = 'ряд';
  const и = document.createElement('span'); и.className = 'имя'; и.textContent = t('сейчас');
  лабСтрока = document.createElement('span'); лабСтрока.style.color = 'var(--dim)'; лабСтрока.style.fontSize = '12px';
  лабСтрока.style.whiteSpace = 'pre-line';   // вторая строка — счёт сцены, см. лабСостояние
  п.appendChild(и); п.appendChild(лабСтрока); лабЭл.appendChild(п);
  лаб.построен = true;
}

/**
 * Взять веса последнего идущего обучения, если человек ничего не выбирал руками.
 *
 * «Ничего не выбирал» — это когда в хранилище нет jw.lab.весаБойца: любое нажатие кнопки в ряду
 * «учится» или в ряду моделей туда пишет, и тогда мы уважаем выбор и не подменяем его. Берём
 * самый поздно начатый прогон подходящего слоя (у сети отряда свой вход и свой выход, её сюда
 * ставить нельзя).
 *
 * Какой файл. Владелец: «при каждом обновлении страницы подгружается ПОСЛЕДНЯЯ УДАЧНАЯ версия
 * весов, и на них прогоняется». Удачная — это лучшие.json: обучение кладёт туда ту итерацию, у
 * которой лучший итог на прогоне, и она не портится, когда очередной шаг PPO уводит сеть вбок.
 * Текущая итерация (текущие.json) остаётся отдельной кнопкой в ряду «учится» — посмотреть, чем
 * сеть занята прямо сейчас. Пока ни одна итерация не посчитана, лучших ещё нет — тогда текущие.
 */
async function свежиеВесаПоУмолчанию() {
  if (localStorage.getItem('jw.lab.весаБойца')) return null;
  let прогоны = лаб.живые;
  if (!прогоны) { try { прогоны = лаб.живые = await Сети.живые(); } catch { return null; } }
  if (!(прогоны || []).length) return null;
  const п = прогоны.reduce((a, b) => (String(b.начат) > String(a.начат) ? b : a));
  const файл = (await Сети.есть(п.лучшие)) ? п.лучшие : п.файл;
  // Веса ставим всегда, а МОЗГИ переключаем только если человек их сам не выбирал. Иначе выбор
  // «образец» слетал на каждом перезапуске сцены: она звала эту подстановку, и та возвращала
  // отрядную сеть — со стороны это выглядело как «кнопка не работает».
  const выбралСам = !!localStorage.getItem('jw.lab.мозги');
  if ((п.вид || 'боец') === 'отряд') { лаб.веса.отряд = файл; if (!выбралСам) лаб.мозги = 'отряд'; }
  else лаб.веса.боец = файл;
  лабУчёбаНарисовать();
  return п;
}

let лабРядМоделей = null, лабСтрока = null, лабРядУчёбы = null;
/** Кнопки идущих прогонов обучения: «взять веса этой минуты» и «взять лучшие за прогон». */
function лабУчёбаНарисовать() {
  if (!лабРядУчёбы) return;
  while (лабРядУчёбы.children.length > 1) лабРядУчёбы.lastChild.remove();
  const прогоны = лаб.живые || [];
  if (!прогоны.length) { const п = document.createElement('span'); п.className = 'имя'; п.style.minWidth = 'auto';
    п.textContent = t('сейчас ничего не учится'); лабРядУчёбы.appendChild(п); return; }
  for (const п of прогоны) for (const [подпись, файл] of [[п.имя, п.файл], [п.имя + ' ' + t('лучшие'), п.лучшие]]) {
    const b = document.createElement('button'); b.className = 'мелк'; b.textContent = подпись;
    b.title = t('веса из идущего обучения; каждое нажатие подтягивает свежую итерацию');
    // Прогон может учить сеть бойца, а может — сеть ОТРЯДА (одна на четверых). Это разные слои
    // с разным входом и выходом, поэтому и кнопка ставит разное: не различать их значило бы
    // подсунуть отрядные веса загрузчику бойца и молча свалиться на скрипт.
    const отрядный = (п.вид || 'боец') === 'отряд';
    b.onclick = () => {
      if (отрядный) { лаб.веса.отряд = файл; лаб.мозги = 'отряд'; localStorage.setItem('jw.lab.весаОтряда', файл); }
      else { лаб.веса.боец = файл; лаб.мозги = 'ИИ'; localStorage.setItem('jw.lab.весаБойца', файл); }
      лабМозгиПоставить(); cv.focus();
    };
    b.classList.toggle('on', (отрядный ? лаб.веса.отряд : лаб.веса.боец) === файл);
    лабРядУчёбы.appendChild(b);
  }
}

/** Что сейчас ведёт партию: слои, осанка, состав. Обновляется раз в секунду, пока стенд открыт. */
function лабСостояние() {
  if (!лабСтрока || !лаб.вкл) return;
  const мой = eng ? mem.u8(G.humanOwner) : 0;
  const с = eng ? ИИ.состояние(eng, мой) : null;
  // Сцена «трое»: кто чем думает. Строка видна и после перезагрузки страницы — состав каждый раз
  // разыгрывается заново, и по ней сразу понятно, за кем смотреть.
  if (бой.вкл) {
    const сек = Math.floor(mem.u32(G.step) * 55 / 1000);
    const живо = (ц) => { let б = 0, д = 0;
      for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
        if (mem.u8(UNITS + i + U.FLAGS5B) & 1 || mem.u8(UNITS + i + U.OWNER) !== ц) continue;
        if (mem.u8(UNITS + i + U.TYPE) >= 0x1a) д++; else if (mem.u8(UNITS + i + U.HP) > 0) б++;
      }
      return `${б}/${д}`; };
    лабСтрока.textContent = `${Math.floor(сек / 60)}:${String(сек % 60).padStart(2, '0')} · ${t('карта')} Ashfall\n`
      + бой.состав.map(м => `${ПЛЕМЕНА_ИМЕНА[м.племя] || м.племя} (${t('цвет')} ${м.цвет}) — ${м.подпись} · ${t('бойцов/домов')} ${живо(м.цвет)} · ${t('еда')} ${mem.u32(G.food + м.цвет * 4)}`).join('\n');
    return;
  }
  if (образецСлой.вкл) {
    const сек = Math.floor(mem.u32(G.step) * 55 / 1000);
    const п = образецСлой.последнее;
    // Режим видно отдельно: владелец смотрит на сцену и должен понимать, ДЕРЁТСЯ отряд, УХОДИТ
    // или СПИТ, — иначе «не сработало» и «сработало» на глаз неразличимы.
    const режимы = { бой: '⚔ бой', отрыв: '🏃 отрыв', сон: '💤 сон' };
    лабСтрока.textContent = `${Math.floor(сек / 60)}:${String(сек % 60).padStart(2, '0')} · ${t('образец')} ${п ? (режимы[п.режим] || п.режим) : ''}`
      + (п ? ` · ${t('на нас зверей')} ${п.агров ?? '—'} · ${t('до ближайшего')} ${п.доБлижайшего === undefined ? '—' : Math.round(п.доБлижайшего)}` : '')
      + (п && п.режим === 'бой' ? ` · ${t('жертва')} ${п.цель ? '#' + п.цель : '—'} · ${t('бьют')} ${п.бьют} · ${t('отошли')} ${п.отходят}` : '')
      + (п && п.режим === 'отрыв' ? ` · ${t('бежим в')} ${п.отрыв ? п.отрыв.x + ',' + п.отрыв.y : '—'}`
          + ` · ${t('гонятся')} ${п.гонятся ?? '—'} · ${t('справимся')} ${п.справимся ? 'да' : 'нет'}`
          + (п.устали ? ` · ${t('устали')}` : '') + ` · ${t('тихо')} ${п.тихо}/18` : '')
      + (п && п.режим === 'сон' ? ` · ${t('жизни')} ${п.жизни}` : '')
      // Стройка — вторая половина работы на «домашних» миссиях: что уже стоит, чего не хватает,
      // что заказано в Святилище и не ломает ли кто дом прямо сейчас.
      // Директива штаба: куда он погнал отряд и почему. Видно, когда включён слой JW_ОБР_ШТАБ=1.
      + (джевПоследний ? `\n${t('джев')}: ${джевПоследний.ошибка ? '⚠ ' + джевПоследний.ошибка
            : `${джевПоследний.выбор} (${Math.round((джевПоследний.уверенность || 0) * 100)}%`
              + `${джевПоследний.изКэша ? ', кэш' : ', ' + джевПоследний.мс + ' мс'})`
              + (джевПоследний.угодье !== undefined && джевПоследний.угодье !== null ? ` · ${t('угодье')} №${джевПоследний.угодье}` : '')
}` : '')
      + (образецСлой.с?.директива ? `\n${t('штаб')}: ${образецСлой.с.директива.вид}`
          + (образецСлой.с.директива.точка ? ` → ${образецСлой.с.директива.точка.x},${образецСлой.с.директива.точка.y}` : '')
          + ` · ${образецСлой.с.директива.почему}` : '')
      + (п?.стройка ? `\n${t('стройка')}: ${t('домов')} ${п.стройка.домов} · ${t('надо')} ${(п.стройка.надо || []).join(',') || '—'}`
          + ` · ${t('конструкторов')} ${п.стройка.конструкторов}`
          + (п.стройка.заказ !== null && п.стройка.заказ !== undefined ? ` · ${t('заказан вид')} ${п.стройка.заказ}` : '')
          + (п.стройка.тревога ? ` · ⚠ ${t('ломают дом')}` : '') : '');
    const сч1 = сценаКуска ? счётСейчас() : null;
    if (сч1) лабСтрока.textContent += `\n${t('сцена')}: ${сч1.сек.toFixed(1)}/${КУСОК_СЦЕНЫ.секунд} с · ${t('убито')} ${сч1.убито}/${сч1.всего}`
      + ` · ${t('урона')} ${сч1.урон} · ${t('потеряно')} ${сч1.потеряно}/${сч1.наших}`
      + (сч1.первый !== null ? ` · ${t('первый')} ${сч1.первый.toFixed(1)} с` : '');
    return;
  }
  if (отрядСлой.сеть) {
    const сек = Math.floor(mem.u32(G.step) * 55 / 1000);
    const имена = отрядСлой.действия ? отрядСлой.действия.map(a => ДЕЙСТВИЯ_ИМЕНА[a] || a).join(', ') : '—';
    лабСтрока.textContent = `${Math.floor(сек / 60)}:${String(сек % 60).padStart(2, '0')} · ${t('сеть отряда')}`
      + ` (${(лаб.веса.отряд || '').replace(/\.json$/, '').replace(/^\.\.\/data\//, '') || t('веса не выбраны')})`
      + ` · ${t('решений')} ${отрядСлой.решений} · ${имена}`;
    const сч0 = сценаКуска ? счётСейчас() : null;
    if (сч0) лабСтрока.textContent += `\n${t('сцена')}: ${сч0.сек.toFixed(1)}/${КУСОК_СЦЕНЫ.секунд} с · ${t('убито')} ${сч0.убито}/${сч0.всего}`
      + ` · ${t('урона')} ${сч0.урон} · ${t('потеряно')} ${сч0.потеряно}/${сч0.наших}`;
    return;
  }
  if (!с) { лабСтрока.textContent = mem && eng && mem.u8(0x32aec + мой) ? t('встроенный ИИ оригинала') : t('никто: играете сами'); return; }
  const сеть = с.счётСеть || 0, учитель = с.счётУчитель || 0;
  const слои = [с.стратегПравило ? 'стратег' : 'штаб', с.комдив ? 'комдив' : null,
                с.бойСеть ? `сеть бойца (${(с.весаБойцаИмя || t('лучшая')).replace(/\.json$/, '').replace(/^\.\.\/data\//, '')})` : t('боец: учитель'),
                с.тактик ? 'тактик' : null].filter(Boolean).join(' + ');
  const от = с.отряды;
  const сек = Math.floor(mem.u32(G.step) * 55 / 1000);
  лабСтрока.textContent = `${Math.floor(сек / 60)}:${String(сек % 60).padStart(2, '0')} · ${слои} · ${t('осанка')} ${с.осанка} · ${t('фаза')} ${с.фаза || '—'}`
    + ` · ${t('решений')}: ${t('сетью')} ${сеть}, ${t('учителем')} ${учитель}`
    + ` · ${t('охота')} ${от.охота.length} ${t('кулак')} ${от.кулак.length} ${t('раб')} ${от.рабочие.length} ${t('лечатся')} ${от.лечение.length}`
    + ` · ${t('добыча')} ${с.добыча ? '#' + с.добыча : '—'}`;
  const сч = сценаКуска ? счётСейчас() : null;
  if (сч) {
    const норма = (v, предел) => v === null ? '—' : `${v.toFixed(1)} с${v <= предел ? '' : ' (мимо)'}`;
    лабСтрока.textContent += `\n${t('сцена')}: ${сч.сек.toFixed(1)}/${КУСОК_СЦЕНЫ.секунд} с · ${t('убито')} ${сч.убито}/${сч.всего}`
      + ` · ${t('урона')} ${сч.урон} · ${t('потеряно')} ${сч.потеряно}/${сч.наших}`
      + ` · ${t('первый')} ${норма(сч.первый, 8)} · ${t('второй')} ${норма(сч.второй, 20)}`;
  }
}
setInterval(лабСостояние, 1000);

/** Кнопки моделей для слоя выбранных мозгов: «лучшая» плюс все веса этого слоя из оглавления. */
function лабМоделиНарисовать() {
  if (!лабРядМоделей) return;
  const м = ЛАБ_МОЗГИ.find(x => x.имя === лаб.мозги) || ЛАБ_МОЗГИ[0];
  while (лабРядМоделей.children.length > 1) лабРядМоделей.lastChild.remove();
  const слой = м.слой;
  if (!слой) { const п = document.createElement('span'); п.className = 'имя'; п.style.minWidth = 'auto';
    п.textContent = t('эти мозги без сети'); лабРядМоделей.appendChild(п); return; }
  const кн = (текст, дело, подсказка, годится) => { const b = document.createElement('button');
    b.textContent = текст; b.className = 'мелк'; b.title = подсказка || '';
    if (!годится) { b.disabled = true; b.style.opacity = '0.45'; } else b.onclick = () => { дело(); cv.focus(); };
    лабРядМоделей.appendChild(b); return b; };
  кн(t('лучшая'), () => { лаб.веса[слой] = null; localStorage.removeItem(слой === 'боец' ? 'jw.lab.весаБойца' : 'jw.lab.весаКомдива'); лабМозгиПоставить(); },
     t('веса по умолчанию для этого слоя'), true).classList.toggle('on', !лаб.веса[слой]);
  const все = (лаб.список || []).filter(з => з.слой === слой);
  // Совместимость определяем по размеру входа и числа действий: они должны совпадать с теми,
  // на которые рассчитан нынешний код сети (это же правило в js/ai/нейросети.js).
  const свежие = все.filter(з => з.вектор !== undefined);
  const эталон = свежие.length ? свежие.reduce((a, b) => (b.вектор > a.вектор ? b : a)) : null;
  for (const з of все) {
    const годится = !эталон || з.вектор === undefined || (з.вектор === эталон.вектор && з.действий === эталон.действий);
    const b = кн(з.имя.replace(/-20\d\d-\d\d-\d\d-\d+$/, ''), () => {
      лаб.веса[слой] = з.файл;
      localStorage.setItem(слой === 'боец' ? 'jw.lab.весаБойца' : 'jw.lab.весаКомдива', з.файл);
      лабМозгиПоставить();
    }, (з.описание || з.имя) + (годится ? '' : ' — ' + t('старый размер сети, не грузится')), годится);
    b.classList.toggle('on', лаб.веса[слой] === з.файл);
  }
}

/** Подсветить в панели то, что выбрано сейчас. */
function лабНарисовать() {
  if (!лаб.построен) return;
  for (const b of лабЭл.querySelectorAll('button[data-мозги]')) b.classList.toggle('on', b.dataset.мозги === лаб.мозги);
  for (const b of лабЭл.querySelectorAll('button[data-миссия]')) b.classList.toggle('on', +b.dataset.миссия === mission);
  for (const b of лабЭл.querySelectorAll('button[data-племя]')) b.classList.toggle('on', +b.dataset.племя === tribe);
  for (const b of лабЭл.querySelectorAll('button[data-сложность]')) b.classList.toggle('on', +b.dataset.сложность === (shell.difficulty ?? 1));
  лабМоделиНарисовать(); лабУчёбаНарисовать();
  const p = document.getElementById('labpause'); if (p) p.classList.toggle('on', !!shell.paused);
  const у = document.getElementById('labугодья');
  if (у) { у.classList.toggle('on', угодья.режим || !!угодья.рект);
           у.title = угодья.рект ? t('участок задан; нажми, чтобы снять') : t('обозначить охотничьи угодья рамкой'); }
  const f = document.getElementById('labfast'); if (f) { f.classList.toggle('on', fast3Btn.classList.contains('on')); f.textContent = fast3Btn.textContent; }
}

/** Включить или выключить стенд: в нём от нижней панели остаются только его собственные кнопки. */
function лабВключить(вкл) {
  лаб.вкл = вкл;
  // В хранилище состояние стенда НЕ пишем — он живёт только в этой вкладке и только по ссылке.
  // Оглавление весов тянем один раз: без него ряд моделей пуст, а с ним видно все обученные сети.
  if (вкл && !лаб.список) Сети.список().then(сп => { лаб.список = сп; лабМоделиНарисовать(); }).catch(() => { лаб.список = []; });
  if (вкл) Сети.живые().then(async сп => {
    лаб.живые = сп; лабУчёбаНарисовать();
    const п = await свежиеВесаПоУмолчанию();
    if (п) { await лабМозгиПоставить(false); say(t('стенд: веса из идущего обучения «{n}»', { n: п.имя })); }
  }).catch(() => {});
  if (вкл && !лаб.построен) лабПостроить();
  document.getElementById('bar').classList.toggle('лаб', вкл);
  лабЭл.hidden = !вкл;
  if (вкл) { лабНарисовать(); лабМозгиПоставить(false); }
  cv.focus();
}
document.getElementById('labbtn').onclick = () => лабВключить(!лаб.вкл);
// Ссылка прямо на сцену: /jw/scene → game.html?lab=1&scene=кусок. Ни меню, ни выбора племени, ни
// брифинга: сцена ставится сама, как только скачаны паки. Ждать экрана игры (как я сделал сперва)
// нельзя — по такой ссылке человек стоит в меню, до партии дело не доходит и не происходит ничего.
// Значение параметра: пусто/«cut»/«кусок» — обрезок карты Тирано, как было; имя или номер
// племени — полная первая миссия этого племени (ссылки /jw/scene/moospell и прочие).
// Сцена «трое на Ashfall»: /jw/battle
// Сохранение с сервера: game.html?save=<id> (кнопка ☁ отдаёт такую ссылку). Ждём, пока
// оболочка дойдёт до главного меню — к этому времени паки скачаны, — и кладём партию.
if (netAuto.get('save')) (async () => {
  for (let k = 0; k < 900 && shell.screen !== 'menu'; k++) await new Promise(r => setTimeout(r, 200));
  try { await сейвССервера(netAuto.get('save')); }
  catch (e) { say(t('не удалось открыть сохранение: ') + e.message); toast(t('не удалось открыть сохранение: ') + e.message); }
})();
if (netAuto.get('battle')) setTimeout(async () => { лабВключить(false); await запуститьБой(); }, 300);
if (netAuto.get('duel')) setTimeout(async () => { лабВключить(false); await запуститьДуэль(); }, 300);
if (netAuto.get('scene')) setTimeout(async () => {
  лабВключить(true);
  const v = String(netAuto.get('scene')).toLowerCase();
  const п = TRIBE_BY_NAME[v] ?? (/^[0-7]$/.test(v) ? +v : null);
  // Второй кусок ссылки — номер миссии: /jw/scene/tyrano/2 открывает вторую стадию этого племени.
  const мис = Math.max(1, Math.min(12, parseInt(netAuto.get('m'), 10) || 1)) - 1;
  if (п === null) await запуститьКусок(); else await запуститьПлемя(п, мис);
}, 300);
// Вход в стенд — ТОЛЬКО ПО ССЫЛКЕ (/jw/lab, /jw/scene), а не «как в прошлый раз». Сперва здесь
// стояло восстановление из хранилища, и это ломало обычную игру: стоило один раз открыть стенд,
// как он всплывал потом в кампании. Владелец: «когда я через уровни перехожу на кампанию, вижу
// стенд; так не должно быть, стенд — это отдельная площадка». Кнопка «стенд» в панели по-прежнему
// включает его руками в текущей вкладке.
if (netAuto.get('lab') === '1' || netAuto.get('scene')) {
  // Панель показываем СРАЗУ, не дожидаясь партии. Раньше ждали экрана игры, и по ссылке /jw/lab
  // человек попадал в главное меню с обычным нижним рядом кнопок — «чет страница сломалась».
  // Своей партии у стенда нет: миссию, племя и сложность выбирают его же кнопками, они и
  // запускают игру. В меню панель полезнее всего.
  лабВключить(true);
  const ждёмПартию = setInterval(() => { if (shell.screen !== 'game') return; clearInterval(ждёмПартию); if (!лаб.вкл) лабВключить(true); }, 500);
}

window.__jw = { mem, get eng() { return eng; }, input, F, shell, fb, rend, лабВключить, лабРестарт, лаб,
  // Наружу — что образец решил на последнем шаге и его внутреннее состояние: этим tools/сцена_замер.mjs
  // и трассировки смотрят режим («бой», «отрыв», «сон», «мясо») прямо со страницы, а не по картинке.
  get образец() { return образецСлой.последнее; }, get образецСост() { return образецСлой.с; },
  get следимЗаОтрядом() { return следимЗаОтрядом; },
  // Для проверок угодий в обычной игре: слой и переключатель рамки.
  get образецСлой() { return образецСлой; }, переключитьУгодья: () => переключитьУгодья(),
  get угодья() { return угодья; }, get охоты() { return охоты; },
  // Печать шрифтом игры наружу: этим tools/menu_label.mjs рисует новые надписи на кнопках меню.
  текст: (s, x, y, о) => text(eng, s, x, y, о), командаПоБукве, кнопкиКоманд, юXдляПроверки: юX, текстШирина: (s, f = 1) => text(eng, s, 0, 2000, { font: f }), Очередь, План, ИИ, Артефакты, Ввод, Следом, Камикадзе, ЗУМ, зумДоступен, G, U, UNITS, BI, BG, подсказкаПредмета, описаниеПредмета, get текстыПредметов() { return текстыПредметов; }, present, startMission, BUILD, pathMode, playReplay, Replay, rec, saveReplay, get playing() { return playing; }, get приказыПаузы() { return приказыПаузы; }, get КРУГ() { return КРУГ; }, get вводТач() { return { круг: !!input.кругОткрыть, тащить: !!input.тащитьКарту }; }, get net() { return net; }, setPathMode: (v) => { localStorage.setItem("jw.path", setPathMode(v)); showPath(); return pathMode(); } };
// ---- быстрый переход по ссылке: /jw/<племя>/<уровень> (nginx переписывает в ?r=&m=),
// либо game.html#tyrano/3. Третьим параметром можно задать сложность: easy | normal | hard.
const TRIBE_BY_NAME = { tyrano: 0, kanoose: 1, 'ka-noo-se': 1, romack: 2, masai: 3,
  moospell: 4, koomba: 5, radumba: 6, koaka: 7 };
const DIFF_BY_NAME = { easy: 0, normal: 1, medium: 1, hard: 2 };
/** Разобрать короткую ссылку /jw/<племя>/<уровень>/<сложность> и сразу открыть эту партию. */
function parseRoute() {
  const q = new URLSearchParams(location.search);
  let r = q.get('r'), m = q.get('m'), d = q.get('d');
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (!r && h) { const p = h.split('/'); r = p[0]; m = p[1]; d = p[2]; }
  if (!r) return null;
  const tribe = TRIBE_BY_NAME[String(r).toLowerCase()] ?? (/^[0-7]$/.test(r) ? +r : null);
  if (tribe === null) return null;
  const mission = Math.max(1, Math.min(12, parseInt(m, 10) || 1)) - 1;
  const diff = DIFF_BY_NAME[String(d || '').toLowerCase()] ?? 1;
  return { tribe, mission, diff };
}
const route = parseRoute();
if (route) {
  shell.tribe = route.tribe; shell.difficulty = route.diff;
  say(`племя ${route.tribe}, миссия ${route.mission + 1}`);
  shell.start(route.mission);                                  // сразу к брифингу нужной стадии
} else { shell.goto('logo_tric'); }
say(''); cv.focus();
// Карты и спрайты качаем фоном, но только когда меню уже на экране: если начать раньше, они
// отбирают полосу у логотипов и самого меню, и на медленной сети первый экран ждёшь заметно дольше.
const prefetch = setInterval(() => {
  if (shell.screen !== 'menu') return;
  clearInterval(prefetch);
  // Пак 06 (783 КБ) идёт первым: он даёт щелчки уже в меню. Тяжёлые карты и спрайты — следом,
  // чтобы не отбирать у него полосу.
  need('_PWAR06.TRW').then(() => { enableSound();
    need('_PWAR08.TRC'); need('_PWAR09.TRC'); need('_PWAR04.TRS'); need('_PWAR05.TRS'); });
}, 500);
