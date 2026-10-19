// Озвучка сюжетных текстов: брифинг стадии и описание племени на экране выбора клана.
//
// Файлы делает tools/tts_story.py (русский и английский — ElevenLabs, польский — Gemini TTS через
// Vertex; у каждого племени свой голос) и кладёт в out/audio/story/<язык>, а сайт отдаёт их по /jw/audio/. Голос идёт мимо
// оригинального звука: музыку и эффекты играет js/ui/music.js и js/ui/sfx.js, а тут обычный
// <audio> — так рассказ можно приглушить или выключить, не трогая остальное.
//
// Автозапуск браузер разрешает не всегда: если play() отклонён, ждём первого касания и
// начинаем с него — иначе на телефоне рассказ молчал бы вообще.
const БАЗА = '../../audio/story/';
// Метка версии дорожек: файлы перезаписываются на месте, без неё браузер играл бы старые из кэша.
const ВЕРСИЯ = '20261003';

export class Narration {
  constructor(el) {
    this.el = el; this.on = localStorage.getItem('jw.narr') !== '0';
    this.volume = +(localStorage.getItem('jw.narrvol') ?? 0.9);
    this.el.volume = this.volume;
    this.cur = null; this.pending = null; this.done = null;
    // Дочитанную дорожку помним: иначе покадровая проверка тут же запустила бы её заново.
    this.el.addEventListener('ended', () => { this.done = this.cur; });
    const пуск = () => { if (this.pending) { const u = this.pending; this.pending = null; this.play(u, true); } };
    addEventListener('pointerdown', пуск, { passive: true });
    addEventListener('keydown', пуск);
  }
  setOn(v) { this.on = !!v; localStorage.setItem('jw.narr', v ? '1' : '0'); if (!v) this.stop(); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.el.volume = this.volume; localStorage.setItem('jw.narrvol', this.volume); }

  /** Проиграть дорожку; повторный вызов с тем же именем ничего не сбрасывает.
   *  Обе функции можно звать хоть каждый кадр — при совпадении они ничего не делают. */
  play(name, force = false) {
    if (!this.on) return;
    const url = БАЗА + name + '.mp3?v=' + ВЕРСИЯ;
    if (!force && (this.done === url || (this.cur === url && (!this.el.paused || this.pending)))) return;
    this.cur = url; this.pending = null; this.el.src = url; this.el.currentTime = 0;
    this.el.play().catch(() => { this.pending = name; });   // ждём первого касания
  }
  stop() {
    if (!this.cur && !this.pending) return;
    this.pending = null; this.cur = null; this.done = null;
    try { this.el.pause(); this.el.removeAttribute('src'); } catch {}
  }
}
