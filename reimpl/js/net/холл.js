// Холл релея (наше): общий чат и список «кто в сети» для панели мультиплеера. Отдельный
// сокет от игрового канала — в списке комнат канала ещё нет, а в комнате общий чат нужен рядом
// с чатом комнаты. Протокол: → {вид:'привет', имя, комната?} (и повторно при смене имени или
// комнаты), → {вид:'чат', текст}; ← {вид:'онлайн', люди:[{имя, комната}]}, ← {вид:'чат', имя, текст, t}.
export class Холл {
  constructor(адрес) {
    this.адрес = адрес; this.ws = null; this.связь = false; this.нужен = true;
    this.имя = ''; this.комната = null;
    this.наОнлайн = null; this.наЧат = null; this.наСвязь = null;
  }
  подключить() {
    if (!this.нужен || (this.ws && this.ws.readyState <= 1)) return;
    let ws; try { ws = new WebSocket(this.адрес); } catch { return this.позже(); }
    this.ws = ws;
    ws.onopen = () => { this.связь = true; this.наСвязь?.(true); this.привет(this.имя, this.комната); };
    ws.onmessage = (e) => { if (typeof e.data !== 'string') return; let об; try { об = JSON.parse(e.data); } catch { return; }
      if (об.вид === 'онлайн') this.наОнлайн?.(об.люди || []);
      else if (об.вид === 'чат') this.наЧат?.(об); };
    ws.onclose = ws.onerror = () => { if (this.ws !== ws) return; this.ws = null; if (this.связь) { this.связь = false; this.наСвязь?.(false); } this.позже(); };
  }
  позже() { if (this.нужен && !this.таймер) this.таймер = setTimeout(() => { this.таймер = null; this.подключить(); }, 5000); }
  /** Назваться (и сказать, в какой комнате сидим); шлётся сразу, если связь есть, иначе при подключении. */
  привет(имя, комната = null) {
    this.имя = имя; this.комната = комната;
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ вид: 'привет', имя, комната }));
  }
  сказать(текст) { if (this.ws && this.ws.readyState === 1 && текст.trim()) this.ws.send(JSON.stringify({ вид: 'чат', текст: текст.slice(0, 300) })); }
  закрыть() { this.нужен = false; clearTimeout(this.таймер); this.таймер = null; const ws = this.ws; this.ws = null; try { ws?.close(); } catch {} }
}
