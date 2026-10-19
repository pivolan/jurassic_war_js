// Спрайты из 3D-модели (наше): рендер GLB в тех же ракурсах, в каких нарисованы спрайты игры.
//
//   node tools/sprite3d.mjs подбор <модель.glb> <эталон.png>   — какой угол камеры совпадает с игрой
//   node tools/sprite3d.mjs виды  <модель.glb> [--угол=35] [--высота=32] [--каталог=out/3d/виды]
//   node tools/sprite3d.mjs сравнить <модель.glb> [--углы=20,30,40,50] [--юнит=1]  — лист сравнения
//                                                     со спрайтами игры в их же размере
//
// Зачем. Спрайты оригинала нарисованы в косой проекции сверху: восемь направлений через 45°,
// камера поднята над горизонтом на неизвестный угол. Чтобы новая графика встала на место старой,
// её надо снимать той же камерой — иначе персонаж будет «не той высоты» и не сядет на тайлы.
// Угол не угадываем, а подбираем: рендерим силуэт при разных углах, сравниваем с силуэтом
// оригинального спрайта по мере Жаккара (пересечение делить на объединение) и берём лучший.
//
// Камера ортографическая: в оригинале спрайт одного размера у края и в центре карты, перспективы
// нет. Нумерация направлений — как в игре (DIRMAP в tools/anim.py): 0 — «вверх», спина к игроку,
// дальше по часовой через 45°, 4 — лицом к игроку. Модель из генератора смотрит в другую сторону,
// поэтому между «направлением игры» и углом сцены есть постоянный сдвиг ПОВОРОТ.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const требуй = createRequire('/usr/lib/node_modules/');
const { chromium } = требуй('playwright');
const КОРЕНЬ = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const позиц = process.argv.slice(2).filter(a => !a.startsWith('--'));

const СТЕНД = path.join(КОРЕНЬ, 'out/3d/_стенд');            // страница рендера и копия модели
const ПОРТ = +(арг.порт || 8231);
const ПОВОРОТ = +(арг.поворот ?? 2);        // направление игры → угол сцены (модель стоит лицом на -Z)

/** Поднять статический сервер над каталогом стенда: fetch по file:// браузеру запрещён. */
function сервер(каталог) {
  const п = spawn('python3', ['-m', 'http.server', String(ПОРТ)], { cwd: каталог, stdio: 'ignore' });
  return { стоп: () => п.kill() };
}

