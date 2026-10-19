#!/bin/bash
# usage: fn.sh FUN_xxxxxxxx [maxlines]
f=$1; m=${2:-400}
awk -v f="// ==== $f " 'index($0,f)==1{p=1;next} /^\/\/ ==== /{if(p)exit} p' ../out/decomp_named.c | grep -vE "^\s*\*\(undefined[24] \*\)\((puVar|pcVar|iVar|unaff_EBP|unaff_ESP)[0-9]* \+ -?0x?[0-9a-f]*\) = (0x[0-9a-f]+|in_CS);$" | head -$m
