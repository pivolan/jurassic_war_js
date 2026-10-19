package jw

/**
 * Регистры и реестр функций — как в JS-порте: каждая портированная функция оригинала лежит
 * под своим адресом, вызывается через call(). Так порт можно вести по кусочкам: непортированная
 * функция сразу видна по адресу, а не прячется за именем.
 */
class Regs(
    @JvmField var eax: Int = 0, @JvmField var ebx: Int = 0, @JvmField var ecx: Int = 0,
    @JvmField var edx: Int = 0, @JvmField var esi: Int = 0, @JvmField var edi: Int = 0,
    @JvmField var ebp: Int = 0, @JvmField var cf: Boolean = false, @JvmField var zf: Boolean = false,
)

typealias PortedFn = (Engine, Regs) -> Regs

object F {
    private val map = HashMap<Int, PortedFn>(1024)
    operator fun get(addr: Int): PortedFn? = map[addr]
    operator fun set(addr: Int, f: PortedFn) { map[addr] = f }
    fun has(addr: Int) = map.containsKey(addr)
    /** Зарегистрировать, только если адрес ещё свободен (как stub() в JS-порте). */
    fun stub(addr: Int, f: PortedFn) { if (!map.containsKey(addr)) map[addr] = f }
    val ported: Int get() = map.size
    fun clear() = map.clear()
}

class NotPorted(addr: Int) : RuntimeException("не портировано: 0x${addr.toString(16)}")

fun call(eng: Engine, addr: Int, r: Regs = Regs()): Regs {
    val f = F[addr] ?: throw NotPorted(addr)
    return f(eng, r)
}

/**
 * Вызвать, если функция есть. Если нет — пропустить и запомнить адрес: пока порт неполон, это
 * честный список того, чего не хватает, а не молчаливое расхождение с оригиналом.
 */
fun opt(eng: Engine, addr: Int, r: Regs = Regs()): Regs? {
    val f = F[addr] ?: run { eng.todo.add("0x" + addr.toString(16)); return null }
    return f(eng, r)
}
