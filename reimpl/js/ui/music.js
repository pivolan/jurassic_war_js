// Музыка: 20 треков пака 07 (Amiga MOD), перекодированные в AAC — out/audio, tools/mod2m4a.sh.
// Служебные номера (по внутренним заголовкам модулей): 15 победа, 16 поражение, 17 экран сюжета,
// 18 титры, 19 выбор племени, 20 заставка; 1..14 — боевые темы миссий.
export const TRACK = { title: 20, clan: 19, story: 17, victory: 15, defeat: 16, ending: 18 };
export const BATTLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** Следующая боевая тема по кругу. */
export const следующаяБоевая = (n) => { const i = BATTLE.indexOf(n); return BATTLE[(i < 0 ? 0 : i + 1) % BATTLE.length]; };

const DUCK = 0.3;                         // во сколько раз тише музыка, пока читается рассказ

export class Music {
  /** @param el элемент <audio>; @param data reimpl/data/music.json */
  constructor(el, data) {
    this.el = el; this.tracks = data?.tracks || []; this.n = 0; this.pending = null;
    this.el.volume = this.volume = +(localStorage.getItem('jw.musvol') ?? 0.5);
    this.on = localStorage.getItem('jw.mus') !== '0';
    this.repeat = true; this.shuffle = false;
    // Что сейчас звучит: экранная тема (меню, брифинг, итог) или боевая. Экранную повторяем,
    // а в бою по кругу идут боевые: раньше одна и та же тема крутилась всю партию.
    this.бой = false;
    this.el.addEventListener('ended', () => this.onEnded());
    // Браузер не даёт запустить звук до первого действия человека — доигрываем отложенное.
    const kick = () => { if (this.pending != null) { const n = this.pending; this.pending = null; this.play(n); } };
    addEventListener('pointerdown', kick, true); addEventListener('keydown', kick, true);
  }
  info(n) { return this.tracks.find(t => t.n === n) || null; }
  name(n) { const t = this.info(n); return t?.name || t?.mod?.replace(/\.MOD$/i, '') || ('Track ' + n); }

  /** Боевая тема: ставим сразу и помечаем, что дальше идут боевые по кругу. */
  бойТрек(n) { this.бой = true; this.play(n); }
  /** Экранная тема (меню, брифинг, итог): повторяется сама по себе. */
  экранТрек(n) { this.бой = false; this.play(n); }

  play(n, { force = false } = {}) {
    if (!this.on) { this.n = n; return; }
    if (!force && this.n === n && !this.el.paused) return;
    this.n = n; const t = this.info(n); if (!t) return;
    this.el.src = '../../audio/' + t.file; this.el.loop = false;
    this.el.play().catch(() => { this.pending = n; });      // до первого клика браузер откажет
  }
  stop() { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); this.pending = null; }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.el.volume = this.volume * (this.ducked ? DUCK : 1); localStorage.setItem('jw.musvol', this.volume); }
  /** Приглушить под рассказ: в оригинале на брифинге вместо музыки играла речь (пак 12),
   *  у нас музыка остаётся, но уходит на задний план. Ползунок громкости при этом не трогается. */
  duck(on) { this.ducked = !!on; this.el.volume = this.volume * (on ? DUCK : 1); }
  setOn(on) { this.on = on; localStorage.setItem('jw.mus', on ? '1' : '0'); if (!on) this.stop(); else if (this.n) this.play(this.n, { force: true }); }
  onEnded() {
    if (this.shuffle) return this.play(BATTLE[Math.floor(Math.random() * BATTLE.length)], { force: true });
    if (this.бой) return this.play(следующаяБоевая(this.n), { force: true });
    if (this.repeat) return this.play(this.n, { force: true });
    this.play(this.n % this.tracks.length + 1, { force: true });
  }
}
