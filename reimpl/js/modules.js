// Загружает все модули порта js/port/*.js (Node). Каждый модуль регистрирует функции в F.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import './core.js';
const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'port');
// Модули-надстройки подменяют функции, которые регистрируют базовые: их надо грузить последними,
// иначе базовый модуль перезапишет подмену (в браузере порядок задан явно в modules.browser.js).
// inject.js обязан идти после orders_ai.js: он подменяет 0x1419e, а orders_ai.js его
// регистрирует. По алфавиту inject.js оказывался раньше — подмена молча затиралась, приказы
// ИИ и сетевого соперника не доходили до движка вообще (в браузере порядок задан явно в
// modules.browser.js, поэтому там всё работало, а в Node — нет).
const LAST = ['caster.js', 'path.js', 'patrol.js', 'fog.js', 'inject.js', 'buildplan.js', 'artifacts.js', 'follow.js', 'kamikaze.js', 'orderqueue.js', 'autofood.js', 'ai_script.js'];
// Порядок важен: файлы из LAST грузятся последними, потому что они ставят обёртки поверх базовых
// реализаций, а обратный порядок их затирал (на этом сгорели inject и patrol).
const list = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !LAST.includes(f)).sort();
if (process.env.MODULES_REVERSE) list.reverse();
for (const f of list.concat(LAST)) await import('./port/' + f);
import './render/scene.js';
import './render/sprites.js';
import './render/hud.js';
import './render/panel.js';
import './render/text.js';
