package jw

import java.io.File
import java.util.zip.InflaterInputStream
import kotlin.test.Test

/**
 * Прогон корпуса случаев из эмулятора оригинала (каталог reimpl/cases): 504 снимка «состояние до →
 * состояние после» для 112 функций. Тот же корпус гоняет JS-порт (js/test/fntest.mjs), поэтому
 * он не зависит от языка и служит мерой готовности Kotlin-порта.
 *
 * Тест не падает из-за того, что функция ещё не портирована — он падает, только если
 * портированная функция даёт не тот результат. И печатает счётчик: сколько случаев уже проходит.
 */
class CasesTest {
    private val cases = File("../../reimpl/cases")

    // ---- маленький разбор JSON: в case.json только числа, объекты и массивы
    private class Json(private val s: String) {
        var i = 0
        fun ws() { while (i < s.length && s[i].isWhitespace()) i++ }
        fun value(): Any? {
            ws()
            return when {
                s[i] == '{' -> obj()
                s[i] == '[' -> arr()
                s[i] == '"' -> str()
                s.startsWith("true", i) -> { i += 4; true }
                s.startsWith("false", i) -> { i += 5; false }
                s.startsWith("null", i) -> { i += 4; null }
                else -> num()
            }
        }
        fun obj(): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>(); i++          // {
            ws(); if (s[i] == '}') { i++; return m }
            while (true) {
                ws(); val k = str(); ws(); i++                  // :
                m[k] = value(); ws()
                if (s[i] == ',') { i++; continue }
                i++; return m                                   // }
            }
        }
        fun arr(): List<Any?> {
            val l = ArrayList<Any?>(); i++                      // [
            ws(); if (s[i] == ']') { i++; return l }
            while (true) {
                l.add(value()); ws()
                if (s[i] == ',') { i++; continue }
                i++; return l                                   // ]
            }
        }
        fun str(): String {
            val sb = StringBuilder(); i++                       // "
            while (s[i] != '"') { if (s[i] == '\\') i++; sb.append(s[i]); i++ }
            i++
            return sb.toString()
        }
        fun num(): Int {
            val st = i
            while (i < s.length && (s[i].isDigit() || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e')) i++
            return s.substring(st, i).toDouble().toInt()
        }
    }

    @Suppress("UNCHECKED_CAST")
    @Test
    fun `портированные функции проходят случаи из эмулятора`() {
        Jw.registerAll()
        if (!cases.isDirectory) return
        val dirs = cases.listFiles()!!.filter { File(it, "case.json").exists() }.sortedBy { it.name }
        var ok = 0; var notPorted = 0; val bad = ArrayList<String>()
        val notPortedFns = sortedSetOf<Int>()

        for (d in dirs) {
            val c = Json(File(d, "case.json").readText()).value() as Map<String, Any?>
            val fn = c["fn"] as Int
            if (!F.has(fn)) { notPorted++; notPortedFns.add(fn); continue }

            val pre = InflaterInputStream(File(d, "pre.bin.z").readBytes().inputStream()).readBytes()
            val m = Mem.ofSize(); m.set(0x30000, pre)
            val before = m.b.copyOf()
            val eng = Engine(m)
            eng.timer = c["timer"] as Int
            val ri = c["regs_in"] as Map<String, Any?>
            val r = Regs(
                eax = ri["eax"] as? Int ?: 0, ebx = ri["ebx"] as? Int ?: 0, ecx = ri["ecx"] as? Int ?: 0,
                edx = ri["edx"] as? Int ?: 0, esi = ri["esi"] as? Int ?: 0, edi = ri["edi"] as? Int ?: 0,
                ebp = ri["ebp"] as? Int ?: 0,
            )
            eng.todo.clear()
            val out = try { F[fn]!!(eng, r) } catch (e: Throwable) { bad.add("${d.name}: исключение ${e}"); continue }
            // Если по дороге встретилась ещё не портированная функция, случай не провален —
            // он просто пока недоступен: результат отличается ровно из-за пропущенного вызова.
            val неполный = eng.todo.isNotEmpty()

            val diff = (c["diff"] as List<Any?>).map { it as List<Any?> }
            val ожидается = HashMap<Int, Int>()
            var расхождение: String? = null
            for (t in diff) {
                val a = t[0] as Int; val n = t[2] as Int
                ожидается[a] = n
                if (m.u8(a) != n) { расхождение = "0x${a.toString(16)}: ждали $n, получили ${m.u8(a)}"; break }
            }
            if (расхождение == null) {
                for (a in 0x30000 until m.b.size) {
                    if (m.b[a] != before[a] && !ожидается.containsKey(a)) {
                        расхождение = "лишняя запись по 0x${a.toString(16)}"; break
                    }
                }
            }
            if (расхождение != null) {
                if (неполный) { notPorted++; notPortedFns.addAll(eng.todo.map { it.removePrefix("0x").toInt(16) }) }
                else bad.add("${d.name} (0x${fn.toString(16)}): $расхождение")
                continue
            }
            ok++
        }

        println("случаи из эмулятора: прошло $ok, не портировано $notPorted, ошибок ${bad.size}")
        println("осталось портировать функций: ${notPortedFns.size}")
        if (bad.isNotEmpty()) {
            bad.take(10).forEach { println("  ✘ $it") }
            throw AssertionError("портированные функции дают не тот результат: ${bad.size} случаев")
        }
    }
}
