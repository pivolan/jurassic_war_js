// Партия вождя по ходу: node tools/вождь_журнал.mjs [файл|последняя] [--полно]
// Журналы пишет прокси (tools/jev_прокси.mjs) в out/вождь/<партия>.jsonl — строка на решение.
import fs from 'node:fs'; import path from 'node:path';
const ПАПКА = decodeURIComponent(new URL('../out/вождь/', import.meta.url).pathname);
const арг = process.argv.slice(2), полно = арг.includes('--полно');
let файл = арг.find(a => !a.startsWith('--'));
if (!файл || файл === 'последняя') {
  const все = fs.readdirSync(ПАПКА).filter(f => f.endsWith('.jsonl')).map(f => [f, fs.statSync(path.join(ПАПКА, f)).mtimeMs]).sort((a, b) => b[1] - a[1]);
  if (!все.length) { console.log('журналов нет'); process.exit(); }
  файл = все[0][0];
}
const строки = fs.readFileSync(файл.includes('/') ? файл : path.join(ПАПКА, файл), 'utf8').trim().split('\n').map(l => JSON.parse(l));
console.log('партия', файл, '— решений', строки.length);
for (const з of строки) {
  const с = з.сводка || {}, о = з.ответ || {};
  for (const е of з.события || []) console.log('   ·', е);
  console.log(`${с.время} | бойцов ${с.бойцов_всего} (−${с.потеряли_бойцов_за_прошлый_ход || 0}) | еда ${String(с.еда).split(' ')[0]} | ${с.враг} | база: ${с.у_нашей_базы}`);
  if (полно) { for (const о2 of с.отряды || []) console.log('      отряд', о2); console.log('      итог прошлого:', с.что_вышло_с_прошлого_решения); console.log('      темы:', (з.темы || []).join(' · ')); }
  if (з.ошибка) { console.log('   ОШИБКА', з.ошибка); continue; }
  const отр = (о.отряды || []).map(п => `${п.номер}:${п.задача}${п.куда ? '→' + п.куда : ''}${п.сколько != null ? '×' + п.сколько : ''}`).join(' ');
  console.log(`   → ${о.замысел} | ${отр} | строить ${о.стройка}, заказ ${о.производство} | «${о.реплика}» (${з.мс} мс)`);
  if (полно) console.log('      почему:', о.почему);
}
