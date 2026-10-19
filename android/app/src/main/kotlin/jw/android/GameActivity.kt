package jw.android

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.Bundle
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import jw.*
import org.json.JSONObject
import java.util.zip.GZIPInputStream
import kotlin.concurrent.thread

/**
 * Оболочка Android: экран, ввод и загрузка ресурсов. Вся игра живёт в модуле :core и про Android
 * ничего не знает — тот же приём, что в браузерной версии.
 *
 * Что уже работает: архивы распаковываются, миссия загружается (состояние сходится с JS-портом
 * побайтово), сцена рисуется портированным кодом оригинала — земля, предметы, юниты, здания,
 * деревья и туман войны. Область карты совпадает с кадром эмулятора DOS попиксельно.
 * Карту можно возить пальцем, миссию и племя — переключать касанием.
 *
 * Управление: тап по своему бойцу выделяет его, тап по земле уводит выделенных туда, тап по
 * чужому — приказ атаки. Кнопка «рамка» переводит ведение пальцем в выделение прямоугольником,
 * иначе палец возит карту. Все приказы идут через «ожидающий приказ» оригинала (0x31acc) и его
 * очередь — тот же путь, что у мыши в DOS.
 *
 * Чего ещё нет: боковой панели, курсора, эффектов заклинаний, ИИ компьютерных игроков.
 */
