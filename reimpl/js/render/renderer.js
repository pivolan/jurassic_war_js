// Рендер: порт функций отрисовки оригинала. Сцена — js/render/scene.js; мини-карта/курсор — js/render/hud.js; боковая панель — js/render/panel.js.
import { F, call } from '../fn.js'; import './scene.js'; import { fixSlotPointers, drawScene, SCENE_FULL, SCENE_TICK, FB } from './scene.js'; import { panelPreTick, hudAfterScene } from './panel.js'; import { fixFontPointers } from './text.js';

export class Renderer {
  constructor(eng, fb, files) { this.eng = eng; this.fb = fb; this.files = files; fixSlotPointers(eng.m); fixFontPointers(eng.m); }
  // `поверхКадра` — наш крючок между «кадр нарисован» и «кадр ушёл в видеопамять»: всё, что
  // рисуется шрифтом игры поверх сцены (подсказка по предмету), должно попасть сюда, иначе
  // flip() скопирует буфер раньше и надпись не увидит никто.
  // Сдвиг базы под панель делают сами панельные блиттеры (js/render/scene.js, сПанельнойБазой),
  // поэтому здесь порядок такой же, как был в оригинале, и знать про широкое окно рендеру не надо.
  drawFull() { const e = this.eng;
    panelPreTick(e); call(e, 0x2661c, {}); drawScene(e, SCENE_FULL);
    hudAfterScene(e, true); this.поверхКадра?.(e); this.flip(); }
  drawTick() { const e = this.eng;
    panelPreTick(e); drawScene(e, SCENE_TICK);
    hudAfterScene(e, false); this.поверхКадра?.(e); this.flip(); }
  flip() { this.eng.vram = this.fb.px; call(this.eng, 0x299b4, {}); this.fb.pal.set(this.eng.m.b.subarray(0x44980, 0x44980 + 768)); } // 0x299b4: курсор + буфер → VRAM (hud.js)
}
