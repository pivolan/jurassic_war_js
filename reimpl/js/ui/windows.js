// Всплывающие окна оболочки: опции, звук, сохранение и загрузка.
// Каждое окно — семейство спрайтов пака 02 по 8 вариантов (скин по племени игрока):
// первый спрайт блока — сама рамка с уже нарисованными подписями, дальше пары
// «обычная/нажатая» для кнопок, последний — палочка 1x10 (движок ползунка). Прямоугольники
// элементов внутри окна — data/ui_screens.json (families).
export const WINDOWS = {
  options: { key: 'game_option',    base: 444, stride: 6,  w: 312, h: 156, knob: 5, pos: [162, 179],
    btn: { sound_controls: 1, ok: 3 } },
  sound:   { key: 'sound_controls', base: 492, stride: 16, w: 312, h: 237, knob: 15, pos: [162, 153],
    btn: { stop: 1, play: 3, shuffle: 5, repeat: 7, ok: 9, page_up: 11, page_down: 13 } },
  load:    { key: 'load_dialog',    base: 284, stride: 9,  w: 238, h: 218,
    btn: { load: 1, cancel: 3, page_up: 5, page_down: 7 } },
  save:    { key: 'save_dialog',    base: 356, stride: 11, w: 238, h: 218,
    btn: { save: 1, delete: 3, cancel: 5, page_up: 7, page_down: 9 } },
};
// Положение окна: у Game Option и Sound Controls координаты элементов прошиты в образе
// (записи виджетов 0x397f3 и 0x39924, экранные), из них и получен левый верхний угол —
// по вертикали окна стоят не по центру. Для Load/Save записей не нашлось, там центр.
export const winPos = (w) => ({ x: w.pos ? w.pos[0] : (640 - w.w) >> 1, y: w.pos ? w.pos[1] : (480 - w.h) >> 1 });

/** Дорожка ползунка → значение min..max (движок/заполнение рисуется по левому краю дорожки). */
export const sliderValue = (zone, x, min, max) =>
  Math.max(min, Math.min(max, min + Math.round((x - zone.x) / (zone.w - 1) * (max - min))));
/** Сколько «палочек» шириной 1 через 2 px заполняют дорожку при значении v (как в 0x20c54). */
export const barTicks = (zone, v, min, max) =>
  Math.max(0, Math.min(zone.w >> 1, Math.round((v - min) / (max - min) * (zone.w >> 1))));
