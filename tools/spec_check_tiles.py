# §3.1 movement-spec: предикат проходимости. Клетка юнита — ЗАНЯТАЯ клетка (+0x53/+0x54),
# а не X>>5,Y>>5 (при диагональном ходе пиксельная позиция транзитом проходит угловую клетку).
import json, zlib, struct, sys, os
POOL,SZ,REC=57600,96,57632
def check(tr):
    ix=json.load(open(os.path.join(tr,'index.json'))); lo=ix['data_lo']
    snap=zlib.decompress(open(os.path.join(tr,'snap0.bin.z'),'rb').read())
    g=lambda a:a-lo; BG=g(0xf6e74); INF=g(0x3183c)
    mapW=struct.unpack_from('<I',snap,g(0x31af8))[0]; mapH=struct.unpack_from('<I',snap,g(0x31afc))[0]
    data=open(os.path.join(tr,'steps.bin'),'rb').read()
    tested=bad=start_bad=0; badunits=set()
    a0=data[0:POOL]
    def passable(tx,ty):
        if tx>=mapW or ty>=mapH: return None
        v=struct.unpack_from('<H',snap,BG+(ty*256+tx)*2)[0]
        return (v>>11)==0 and (snap[INF+(v&0x7ff)]&1)!=0
    # клетки, на которых юниты СТОЯЛИ уже на шаге 0 (расстановка редактора) — исключаем
    startcells=set()
    for i in range(0,POOL,SZ):
        if a0[i+4] and a0[i+4]<24: startcells.add((i,a0[i+0x53],a0[i+0x54]))
    for k in range(ix['steps']):
        a=data[k*REC:k*REC+POOL]
        for i in range(0,POOL,SZ):
            t=a[i+4]
            if t==0 or t==0x0b or t>=24: continue
            if a[i+0x2b]>=0x60: continue
            tx,ty=a[i+0x53],a[i+0x54]
            p=passable(tx,ty)
            if p is None: continue
            tested+=1
            if not p:
                if (i,tx,ty) in startcells: start_bad+=1
                else: bad+=1; badunits.add((i,tx,ty,k))
    return tested,bad,start_bad,badunits
T=B=S=0; ex=[]
for tr in sys.argv[1:]:
    t,b,s,bu=check(tr); T+=t; B+=b; S+=s; ex+= [(tr,)+x for x in list(bu)[:2]]
    print(f"{tr:28s} занятых клеток {t:8d}  нарушений {b}  (из них стартовая расстановка: {s})")
print(f"\nИТОГО {T} клеток; нарушений {B}; стартовых расстановок на непроходимом {S}")
print("ВЕРДИКТ:", "ПРЕДИКАТ ПРОХОДИМОСТИ ПОДТВЕРЖДЁН" if B==0 else "ЕСТЬ НАРУШЕНИЯ")
for e in ex[:6]: print("   ", e)
