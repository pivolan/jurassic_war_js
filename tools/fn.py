import sys,re
src=open('out/decomp_named.c').read().split('\n')
starts=[(i,l) for i,l in enumerate(src) if l.startswith('// ====')]
for name in sys.argv[1:]:
    for k,(i,l) in enumerate(starts):
        if name in l:
            j=starts[k+1][0] if k+1<len(starts) else len(src)
            print('\n'.join(src[i:j])); break
    else: print("NOT FOUND",name)
