import sys,os,struct,glob; sys.path.insert(0,'tools'); import trc,lzss
os.makedirs('out/extract',exist_ok=True); tot=ok=0
for f in sorted(glob.glob('PWAR/_PWAR*.TR?')):
    pk=os.path.basename(f)[5:7]+os.path.basename(f)[-1]; od=f'out/extract/{pk}'; os.makedirs(od,exist_ok=True)
    m,e=trc.load(f)
    for i,x in enumerate(e):
        if m=='TRC':
            d=lzss.unpack(x['data'],x['size']) if x['flag']==1 else x['data']
            good=(len(d)==x['size'] and (sum(d)&0xffff)==x['cksum']); tot+=1; ok+=good
            open(f"{od}/{i:03d}_{x['name']}",'wb').write(d)
            if not good: print("BAD",f,i,x['name'],len(d),x['size'])
        elif m=='TRS':
            open(f"{od}/{i:04d}_{x['w']}x{x['h']}.raw",'wb').write(x['data'][:x['w']*x['h']])
        else: # TRW: wav
            off,size,a,ch,rate,bits,b=struct.unpack_from('<IIHHHHH',open(f,'rb').read(),0x20+i*16)
            pcm=x['data'][:size]
            hdr=b'RIFF'+struct.pack('<I',36+len(pcm))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,rate,rate,1,8)+b'data'+struct.pack('<I',len(pcm))
            open(f"{od}/{i:03d}_{rate}.wav",'wb').write(hdr+pcm)
    print(pk,len(e),'entries')
print("TRC verified",ok,"/",tot)
