# Jurassic War LZSS (pwar.exe @ 0x2b40e): MSB-first bits; flag0 -> 8-bit literal; flag1 -> len(5) pos(12) абсолютная позиция в окне 4096
def unpack(src, outlen):
    ring=bytearray(4096+64); rpos=0; out=bytearray(); bitpos=0; nbits=len(src)*8
    def bits(n):
        nonlocal bitpos; v=0
        for _ in range(n):
            if bitpos>=nbits: raise EOFError
            v=(v<<1)|((src[bitpos>>3]>>(7-(bitpos&7)))&1); bitpos+=1
        return v
    def put(b):
        nonlocal rpos; ring[rpos]=b; rpos=0 if rpos+1>0xfff else rpos+1
    try:
        while len(out)<outlen:
            if bits(1)==0:
                b=bits(8); out.append(b); put(b)
            else:
                ln=bits(5); pos=bits(12); tmp=[]
                for i in range(ln):
                    b=ring[pos+i]; out.append(b); ring[4096+i]=b; tmp.append(b)
                    if len(out)>=outlen: break
                if ln<0x1f:
                    for b in tmp: put(b)
    except EOFError: pass
    return bytes(out[:outlen])
