// Кадровый буфер 640x480, 8 бит (индексы палитры), как VRAM оригинала
export class FrameBuffer {
  constructor(w = 640, h = 480) {
    this.w = w; this.h = h; this.px = new Uint8Array(w * h); this.pal = new Uint8Array(768);
    // Палитра в упакованном виде: один dword на индекс. Пересобирается, только когда байты
    // палитры действительно изменились (её крутит анимация воды и меняют экраны оболочки).
    this.pal32 = new Uint32Array(256); this._palSum = -1;
  }
  _syncPal() {
    let sum = 0; const p = this.pal; for (let i = 0; i < 768; i += 7) sum = (sum + p[i] * (i + 1)) | 0;
    if (sum === this._palSum) return; this._palSum = sum;
    for (let i = 0; i < 256; i++) { const o = i * 3;
      this.pal32[i] = LE ? (0xff000000 | (p[o + 2] << 16) | (p[o + 1] << 8) | p[o])
                         : ((p[o] << 24) | (p[o + 1] << 16) | (p[o + 2] << 8) | 0xff); }
  }
  /** Развернуть кадр прямо в ImageData канвы — без выделения памяти на каждом кадре. */
  blitTo(imageData) {
    this._syncPal();
    const out = this._u32 && this._u32.buffer === imageData.data.buffer ? this._u32
      : (this._u32 = new Uint32Array(imageData.data.buffer));
    const px = this.px, pal = this.pal32, n = px.length;
    for (let i = 0; i < n; i++) out[i] = pal[px[i]];
  }
  toRGBA() { const out = new Uint8ClampedArray(this.w * this.h * 4); for (let i = 0; i < this.px.length; i++) { const p = this.px[i] * 3; out[i * 4] = this.pal[p]; out[i * 4 + 1] = this.pal[p + 1]; out[i * 4 + 2] = this.pal[p + 2]; out[i * 4 + 3] = 255; } return out; }
}
// Порядок байт в Uint32Array: на всех целевых платформах little-endian, но проверяем честно.
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
