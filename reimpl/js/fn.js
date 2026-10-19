// Реестр портированных функций по адресу оригинала: F[0x15f86] = (eng, regs) => {...; return {eax, edx, cf}}
export const F = Object.create(null);
/** Позвать портированную функцию оригинала по её адресу. Нет такой — падаем с адресом в тексте:
 *  молча пропустить вызов нельзя, дальше поедет вся симуляция. */
export function call(eng, addr, regs = {}) { const f = F[addr]; if (!f) throw new Error('not ported: 0x' + addr.toString(16)); return f(eng, regs) || {}; }
