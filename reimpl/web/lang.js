// Язык нашего интерфейса (кнопки внизу, лобби, полоса «МУЛЬТИПЛЕЕР», окно ожидания). Исходные
// строки — русские, они же ключи; английский — в словаре. Переключается той же кнопкой языка, что
// и сюжетные тексты (js/ui/locale.js): ru — как есть, всё остальное — по-английски.
export let язык = 'en';
const EN = {
  'сохранения на сервере ({n})': 'saves on the server ({n})', 'сохранения на сервере: нет связи с релеем': 'server saves: no link to the relay',
  'стадия': 'stage', 'от начала': 'into the game', 'загрузить': 'load', 'скопировать ссылку': 'copy link', 'ссылка скопирована': 'link copied',
  'Загрузить сохранение? Текущая партия не сохранится.': 'Load the save? The current game will not be kept.',
  '☁ сейв': '☁ save', 'сохранить партию на сервер: то самое положение можно открыть по ссылке ?save=…': 'save the game to the server: the exact position opens via the link ?save=…',
  'сохранять нечего: партия не идёт': 'nothing to save: no game running', 'сохранено на сервер: {id}': 'saved to the server: {id}',
  'не удалось сохранить на сервер: ': 'could not save to the server: ', 'не удалось открыть сохранение: ': 'could not open the save: ',
  // кнопки внизу
  'мультиплеер': 'multiplayer', 'патруль': 'patrol', 'сетевая игра': 'multiplayer', 'отряды': 'squads',
  'камикадзе: {n}': 'kamikaze: {n}', 'камикадзе отменён': 'kamikaze off',
  'скорость игры: {v}': 'game speed: {v}', 'самая быстрая': 'fastest', 'быстрая': 'fast', 'обычная': 'normal',
  'медленная': 'slow', 'самая медленная': 'slowest',
  'колонка отрядов слева и автопривязка новых юнитов к цифрам 1..9, 0': 'squad column on the left and automatic binding of new units to keys 1..9, 0',
  'колонка отрядов и автопривязка включены': 'squad column and auto-binding on',
  'колонка отрядов и автопривязка выключены': 'squad column and auto-binding off',
  'музыка вкл/выкл': 'music on/off',
  'украшения: прибавки работают': 'trinkets: bonuses on', 'украшения: прибавки выключены': 'trinkets: bonuses off',
  'украшения: пассивные прибавки от артефактов (в кампании)': 'trinkets: passive artifact bonuses (campaign)', 'озвучка сюжета': 'story narration', 'записи партий': 'replays',
  'выбор уровня и расы': 'level and tribe', 'задание миссии (F2)': 'mission briefing (F2)', 'пауза (P)': 'pause (P)',
  'патруль отряда (V), затем щелчок по карте': 'patrol (V), then click the map', 'язык сюжетных текстов': 'language',
  'Tyrannosaurus': 'Tyrannosaurus',
  // лобби
  'край': 'edge', 'прокрутка карты у края экрана': 'map scrolling at the screen edge', 'прокрутка у края: включена': 'edge scrolling: on', 'прокрутка у края: выключена': 'edge scrolling: off',
  'ЛКМ': 'LMB', 'ПКМ': 'RMB',
  'ИИ карты': 'map AI',
  'заново': 'restart', 'начать скирмиш заново теми же настройками': 'restart the skirmish with the same settings', 'скирмиш заново': 'skirmish restarted',
  'правила партии': 'match rules', 'быстрый старт': 'quick start', '100 000 еды и два юнита на место': '100,000 food and two units per slot',
  'украшения дают прибавки': 'trinkets give bonuses', 'артефакты в слотах работают': 'artifacts in slots take effect',
  'пускать незнакомцев': 'let strangers in', 'во время матча, если есть места': 'mid-match, if slots are free',
  'пускать наблюдателей': 'let observers in', 'во время матча': 'mid-match',
  'наблюдатель': 'observer', 'смотреть за боем со стороны': 'watch from the side', 'вы смотрите со стороны; чтобы играть, щёлкните по месту': 'you are watching; click a seat to play',
  'приблизить карту': 'zoom in', 'отдалить карту': 'zoom out', 'масштаб: обычный': 'zoom: normal', 'масштаб: вся карта': 'zoom: whole map', 'масштаб: вдвое дальше': 'zoom: 2× out',
  'белый': 'white', 'жёлтый': 'yellow', 'голубой': 'cyan', 'розовый': 'pink', 'красный': 'red', 'зелёный': 'green', 'оранжевый': 'orange', 'фиолетовый': 'purple',
  'Победа: {t} — нажмите, чтобы продолжить': 'Victory: {t} — tap to continue',
  'Поражение — нажмите, чтобы продолжить': 'Defeat — tap to continue',
  'Победил {t} — нажмите, чтобы продолжить': '{t} won — tap to continue',
  'победил {t}': '{t} won',
  // компьютерные места: вид ИИ, уровень, характер (web/game.js drawPlaces)
  'скриптовый': 'scripted', 'оригинальный': 'original',
  'лёгкий': 'easy', 'обычный': 'normal', 'сложный': 'hard', 'зверский': 'brutal',
  'ровный': 'steady', 'агрессор': 'aggressor', 'экономист': 'economist', 'черепаха': 'turtle', 'налётчик': 'raider', 'охотник': 'hunter', 'защитник': 'defender',
  'смотреть за боем': 'watch the fight', 'вы смотрите со стороны': 'you are watching', 'можно не играть, а смотреть': 'you can just watch',
  'показать, что думает компьютерный противник': 'show what the computer opponent is thinking',
  'управление: левая выделяет, правая приказывает': 'controls: left selects, right commands',
  'управление: как в оригинале, всё левой кнопкой': 'controls: original, everything on the left button',
  'пурпурный': 'purple', 'синий': 'blue', 'мои записи': 'my recordings', 'на сервере ({n})': 'on the server ({n})', 'на сервере: нет связи с релеем': 'server: no link to the relay', ' — пусто': ' — empty', 'отправить на сервер': 'upload to the server', 'реплей: качаю с сервера…': 'replay: downloading…', 'не удалось скачать реплей: ': 'could not download the replay: ', 'несут на склад: {n}': 'carrying to the store: {n}', 'никто ничего не несёт': 'nobody is carrying anything', 'склада нет': 'no food storage', 'автоприрост еды': 'food keeps coming', 'каждой базе 2000 еды в минуту': '2000 food a minute to every base', 'идём за ним': 'following', 'шаг {n} в очереди': 'step {n} queued', 'собираем мясо: {n}': 'collecting meat: {n}', 'мяса рядом нет': 'no meat nearby', 'раздать вещи: {n}': 'handing out gear: {n}', 'некому отдать: {n}': 'nobody to give to: {n}', 'лишних вещей нет': 'nothing spare to hand out', 'скидывают лишнее: {n}': 'dropping spare gear: {n}', 'в атаку: {n}': 'attacking: {n}', 'идут: {n}': 'moving: {n}', 'собрать мясо': 'gather meat', 'вооружиться': 'arm up', 'сбросить лишнее': 'drop spare', 'отступить': 'fall back', 'берсерк': 'berserk', 'не вышло: ': 'failed: ', 'тач': 'touch', 'отход': 'fall back', 'управление пальцем: включено': 'touch controls: on', 'управление пальцем: выключено': 'touch controls: off', 'отходят к базе: {n} из {в}': 'falling back to base: {n} of {в}', 'отводить некого': 'nobody to pull back', 'раненых нет: все держат бой': 'no wounded: everyone holds the line', 'отходить некуда: домов нет': 'nowhere to fall back: no buildings', 'управление для пальца: выделение защищено от случайного тапа, палец тащит карту, рамка — долгим нажатием': 'touch controls: selection is protected from stray taps, drag to pan the map, long-press for a selection box', 'отход: выделенные бросают дела и идут к базе; если никто не выделен — все свои в кадре (R)': 'fall back: the selected drop everything and head home; with nothing selected — all your units on screen (R)', 'раздать': 'share', 'скинуть': 'drop', 'раздать бесхозные вещи по отряду: ненадетое оружие и щиты уходят ближайшим безоружным (G)': 'share spare gear across the squad: unworn weapons and shields go to the nearest unarmed (G)', 'скинуть всё ненадетое на землю под ноги (Y)': 'drop everything unworn on the ground (Y)', 'никто не выделен': 'nothing selected',
  'имя': 'name', 'релей': 'relay', 'закрыть': 'close', 'комнаты': 'rooms', 'своя комната': 'your room', 'название': 'name',
  'карта': 'map', 'сложность': 'difficulty', 'создать': 'create', 'смотреть': 'watch', 'войти в комнату наблюдателем': 'join as observer',
  'пускать незнакомцев во время матча, если есть места': 'let strangers join mid-match if slots are free',
  'пускать наблюдателей во время матча': 'let observers join mid-match', 'пускать незнакомцев во время матча': 'let strangers join mid-match',
  'пока ни одной комнаты — создайте свою': 'no rooms yet — create one', 'наведите на комнату — здесь будет карта и состав': 'hover a room to see its map and players',
  'комната': 'room', 'игрок': 'player', 'язык': 'language', 'старт': 'start', 'играть': 'play', 'смотреть партию': 'watch the game', 'стать наблюдателем': 'become observer',
  'стать игроком': 'become player', 'выйти из комнаты': 'leave room', 'выйти': 'quit', 'пауза для всех': 'pause for everyone', 'туман': 'fog',
  'игрок отключился': 'player disconnected',
  'Игра ждёт его возвращения. Если все оставшиеся нажмут «не ждать», партия продолжится без него.': 'The game waits for them. If everyone left presses "don\'t wait", the match goes on without them.',
  'не ждать': "don't wait", 'вы не ждёте': "you don't wait", 'не ждут': "not waiting",
  'войти': 'join', 'или двойной клик по строке': 'or double-click the row', 'вернуться': 'return', 'войти в игру': 'join game', 'хост не пускает посторонних': 'host does not allow strangers', 'мест нет': 'no free slots',
  'хост не пускает зрителей во время матча': 'host does not allow observers mid-match', 'подключение…': 'connecting…', 'релей недоступен': 'relay unavailable',
  'ожидание': 'waiting', 'идёт игра': 'in progress', 'идёт игра, вход открыт': 'in progress, open', 'вылетел {n}': 'dropped {n}',
  'ХОСТ': 'HOST', 'Я': 'ME', 'НАБЛЮДАТЕЛЬ': 'OBSERVER', 'ВЫЛЕТЕЛ': 'DROPPED', 'ИДЁТ ИГРА': 'IN PROGRESS', 'вы наблюдатель': 'you are an observer',
  'вернуться в игру': 'return to game', 'свободных племён нет': 'no free tribes', 'хост не пускает новых игроков': 'host does not allow new players',
  'моё место': 'my seat', 'нет места': 'no seat', 'занято': 'taken', 'входим в партию…': 'joining…', 'подключаемся к партии…': 'connecting to the game…',
  'без тумана': 'no fog', 'за всех игроков': 'all players', 'глазами {t}': 'as {t}', 'сетевые карты': 'skirmish maps', 'кампания': 'campaign',
  'сетевая карта': 'skirmish map', 'демо-карта': 'demo map', 'кампания, миссия {n}': 'campaign, mission {n}', 'племён {n}': '{n} tribes', '{n} игр.': '{n} pl.',
  'игроков {a} из {b}': 'players {a} of {b}', 'зрителей {n}': 'observers {n}', 'хост {h}': 'host {h}', 'комната «{r}»': 'room "{r}"',
  'идёт игра · игроков {a} из {b}': 'in progress · players {a} of {b}', 'игроков {n}': 'players {n}', 'зрителей: {n}': 'observers: {n}',
  'пускает незнакомцев': 'strangers allowed', 'без зрителей': 'no observers', 'миссия {n}': 'mission {n}', 'сетевая {n}': 'skirmish {n}',
  '{n} игрок': '{n} player', '{n} игрока': '{n} players', '{n} игроков': '{n} players',
  // записи и реплеи
  'Записи партий': 'Replays', 'импорт': 'import', 'удалить все': 'delete all', 'РЕПЛЕЙ': 'REPLAY', 'выход': 'exit', 'выйти из просмотра': 'leave playback',
  'пауза / продолжить': 'pause / resume', 'скорость просмотра': 'playback speed', 'перемотка': 'seek',
  // статусы сетевой игры (js/net/игра.js)
  'в комнате «{r}» как игрок {n}': 'in room "{r}" as player {n}', 'вернулся в комнату «{r}» как игрок {n}': 'back in room "{r}" as player {n}',
  'карта не загрузилась: {e}': 'map failed to load: {e}', 'не всем хватило племён на этой карте': 'not enough tribes on this map for everyone',
  '{p} вышел': '{p} left', '{p} вернулся': '{p} is back', '{p} отключился — ждём его возвращения': '{p} disconnected — waiting for them',
  '{p} выбыл — его племя берёт ИИ': '{p} is out — the AI takes their tribe', 'ИИ взял {t}': 'AI took {t}', '{t} снова у человека': '{t} is human again',
  '{p} не ждёт {q} ({a} из {b})': "{p} won't wait for {q} ({a} of {b})", '{p} снова в игре с хода {n}': '{p} is back in the game from turn {n}',
  '{p} вступает за {t} с хода {n}': '{p} joins as {t} from turn {n}', '{p} смотрит партию с хода {n}': '{p} watches from turn {n}',
  '{p}: чтобы играть, войдите игроком': '{p}: to play, join as a player', '{p}: чтобы смотреть, войдите наблюдателем': '{p}: to watch, join as an observer',
  '{p} хочет играть, но комната закрыта для новых': '{p} wants to play, but the room is closed to new players',
  '{p} хочет играть, но свободных племён нет': '{p} wants to play, but there are no free tribes', '{p} входит в партию за {t}': '{p} joins the game as {t}',
  '{p} смотрит партию': '{p} is watching', '{p} разошёлся — шлю состояние': '{p} desynced — sending state', 'связь с релеем оборвалась': 'lost connection to the relay',
  'ошибка: {e}': 'error: {e}', 'в этой партии для меня нет места': 'no seat for me in this game', 'старт: миссия {n}, я наблюдаю': 'start: map {n}, observing',
  'старт: миссия {n}, я — {t}': 'start: map {n}, I am {t}', 'снимок не принят: {e}': 'snapshot rejected: {e}', 'состояние восстановлено с хода {n}': 'state restored from turn {n}',
  'партия началась': 'game started', '{p} разошёлся на ходу {n}': '{p} desynced at turn {n}', 'рассинхрон на ходу {n} — запрашиваю состояние у хоста': 'desync at turn {n} — requesting state from host',
  'ждём: {who}': 'waiting for: {who}', 'туман выключен': 'fog off', 'туман глазами {t}': 'fog as {t}', 'туман: всё, что открыли все игроки': 'fog: everything any player revealed',
  'МУЛЬТИПЛЕЕР': 'MULTIPLAYER', 'загрузка…': 'loading…', 'движок ': 'engine ', 'интерфейс…': 'interface…', 'интерфейс ': 'interface ', 'загрузка ': 'loading ',
  'рендер: ': 'render: ', 'условия миссии: ': 'mission check: ', 'идёт просмотр реплея': 'replay is playing', 'только в игре': 'only in game',
  'здесь нельзя: занято или непроходимо': 'not here: occupied or impassable', 'тираннозавр…': 'tyrannosaurus…', 'место занято': 'spot taken',
  'нет места в списке юнитов': 'unit list is full', 'тираннозавр на месте': 'tyrannosaurus placed', '(текст задания не загружен)': '(briefing not loaded)',
  'перевод не загрузился': 'translation failed to load', 'патруль: щёлкайте по карте точки маршрута': 'patrol: click route points on the map',
  'патруль: больше {n} точек нельзя': 'patrol: at most {n} points', 'патруль: точка {a} из {b}, ещё раз «патруль» — готово': 'patrol: point {a} of {b}, press "patrol" again when done',
  'патруль: {n} {w} — пошли': 'patrol: {n} {w} — go', 'точка': 'point', 'точки': 'points',
  'озвучка сюжета: вкл': 'story narration: on', 'озвучка сюжета: выкл': 'story narration: off', 'продолжить (P)': 'resume (P)', 'ПАУЗА': 'PAUSED',
  'Выйти к выбору уровня? Текущая партия не сохранится.': 'Go to level select? The current game will be lost.',
  'реплей: ': 'replay: ', 'реплей не сохранён: ': 'replay not saved: ', 'реплей не найден': 'replay not found', 'реплей: загрузка ресурсов…': 'replay: loading resources…',
  'реплей досмотрен: победа': 'replay finished: victory', 'реплей досмотрен: поражение': 'replay finished: defeat', 'реплей закончился': 'replay ended',
  'пока пусто — сыграй партию, она запишется сама': 'empty so far — play a game, it records itself', 'скачать файл .jwr': 'download .jwr file', 'удалить': 'delete',
  'Удалить все реплеи?': 'Delete all replays?', 'реплей загружен': 'replay imported', 'не удалось прочитать файл: ': 'could not read the file: ',
  'реплей сохранён: {name}, {d}': 'replay saved: {name}, {d}', 'перемотка на {d} за {ms} мс': 'seek to {d} in {ms} ms',
  'выбран один юнит': 'one unit selected',
  'создать игру': 'create game', 'новая игра': 'new game', 'как назовём?': 'name it', 'отмена': 'cancel',
  'вы хост': 'you are the host', 'готов': 'ready', 'не готов': 'not ready', 'ГОТОВ': 'READY', 'запустить': 'launch', 'отменить запуск': 'cancel launch',
  'старт через {n} с': 'starting in {n} s', 'запуск отменён': 'launch cancelled', 'выгнать': 'kick', 'хост выгнал вас из комнаты': 'the host kicked you out',
  'сдаться': 'surrender', 'наблюдатели': 'observers', 'сесть игроком': 'sit as player', 'мест для зрителей нет': 'no observer slots left', 'сторон в бою {n}': '{n} sides fighting', 'под ИИ {n}': 'AI-run {n}', 'бойцов': 'fighters', 'зданий': 'buildings', 'ИИ': 'AI', 'МОЁ МЕСТО': 'MY SEAT', 'занять': 'take',
  'войти в игру': 'join game', 'смотреть партию': 'watch the game','вернуться в игру': 'return to game', 'режим': 'mode', 'стартовые наборы по местам': 'start kits by slots', 'готовые армии карты': "map's armies", 'быстрый старт (100 000 еды, два юнита)': 'quick start (100,000 food, two units)',
  'цвет {n}': 'color {n}', 'компьютер': 'computer', 'закрыто': 'closed', 'свободно': 'open', 'сесть': 'sit', 'встать': 'leave slot', 'закрыть': 'close', 'открыть': 'open', 'компьютеров {n}': 'computers {n}', 'сдаться: племя отдаётся компьютеру, вы выходите': 'surrender: your tribe goes to the computer, you leave',
  'выйти без сдачи: остальные будут ждать вас или решат играть без вас': 'leave without surrendering: others will wait for you or vote to go on',
  'Сдаться? Племя перейдёт компьютеру.': 'Surrender? Your tribe goes to the computer.', 'Сдаться? Ваши войска и постройки погибнут.': 'Surrender? Your troops and buildings will be destroyed.', '{p} сдался': '{p} surrendered', 'сдаться: войска и постройки гибнут, вы выходите': 'surrender: troops and buildings die, you leave', 'общий чат': 'global chat', 'свободно · ИИ карты': 'open · map AI', 'чат комнаты': 'room chat', 'написать…': 'type a message…', 'скирмиш': 'skirmish', 'склада нет: мясо принимает только склад': 'no storehouse: only a storehouse takes meat', 'у выделенных ({n}) пустые руки: сначала T — собрать мясо': 'the selected ({n}) carry nothing: press T first to gather meat', 'пошли за мясом: {n}': 'going for meat: {n}', 'несут на склад: {n} ({m} мяса)': 'carrying to the store: {n} ({m} meat)', 'с пустыми руками: {n}': 'empty-handed: {n}', 'мяса рядом нет: некому и нечего нести ({n})': 'no meat nearby: nothing to carry ({n})', 'мозги: скрипт': 'brain: script', 'мозги: сеть бойца': 'brain: unit net', 'мозги: сеть тактика': 'brain: tactician net', 'мозги: обе сети': 'brain: both nets', 'сцены': 'scenes', 'сеть бойца, тактика и штаб скриптовые': 'unit net; tactics and HQ by the script', 'АИ тренировка': 'AI training', 'АИ тренировка: полсотни арен, на которых учится сеть бойца': 'AI training: fifty arenas where the unit net learns', 'сцена: загрузка ресурсов…': 'scene: loading resources…', 'сцены племени': 'tribe scenes', 'сцены тренировки нейронок: полсотни арен, на которых учится сеть бойца': 'neural-net training scenes: fifty arenas where the unit net learns', 'сцены племени: поведение компьютера на подготовленных положениях, идёт вживую': 'tribe scenes: the computer\u2019s behaviour in prepared situations, played live', 'Учебные сцены': 'Training scenes', 'запустить': 'start', 'мозги': 'brain', 'без врага': 'no enemy', '{n} шт. \u00b7 обе стороны ведёт компьютер, идёт вживую': '{n} scenes \u00b7 both sides run by the computer, played live', 'карта {m} \u00b7 ~{s} с': 'map {m} \u00b7 ~{s}s', 'сцена «{s}» \u00b7 {b} — {w}': 'scene “{s}” \u00b7 {b} — {w}', 'нет такой сцены': 'no such scene', 'учебные сцены: поведение компьютера на подготовленных положениях': 'training scenes: the computer\u2019s behaviour in prepared situations', 'показаны только учебные сцены': 'showing training scenes only', 'записи партий': 'game replays', 'компьютер: скрипт': 'computer: script', 'компьютер: стратег': 'computer: strategist', 'компьютер: нейронка': 'computer: neural net', 'компьютер: комдив': 'computer: group net', 'веса не скачались: ': 'weights failed to load: ', 'компьютерных мест нет': 'no computer seats', 'показать, какие мозги у компьютерных мест и что они решают прямо сейчас': 'show which brains the computer seats use and what they decide right now', 'нейросеть не загрузилась: {e}': 'neural net failed to load: {e}', 'играем скриптом: не подключилась {e}': 'playing with the script: {e} did not connect', 'сцена не запущена: не подключилась нейросеть — {e}': 'scene not started: the neural net did not connect — {e}', 'реплей пойдёт вразнос: не подключилась нейросеть — {e}': 'the replay will drift: the neural net did not connect — {e}', 'компьютер: родной': 'computer: original', 'скрипт': 'script', 'нейронка': 'neural net', 'родной': 'original', 'счёт': 'score', 'табло соперников: очки, еда, бойцы и постройки по племенам (как в Age of Empires)': 'rivals scoreboard: score, food, units and buildings per tribe (like in Age of Empires)', 'табло соперников: включено': 'rivals scoreboard: on', 'табло соперников: выключено': 'rivals scoreboard: off', 'табло: полное': 'scoreboard: full', 'широкое окно карты: включено': 'wide map view: on', 'табло: короткое': 'scoreboard: compact', 'табло: скрыто': 'scoreboard: hidden', 'веса сети бойца': 'unit net weights', 'веса сети тактика': 'tactician net weights', 'лёгкая': 'easy', 'обычная': 'normal', 'трудная': 'hard', 'миссия {m}, племя {t}, сложность {d}': 'mission {m}, tribe {t}, difficulty {d}', 'скорость ×3': 'speed ×3', 'обычная скорость': 'normal speed', 'скорость ×3: включена': 'speed ×3: on', 'ускорить игру втрое; в сетевой партии недоступно': 'run the game three times faster; not available in a network game', 'сдаться и сохранить реплей': 'surrender & save replay', 'выйти и сохранить реплей': 'quit & save replay', 'сдаться: войска и постройки гибнут, вы выходите; запись партии уйдёт на сервер': 'surrender: your troops and buildings die, you leave; the replay goes to the server', 'выйти без сдачи: остальные будут ждать вас или решат играть без вас; запись партии уйдёт на сервер': 'quit without surrender: the others will wait or play on without you; the replay goes to the server', 'все места — компьютер': 'all seats to the computer', 'свободные места занимает компьютер': 'free seats are taken by the computer', 'все свободные места — компьютер': 'every free seat goes to the computer', 'сначала закажите постройку в Святилище': 'order a building in the Sanctuary first', 'отметьте место постройки; правая кнопка — выйти': 'mark where to build; right button exits', 'место отмечено: строитель придёт сам': 'site marked: the builder will come on his own', 'стройка уже идёт: сначала достройте': 'a building is already in progress: finish it first', 'план снят': 'plan removed', 'плавное движение: вкл': 'smooth motion: on', 'плавное движение: выкл': 'smooth motion: off', 'плавное движение: юниты двигаются между шагами игры': 'smooth motion: units move between game steps', 'партия против компьютера': 'a game against the computer', 'сетевая игра': 'multiplayer', 'СКИРМИШ': 'SKIRMISH', 'Null Modem — партия против компьютера, Modem — игра по сети': 'Null Modem is a game against the computer, Modem plays online', 'скирмиш: выберите карту и соперников': 'skirmish: pick a map and opponents', 'скирмиш: партия против компьютера без сети': 'skirmish: a game against the computer, no network', 'общий': 'main', '{p} теперь зритель': '{p} is now an observer', '{p} теперь играет': '{p} is now playing', 'роль не принята: {e}': 'role rejected: {e}', 'в сети: {n}': 'online: {n}', 'нет связи с релеем': 'no link to the relay', 'зритель': 'observer', 'в комнате «{r}»': 'in room “{r}”', '{p} сдался — его племя берёт ИИ': '{p} surrendered — the AI takes their tribe', 'в сетевой партии нельзя': 'not in a network game', 'реплей сохранён: {name}, {d}': 'replay saved: {name}, {d}',
};
export function t(s, vars) {
  let r = (язык === 'ru' ? null : EN[s]) ?? s;
  if (vars) for (const k of Object.keys(vars)) r = r.split('{' + k + '}').join(String(vars[k]));
  return r;
}
const исходники = new WeakMap();
const подсказки = new WeakMap();     // поле → русский placeholder (атрибут, а не текстовый узел)     // узел → русский текст, чтобы переключать туда-обратно
/** Перевести всё статичное в документе: текстовые узлы и подсказки title. */
export function применитьЯзык(lang, root = document) {
  язык = lang === 'ru' ? 'ru' : 'en';
  const walk = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.nodeValue.trim() || !/[а-яА-ЯёЁ]/.test(исходники.get(n) ?? n.nodeValue)) continue;
    if (!исходники.has(n)) исходники.set(n, n.nodeValue);
    const src = исходники.get(n), lead = src.match(/^\s*/)[0], trail = src.match(/\s*$/)[0];
    n.nodeValue = lead + t(src.trim()) + trail;
  }
  for (const el of (root.body || root).querySelectorAll('[title]')) {
    if (!исходники.has(el)) исходники.set(el, el.title);
    el.title = t(исходники.get(el));
  }
  for (const el of (root.body || root).querySelectorAll('[placeholder]')) {   // подсказки в полях ввода (чат, имя комнаты)
    if (!подсказки.has(el)) подсказки.set(el, el.placeholder);
    el.placeholder = t(подсказки.get(el));
  }
}
