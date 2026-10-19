// Обновить метки версий у наших ассетов в HTML: ?v=<хеш содержимого>.
//
//   node tools/версии.mjs            # проставить всем изменившимся
//   node tools/версии.mjs --проверить # только сказать, что разошлось (код 1, если разошлось)
//
// Зачем. Правки уезжали на сайт, а у владельца на планшете оставалось старое: вкладка держала
// прежний game.js. Раньше метку `?v=` я поднимал руками — и, конечно, иногда забывал. Теперь
// метка считается из СОДЕРЖИМОГО файла: поменялся файл — поменялась метка, не поменялся — нет.
// Вызывается из tools/repo_sync.sh перед каждым пушем, так что забыть уже нельзя.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url'; import crypto from 'node:crypto';
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ВЕБ = path.join(КОРЕНЬ, 'reimpl/web');
const проверка = process.argv.includes('--проверить');

/** Все файлы дерева (рекурсивно), отсортированные — чтобы хеш не зависел от порядка обхода. */
function всеФайлы(корень, куда = []) {
  for (const и of fs.readdirSync(корень, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const п = path.join(корень, и.name);
    if (и.isDirectory()) всеФайлы(п, куда); else if (/\.(js|css)$/.test(и.name)) куда.push(п);
  }
  return куда;
}
// Код игры — это не только web/game.js: он тянет полсотни модулей из reimpl/js, и правка любого из
// них меняет поведение. Раньше метка считалась только по самому файлу, поэтому правка в js/ не
// двигала версию: у владельца на планшете оставалась прежняя вкладка, и казалось, что ничего не
// приехало. Теперь метка модуля-точки-входа считается по НЕМУ ПЛЮС всему дереву reimpl/js.
const ДЕРЕВО = path.join(КОРЕНЬ, 'reimpl/js');
let хешДерева = null;
function деревоJS() {
  if (хешДерева) return хешДерева;
  const h = crypto.createHash('sha1');
  for (const ф of всеФайлы(ДЕРЕВО)) h.update(fs.readFileSync(ф));
  return (хешДерева = h.digest('hex'));
}
/** Короткий хеш: содержимое файла плюс всё дерево модулей игры. */
const хеш = (ф) => crypto.createHash('sha1').update(fs.readFileSync(ф)).update(деревоJS()).digest('hex').slice(0, 8);

let менял = 0, разошлось = [];
for (const имя of fs.readdirSync(ВЕБ).filter(f => f.endsWith('.html'))) {
  const файл = path.join(ВЕБ, имя);
  let текст = fs.readFileSync(файл, 'utf8'); const было = текст;
  // src="game.js?v=..." и import ... from './lang.js?v=...'
  текст = текст.replace(/(["'])([\w./-]+\.(?:js|css))\?v=[\w.]+\1/g, (всё, к, ф) => {
    const п = path.join(ВЕБ, ф);
    if (!fs.existsSync(п)) return всё;
    return `${к}${ф}?v=${хеш(п)}${к}`;
  });
  if (текст !== было) { разошлось.push(имя); if (!проверка) { fs.writeFileSync(файл, текст, 'utf8'); менял++; } }
}
// Внутренние импорты модулей с меткой (game.js → ./lang.js?v=…) правим тем же правилом.
for (const имя of fs.readdirSync(ВЕБ).filter(f => f.endsWith('.js'))) {
  const файл = path.join(ВЕБ, имя);
  let текст = fs.readFileSync(файл, 'utf8'); const было = текст;
  текст = текст.replace(/(from\s+['"])(\.\/[\w./-]+\.js)\?v=[\w.]+(['"])/g, (всё, а, ф, б) => {
    const п = path.join(ВЕБ, ф);
    if (!fs.existsSync(п)) return всё;
    return `${а}${ф}?v=${хеш(п)}${б}`;
  });
  if (текст !== было) { разошлось.push(имя); if (!проверка) { fs.writeFileSync(файл, текст, 'utf8'); менял++; } }
}
// КАРТА ИМПОРТОВ: метка версии у КАЖДОГО модуля кода, не только у game.js. Владелец увидел на планшете
// старое поведение: game.js приезжал новый, а подгружаемые им модули ИИ (js/ai/образец.js и др.) шли без
// метки и оставались прежними. Карта импортов в самой странице сопоставляет каждому модулю адрес с
// ?v=<хеш всего кода>: поменялось что угодно — меняются все адреса, браузер качает заново. Исходники не
// трогаем, поэтому инструменты в node работают с теми же модулями, что и прежде.
{
  const h = crypto.createHash('sha1'); h.update(деревоJS());
  for (const ф of fs.readdirSync(ВЕБ).filter(f => f.endsWith('.js')).sort()) h.update(fs.readFileSync(path.join(ВЕБ, ф)));
  const v = h.digest('hex').slice(0, 10);
  const карта = {};
  for (const ф of всеФайлы(ДЕРЕВО)) if (ф.endsWith('.js')) { const о = '../js/' + path.relative(ДЕРЕВО, ф).split(path.sep).join('/'); карта[о] = о + '?v=' + v; }
  for (const ф of fs.readdirSync(ВЕБ).filter(f => f.endsWith('.js') && f !== 'game.js').sort()) карта['./' + ф] = './' + ф + '?v=' + v;
  const блок = '<script type="importmap" data-jw-versions>' + JSON.stringify({ imports: карта }) + '</script>';
  for (const имя of fs.readdirSync(ВЕБ).filter(f => f.endsWith('.html'))) {
    const файл = path.join(ВЕБ, имя);
    let текст = fs.readFileSync(файл, 'utf8'); const было = текст;
    if (!/type=["']module["']/.test(текст)) continue;
    if (/<script type="importmap" data-jw-versions>[\s\S]*?<\/script>/.test(текст)) текст = текст.replace(/<script type="importmap" data-jw-versions>[\s\S]*?<\/script>/, () => блок);
    else текст = текст.replace(/<script/, () => блок + '\n<script');       // до первого скрипта страницы
    if (текст !== было) { разошлось.push(имя); if (!проверка) { fs.writeFileSync(файл, текст, 'utf8'); менял++; } }
  }
}
if (проверка) {
  if (разошлось.length) { console.log('метки версий устарели в:', разошлось.join(', ')); process.exit(1); }
  console.log('метки версий на месте'); process.exit(0);
}
console.log(менял ? `метки версий обновлены: ${[...new Set(разошлось)].join(', ')}` : 'метки версий уже свежие');
