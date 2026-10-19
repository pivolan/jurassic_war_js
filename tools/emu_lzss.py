import sys,struct; sys.path.insert(0,'tools')
from unicorn import *; from unicorn.x86_const import *
img=open('pwar.img','rb').read()
BASE=0x10000; INBUF=0x6433b8; OUT=0x700000; STACK=0x7f0000
def run(src,outlen):
    mu=Uc(UC_ARCH_X86,UC_MODE_32); mu.mem_map(0,0x800000); mu.mem_write(BASE,img)
    st={'fpos':0}
    def w32(a,v): mu.mem_write(a,struct.pack('<I',v))
    w32(0x476c8,0); w32(0x476cc,1); w32(0x476d0,len(src)); mu.mem_write(0x476d4,b'\0\0')
    mu.mem_write(0x48700,b'\0'); w32(0x48704,0); w32(0x486fc,0); mu.mem_write(0x476dc,b'\0'*0x1000)
    mu.reg_write(UC_X86_REG_EDI,OUT); mu.reg_write(UC_X86_REG_ECX,outlen); mu.reg_write(UC_X86_REG_ESP,STACK)
    w32(STACK,0xdeadbeef)
    def hook_intr(uc,intno,ud):
        ah=(uc.reg_read(UC_X86_REG_EAX)>>8)&0xff
        if intno==0x21 and ah==0x3f:
            n=uc.reg_read(UC_X86_REG_ECX); dx=uc.reg_read(UC_X86_REG_EDX)
            chunk=src[st['fpos']:st['fpos']+n]; st['fpos']+=len(chunk); uc.mem_write(dx,chunk)
            uc.reg_write(UC_X86_REG_EAX,len(chunk)); uc.reg_write(UC_X86_REG_EFLAGS,uc.reg_read(UC_X86_REG_EFLAGS)&~1)
        else: raise Exception("int %x ah=%x"%(intno,ah))
    mu.hook_add(UC_HOOK_INTR,hook_intr)
    err=None
    try: mu.emu_start(BASE+0x1b40e,0xdeadbeef,timeout=60_000_000)
    except UcError as e: err="emu err %s eip=0x%x"%(e,mu.reg_read(UC_X86_REG_EIP))
    n=mu.reg_read(UC_X86_REG_EDI)-OUT
    return bytes(mu.mem_read(OUT,max(n,0))), struct.unpack('<H',mu.mem_read(0x476d4,2))[0], err
if __name__=='__main__':
    import trc,collections
    for f,k in [('_PWAR00.TRC',2),('_PWAR08.TRC',9)]:
        m,e=trc.load('PWAR/'+f)
        for x in e[:k]:
            if x['size']==x['size2']: continue
            o,ck,err=run(x['data'],x['size']); print(x['name'],x['size'],'->',len(o),'cksum',ck,'expected',x['cksum'],'flag',x['flag'],err or '', o[:16].hex(), collections.Counter(o).most_common(3))
