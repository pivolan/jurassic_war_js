import sys; sys.path.insert(0,'tools'); import trc
from PIL import Image, ImageOps
m,e=trc.load('PWAR/_PWAR01.TRC'); pal=list(trc.get(e,'MAIN.PAL')['data'])
m,es=trc.load('PWAR/_PWAR04.TRS')
DIRMAP=[0,1,2,3,4,3,2,1]; MIRROR=[0,0,0,0,0,1,1,1]
# from pwar.exe tables @0x36dd8..: stand/walk/attack bases and per-dir offsets
HUMAN=[(f'human{u+1}',u*65,8,4) for u in range(8)]
# Блоки кадров берутся из таблицы движка: база стойки — u16 по адресу 0x36dd6 + тип*2, смещение
# направления — 0x36e06 + направление*2 (см. js/port/economy.js, установка SPR). По ней:
#   люди 1..8   → 0, 65, 130 … 455 (шаг 65), формула (тип−1)*65 верна только для них;
#   ручные ящеры 9..13 → 1685, 1725, 1765, 1805, 1845 (шаг 40);
#   дикое зверьё 14..23 → 1885 … 2245 (тот же шаг 40).
# Прежний список начинался с 1685 и был подписан как «звери», из-за чего первые пять гифок
# получили чужие имена: beast01_trex на деле велоцираптор (тип 9). Имена приведены к типам.
ЯЩЕРЫ_НАЗВАНИЯ=[(9,'raptor'),(10,'dino10'),(11,'dino11'),(12,'dino12'),(13,'dilophosaurus')]
ЗВЕРИ_НАЗВАНИЯ=[(14,'trex'),(15,'brachiosaurus'),(16,'centrosaurus'),(17,'stauricosaurus'),(18,'daemon'),
                (19,'mammoth'),(20,'musso'),(21,'tiger'),(22,'leopard'),(23,'cur')]
# 15 (брахиозавр) и 18 (демон) в паке пустые — их пропускаем, как и раньше пропускались «empty».
BEAST=[(f'unit{t:02d}_{n}', 1685 + 40 * (t - 9), 4, 3) for t, n in ЯЩЕРЫ_НАЗВАНИЯ + ЗВЕРИ_НАЗВАНИЯ if t not in (15, 18)]
def spr(i,mirror):
    s=es[i]; d=s['data'][:s['w']*s['h']]
    px=Image.frombytes('P',(s['w'],s['h']),d); mask=Image.frombytes('L',(s['w'],s['h']),bytes(255 if b else 0 for b in d))
    if mirror: px=ImageOps.mirror(px); mask=ImageOps.mirror(mask)
    return px,mask
def unit_gif(name,base,nw,na,scale=3,dur=120):
    stand=[base+DIRMAP[d] for d in range(8)]
    walk=[[base+5+DIRMAP[d]*nw+k for k in range(nw)] for d in range(8)]
    atk=[[base+5+5*nw+DIRMAP[d]*na+k for k in range(na)] for d in range(8)]
    allf=[i for row in walk+atk for i in row]+stand
    cw=max(es[i]['w'] for i in allf)+8; ch=max(es[i]['h'] for i in allf)+8
    nf=nw*2 if nw%na==0 or na%nw==0 else nw*na
    frames=[]
    for f in range(max(nw,na)*2):
        canvas=Image.new('P',(cw*8,ch*2),0); canvas.putpalette(pal)
        for d in range(8):
            for row,seq in ((0,walk[d]),(1,atk[d])):
                i=seq[f%len(seq)]; px,mask=spr(i,MIRROR[d]); canvas.paste(px,(d*cw+(cw-px.width)//2,row*ch+ch-4-px.height),mask)
        frames.append(canvas.resize((canvas.width*scale,canvas.height*scale),Image.NEAREST))
    frames[0].save(f'out/anim/{name}.gif',save_all=True,append_images=frames[1:],duration=dur,loop=0,disposal=1)
    return frames
if __name__=='__main__':
    for name,base,nw,na in HUMAN+BEAST:
        fr=unit_gif(name,base,nw,na); 
    # strips for check
    for n,base,nw,na in [HUMAN[0],BEAST[0],BEAST[-1]]:
        fr=unit_gif(n,base,nw,na); w,h=fr[0].size; strip=Image.new('RGB',(w,h*len(fr)))
        for i,f in enumerate(fr): strip.paste(f.convert('RGB'),(0,i*h))
        strip.save(f'out/img/strip_{n}.png'); print(n,len(fr),strip.size)
    import os; print(len(os.listdir('out/anim')))
