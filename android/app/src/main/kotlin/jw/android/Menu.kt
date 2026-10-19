package jw.android

import jw.Archive
import jw.Mem
import jw.Render
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.atan2
import kotlin.math.hypot

/**
 * Игровое меню оригинала: главный экран с колесом, выбор клана и выбор сложности — те самые
 * картинки из паков 01 и 02, а не наша выдумка.
 *
 * Как это устроено в игре. Фон главного меню — MAIN.SCR (пак 01, запись 5), поверх него в
 * (207,188) ложится колесо из семи кусков пака 02 (записи 19..32, чётная — обычная, нечётная —
 * подсвеченная). Выбор клана — целая картинка (запись 163), а подсветка медальона — это другая
 * целая картинка (164..171). Выбор сложности — то же колесо на том же месте плюс плашка.
 * Раскладка кнопок (сектора колеса и эллипсы медальонов) снята в reimpl/data/ui_screens.json —
 * его же читает браузерная оболочка, так что описание одно на оба порта.
 *
 * Рисуем в тот же кадровый буфер оригинала (0x1235f4) и той же палитрой, что игра, — поэтому
 * меню на экране выглядит ровно как в DOS.
 */
class Menu(private val mem: Mem, private val каталог: JSONObject) {
    enum class Экран { ГЛАВНОЕ, ПЛЕМЯ, СЛОЖНОСТЬ }

    var экран = Экран.ГЛАВНОЕ; private set
    var племя = 0
    var сложность = 1
    var миссия = 0
    private val кэш = HashMap<String, Archive>()
    private var подсвечен: String? = null

    private val ПАКИ = mapOf("01C" to "_PWAR01.TRC", "02S" to "_PWAR02.TRS", "03C" to "_PWAR03.TRC")

    private fun архив(files: Map<String, ByteArray>, имя: String): Archive? {
        val файл = ПАКИ[имя] ?: return null
        val данные = files[файл] ?: return null
        return кэш.getOrPut(файл) { Archive(данные) }
    }
    private fun экранКаталога(имя: String): JSONObject = каталог.getJSONObject("screens").getJSONObject(имя)

    /** Палитра .PAL: 768 байт, компоненты уже 8-битные. */
    private fun палитра(files: Map<String, ByteArray>, пак: String, запись: Int) {
        val a = архив(files, пак) ?: return
        val d = a.data(запись)
        System.arraycopy(d, 0, mem.b, Render.PAL, minOf(768, d.size))
    }
    /** Полноэкранная картинка 640x480, один байт на пиксель. */
    private fun фон(files: Map<String, ByteArray>, пак: String, запись: Int) {
        val a = архив(files, пак) ?: return
        val d = a.data(запись)
        for (y in 0 until 480) {
            val src = y * 640
            if (src + 640 > d.size) break
            System.arraycopy(d, src, mem.b, Render.FB + mem.u32(Render.ROWS + y * 4), 640)
        }
    }
    /** Спрайт пака 02: размеры лежат в оглавлении архива, индекс 0 прозрачный. */
    private fun спрайт(files: Map<String, ByteArray>, пак: String, запись: Int, x0: Int, y0: Int) {
        val a = архив(files, пак) ?: return
        val e = a.entries[запись] ?: return
        val d = a.data(запись)
        for (y in 0 until e.h) {
            val dy = y0 + y
            if (dy < 0 || dy >= 480) continue
            val row = Render.FB + mem.u32(Render.ROWS + dy * 4)
            for (x in 0 until e.w) {
                val dx = x0 + x
                if (dx < 0 || dx >= 640) continue
                val p = d[y * e.w + x]
                if (p.toInt() != 0) mem.b[row + dx] = p
            }
        }
    }

    fun draw(files: Map<String, ByteArray>) {
        when (экран) {
            Экран.ГЛАВНОЕ -> {
                палитра(files, "01C", 4)                       // MAIN.PAL — общая для пака 02 и игры
                фон(files, "01C", 5)
                кнопкиКолеса(files, "title_menu")
            }
            Экран.ПЛЕМЯ -> {
                палитра(files, "01C", 4)
                val h = хотспоты("tribe_select")
                val вариант = (0 until h.length()).map { h.getJSONObject(it) }
                    .firstOrNull { it.optInt("tribe", -1) == племя }?.optInt("screen_variant", 0) ?: 0
                фон(files, "02S", if (вариант != 0) вариант else экранКаталога("tribe_select").getInt("entry"))
            }
            Экран.СЛОЖНОСТЬ -> {
                палитра(files, "01C", 4)
                фон(files, "01C", 5)
                спрайт(files, "02S", 154, 207, 188)            // плашка «Choose Game Difficulty»
                кнопкиКолеса(files, "difficulty")
            }
        }
    }

