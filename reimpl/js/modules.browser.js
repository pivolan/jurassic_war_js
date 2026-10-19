// Порядок загрузки модулей порта для браузера. В node то же самое делает modules.js, читая каталог,
// но браузеру нужен явный список: динамического чтения каталога там нет.
//
// Порядок ВАЖЕН. Модули из конца списка ставят обёртки поверх базовых реализаций (патруль и
// камикадзе — поверх обработчика состояний, inject — поверх раздачи приказов). Если загрузить их
// раньше, базовый модуль затрёт обёртку, и механика молча перестанет работать — так уже было.
import './core.js';
import './port/combat.js';
import './port/economy.js';
import './port/input.js';
import './port/loader.js';
import './port/magic.js';
import './port/move.js';
import './port/orders_ai.js';
import './port/caster.js';   // маг возвращается к бою после вспомогательного заклинания
import './port/patrol.js';  // приказ патрулирования поверх «охраны поста» оригинала (после move.js)
import './port/kamikaze.js';   // камикадзе: бьёт всех подряд, ближайших первыми
import './port/path.js';   // режимы поиска пути: подключается после move.js, чтобы подменить 0x1e11e/0x1dc43
import './render/scene.js';
import './render/sprites.js';
import './render/hud.js';
import './render/panel.js';
import './render/text.js';
import './port/inject.js';   // отдача приказов мимо интерфейса (ИИ и сеть): подменяет 0x1419e, только после orders_ai.js
import './port/artifacts.js';   // пассивные прибавки от украшений (после inject.js)
import './port/buildplan.js';  // планы стройки: строитель сам идёт на отмеченное место (после inject.js)
import './port/follow.js';    // приказ «следовать за юнитом» (после inject.js)
import './port/orderqueue.js'; // очередь приказов по Shift (после inject.js)
import './port/autofood.js';   // автоприрост еды базам (после inject.js)
import './port/ai_script.js';  // скриптовый компьютерный противник (после inject.js: вешает хук шага)
import './port/fog.js';        // тишина и никаких надписей на неразведанных клетках (после magic.js и text.js)
