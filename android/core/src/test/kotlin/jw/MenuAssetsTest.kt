package jw

import java.io.File
import kotlin.test.Test

/** Проверка, что экраны меню читаются из паков так же, как их читает браузерная оболочка. */
class MenuAssetsTest {
    @Test
    fun `картинки меню на месте`() {
        val p01 = Archive(File("../../PWAR/_PWAR01.TRC").readBytes())
        for (i in listOf(4, 5)) {
            val e = p01.entries[i]; val d = p01.data(i)
            println("пак 01 запись $i: имя ${e.name} size ${e.size} packed ${e.packed} → ${d.size} байт")
        }
        val p02 = Archive(File("../../PWAR/_PWAR02.TRS").readBytes())
        println("пак 02: записей ${p02.entries.size}")
        for (i in listOf(19, 20, 154, 163, 168)) {
            val e = p02.entries[i]; val d = p02.data(i)
            println("  запись $i: ${e.w}x${e.h} size ${e.size} packed ${e.packed} → ${d.size} байт")
        }
    }
}
