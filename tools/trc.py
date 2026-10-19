import struct
def load(path):
    d=open(path,'rb').read(); magic=d[:3].decode(); n2,tab=struct.unpack_from('<II',d,8); base=tab; ents=[]
    if magic=='TRC':
        for i in range(n2):
            o=0x20+i*32; name=d[o:o+12].split(b'\0')[0].decode('latin1'); off,sz,sz2,ck,flag,pad=struct.unpack_from('<IIIHBB',d,o+12)
            ents.append(dict(name=name,off=off,size=sz,size2=sz2,cksum=ck,flag=flag,data=d[base+off:base+off+sz2]))
    else:
        for i in range(n2):
            o=0x20+i*16; v=struct.unpack_from('<IHHhhhh',d,o); off=v[0]
            nxt=struct.unpack_from('<I',d,o+16)[0] if i+1<n2 else len(d)-base
            ents.append(dict(off=off,w=v[1],h=v[2],x=v[3:7],data=d[base+off:base+nxt]))
    return magic,ents
def get(ents,name): return next(e for e in ents if e['name']==name)
