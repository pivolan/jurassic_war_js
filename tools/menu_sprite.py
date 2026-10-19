import sys; sys.path.insert(0,'tools'); import trc
from PIL import Image
m,e1 = trc.load('PWAR/_PWAR01.TRC'); pal = list(trc.get(e1,'MAIN.PAL')['data'])
m,e2 = trc.load('PWAR/_PWAR02.TRS')
номер = int(sys.argv[1]) if len(sys.argv)>1 else 19
s = e2[номер]
d = s['data'][:s['w']*s['h']]
px = Image.frombytes('P',(s['w'],s['h']),d); px.putpalette(pal)
маска = Image.frombytes('L',(s['w'],s['h']),bytes(255 if b else 0 for b in d))
имя = sys.argv[2] if len(sys.argv)>2 else f'out/art/меню/спрайт_{номер}.png'
import os; os.makedirs(os.path.dirname(имя), exist_ok=True)
rgba = px.convert('RGBA'); rgba.putalpha(маска)
rgba.save(имя)
print(f'запись {номер}: {s["w"]}×{s["h"]} → {имя}, цветов {len(set(d))}')
