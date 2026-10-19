import struct,sys
d=open(sys.argv[1],'rb').read(); out=sys.argv[2]
off=d.find(b'LE\x00\x00'); h=d[off:]
f=lambda o:struct.unpack_from('<I',h,o)[0]
pagesize=f(0x28); npages=f(0x14); lastpage=f(0x2c); nobj=f(0x44); objtab=f(0x40)
fixpagetab=f(0x68); fixrectab=f(0x6c); datapages=f(0x80)
objs=[]
for i in range(nobj):
    vsize,base,flags,pmi,pmc,res=struct.unpack_from('<IIIIII',h,objtab+i*24); objs.append((vsize,base,flags,pmi,pmc))
def pagedata(p):  # 1-based
    o=datapages+(p-1)*pagesize; n=lastpage if p==npages else pagesize
    return d[o:o+n].ljust(pagesize,b'\0')
lo=min(b for _,b,_,_,_ in objs); hi=max(b+pc*pagesize for _,b,_,pm,pc in objs)
img=bytearray(hi-lo)
pageaddr={}
for vsize,base,flags,pmi,pmc in objs:
    for k in range(pmc):
        p=pmi+k; a=base+k*pagesize; pageaddr[p]=a; img[a-lo:a-lo+pagesize]=pagedata(p)
# fixups
nfix=0; kinds={}
for p in range(1,npages+1):
    s=f(fixpagetab+(p-1)*4); e=f(fixpagetab+p*4); r=fixrectab+s; end=fixrectab+e
    while r<end:
        src=h[r]; fl=h[r+1]; r+=2
        st=src&0x0f; lst=src&0x20
        if lst: cnt=h[r]; r+=1; srcs=[]
        else: so=struct.unpack_from('<h',h,r)[0]; r+=2; srcs=[so]
        tt=fl&3
        if tt!=0: raise SystemExit("imported fixup unsupported")
        if fl&0x40: obj=struct.unpack_from('<H',h,r)[0]; r+=2
        else: obj=h[r]; r+=1
        toff=0
        if st!=2:
            if fl&0x10: toff=f(r); r+=4
            else: toff=struct.unpack_from('<H',h,r)[0]; r+=2
        if fl&4: raise SystemExit("additive unsupported")
        if lst:
            for _ in range(cnt): srcs.append(struct.unpack_from('<h',h,r)[0]); r+=2
        target=objs[obj-1][1]+toff
        kinds[st]=kinds.get(st,0)+1
        for so in srcs:
            a=pageaddr[p]+so
            if st==7: struct.pack_into('<I',img,a-lo,target)
            elif st==5: struct.pack_into('<H',img,a-lo,target&0xffff)
            elif st==2: pass  # selector
            elif st==6: struct.pack_into('<I',img,a-lo,target)  # 16:32 offset part
            elif st==8: struct.pack_into('<i',img,a-lo,target-(a+4))
            else: raise SystemExit("src type %d"%st)
            nfix+=1
open(out,'wb').write(img)
print("base=0x%x size=0x%x fixups=%d kinds=%s entry=0x%x"%(lo,len(img),nfix,kinds,objs[f(0x18)-1][1]+f(0x1c)))
