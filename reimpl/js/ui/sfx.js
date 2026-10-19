// Звуковые эффекты. Движок уже считает всё, что нужно: порт функции 0x2000d кладёт заявку в
// очередь 0x38870 + id*8 (u32 id, u16 громкость слева, u16 справа — с затуханием по расстоянию
// и панорамой по положению относительно экрана), а в конце шага 0x200fe очередь опустошается.
// Здесь остаётся только достать заявки и проиграть сэмплы.
//
// Сэмплы — пак 06 (_PWAR06.TRW): 110 записей, 8 бит без знака, 11025 Гц, моно. Перекодировать
// их не нужно, PCM разворачивается в AudioBuffer напрямую.
import { arch } from './screen.js';

const QUEUE = 0x38870, QN = 0x6f;

// Выбор варианта голоса («какой из четырёх окриков сказать») — свой генератор, не движковый.
// В оригинале здесь дёргался общий ГСЧ 0x204a6 (состояние 0x393a4), и из-за этого поток
// случайных чисел зависел от того, включён ли звук и сколько игрок кликал по юнитам. На саму
// игру это не влияет (единственный живой потребитель 0x204a6 — расстановка врагов ИИ при
// загрузке миссии), но это мина: любой будущий код, который возьмёт из 0x204a6 число во время
// партии, станет звукозависимым, а записи партий — невоспроизводимыми. Поэтому голоса живут
// на отдельном потоке и память движка не трогают вообще. См. ROADMAP §7a.
let voiceSeed = 0x9e3779b9;
export function voiceRand(n) {
  voiceSeed ^= voiceSeed << 13; voiceSeed ^= voiceSeed >>> 17; voiceSeed ^= voiceSeed << 5; voiceSeed >>>= 0;
  return n > 0 ? voiceSeed % n : 0;
}

export class Sfx {
  constructor() { this.ctx = null; this.master = null; this.files = null; this.pack = null; this.buf = new Map(); this.live = 0; this.on = false; }
  attach(files, pack = '_PWAR06.TRW') { this.files = files; this.pack = pack; this.on = !!files[pack]; }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = this.volume; }

  /** Контекст создаётся лениво: до первого действия человека браузер звук не пустит. */
  ready() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume ?? (+(localStorage.getItem('jw.sfxvol') ?? 6) - 1) / 9;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  buffer(id) {
    if (this.buf.has(id)) return this.buf.get(id);
    let b = null;
    try {
      const a = arch(this.files, this.pack); const e = a.entries[id];
      if (e && e.size > 1) {
        const pcm = a.data(id);
        b = this.ctx.createBuffer(1, pcm.length, e.rate || 11025);
        const ch = b.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] - 128) / 128;   // 8 бит без знака
      }
    } catch { b = null; }
    this.buf.set(id, b); return b;
  }

  /** l, r — громкости каналов 0..15, как их посчитал движок. */
  play(id, l = 15, r = 15) {
    if (!this.on || !this.ready() || this.live > 12) return;
    const b = this.buffer(id); if (!b) return;
    const src = this.ctx.createBufferSource(); src.buffer = b;
    const gl = this.ctx.createGain(), gr = this.ctx.createGain();
    gl.gain.value = l / 15; gr.gain.value = r / 15;
    const merge = this.ctx.createChannelMerger(2);
    src.connect(gl).connect(merge, 0, 0); src.connect(gr).connect(merge, 0, 1);
    merge.connect(this.master);
    this.live++; src.onended = () => { this.live--; };
    src.start();
  }

  /** Проиграть всё, что движок положил в очередь за шаг (вызывается перед её очисткой). */
  flush(m) {
    if (!this.on) return;
    for (let i = 0; i < QN; i++) {
      const q = QUEUE + i * 8; if (m.u32(q) === 0) continue;
      this.play(i, m.u16(q + 4), m.u16(q + 6));
    }
  }
}
