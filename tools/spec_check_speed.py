# Чистая проверка §4.1: считаем ТОЛЬКО непрерывные проходы тайла без единого шага ожидания.
import json, sys, struct, os, collections
O=dict(TYPE=4,SPD=0x12,STATE=0x2b,X=0x2f,Y=0x31,DIR=0x3d,PHASE=0x40)
POOL,SZ,REC=57600,96,57632
MOV={0x00,0x11,0x31,0x36,0x42}
res=collections.defaultdict(collections.Counter)
for tr in sys.argv[1:]:
    ix=json.load(open(os.path.join(tr,'index.json'))); data=open(os.path.join(tr,'steps.bin'),'rb').read()
    ns=ix['steps']
    pools=[data[k*REC:k*REC+POOL] for k in range(ns)]
    for i in range(0,POOL,SZ):
        run=None   # (стартовый шаг, spd)
        for k in range(ns-1):
            a,b=pools[k],pools[k+1]
            t=a[i+O['TYPE']]
            if t==0 or t==0xb or b[i+O['TYPE']]!=t: run=None; continue
            if a[i+O['STATE']] not in MOV or b[i+O['STATE']]!=a[i+O['STATE']]: run=None; continue
            X=struct.unpack_from('<H',a,i+O['X'])[0]; Y=struct.unpack_from('<H',a,i+O['Y'])[0]
            gX=struct.unpack_from('<H',b,i+O['X'])[0]; gY=struct.unpack_from('<H',b,i+O['Y'])[0]
            moved=(gX!=X or gY!=Y)
            onTile=(X&0x1f)==0 and (Y&0x1f)==0
            if onTile and moved:
                if run is not None and run[1]==a[i+O['SPD']]:
                    res[((0xff-run[1])>>5)+1][k-run[0]]+=1
                run=(k,a[i+O['SPD']])
            elif not moved:
                run=None
tab={8:8.0,7:8.0,6:8.0,5:7.5,4:8.0,3:7.0,2:7.0,1:6.0}
print(f"{'N':>2} {'SPD':>9} {'проходов':>9}  распределение шагов на тайл (шаг:раз)      среднее   док")
for N in sorted(res):
    c=res[N]; tot=sum(c.values()); avg=sum(k*v for k,v in c.items())/tot
    dist=' '.join(f"{k}:{v}" for k,v in sorted(c.items()))
    lo=max(0,256-N*32); hi=255-(N-1)*32
    print(f"{N:>2} {lo:>4}-{hi:<4} {tot:>9}  {dist:<42} {avg:>7.3f}  {tab[N]:.2f}")
