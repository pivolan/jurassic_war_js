import json, sys, struct, os, collections
DPX   = {1:(0,-4), 2:(4,-4), 3:(4,0), 4:(4,4), 5:(0,4), 6:(-4,4), 7:(-4,0), 8:(-4,-4)}
DSUB  = {1:(0,-1), 2:(1,-1), 3:(1,0), 4:(1,1), 5:(0,1), 6:(-1,1), 7:(-1,0), 8:(-1,-1)}
ALIGN = [0,-1,-2]+[0]*27+[2,1]
def move_step(X, Y, d, spd, c41):
    c = (c41 - 1) & 0xff
    if c == 0:
        c = ((0xff - spd) >> 5) + 1
        dx, dy = DSUB[d]; X += dx; Y += dy
    dx, dy = DPX[d]; X += dx; Y += dy
    return (X + ALIGN[X & 0x1f]) & 0xffff, (Y + ALIGN[Y & 0x1f]) & 0xffff, c
O=dict(TYPE=4,SPD=0x12,STATE=0x2b,X=0x2f,Y=0x31,DIR=0x3d,PHASE=0x40,CTR=0x41)
POOL,SZ,REC=57600,96,57632
st_ok=collections.Counter(); st_bad=collections.Counter(); spds=collections.Counter(); samples=[]
for tr in sys.argv[1:]:
    ix=json.load(open(os.path.join(tr,'index.json'))); data=open(os.path.join(tr,'steps.bin'),'rb').read()
    for k in range(ix['steps']-1):
        a=data[k*REC:k*REC+POOL]; b=data[(k+1)*REC:(k+1)*REC+POOL]
        for i in range(0,POOL,SZ):
            if a[i+O['TYPE']]==0 or b[i+O['TYPE']]!=a[i+O['TYPE']]: continue
            if a[i+O['TYPE']]==0xb: continue
            st=a[i+O['STATE']]
            if st!=b[i+O['STATE']]: continue
            if st>=0x60: continue      # труп/удаление — шаг движения не вызывается
            X=struct.unpack_from('<H',a,i+O['X'])[0]; Y=struct.unpack_from('<H',a,i+O['Y'])[0]
            if (X&0x1f)==0 and (Y&0x1f)==0: continue
            if a[i+O['PHASE']]>1: continue
            d=struct.unpack_from('<H',a,i+O['DIR'])[0]
            if d not in DPX: continue
            eX,eY,eC=move_step(X,Y,d,a[i+O['SPD']],a[i+O['CTR']])
            gX=struct.unpack_from('<H',b,i+O['X'])[0]; gY=struct.unpack_from('<H',b,i+O['Y'])[0]; gC=b[i+O['CTR']]
            if (eX,eY,eC)==(gX,gY,gC):
                st_ok[st]+=1; spds[a[i+O['SPD']]]+=1
            else:
                st_bad[st]+=1
                if len(samples)<6: samples.append((tr,k,i,st,(X,Y,d,a[i+O['SPD']],a[i+O['CTR']]),(eX,eY,eC),(gX,gY,gC)))
print("состояние: совпало / не совпало")
for st in sorted(set(st_ok)|set(st_bad)):
    print(f"  0x{st:02x}: {st_ok[st]:6d} / {st_bad[st]:6d}")
print("SPD, на которых проверено:", dict(sorted(spds.items())))
tot_ok, tot_bad = sum(st_ok.values()), sum(st_bad.values())
print(f"ИТОГО совпало {tot_ok}, не совпало {tot_bad}  →  {'СПЕЦИФИКАЦИЯ ПОДТВЕРЖДЕНА' if tot_bad==0 else 'ЕСТЬ РАСХОЖДЕНИЯ'}")
for s in samples: print("  пример расхождения:", s)
