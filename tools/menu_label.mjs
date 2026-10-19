// Новая надпись на кнопке меню — шрифтом самой игры (наше).
//
//   node tools/menu_label.mjs <номер записи> "<надпись>" [--цвет=0xf8] [--шрифт=1] [--файл=…]
//
// Второй способ после нейросетевого (tools/menu_relabel.mjs). Там буквы рисует сеть, и как бы
// аккуратно мы потом ни собирали кнопку обратно, остаются крапины и обрубленные хвосты: сеть не
// знает ни нашей палитры, ни размера 100×100. Здесь буквы рисует сам движок своим шрифтом — тем
// же, каким печатаются подсказки, — поэтому попадание в палитру и в пиксельную сетку точное,
// а надпись меняется хоть на каждый язык.
//
// Печатаем в настоящей вкладке через playwright: шрифты и палитру поднимает оболочка при загрузке
// страницы, вне браузера они не готовы (в голом снимке текст выходил нулевой ширины).
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const требуй = createRequire('/usr/lib/node_modules/');
const { chromium } = требуй('playwright');
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const позиц = process.argv.slice(2).filter(a => !a.startsWith('--'));
const номер = +позиц[0], надпись = позиц[1];
if (!номер || !надпись) { console.error('нужны номер записи и надпись'); process.exit(1); }

const папка = path.join(КОРЕНЬ, 'out/art/меню'); fs.mkdirSync(папка, { recursive: true });
const исход = path.join(папка, `кнопка_${номер}.png`);
if (!fs.existsSync(исход)) execFileSync('python3', [path.join(КОРЕНЬ, 'tools/menu_sprite.py'), String(номер), исход], { cwd: КОРЕНЬ });
const [ш, в] = execFileSync('identify', ['-format', '%w %h', исход]).toString().split(' ').map(Number);
// Самый светлый жёлтый исходной надписи: по нему найдём в палитре ту самую рампу, которой
// напечатан оригинальный текст, и напечатаем новый ровно тем же цветом.
const жёлтыйRGB = execFileSync('python3', ['-c', `
import sys, os
_с = '${КОРЕНЬ}tools'
sys.path = [p for p in sys.path if os.path.abspath(p or '.') != _с] + [_с]
import numpy as np
from PIL import Image
A = np.asarray(Image.open(sys.argv[1]).convert('RGB'), int).reshape(-1, 3)
ж = A[(A[:,0] > 150) & (A[:,1] > 120) & (A[:,2] < 120)]
print(','.join(map(str, ж[ж.sum(1).argmax()])) if len(ж) else '252,252,84')
`, исход]).toString().trim().split(',').map(Number);

const ПОРТ = +(арг.порт || 8896);
const статика = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const бр = await chromium.launch();
const стр = await бр.newPage({ viewport: { width: 900, height: 700 } });
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.net, null, { timeout: 30000 });
// Цвет надписи берём не наугад: ищем в палитре игры ту же жёлтую рампу, какой напечатана
// исходная надпись (шрифт занимает четыре подряд идущих индекса, см. render-spec §11.3).
const слойДанные = await стр.evaluate(([надпись, ш, в, цвет, шрифт, жёлтыйRGB]) => {
  const j = window.__jw, m = j.mem;
  // Палитра зависит от экрана: кнопки живут на экране «Multiplayer», туда и переходим, иначе
  // индексы не те и надпись выходит тёмной.
  j.shell.goto('multiplayer'); j.shell.frame();
  const FB = 0x1235f4, ROWS = 0x122e74, PAL = 0x44980;   // адреса из js/render/scene.js и js/ui/screen.js
  // Чистим прямоугольник под надпись и печатаем в него шрифтом игры.
  for (let y = 0; y < в + 8; y++) m.b.fill(0, FB + m.u32(ROWS + y * 4), FB + m.u32(ROWS + y * 4) + ш + 40);
  // Индекс рампы: первый жёлтый, у которого следующие три тоже жёлтые и светлее.
  // Ищем индекс самого светлого жёлтого исходной надписи; шрифт печатает рампой из четырёх
  // подряд идущих индексов, где последний — самый светлый, поэтому берём найденный минус три.
  // Палитра в памяти шестибитная (0..63), а из PNG приходит восьмибитный цвет — иначе ближайшим
  // всегда оказывался тёмный индекс, и надпись выходила чёрной.
  let макс = 0; for (let i = 0; i < 768; i++) if (m.b[PAL + i] > макс) макс = m.b[PAL + i];
  const цель = макс <= 63 ? жёлтыйRGB.map(v => Math.round(v / 4)) : жёлтыйRGB;
  let лучший = цвет, разн = 1e9;
  for (let i = 1; i < 253; i++) {
    const d = Math.abs(m.b[PAL + i * 3] - цель[0]) + Math.abs(m.b[PAL + i * 3 + 1] - цель[1]) + Math.abs(m.b[PAL + i * 3 + 2] - цель[2]);
    if (d < разн) { разн = d; лучший = i; }
  }
  // Тело буквы печатается первым уровнем рампы, то есть самим `col`; поэтому базой берём индекс
  // найденного жёлтого, а не «минус три» — иначе буквы выходят зеленоватыми (проверено глазом).
  const рампа = лучший;
  const ширина = j.текстШирина ? j.текстШирина(надпись, шрифт) : 0;
  const x0 = Math.max(0, (ш - (ширина || 0)) >> 1), y0 = Math.round(в * 0.40);
  const занял = j.текст(надпись, x0, y0, { font: шрифт, col: рампа });
  const буквы = [];
  for (let y = 0; y < в; y++) for (let x = 0; x < ш; x++) { const v = m.b[FB + m.u32(ROWS + y * 4) + x]; if (v) буквы.push([x, y, v]); }
  const палитра = []; for (let i = 0; i < 256; i++) палитра.push([m.b[PAL + i * 3], m.b[PAL + i * 3 + 1], m.b[PAL + i * 3 + 2]]);
  return { ш, в, буквы, палитра, занял, рампа, лучший, макс };
}, [надпись, ш, в, +(арг.цвет || 0xf8), +(арг.шрифт || 1), жёлтыйRGB]);
await бр.close(); статика.kill();

const слой = path.join(папка, `надпись_${номер}.json`);
fs.writeFileSync(слой, JSON.stringify(слойДанные));
console.log(`надпись «${надпись}»: ${слойДанные.занял} пикселей шириной, точек ${слойДанные.буквы.length}`);
const готово = арг.файл ? path.join(КОРЕНЬ, арг.файл) : path.join(папка, `кнопка_${номер}_шрифт.png`);
execFileSync('python3', [path.join(КОРЕНЬ, 'tools/menu_paint.py'), исход, слой, готово], { stdio: 'inherit' });