    private fun хотспоты(имя: String): JSONArray = экранКаталога(имя).getJSONArray("hotspots")

    private fun кнопкиКолеса(files: Map<String, ByteArray>, имя: String) {
        val h = хотспоты(имя)
        for (i in 0 until h.length()) {
            val z = h.getJSONObject(i)
            if (!z.has("sprite_normal")) continue
            val xy = z.getJSONArray("sprite_xy")
            val подсвет = z.getString("id") == подсвечен
            спрайт(files, "02S", if (подсвет) z.getInt("sprite_over") else z.getInt("sprite_normal"),
                xy.getInt(0), xy.getInt(1))
        }
    }

    /** Кнопка под пальцем: сектор колеса или эллипс медальона. */
    private fun попадание(имя: String, x: Int, y: Int): JSONObject? {
        val h = хотспоты(имя)
        var центр: JSONObject? = null
        for (i in 0 until h.length()) {
            val z = h.getJSONObject(i)
            when (z.getString("kind")) {
                "ellipse" -> {
                    val dx = (x - z.getInt("cx")).toDouble() / z.getInt("rx")
                    val dy = (y - z.getInt("cy")).toDouble() / z.getInt("ry")
                    if (dx * dx + dy * dy <= 1.0) return z
                }
                "sector" -> {
                    val w = экранКаталога(имя).getJSONObject("wheel")
                    val dx = x - w.getDouble("cx"); val dy = y - w.getDouble("cy")
                    val r = hypot(dx, dy)
                    if (r < z.getDouble("r0") || r > z.getDouble("r1")) continue
                    val a = Math.toDegrees(atan2(-dy, dx))
                    val a0 = z.getDouble("a0"); val a1 = z.getDouble("a1")
                    val внутри = if (a0 <= a1) a in a0..a1 else (a >= a0 || a <= a1)
                    if (внутри) { if (r <= w.getDouble("r_hub")) центр = z else return z }
                }
            }
        }
        return центр
    }

    /**
     * Нажатие в координатах кадра 640x480. Возвращает «старт», если пора грузить партию,
     * иначе подпись для строки состояния (или null, если ничего не изменилось).
     */
    fun tap(x: Int, y: Int): String? {
        val имя = when (экран) {
            Экран.ГЛАВНОЕ -> "title_menu"; Экран.ПЛЕМЯ -> "tribe_select"; Экран.СЛОЖНОСТЬ -> "difficulty" }
        val z = попадание(имя, x, y) ?: return null
        val id = z.getString("id")
        подсвечен = id
        return when (экран) {
            Экран.ГЛАВНОЕ -> when (id) {
                "new_game" -> { экран = Экран.ПЛЕМЯ; подсвечен = null; "выберите племя" }
                "quit" -> "выход тут не нужен"
                "help" -> "подсказка не портирована"
                else -> "${z.getString("label")} пока не сделано"
            }
            Экран.ПЛЕМЯ -> when (id) {
                "select" -> { экран = Экран.СЛОЖНОСТЬ; подсвечен = null; "выберите сложность" }
                "cancel" -> { экран = Экран.ГЛАВНОЕ; подсвечен = null; "главное меню" }
                else -> { племя = z.optInt("tribe", племя); "племя: ${z.getString("label")}" }
            }
            Экран.СЛОЖНОСТЬ -> when (id) {
                "easy" -> { сложность = 0; "старт" }
                "medium" -> { сложность = 1; "старт" }
                "hard" -> { сложность = 2; "старт" }
                "cancel" -> { экран = Экран.ПЛЕМЯ; подсвечен = null; "выберите племя" }
                else -> null
            }
        }
    }

    fun вГлавное() { экран = Экран.ГЛАВНОЕ; подсвечен = null }
}
