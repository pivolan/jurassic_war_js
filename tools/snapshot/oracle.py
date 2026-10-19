#!/usr/bin/env python3
"""Эталон: настоящий код pwar.exe под unicorn (образ сдвинут на +0x100000: код @0x110000, данные @0x130000).
Все адреса из заметок (база 0x10000) задаются как есть и переводятся через A()."""
import struct, os, sys, hashlib
from unicorn import *
from unicorn.x86_const import *
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

HERE=os.path.dirname(os.path.abspath(__file__)); JW=os.path.dirname(os.path.dirname(HERE))
PWAR=os.environ.get('JW_PWAR') or os.path.join(JW,'PWAR')          # folder with the original game files
RELOC=0x100000
def A(a): return a+RELOC
IMG=open(os.environ.get('JW_RELOC_IMG') or os.path.join(HERE,'pwar_reloc.img'),'rb').read();   # made by make_boot_snap.py
BASE=A(0x10000); CODE_END=0x1dbac
RET=0xdead0000; STACK=0x7f0000; HEAP=0x1000000; HEAP_END=0x9000000
VRAM=0xA0000; LOWPOOL=(0x20000,0x90000)   # DOS-память для DPMI 0x100
G=dict(mission=0x31abb, tribe=0x31b64, difficulty=0x31aba, speed=0x30098, countdown=0x3033c, step=0x31ab4,
       ticks=0x31ab0, lastTimer=0x36d80, norender=0x30346, unitHead=0x31b6c, food=0x31c28,
       endcode=0x30349, music=0x30344, netflag=0x333c0, curfile=0x475a8, curentry=0x475a4, soundtype=0x30083, gameover=0x303b0)
UNITS=0xe4400; UNIT_SZ=96; NUNITS=600
F=dict(entry=0x10064, menu_call=0x100f9, start=0x15026, diff=0x1545a, music=0x20298, aiinit=0x15da1, tick=0x17e1c,
       victory=0x17728, addorder=0x14895, unload=0x10713)
STUBS={0x2b91c:'cdcheck', 0x2100a:'intro', 0x2b217:'sndmodule', 0x2cd97:'sfxload'}   # функции, которые пропускаем (CF=0)