const СТРАНИЦА = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}</style>
<canvas id="c"></canvas>
<script type="importmap">{"imports":{"three":"./three.module.js"}}</script>
<script type="module">
import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.module.js';
const рен = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true, alpha: true });
рен.setClearColor(0x000000, 0);
const сцена = new THREE.Scene();
сцена.add(new THREE.HemisphereLight(0xffffff, 0x99a0b0, 2.0));
const солнце = new THREE.DirectionalLight(0xfff2e0, 2.2); солнце.position.set(-2, 5, 3); сцена.add(солнце);
const кам = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
window.готово = false; window.ошибка = null;
new GLTFLoader().load('model.glb', (g) => {
  const о = g.scene; сцена.add(о);
  const б = new THREE.Box3().setFromObject(о);
  const ц = б.getCenter(new THREE.Vector3()), р = б.getSize(new THREE.Vector3());
  о.position.sub(ц); о.position.y += р.y / 2;                    // ставим на «пол» y=0
  let треуг = 0; о.traverse(n => { if (n.isMesh) треуг += n.geometry.index ? n.geometry.index.count / 3 : n.geometry.attributes.position.count / 3; });
  window.свод = { треугольников: Math.round(треуг), высота: р.y, ширина: р.x, глубина: р.z };
  // Кадр: направление (0 — спина к игроку, по часовой), угол подъёма камеры, размер картинки.
  window.кадр = (направление, подъём, ширПикс, высПикс) => {
    рен.setSize(ширПикс, высПикс, false);
    const а = направление * Math.PI / 4, э = подъём * Math.PI / 180;
    const d = Math.max(р.x, р.y, р.z) * 3;
    кам.position.set(Math.sin(а) * Math.cos(э) * d, Math.sin(э) * d + р.y / 2, Math.cos(а) * Math.cos(э) * d);
    кам.up.set(0, 1, 0); кам.lookAt(0, р.y / 2, 0);
    // Ортографический охват: чуть больше габарита, чтобы фигура влезла при любом наклоне.
    const охват = Math.max(р.y, Math.hypot(р.x, р.z)) * 0.62;
    кам.top = охват; кам.bottom = -охват; кам.left = -охват * ширПикс / высПикс; кам.right = охват * ширПикс / высПикс;
    кам.updateProjectionMatrix();
    рен.render(сцена, кам);
  };
  window.готово = true;
}, undefined, (e) => { window.ошибка = String(e); window.готово = true; });
</script>`;

async function стенд(модель) {
  fs.mkdirSync(СТЕНД, { recursive: true });
  fs.copyFileSync(модель, path.join(СТЕНД, 'model.glb'));
  fs.writeFileSync(path.join(СТЕНД, 'index.html'), СТРАНИЦА);
  // Библиотеки кладём один раз (сеть может быть недоступна на следующем прогоне).
  const нужны = [['three.module.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'],
                 ['GLTFLoader.module.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js'],
                 ['utils/BufferGeometryUtils.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js']];
  for (const [имя, ссылка] of нужны) {
    const ф = path.join(СТЕНД, имя);
    if (fs.existsSync(ф) && fs.statSync(ф).size > 1000) continue;
    fs.mkdirSync(path.dirname(ф), { recursive: true });
    const о = await fetch(ссылка); fs.writeFileSync(ф, Buffer.from(await о.arrayBuffer()));
  }
  const с = сервер(СТЕНД);
  await new Promise(r => setTimeout(r, 700));
  const бр = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const стр = await бр.newPage({ viewport: { width: 512, height: 512 } });
  await стр.goto(`http://127.0.0.1:${ПОРТ}/index.html`);
  await стр.waitForFunction('window.готово === true', null, { timeout: 60000 });
  const ош = await стр.evaluate('window.ошибка'); if (ош) throw new Error('модель не загрузилась: ' + ош);
  return { стр, закрыть: async () => { await бр.close(); с.стоп(); } };
}

const снимок = async (стр, направление, подъём, ш, в) => {
  await стр.setViewportSize({ width: ш, height: в });
  await стр.evaluate(`window.кадр(${направление}, ${подъём}, ${ш}, ${в})`);
  return стр.screenshot({ omitBackground: true });
};