class GameActivity : Activity(), SurfaceHolder.Callback {
    private lateinit var surface: SurfaceView
    private val bitmap: Bitmap = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888)
    private val pixels = IntArray(640 * 480)
    private val palette = IntArray(256)
    private val paint = Paint().apply { isFilterBitmap = false }
    @Volatile private var running = false
    private var loop: Thread? = null

    private val mem = Mem.ofSize()
    private var boot: ByteArray = ByteArray(0)
    private var files: Map<String, ByteArray> = emptyMap()
    @Volatile private var eng: Engine? = null
    @Volatile private var статус = "загрузка ресурсов…"
    @Volatile private var кадрГотов = false
    @Volatile private var сбой: String? = null
    private var кадрНаЭкране = Rect(0, 0, 1, 1)               // куда лёг весь кадр 640x480
    private val кнопки = ArrayList<Pair<Rect, String>>()      // прямоугольник и подпись
    private var рамка: Rect? = null
    @Volatile private var подсказка = "тап — выбрать, двумя пальцами — вести карту"

    // Прокрутка двумя пальцами: центр «стика» ставится там, где легли пальцы, направление даёт
    // смещение, скорость постоянная. Дробные пиксели копим — камера обязана быть кратна 32.
    private var стик: Pair<Float, Float>? = null
    @Volatile private var стикСмещение = 0f to 0f
    private var накопX = 0f
    private var накопY = 0f
    private var времяПрокрутки = 0L
    private val СКОРОСТЬ = 560f                               // пикселей карты в секунду на максимуме
    private val РАДИУС = 90f                                  // на сколько увести палец до полной скорости

    @Volatile private var вМеню = true
    private var меню: Menu? = null
    private var палитраИгры: ByteArray? = null      // чтобы вернуться в партию с её палитрой
    private var миссия = 0
    private var племя = 0
    private var сложность = 1
    private val ПЛЕМЕНА = arrayOf("Tyrano", "Ka-noo-se", "Romack", "Masai", "Moospell", "Koomba", "Radumba", "Koaka")
    private val СЛОЖНОСТИ = arrayOf("лёгкая", "обычная", "тяжёлая")

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        window.decorView.systemUiVisibility =
            android.view.View.SYSTEM_UI_FLAG_FULLSCREEN or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        surface = SurfaceView(this)
        surface.holder.addCallback(this)
        setContentView(surface)
        thread(name = "jw-assets") { загрузитьРесурсы() }
    }

    /**
     * Ассеты кладутся в APK сжатыми, но упаковщик Android часть из них разворачивает сам и
     * отрезает расширение. Поэтому имя пробуем в обоих видах, а способ распаковки определяем
     * по первым байтам, а не по названию файла.
     */
    private fun актив(имя: String): ByteArray {
        val сырой = try { assets.open(имя) } catch (_: Throwable) { assets.open("$имя.gz") }
            .use { it.readBytes() }
        if (сырой.size > 2 && (сырой[0].toInt() and 0xff) == 0x1f && (сырой[1].toInt() and 0xff) == 0x8b)
            return GZIPInputStream(сырой.inputStream(), 1 shl 16).use { it.readBytes() }
        if (сырой.size > 2 && (сырой[0].toInt() and 0xff) == 0x78)                 // zlib, как boot_snap
            return java.util.zip.InflaterInputStream(сырой.inputStream()).use { it.readBytes() }
        return сырой
    }

    private fun загрузитьРесурсы() {
        try {
            статус = "снимок движка…"
            boot = актив("boot_snap.bin.z")
            статус = "архивы игры…"
            files = mapOf(
                "_PWAR01.TRC" to актив("_PWAR01.TRC"),
                "_PWAR02.TRS" to актив("_PWAR02.TRS"),         // экраны меню и колесо
                "_PWAR08.TRC" to актив("_PWAR08.TRC"),
                "_PWAR05.TRS" to актив("_PWAR05.TRS"),         // спрайты по племенам
                "_PWAR09.TRC" to актив("_PWAR09.TRC"),
            )
            статус = "меню…"
            меню = Menu(mem, JSONObject(String(актив("ui_screens.json"), Charsets.UTF_8)))
            Jw.registerAll()
            // Меню рисуется в кадровый буфер оригинала, а таблица начал строк 0x122e74 лежит в
            // снимке движка — без него все строки кадра ушли бы в нулевое смещение (полосы).
            mem.set(0x30000, boot)
            mem.w32(0x46c, 110)
            Sprites.fixSlotPointers(mem)
            статус = "новая игра — колесо в центре"
        } catch (e: Throwable) {
            статус = "ошибка загрузки: ${e.message}"
        }
    }

    private fun открытьМиссию() {
        статус = "миссия ${миссия + 1}, ${ПЛЕМЕНА[племя]}…"
        кадрГотов = false
        eng = null
        mem.b.fill(0)
        mem.set(0x30000, boot)
        mem.w32(0x46c, 110)
        Sprites.fixSlotPointers(mem)          // ровно один раз на каждое восстановление снимка
        val e = Loader.loadMission(mem, files, миссия, племя, сложность)
        // Поставим камеру на первого своего юнита, иначе экран начинается в неразведанном углу
        val мой = mem.u8(0x31b64)
        var i = mem.u32(G.unitHead)
        while (i != 0) {
            if (mem.u8(UNITS + i + U.OWNER) == мой && (mem.u8(UNITS + i + U.FLAGS5B) and 1) == 0) {
                val x = mem.u16(UNITS + i + U.X) - mem.u32(Render.VW) / 2
                val y = mem.u16(UNITS + i + U.Y) - 240
                mem.w32(Render.CAMX, 0); mem.w32(Render.CAMY, 0)
                Render.scroll(mem, x, y)
                break
            }
            i = mem.u32(UNITS + i + U.NEXT)
        }
        call(e, 0x2661c)                      // нарисовать боковую панель целиком
        Hud.afterScene(e, true)
        eng = e
        вМеню = false
        статус = "миссия ${миссия + 1} · ${ПЛЕМЕНА[племя]} · ${СЛОЖНОСТИ[сложность]}"
    }

    override fun surfaceCreated(h: SurfaceHolder) {
        running = true
        loop = thread(name = "jw-loop") { цикл(h) }
    }

    override fun surfaceChanged(h: SurfaceHolder, f: Int, w: Int, ht: Int) {}

    override fun surfaceDestroyed(h: SurfaceHolder) {
        running = false
        loop?.join(800)
    }

    /**
     * Шаг симуляции идёт по расписанию оригинала — 18.2 раза в секунду, как тик таймера BIOS;
     * кадр рисуется чаще. Порт неполон, поэтому пропущенные функции копятся в eng.todo и их
     * число видно в строке состояния — это честный указатель, чего ещё нет.
     */
    private fun цикл(h: SurfaceHolder) {
        var следующийШаг = System.nanoTime()
        val шагНс = 55_000_000L
        while (running) {
            val м = меню
            if (вМеню && м != null) {
                synchronized(mem) { м.draw(files); Render.toArgb(mem, pixels, palette) }
                bitmap.setPixels(pixels, 0, 640, 0, 0, 640, 480)
                кадрГотов = true
            }
            val e = eng
            if (!вМеню && e != null) {
                прокрутитьСтиком()
                synchronized(mem) {
                    var шагов = 0
                    while (System.nanoTime() >= следующийШаг && шагов < 4) {
                        try { e.timer = e.timer + 1; e.tick() } catch (t: Throwable) { сбой = t.toString().take(60) }
                        следующийШаг += шагНс; шагов++
                    }
                    if (шагов == 0 && System.nanoTime() > следующийШаг + шагНс * 8) следующийШаг = System.nanoTime()
                    Hud.preTick(e)
                    Scene.draw(e)
                    Hud.afterScene(e, false)
                    Render.toArgb(mem, pixels, palette)
                }
                bitmap.setPixels(pixels, 0, 640, 0, 0, 640, 480)
                кадрГотов = true
            }
            val c = h.lockCanvas() ?: continue
            try { нарисовать(c) } finally { h.unlockCanvasAndPost(c) }
            Thread.sleep(16)
        }
    }

    /**
     * Портрет: карта занимает верх экрана во всю ширину, снизу остаётся полоса под управление —
     * ровно та же раскладка, что в браузерной версии на телефоне. Ширина окна карты берётся из
     * [0x488c4]: справа от него в оригинале боковая панель, её порт пока не рисует.
     */
    private fun нарисовать(c: Canvas) {
        c.drawColor(Color.BLACK)
        if (вМеню) { менюНаЭкран(c); return }
        // Кадр оригинала целиком: слева карта (0..[0x488c4]), справа боковая панель.
        val k = minOf(c.width / 640f, c.height * 0.72f / 480f)
        val w = (640 * k).toInt(); val ht = (480 * k).toInt()
        val x = (c.width - w) / 2
        кадрНаЭкране = Rect(x, 0, x + w, ht)
        if (кадрГотов) c.drawBitmap(bitmap, Rect(0, 0, 640, 480), кадрНаЭкране, paint)
        else {
            paint.color = Color.rgb(40, 34, 28)
            c.drawRect(кадрНаЭкране, paint)
        }
        paint.color = Color.rgb(28, 24, 20)
        c.drawRect(Rect(0, ht, c.width, c.height), paint)
        paint.textSize = 13f * resources.displayMetrics.density
        paint.textAlign = Paint.Align.CENTER
        if (!кадрГотов) {
            paint.color = Color.rgb(232, 192, 125)
            c.drawText("Jurassic War", c.width / 2f, c.height / 2f - 20, paint)
        }
        pometkiВыделения(c)
        val e = eng
        val выд = if (e == null) 0 else synchronized(mem) { Ui.selectedCount(mem) }
        val вторая = if (e == null) подсказка else
            "шаг ${mem.u32(G.step)} · выделено $выд" +
            (if (e.todo.isEmpty()) "" else " · нет ${e.todo.size} функций") + (сбой?.let { " · $it" } ?: "")
        paint.textAlign = Paint.Align.CENTER
        var низ = кадрНаЭкране.bottom + 13f * resources.displayMetrics.density
        низ = строка(c, статус, низ, 13f, Color.rgb(232, 192, 125))
        низ = строка(c, вторая, низ, 12f, Color.rgb(232, 192, 125))
        низ = строка(c, подсказка, низ, 11f, Color.rgb(141, 130, 116))
        кнопкиНарисовать(c, низ + 6f)
    }

    /** Строка по центру, ужатая до ширины экрана: подписи длинные, а телефон узкий. */
    private fun строка(c: Canvas, текст: String, y: Float, кегль: Float, цвет: Int): Float {
        val d = resources.displayMetrics.density
        paint.color = цвет
        paint.textSize = кегль * d
        val ширина = paint.measureText(текст)
        if (ширина > c.width - 16) paint.textSize = paint.textSize * (c.width - 16) / ширина
        c.drawText(текст, c.width / 2f, y, paint)
        return y + paint.textSize * 1.5f
    }

    /** Полоса кнопок под картой. Раскладку считаем на месте: XML-разметки у оболочки нет. */
    private fun кнопкиНарисовать(c: Canvas, верх: Float) {
        val подписи = listOf("меню", "стоять", "стоп-приказ", "центр")
        кнопки.clear()
        val h = (c.height - верх - 8f).coerceIn(48f, 120f)
        val w = c.width / подписи.size.toFloat()
        paint.textSize = 13f * resources.displayMetrics.density
        подписи.forEachIndexed { k, подпись ->
            val r = Rect((k * w + 6).toInt(), верх.toInt(), ((k + 1) * w - 6).toInt(), (верх + h).toInt())
            кнопки.add(r to подпись)
            paint.color = if (подпись.endsWith("✓")) Color.rgb(72, 62, 44) else Color.rgb(48, 42, 36)
            c.drawRect(r, paint)
            paint.color = Color.rgb(232, 192, 125)
            c.drawText(подпись, r.exactCenterX(), r.exactCenterY() + paint.textSize * 0.36f, paint)
        }
    }

    /** Жёлтые уголки на выделенных и рамка, пока её тянут пальцем. */
    private fun pometkiВыделения(c: Canvas) {
        val e = eng ?: return
        if (!кадрГотов) return
        val k = кадрНаЭкране.width() / 640f
        val vw = mem.u32(Render.VW).coerceIn(64, 640)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = Color.rgb(252, 252, 72)
        synchronized(mem) {
            val camX = mem.u32(Render.CAMX); val camY = mem.u32(Render.CAMY)
            var i = mem.u32(G.unitHead)
            while (i != 0) {
                if ((mem.u8(UNITS + i + U.F07) and 0x80) != 0) {
                    val sx = кадрНаЭкране.left + (mem.u16(UNITS + i + U.X) - camX) * k
                    val sy = кадрНаЭкране.top + (mem.u16(UNITS + i + U.Y) - camY) * k
                    if (sx > кадрНаЭкране.left - 32 && sx < кадрНаЭкране.left + vw * k && sy > кадрНаЭкране.top - 32 && sy < кадрНаЭкране.bottom)
                        c.drawRect(sx, sy, sx + 32 * k, sy + 32 * k, paint)
                }
                i = mem.u32(UNITS + i + U.NEXT)
            }
        }
        рамка?.let { paint.color = Color.rgb(252, 252, 72); c.drawRect(it, paint) }
        paint.style = Paint.Style.FILL
    }

    // ---- экран ↔ карта
    private fun кадрX(sx: Float): Int = ((sx - кадрНаЭкране.left) * 640 / кадрНаЭкране.width()).toInt()
    private fun кадрY(sy: Float): Int = ((sy - кадрНаЭкране.top) * 480 / кадрНаЭкране.height()).toInt()
    private fun мирX(sx: Float): Int = mem.u32(Render.CAMX) + кадрX(sx)
    private fun мирY(sy: Float): Int = mem.u32(Render.CAMY) + кадрY(sy)
    private fun поКарте(x: Float, y: Float): Boolean =
        кадрНаЭкране.contains(x.toInt(), y.toInt()) && кадрX(x) < mem.u32(Render.VW)
    private fun поПанели(x: Float, y: Float): Boolean =
        кадрНаЭкране.contains(x.toInt(), y.toInt()) && кадрX(x) >= mem.u32(Render.VW)

    /**
     * Прокрутка карты «стиком» из двух пальцев: скорость постоянная и не зависит от того, как
     * резко ведут палец, — раньше карта дёргалась рывками по 32 пикселя вслед за пальцем.
     * Дробные пиксели копим и отдаём движку целыми клетками: камера обязана быть кратна 32,
     * иначе тайловая строка считается неверно и карта уезжает.
     */
    private fun прокрутитьСтиком() {
        val сейчас = System.nanoTime()
        val dt = ((сейчас - времяПрокрутки).coerceAtMost(100_000_000L)) / 1e9f
        времяПрокрутки = сейчас
        val (ox, oy) = стикСмещение
        if (стик == null || (ox == 0f && oy == 0f)) { накопX = 0f; накопY = 0f; return }
        val длина = kotlin.math.hypot(ox, oy)
        if (длина < 8f) return                                   // мёртвая зона под пальцем
        val доля = (длина / РАДИУС).coerceAtMost(1f)
        накопX += ox / длина * доля * СКОРОСТЬ * dt
        накопY += oy / длина * доля * СКОРОСТЬ * dt
        val шагX = (накопX / 32).toInt() * 32
        val шагY = (накопY / 32).toInt() * 32
        if (шагX != 0 || шагY != 0) {
            накопX -= шагX; накопY -= шагY
            synchronized(mem) { Render.scroll(mem, шагX, шагY) }
        }
    }

    /**
     * Меню на экране: кадр оригинала целиком плюс своя нижняя полоса — быстрый вход в партию
     * и перебор миссии. Колесо, кланы и сложность — настоящие экраны игры, их рисует Menu.
     */
    private fun менюНаЭкран(c: Canvas) {
        val d = resources.displayMetrics.density
        val k = minOf(c.width / 640f, c.height * 0.78f / 480f)
        val w = (640 * k).toInt(); val ht = (480 * k).toInt()
        кадрНаЭкране = Rect((c.width - w) / 2, 0, (c.width - w) / 2 + w, ht)
        if (кадрГотов) c.drawBitmap(bitmap, Rect(0, 0, 640, 480), кадрНаЭкране, paint)
        else { paint.color = Color.rgb(40, 34, 28); c.drawRect(кадрНаЭкране, paint) }
        paint.color = Color.rgb(28, 24, 20)
        c.drawRect(Rect(0, ht, c.width, c.height), paint)
        paint.textAlign = Paint.Align.CENTER
        var низ = ht + 13f * d
        низ = строка(c, статус, низ, 13f, Color.rgb(232, 192, 125))
        val м = меню
        низ = строка(c, "племя ${ПЛЕМЕНА[м?.племя ?: племя]} · миссия ${(м?.миссия ?: миссия) + 1} · ${СЛОЖНОСТИ[м?.сложность ?: сложность]}",
                     низ, 12f, Color.rgb(141, 130, 116))
        кнопки.clear()
        val подписи = listOf("миссия −", "в игру", "миссия +")
        val hb = (c.height - низ - 10f).coerceIn(52f, 130f)
        val шир = c.width / подписи.size.toFloat()
        paint.textSize = 14f * d
        подписи.forEachIndexed { i, подпись ->
            val r = Rect((i * шир + 6).toInt(), низ.toInt(), ((i + 1) * шир - 6).toInt(), (низ + hb).toInt())
            кнопки.add(r to подпись)
            paint.color = if (подпись == "в игру") Color.rgb(84, 68, 40) else Color.rgb(48, 42, 36)
            c.drawRect(r, paint)
            paint.color = Color.rgb(232, 192, 125)
            c.drawText(подпись, r.exactCenterX(), r.exactCenterY() + paint.textSize * 0.36f, paint)
        }
    }

    // ---- ввод. По карте: тап — выбрать или приказать, ведение одним пальцем — рамка выделения,
    // двумя пальцами — прокрутка карты с постоянной скоростью. По панели: нажатие кнопки.
    private var начало = 0f to 0f
    private var вёл = false
    private var двумя = false

    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (вМеню) { if (e.actionMasked == MotionEvent.ACTION_UP) нажатиеМеню(e.x, e.y); return true }
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { начало = e.x to e.y; вёл = false; двумя = false; рамка = null }
            MotionEvent.ACTION_POINTER_DOWN -> {
                двумя = true; рамка = null
                стик = центр(e); стикСмещение = 0f to 0f; накопX = 0f; накопY = 0f
                времяПрокрутки = System.nanoTime()
                подсказка = "веди двумя пальцами — карта поедет"
            }
            MotionEvent.ACTION_MOVE -> {
                if (двумя && e.pointerCount >= 2) {
                    val c = центр(e); val s0 = стик
                    if (s0 != null) стикСмещение = (c.first - s0.first) to (c.second - s0.second)
                } else if (kotlin.math.hypot(e.x - начало.first, e.y - начало.second) > 12) {
                    вёл = true
                    if (поКарте(начало.first, начало.second)) рамка = Rect(
                        minOf(начало.first, e.x).toInt(), minOf(начало.second, e.y).toInt(),
                        maxOf(начало.first, e.x).toInt(), maxOf(начало.second, e.y).toInt())
                }
            }
            MotionEvent.ACTION_POINTER_UP -> { стик = null; стикСмещение = 0f to 0f }
            MotionEvent.ACTION_UP -> {
                val движок = eng
                стик = null; стикСмещение = 0f to 0f
                if (движок != null && !двумя) {
                    if (вёл && поКарте(начало.first, начало.second)) {
                        synchronized(mem) {
                            Ui.boxSelect(движок, мирX(начало.first), мирY(начало.second), мирX(e.x), мирY(e.y))
                        }
                        подсказка = "выделено ${synchronized(mem) { Ui.selectedCount(mem) }}"
                    } else if (!вёл && поКарте(e.x, e.y)) {
                        подсказка = synchronized(mem) { тапПоКарте(движок, e.x, e.y) }
                    } else if (!вёл && поПанели(e.x, e.y)) {
                        val п = synchronized(mem) { Panel.click(движок, кадрX(e.x), кадрY(e.y)) }
                        if (п.isNotEmpty()) подсказка = п
                    } else if (!вёл) нажатиеКнопки(e.x, e.y)
                }
                рамка = null; двумя = false
            }
        }
        return true
    }

    private fun центр(e: MotionEvent): Pair<Float, Float> {
        var x = 0f; var y = 0f
        for (k in 0 until e.pointerCount) { x += e.getX(k); y += e.getY(k) }
        return (x / e.pointerCount) to (y / e.pointerCount)
    }

    /**
     * Тап по карте. Если панель перевела курсор в режим (заклинание, стройка), тап отдаёт именно
     * этот приказ — как в оригинале, где кнопка панели меняла форму курсора, а щелчок по карте
     * уже нёс приказ.
     */
    private fun тапПоКарте(движок: Engine, sx: Float, sy: Float): String {
        val wx = мирX(sx); val wy = мирY(sy)
        if (mem.u16(Ui.MODE) == 0) return Ui.tap(движок, wx, wy)
        return if (Ui.tapInMode(движок, wx, wy)) "приказ отдан" else "нужна цель"
    }

    private fun нажатиеКнопки(x: Float, y: Float) {
        val нажата = кнопки.firstOrNull { it.first.contains(x.toInt(), y.toInt()) } ?: return
        val e = eng
        when (нажата.second) {
            "меню" -> {
                synchronized(mem) { палитраИгры = mem.b.copyOfRange(Render.PAL, Render.PAL + 768) }
                меню?.let { it.племя = племя; it.миссия = миссия; it.сложность = сложность; it.вГлавное() }
                вМеню = true; статус = "игровое меню"
            }
            "стоять" -> { if (e != null) { synchronized(mem) { Ui.orderHold(e) }; подсказка = "стоят" } }
            "стоп-приказ" -> { synchronized(mem) { mem.w16(Ui.MODE, 0) }; подсказка = "режим сброшен" }
            "центр" -> if (e != null) synchronized(mem) { кЮниту() }
        }
    }

    private fun нажатиеМеню(x: Float, y: Float) {
        val м = меню ?: return
        val кнопка = кнопки.firstOrNull { it.first.contains(x.toInt(), y.toInt()) }
        if (кнопка != null) {
            when (кнопка.second) {
                "миссия −" -> { м.миссия = (м.миссия + 11) % 12 }
                "миссия +" -> { м.миссия = (м.миссия + 1) % 12 }
                "в игру" -> запуститьИзМеню()
            }
            return
        }
        if (!кадрНаЭкране.contains(x.toInt(), y.toInt())) return
        val ответ = synchronized(mem) { м.tap(кадрX(x), кадрY(y)) } ?: return
        if (ответ == "старт") запуститьИзМеню() else статус = ответ
    }

    /** Быстрый вход: с настройками из меню — либо новая партия, либо возврат в текущую. */
    private fun запуститьИзМеню() {
        val м = меню ?: return
        if (files.isEmpty()) return
        val те_же = eng != null && м.племя == племя && м.миссия == миссия && м.сложность == сложность
        if (те_же) {                                   // партия уже идёт — просто возвращаемся
            synchronized(mem) {
                палитраИгры?.let { System.arraycopy(it, 0, mem.b, Render.PAL, 768) }
                eng?.let { Render.toArgb(mem, pixels, palette) }
            }
            вМеню = false
            статус = "миссия ${миссия + 1} · ${ПЛЕМЕНА[племя]} · ${СЛОЖНОСТИ[сложность]}"
            return
        }
        племя = м.племя; миссия = м.миссия; сложность = м.сложность
        thread { synchronized(mem) { открытьМиссию() } }
    }

    /** Камера на первого своего живого юнита. */
    private fun кЮниту() {
        val мой = mem.u8(G.humanOwner)
        var i = mem.u32(G.unitHead)
        while (i != 0) {
            if (mem.u8(UNITS + i + U.OWNER) == мой && (mem.u8(UNITS + i + U.FLAGS5B) and 1) == 0 &&
                mem.u8(UNITS + i + U.TYPE) < 0x1a) {
                mem.w32(Render.CAMX, 0); mem.w32(Render.CAMY, 0)
                Render.scroll(mem, mem.u16(UNITS + i + U.X) - mem.u32(Render.VW) / 2, mem.u16(UNITS + i + U.Y) - 240)
                return
            }
            i = mem.u32(UNITS + i + U.NEXT)
        }
    }
}
