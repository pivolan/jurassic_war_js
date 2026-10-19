#!/usr/bin/env python3
"""Build data/boot_snap.bin.z from YOUR OWN copy of Jurassic War 1.05E.

The browser engine starts from a memory image of the original engine taken right after it has
initialised (just before the main menu): linear 0x30000..0x6483c0, i.e. the data segment with all
static tables. This script produces it without DOSBox:

  1. loads PWAR.EXE (LE executable) and relocates it to +0x100000 (code @0x110000, data @0x130000);
  2. runs the real game code under the Unicorn CPU emulator (oracle.py) from the entry point up to
     the main-menu call, with DOS/DPMI calls emulated and CD check / intro / sound skipped;
  3. dumps the data segment and moves every static pointer back by -0x100000;
  4. zlib-compresses it (level 6).

Usage:
  pip install unicorn capstone
  python3 tools/snapshot/make_boot_snap.py --pwar /path/to/game [--out data/boot_snap.bin.z]

/path/to/game must contain PWAR.EXE (version 1.05E) and _SETUP.DAT, _PWAR01.TRC, _PWAR04.TRS,
_PWAR05.TRS, _PWAR11.TRC (file names are case-insensitive)."""
import argparse, hashlib, json, os, struct, sys, zlib

R = 0x100000                                     # relocation shift used by the emulator
DATA_LO, DATA_HI = 0x30000, 0x6483c0
EXE_MD5 = '0c0271736050189548b1df45e85c8097'     # PWAR.EXE "TRIC(R) Jurassic war V1.05E", 342102 bytes

def le_load(exe, shift):
    """LE loader: flat image (base 0x10000+shift) with internal fixups applied for that base.
    Returns (image, base, list of 32-bit pointer fixup sites as unshifted linear addresses)."""
    off = exe.find(b'LE\x00\x00'); h = exe[off:]
    f = lambda o: struct.unpack_from('<I', h, o)[0]
    pagesize, npages, lastpage, nobj, objtab = f(0x28), f(0x14), f(0x2c), f(0x44), f(0x40)
    fixpagetab, fixrectab, datapages = f(0x68), f(0x6c), f(0x80)
    objs = [struct.unpack_from('<IIIIII', h, objtab + i * 24)[:5] for i in range(nobj)]
    lo = min(o[1] for o in objs); hi = max(o[1] + o[4] * pagesize for o in objs)
    img = bytearray(hi - lo); pageaddr = {}
    for vsize, base, flags, pmi, pmc in objs:
        for k in range(pmc):
            p = pmi + k; a = base + k * pagesize; pageaddr[p] = a
            o = datapages + (p - 1) * pagesize; n = lastpage if p == npages else pagesize
            img[a - lo:a - lo + pagesize] = exe[o:o + n].ljust(pagesize, b'\0')
    sites = []
    for p in range(1, npages + 1):
        r = fixrectab + f(fixpagetab + (p - 1) * 4); end = fixrectab + f(fixpagetab + p * 4)
        while r < end:
            src, fl = h[r], h[r + 1]; r += 2
            st, lst = src & 0x0f, src & 0x20
            if lst: cnt = h[r]; r += 1; srcs = []
            else: srcs = [struct.unpack_from('<h', h, r)[0]]; r += 2
            if fl & 3: sys.exit('imported fixups are not supported')
            if fl & 0x40: obj = struct.unpack_from('<H', h, r)[0]; r += 2
            else: obj = h[r]; r += 1
            toff = 0
            if st != 2:
                if fl & 0x10: toff = f(r); r += 4
                else: toff = struct.unpack_from('<H', h, r)[0]; r += 2
            if fl & 4: sys.exit('additive fixups are not supported')
            if lst:
                for _ in range(cnt): srcs.append(struct.unpack_from('<h', h, r)[0]); r += 2
            target = objs[obj - 1][1] + toff
            for so in srcs:
                a = pageaddr[p] + so
                if st in (6, 7): struct.pack_into('<I', img, a - lo, target + shift); sites.append(a)
                elif st == 5: struct.pack_into('<H', img, a - lo, (target + shift) & 0xffff)
                elif st == 8: struct.pack_into('<i', img, a - lo, target - (a + 4))
                elif st == 2: pass
                else: sys.exit('fixup source type %d is not supported' % st)
    return bytes(img), lo, sites

def find(folder, name):
    for f in os.listdir(folder):
        if f.lower() == name.lower(): return os.path.join(folder, f)
    return None

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pwar', required=True, help='folder with the original game files')
    here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(os.path.dirname(here))
    ap.add_argument('--out', default=os.path.join(root, 'data', 'boot_snap.bin.z'))
    a = ap.parse_args()
    exe_path = find(a.pwar, 'PWAR.EXE')
    if not exe_path: sys.exit('PWAR.EXE not found in ' + a.pwar)
    for need in ('_SETUP.DAT', '_PWAR01.TRC', '_PWAR04.TRS', '_PWAR05.TRS', '_PWAR11.TRC'):
        if not find(a.pwar, need): sys.exit(need + ' not found in ' + a.pwar)
    exe = open(exe_path, 'rb').read()
    md5 = hashlib.md5(exe).hexdigest()
    if md5 != EXE_MD5: print('warning: PWAR.EXE md5 %s differs from 1.05E (%s); the port expects 1.05E' % (md5, EXE_MD5))
    img, base, sites = le_load(exe, R)
    reloc = os.path.join(here, 'pwar_reloc.img'); open(reloc, 'wb').write(img)
    # the emulator opens game files by base name; make them findable regardless of case
    folder = os.path.join(here, '_pwar'); os.makedirs(folder, exist_ok=True)
    for f in os.listdir(a.pwar):
        dst = os.path.join(folder, f.upper())
        if not os.path.exists(dst): os.symlink(os.path.abspath(os.path.join(a.pwar, f)), dst)
    os.environ['JW_PWAR'] = folder; os.environ['JW_RELOC_IMG'] = reloc
    sys.path.insert(0, here); import oracle
    print('booting the original engine under emulation (about 15 s)...')
    o = oracle.Oracle(); o.boot()
    snap = bytearray(o.mem(DATA_LO, DATA_HI - DATA_LO))
    # static pointers inside the dumped range were relocated by +R: move them back
    n = 0
    for s in sites:
        if DATA_LO <= s < DATA_HI - 3:
            v = struct.unpack_from('<I', snap, s - DATA_LO)[0]
            if R + 0x10000 <= v < DATA_HI + R: struct.pack_into('<I', snap, s - DATA_LO, v - R); n += 1
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, 'wb').write(zlib.compress(bytes(snap), 6))
    print('wrote %s (%d bytes raw, %d pointers un-shifted, md5 %s)' % (a.out, len(snap), n, hashlib.md5(snap).hexdigest()))

if __name__ == '__main__':
    main()
