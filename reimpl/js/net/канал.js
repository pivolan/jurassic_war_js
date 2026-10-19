// Канал сетевой игры (наше): веб-сокет до релея, комнаты, ходы и снимки.
//
// Релей — tools/net_server.mjs, он пересылает сообщения всем в комнате, включая отправителя.
// Значит у всех один и тот же поток в одном и том же порядке, и «своей истории» ни у кого нет.
// Номер игрока проставляет сервер: клиент его не выбирает и подделать не может.
//
// Двоичное сообщение — снимок состояния: [кому: 1 байт, 0xff — всем][ход: u32][таймер: u32][память].
// Ход — в начале какого хода снят, таймер — [0x46c] хоста в тот момент (он вне области снимка,
// а от него считается второй ГСЧ).
//
// Работает одинаково в браузере и в Node 22 — WebSocket там и там есть в глобальных.
export const ШАПКА = 9;

export class Канал {
  constructor(адрес) {
    this.адрес = адрес;
    this.ws = null;
    this.игрок = null;
    this.хост = null;
    this.участники = [];
    this.вернулся = false;     // релей узнал наш ключ: мы возвращаемся на своё место
    this.наХод = null;         // (пакет) — пришёл ход
    this.наСостав = null;      // (состав) — кто в комнате; состав.ушёл — кто только что вышел
    this.наСнимок = null;      // (Uint8Array, { кому, ход, таймер, от }) — пришёл снимок состояния
    this.наСлужебное = null;   // всё прочее (лобби, старт, запрос снимка, обрыв)
  }

  подключиться(комната, имя, ключ = null, роль = 'игрок') {
    this.комната = комната; this.имя = имя;
    return new Promise((готово, беда) => {
      let ws;
      try { ws = new WebSocket(this.адрес); } catch (e) { беда(new Error('канал: плохой адрес ' + this.адрес)); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws; this.очередь = [];
      ws.onopen = () => ws.send(JSON.stringify({ вид: 'войти', комната, имя, ключ, роль }));
      ws.onerror = () => беда(new Error('канал: не удалось подключиться к ' + this.адрес));
      ws.onclose = () => { this.закрыт = true; if (this.наСлужебное) this.наСлужебное({ вид: 'обрыв' }); };
      // До «ты» (нашего номера) ничего не разбираем: состав и старт могут прийти в том же куске
      // TCP, что и «ты», раньше, чем обвязка успеет запомнить канал. Копим и разбираем после.
      ws.onmessage = (e) => {
        if (this.закрыт) return;
        if (this.игрок === null) {
          if (typeof e.data === 'string') { let об; try { об = JSON.parse(e.data); } catch { return; }
            if (об.вид === 'ты') { this.игрок = об.игрок; this.вернулся = !!об.вернулся; this.роль = об.роль || 'игрок'; готово(this); const о = this.очередь; this.очередь = []; for (const d of о) this.разбор(d); return; }
            if (об.вид === 'отказ') { this.закрыт = true; try { ws.close(); } catch {} беда(new Error(об.текст || 'релей не пустил')); return; } }
          this.очередь.push(e.data); return;
        }
        this.разбор(e.data);
      };
    });
  }

  разбор(данные) {
    try { this.разбор2(данные); }
    catch (e) { console.error('канал: ошибка в обработчике', e); if (this.наСлужебное) this.наСлужебное({ вид: 'ошибка', текст: String(e && e.message || e) }); }
  }
  разбор2(данные) {
    if (typeof данные !== 'string') {
      const b = new Uint8Array(данные);
      if (b.length < ШАПКА) return;
      const dv = new DataView(b.buffer, b.byteOffset, ШАПКА);
      const кому = b[0], ход = dv.getUint32(1, true), таймер = dv.getUint32(5, true);
      if (кому !== 0xff && кому !== this.игрок) return;
      if (this.наСнимок) this.наСнимок(b.subarray(ШАПКА), { кому, ход, таймер });
      return;
    }
    let об; try { об = JSON.parse(данные); } catch { return; }
    if (об.вид === 'состав') {
      this.хост = об.хост; this.участники = об.участники;
      const я = об.участники.find(у => у.игрок === this.игрок); if (я) this.роль = я.роль;   // роль меняется на месте, без входа заново
      if (this.наСостав) this.наСостав(об);
      return;
    }
    if (об.вид === 'ход') { if (this.наХод) this.наХод(об); return; }
    if (this.наСлужебное) this.наСлужебное(об);
  }

  /** Попросить релей сменить роль (игрок ⇄ наблюдатель) в этом же соединении. */
  ролью(роль) { this.послать({ вид: 'роль', роль }); }
  /** Отправить пакет хода. Номер игрока проставит сервер. */
  ход(пакет) { this.послать(пакет); }
  послать(об) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(об)); }

  /** Разослать снимок состояния. кому = 0xff — всем. */
  снимок(данные, { кому = 0xff, ход = 0, таймер = 0 } = {}) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const п = new Uint8Array(данные.length + ШАПКА);
    п[0] = кому;
    const dv = new DataView(п.buffer, 0, ШАПКА);
    dv.setUint32(1, ход >>> 0, true); dv.setUint32(5, таймер >>> 0, true);
    п.set(данные, ШАПКА);
    this.ws.send(п.buffer);
  }

  закрыть() {
    this.закрыт = true; const ws = this.ws; this.ws = null;
    if (!ws) return;
    ws.onmessage = ws.onclose = ws.onerror = null;
    try { if (ws.readyState === 0 || ws.readyState === 1) ws.close(); } catch {}
  }
  get яХост() { return this.игрок !== null && this.игрок === this.хост; }
  get открыт() { return !!this.ws && this.ws.readyState === 1; }
}
