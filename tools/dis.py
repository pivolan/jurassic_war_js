#!/usr/bin/env python3
"""dis.py START END  — дизассемблер участка pwar.img (адреса как в заметках, база 0x10000)"""
import sys; from capstone import *
img=open(__file__.rsplit('/',2)[0]+'/pwar.img','rb').read(); base=0x10000
s=int(sys.argv[1],16); e=int(sys.argv[2],16) if len(sys.argv)>2 else s+0x100
md=Cs(CS_ARCH_X86,CS_MODE_32); md.skipdata=True
for i in md.disasm(img[s-base:e-base],s): print("%05x  %-8s %s"%(i.address,i.mnemonic,i.op_str))