if (позиц[0] === 'виды') {
  const модель = позиц[1] || 'out/3d/простолюдин.glb';
  const подъём = +(арг.угол || 35), высПикс = +(арг.высота || 32) * (+(арг.масштаб || 8));
  const каталог = path.join(КОРЕНЬ, арг.каталог || 'out/3d/виды');
  fs.mkdirSync(каталог, { recursive: true });
  const { стр, закрыть } = await стенд(path.isAbsolute(модель) ? модель : path.join(КОРЕНЬ, модель));
  console.log('модель: ' + JSON.stringify(await стр.evaluate('window.свод')));
  for (let d = 0; d < 8; d++) {
    const png = await снимок(стр, (d - ПОВОРОТ + 8) % 8, подъём, Math.round(высПикс * 0.75), высПикс);
    fs.writeFileSync(path.join(каталог, `вид_${d}.png`), png);
  }
  await закрыть();
  console.log(`восемь видов при подъёме ${подъём}° → ${каталог}`);
} else if (позиц[0] === 'подбор') {
  // Ищем угол подъёма камеры по силуэту: сравниваем с эталонным спрайтом игры.
  const модель = позиц[1], эталон = позиц[2];
  const { стр, закрыть } = await стенд(path.isAbsolute(модель) ? модель : path.join(КОРЕНЬ, модель));
  const { execFileSync } = await import('node:child_process');
  // Силуэты считаем в Python/PIL: разбирать текстовый дамп ImageMagick оказалось ненадёжно —
  // маски выходили сплошными, и все углы давали одно и то же число.
  const врем = path.join(СТЕНД, 'подбор'); fs.mkdirSync(врем, { recursive: true });
  const эталонЧист = path.join(врем, 'эталон.png');
  execFileSync('convert', [эталон, '-fuzz', '2%', '-transparent', '#040404', '-trim', '+repage', эталонЧист]);
  const углы = [];
  for (let угол = 10; угол <= 80; угол += 5) {
    const ф = path.join(врем, `у${угол}.png`);
    fs.writeFileSync(ф, await снимок(стр, (4 - ПОВОРОТ + 8) % 8, угол, 256, 340));
    execFileSync('convert', [ф, '-trim', '+repage', ф]);
    углы.push(угол);
  }
  const код = `
import sys
from PIL import Image
def маска(ф, ш=48, в=64):
    # Фигура — всё, что не фон. Фон бывает двух видов: прозрачный (наш рендер) и белый
    # (спрайт игры, куда белый подставлен при вырезании). Берём оба признака: непрозрачное
    # И не почти белое. Раньше смотрел только на альфу — после convert -trim она терялась,
    # маски выходили сплошными прямоугольниками, и все углы давали одинаковые 84 %.
    и = Image.open(ф).convert('RGBA').resize((ш, в), Image.BILINEAR)
    п = list(и.getdata())
    return [1 if (a > 96 and not (r > 235 and g > 235 and b > 235)) else 0 for (r, g, b, a) in п]
э = маска(sys.argv[1])
for ф in sys.argv[2:]:
    р = маска(ф)
    и2 = sum(1 for x, y in zip(э, р) if x and y); о = sum(1 for x, y in zip(э, р) if x or y)
    print(ф.split('/')[-1][1:-4], round(100 * и2 / max(1, о), 1))
`;
  const вывод = execFileSync('python3', ['-c', код, эталонЧист, ...углы.map(у => path.join(врем, `у${у}.png`))]).toString();
  let лучший = null;
  for (const строка of вывод.trim().split('\n')) {
    const [у, ж] = строка.split(' ').map(Number);
    console.log(`подъём ${String(у).padStart(2)}°: совпадение силуэта ${ж.toFixed(1)} %`);
    if (!лучший || ж > лучший.жак) лучший = { угол: у, жак: ж };
  }
  await закрыть();
  console.log(`лучший угол: ${лучший.угол}° (${лучший.жак.toFixed(1)} %)`);
} else if (позиц[0] === 'сравнить') {
  // Лист: сверху спрайты игры, ниже — рендеры при разных углах подъёма, всё в размере оригинала
  // и увеличено одинаково. Так видно не «похоже ли вообще», а сядет ли новая графика на место старой.
  const модель = позиц[1];
  const углы = (арг.углы || '20,30,40,50').split(',').map(Number);
  const { execFileSync } = await import('node:child_process');
  const врем = path.join(СТЕНД, 'сравн'); fs.mkdirSync(врем, { recursive: true });
  const { стр, закрыть } = await стенд(path.isAbsolute(модель) ? модель : path.join(КОРЕНЬ, модель));
  const ряды = [];
  // Ряд оригинала: спрайты стойки уже вырезаны в out/3d/стойка_<d>.png
  const орigin = [];
  for (let d = 0; d < 8; d++) {
    const из = path.join(КОРЕНЬ, `out/3d/стойка_${d}.png`), в = path.join(врем, `ориг_${d}.png`);
    execFileSync('convert', [из, '-fuzz', '2%', '-fill', 'white', '-opaque', '#040404', '-trim', '+repage',
                             '-filter', 'point', '-resize', 'x256', '-background', 'white', '-alpha', 'remove',
                             '-gravity', 'south', '-extent', '224x256', в]);
    орigin.push(в);
  }
  ряды.push(орigin);
  for (const угол of углы) {
    const ряд = [];
    for (let d = 0; d < 8; d++) {
      const ф = path.join(врем, `у${угол}_${d}.png`);
      fs.writeFileSync(ф, await снимок(стр, (d - ПОВОРОТ + 8) % 8, угол, 256, 340));
      execFileSync('convert', [ф, '-trim', '+repage', '-resize', 'x256', '-background', 'white', '-alpha', 'remove',
                               '-gravity', 'south', '-extent', '224x256', ф]);
      ряд.push(ф);
    }
    ряды.push(ряд);
  }
  await закрыть();
  const лист = path.join(КОРЕНЬ, арг.лист || 'out/3d/сравнение.png');
  execFileSync('montage', [...ряды.flat(), '-tile', '8x' + ряды.length, '-geometry', '+3+3', '-background', '#bbbbbb', лист]);
  console.log(`лист сравнения (сверху оригинал, ниже углы ${углы.join(', ')}°): ${лист}`);
} else {
  console.error('команды: подбор <модель.glb> <эталон.png> | виды <модель.glb> [--угол=35]');
  process.exit(1);
}