class Oracle:
    def __init__(self, log=False):
        self.log=log; self.files={}; self.nexth=5; self.heap=HEAP; self.low=LOWPOOL[0]; self.selbase={}; self.fatal=None
        self.palette=bytearray(768); self.dac_idx=0; self.dac_sub=0; self.calls=[]
        mu=self.mu=Uc(UC_ARCH_X86,UC_MODE_32)
        mu.mem_map(0,0x100000)                 # BIOS/DOS/VRAM
        mu.mem_map(0x100000,0x700000)          # программа: код 0x110000, данные 0x130000..0x7483c0
        mu.mem_map(HEAP,HEAP_END-HEAP)
        mu.mem_write(BASE,IMG)
        self._gdt()
        md=Cs(CS_ARCH_X86,CS_MODE_32); md.skipdata=True
        self.skip={i.address:i.size for i in md.disasm(IMG[:CODE_END],BASE) if i.mnemonic=='call' and '0x%x'%A(0x30c46) in i.op_str}
        self.stubs={A(a):n for a,n in STUBS.items()}
        mu.hook_add(UC_HOOK_CODE,self._code,begin=BASE,end=BASE+CODE_END)
        mu.hook_add(UC_HOOK_INTR,self._intr)
        mu.hook_add(UC_HOOK_INSN,self._in,None,1,0,UC_X86_INS_IN)
        mu.hook_add(UC_HOOK_INSN,self._out,None,1,0,UC_X86_INS_OUT)
        mu.hook_add(UC_HOOK_MEM_UNMAPPED,self._unmapped)
        self.autotimer=True; mu.hook_add(UC_HOOK_MEM_READ,self._timer_read,begin=0x46c,end=0x46f)
        self.timer=0; mu.mem_write(0x46c,struct.pack('<I',0)); self.vsync=0
        mu.mem_write(0x463,struct.pack('<H',0x3d4)); mu.mem_write(0x449,bytes([3])); mu.mem_write(0x44a,struct.pack('<H',80)); mu.mem_write(0x484,bytes([24]))
    def _gdt(self):
        mu=self.mu; gdt=0xF0000
        def desc(base,limit,flags):  # flags: 0xcf9a code / 0xcf92 data (4K gran, 32-bit)
            return struct.pack('<HHBBBB',limit&0xffff,base&0xffff,(base>>16)&0xff,flags&0xff,((limit>>16)&0xf)|((flags>>8)&0xf0),(base>>24)&0xff)
        mu.mem_write(gdt,b'\0'*8+desc(0,0xfffff,0xcf9a)+desc(0,0xfffff,0xcf92))
        mu.reg_write(UC_X86_REG_GDTR,(0,gdt,8*3-1,0))
        mu.reg_write(UC_X86_REG_CS,0x08)
        for r in (UC_X86_REG_DS,UC_X86_REG_ES,UC_X86_REG_SS,UC_X86_REG_FS,UC_X86_REG_GS): mu.reg_write(r,0x10)
    # --- memory helpers (doc addresses)
    def r8(self,a): return self.mu.mem_read(A(a),1)[0]
    def r16(self,a): return struct.unpack('<H',self.mu.mem_read(A(a),2))[0]
    def r32(self,a): return struct.unpack('<I',self.mu.mem_read(A(a),4))[0]
    def w8(self,a,v): self.mu.mem_write(A(a),bytes([v&0xff]))
    def w16(self,a,v): self.mu.mem_write(A(a),struct.pack('<H',v&0xffff))
    def w32(self,a,v): self.mu.mem_write(A(a),struct.pack('<I',v&0xffffffff))
    def mem(self,a,n): return bytes(self.mu.mem_read(A(a),n))
    def rstr(self,lin):
        b=b''
        while len(b)<200:
            c=bytes(self.mu.mem_read(lin,1))
            if c==b'\0': break
            b+=c; lin+=1
        return b.decode('latin1')
    # --- hooks
    def _code(self,uc,addr,size,ud):
        if addr in self.skip: uc.reg_write(UC_X86_REG_EIP,addr+self.skip[addr]); self.setcf(0); uc.reg_write(UC_X86_REG_EAX,0); return
        if addr in self.stubs:
            esp=uc.reg_read(UC_X86_REG_ESP); ret=struct.unpack('<I',uc.mem_read(esp,4))[0]
            uc.reg_write(UC_X86_REG_ESP,esp+4); uc.reg_write(UC_X86_REG_EAX,0); self.setcf(0); uc.reg_write(UC_X86_REG_EIP,ret)
            if self.log: print("stub",self.stubs[addr])
    def _timer_read(self,uc,access,addr,size,value,ud):
        if self.autotimer: self.timer+=1; uc.mem_write(0x46c,struct.pack('<I',self.timer))
    def _unmapped(self,uc,access,addr,size,value,ud):
        print("UNMAPPED access %d at 0x%x size %d eip=0x%x"%(access,addr,size,uc.reg_read(UC_X86_REG_EIP))); return False
    def _in(self,uc,port,size,ud):
        if port==0x60: return 0
        if port==0x3da: self.vsync^=0x09; return self.vsync   # чередуем: ждут и начала, и конца обратного хода
        return 0
    def _out(self,uc,port,size,value,ud):
        if port==0x3c8: self.dac_idx=value&0xff; self.dac_sub=0
        elif port==0x3c9:
            self.palette[self.dac_idx*3+self.dac_sub]=(value&0x3f)<<2; self.dac_sub+=1
            if self.dac_sub==3: self.dac_sub=0; self.dac_idx=(self.dac_idx+1)&0xff
    def setcf(self,v):
        f=self.mu.reg_read(UC_X86_REG_EFLAGS); self.mu.reg_write(UC_X86_REG_EFLAGS,(f|1) if v else (f&~1))
    def setzf(self,v):
        f=self.mu.reg_read(UC_X86_REG_EFLAGS); self.mu.reg_write(UC_X86_REG_EFLAGS,(f|0x40) if v else (f&~0x40))
    def _intr(self,uc,intno,ud):
        eax=uc.reg_read(UC_X86_REG_EAX); ah=(eax>>8)&0xff; al=eax&0xff
        if intno==0x21: return self._dos(uc,ah,al,eax)
        if intno==0x31: return self._dpmi(uc,eax&0xffff)
        if intno==0x10: return self._video(uc,eax&0xffff, lambda r,v: uc.reg_write(r,v), uc.reg_read)
        if intno==0x33: return self._mouse(uc,eax&0xffff)
        if intno==0x16:
            if ah==1: self.setzf(1); uc.reg_write(UC_X86_REG_EAX,0); return
            uc.reg_write(UC_X86_REG_EAX,0); return
        if intno==0x2f:
            ax=eax&0xffff
            if ax==0x1500: uc.reg_write(UC_X86_REG_EBX,1); uc.reg_write(UC_X86_REG_ECX,3); return
            if ax==0x1687: uc.reg_write(UC_X86_REG_EAX,1); return
            uc.reg_write(UC_X86_REG_EAX,0); return
        raise Exception("int %x ah=%x eip=%x"%(intno,ah,uc.reg_read(UC_X86_REG_EIP)))
    def _video(self,uc,ax,W,R):
        if ax==0x4f02: W(UC_X86_REG_EAX,0x004f); return
        if ax==0x4f05: W(UC_X86_REG_EAX,0x004f); return
        if ax==0x1a00: W(UC_X86_REG_EAX,0x1a08); return
        if (ax>>8)==0x0f: W(UC_X86_REG_EAX,0x5003); return
        if (ax>>8)==0x4f: W(UC_X86_REG_EAX,0x004f); return
        return
    def _mouse(self,uc,ax):
        W=uc.reg_write
        if ax==0: W(UC_X86_REG_EAX,0xffff); W(UC_X86_REG_EBX,2); return
        if ax==3: W(UC_X86_REG_EBX,0); W(UC_X86_REG_ECX,320); W(UC_X86_REG_EDX,240); return
        if ax==0x24: W(UC_X86_REG_EBX,0x0800); W(UC_X86_REG_ECX,0x0400); return
        W(UC_X86_REG_EAX,0); return
    def _dos(self,uc,ah,al,eax):
        R=uc.reg_read; W=uc.reg_write
        if ah==0x3d:
            name=self.rstr(R(UC_X86_REG_EDX)); base=os.path.basename(name.replace('\\','/')); path=os.path.join(PWAR,base)
            if not os.path.exists(path):
                if self.log: print("open FAIL",name)
                W(UC_X86_REG_EAX,2); self.setcf(1); return
            h=self.nexth; self.nexth+=1; data=open(path,'rb').read()
            if base.upper()=='_SETUP.DAT': data=bytearray(data); data[0x23]=0; data=bytes(data)   # звук = MODNULL
            self.files[h]=[data,0]
            if self.log: print("open",name,"->",h)
            W(UC_X86_REG_EAX,h); self.setcf(0); return
        if ah==0x3e: self.files.pop(R(UC_X86_REG_EBX)&0xffff,None); W(UC_X86_REG_EAX,0); self.setcf(0); return
        if ah==0x3f:
            h=R(UC_X86_REG_EBX)&0xffff; n=R(UC_X86_REG_ECX); dst=R(UC_X86_REG_EDX)
            if h not in self.files: W(UC_X86_REG_EAX,6); self.setcf(1); return
            data,pos=self.files[h]; chunk=data[pos:pos+n]; self.files[h][1]=pos+len(chunk)
            if chunk: uc.mem_write(dst,chunk)
            W(UC_X86_REG_EAX,len(chunk)); self.setcf(0); return
        if ah==0x3c:  # create file: «провал» = диск только для чтения (проверка CD)
            W(UC_X86_REG_EAX,5); self.setcf(1); return
        if ah==0x40:  # write (сохранения) — игнорируем
            W(UC_X86_REG_EAX,R(UC_X86_REG_ECX)); self.setcf(0); return
        if ah==0x42:
            h=R(UC_X86_REG_EBX)&0xffff; off=((R(UC_X86_REG_ECX)&0xffff)<<16)|(R(UC_X86_REG_EDX)&0xffff)
            if off>=0x80000000: off-=0x100000000
            data,pos=self.files[h]; np={0:off,1:pos+off,2:len(data)+off}[al]
            self.files[h][1]=np; W(UC_X86_REG_EAX,np&0xffff); W(UC_X86_REG_EDX,(np>>16)&0xffff); self.setcf(0); return
        if ah==0x4c:
            self.fatal=self.rstr(self.r32(G['curfile'])); raise Exception("DOS exit al=%d msg=%r"%(al,self.fatal))
        if ah in (0x25,0x35,0x2c,0x2a,0x44,0x41,0x30,0x19,0x0e,0x1a,0x4e,0x4f,0x43,0x3b,0x48,0x49,0x4a,0x2d,0x2b,0x0d,0x1c,0x36):
            if ah==0x36: W(UC_X86_REG_EAX,64); W(UC_X86_REG_EBX,0x8000); W(UC_X86_REG_ECX,512); W(UC_X86_REG_EDX,0xffff)
            elif ah==0x2c: W(UC_X86_REG_ECX,0); W(UC_X86_REG_EDX,0)
            elif ah==0x30: W(UC_X86_REG_EAX,0x0007)
            elif ah==0x19: W(UC_X86_REG_EAX,2)
            elif ah==0x48: W(UC_X86_REG_EAX,0x1000)
            else: W(UC_X86_REG_EAX,0)
            self.setcf(0); return
        raise Exception("DOS ah=%x eip=%x"%(ah,uc.reg_read(UC_X86_REG_EIP)))
    def _dpmi(self,uc,ax):
        R=uc.reg_read; W=uc.reg_write
        if ax==0x100:   # alloc DOS mem: BX paragraphs -> AX segment, DX selector
            n=(R(UC_X86_REG_EBX)&0xffff)*16
            if self.low+n<=LOWPOOL[1]: a=self.low; self.low=(self.low+n+0xf)&~0xf; seg=a>>4
            else: a=self.heap; self.heap=(self.heap+n+0xfff)&~0xfff; seg=0xf000+len(self.selbase)
            sel=0x100+len(self.selbase)*8; self.selbase[sel]=a; self.selbase[seg]=a
            W(UC_X86_REG_EAX,seg); W(UC_X86_REG_EDX,sel); self.setcf(0)
            if self.log: print("dpmi dosalloc %x -> seg %x lin %x"%(n,seg,a))
            return
        if ax==0x101: self.setcf(0); return
        if ax==0x6:     # get base of selector BX -> CX:DX
            sel=R(UC_X86_REG_EBX)&0xffff; b=self.selbase.get(sel,0)
            W(UC_X86_REG_ECX,b>>16); W(UC_X86_REG_EDX,b&0xffff); self.setcf(0); return
        if ax in (0x0,0xa):   # alloc descriptor / alias -> AX selector (плоский)
            W(UC_X86_REG_EAX,0x10); self.setcf(0); return
        if ax in (0x1,0x7,0x8,0x9,0xc,0xd,0x502,0x303,0x304,0x204,0x205,0x505): self.setcf(0); return
        if ax==0x501:
            size=((R(UC_X86_REG_EBX)&0xffff)<<16)|(R(UC_X86_REG_ECX)&0xffff)
            a=self.heap; self.heap=(self.heap+size+0xfff)&~0xfff
            if self.heap>HEAP_END: raise Exception("heap exhausted")
            W(UC_X86_REG_EBX,a>>16); W(UC_X86_REG_ECX,a&0xffff); W(UC_X86_REG_ESI,a>>16); W(UC_X86_REG_EDI,a&0xffff); self.setcf(0); return
        if ax==0x500:
            uc.mem_write(R(UC_X86_REG_EDI),struct.pack('<I',0x4000000)*12); self.setcf(0); return
        if ax==0x800:   # physical map -> BX:CX linear (VRAM)
            W(UC_X86_REG_EBX,VRAM>>16); W(UC_X86_REG_ECX,VRAM&0xffff); self.setcf(0); return
        if ax==0x300:   # simulate real-mode int BL with call structure at ES:EDI
            p=R(UC_X86_REG_EDI); bl=R(UC_X86_REG_EBX)&0xff; cs=bytearray(uc.mem_read(p,0x32))
            eaxv=struct.unpack_from('<I',cs,0x1c)[0]; es=struct.unpack_from('<H',cs,0x22)[0]; di=struct.unpack_from('<I',cs,0)[0]&0xffff
            buf=(es<<4)+di
            if bl==0x10:
                axv=eaxv&0xffff
                if axv==0x4f00:
                    uc.mem_write(buf,b'VESA'+struct.pack('<H',0x0102)+b'\0'*250)
                elif axv==0x4f01:
                    mi=bytearray(256); struct.pack_into('<HBBHHHHIHHHBBBBBBBBBB',mi,0,0x1b,7,0,64,64,0xa000,0,0,640,640,480,8,16,1,8,1,4,0,1,0,0)
                    uc.mem_write(buf,bytes(mi))
                struct.pack_into('<I',cs,0x1c,0x004f)
            else:
                struct.pack_into('<I',cs,0x1c,0)
            struct.pack_into('<H',cs,0x20,0)   # flags: CF clear
            uc.mem_write(p,bytes(cs)); self.setcf(0); return
        raise Exception("DPMI ax=%x eip=%x"%(ax,uc.reg_read(UC_X86_REG_EIP)))
    # --- calling into the game
    def call(self,addr,eax=0,ebx=0,ecx=0,edx=0,esi=0,edi=0,until=None):
        mu=self.mu; mu.reg_write(UC_X86_REG_ESP,STACK); mu.mem_write(STACK,struct.pack('<I',RET))
        for r,v in ((UC_X86_REG_EAX,eax),(UC_X86_REG_EBX,ebx),(UC_X86_REG_ECX,ecx),(UC_X86_REG_EDX,edx),(UC_X86_REG_ESI,esi),(UC_X86_REG_EDI,edi)): mu.reg_write(r,v)
        mu.emu_start(A(addr),A(until) if until else RET,timeout=0,count=0)
    def boot(self):
        """init игры как при запуске, до вызова меню"""
        self.autotimer=True; self.call(F['entry'],until=F['menu_call']); self.autotimer=False
    def start(self,mission=0,tribe=0,difficulty=1):
        self.w8(G['mission'],mission); self.w8(G['tribe'],tribe); self.w8(G['difficulty'],difficulty)
        self.w16(G['speed'],1); self.w16(G['countdown'],1); self.w8(G['norender'],1); self.w8(G['music'],0); self.w8(G['netflag'],0)
        self.call(F['unload']); self.call(F['start']); self.call(F['diff']); self.call(F['music']); self.call(F['aiinit'])
        self.w32(G['step'],0); self.w32(G['ticks'],0); self.w8(G['endcode'],0); self.w16(G['gameover'],0)
    def step(self,n=1):
        for _ in range(n):
            self.timer+=1; self.mu.mem_write(0x46c,struct.pack('<I',self.timer)); self.call(F['tick'])
            if self.r8(G['endcode'])!=0 or (self.r16(G['step'])&0x1f)==0: self.call(F['victory'])
    def order(self,code,unit=0,target=0,x=0,y=0):
        """Приказ как из UI: выделить юнит (+0x07 бит 0x80, 0x31adc) и положить «ожидающий клик» (0x31acc код, 0x31ad0 цель, 0x31ad4 x, 0x31ad8 y).
        Применяется в начале следующего тика (FUN_00013f4c → 0x1419e → обработчики по коду>>4)."""
        i=self.r32(G['unitHead'])
        while i:
            self.w8(UNITS+i+7, self.r8(UNITS+i+7)&0x7f); i=self.r32(UNITS+i+0x60)
        if unit: self.w8(UNITS+unit+7, self.r8(UNITS+unit+7)|0x80); self.w32(0x31adc,unit)
        self.w8(0x31acc,code); self.w32(0x31ad0,target); self.w32(0x31ad4,x); self.w32(0x31ad8,y)
    # --- state
    def units(self):
        out=[]; i=self.r32(G['unitHead'])
        while i:
            out.append((i,self.mem(UNITS+i,UNIT_SZ))); i=self.r32(UNITS+i+0x60)
        return out
    def pool(self): return self.mem(UNITS,NUNITS*UNIT_SZ)
    def state_hash(self):
        h=hashlib.md5(); h.update(self.pool()); h.update(self.mem(G['food'],32)); return h.hexdigest()[:12]
    def food(self): return [self.r32(G['food']+i*4) for i in range(8)]
    def stepno(self): return self.r16(G['step'])

if __name__=='__main__':
    import time
    m=int(sys.argv[1]) if len(sys.argv)>1 else 0; t=int(sys.argv[2]) if len(sys.argv)>2 else 0; n=int(sys.argv[3]) if len(sys.argv)>3 else 50
    o=Oracle(log='-v' in sys.argv); t0=time.time()
    o.boot(); print("boot ok %.1fs heap used %.1fMB low %x"%(time.time()-t0,(o.heap-HEAP)/1e6,o.low))
    o.start(m,t); us=o.units(); print("mission",m,"tribe",t,"units",len(us),"food",o.food(),"hash",o.state_hash())
    from collections import Counter; print("types",sorted(Counter(u[1][4] for u in us).items()))
    t0=time.time()
    for k in range(n):
        o.step()
        if k%10==0 or k==n-1: print("step",o.stepno(),"hash",o.state_hash(),"food",o.food()[:2],"units",len(o.units()))
    print("%.2f s/step"%((time.time()-t0)/n))
