#!/usr/bin/env bash
# Prepare a runnable Jurassic War JS port from YOUR OWN copy of the original game (version 1.05E).
#
#   ./setup.sh /path/to/your/game        # folder with PWAR.EXE and the _PWAR??.TR? archives
#   ./setup.sh /path/to/your/game --music --video   # also convert music and cinematics (needs ffmpeg)
#
# What it does (nothing is downloaded, everything is built from your files):
#   1. links your game files into ./PWAR/
#   2. builds reimpl/data/boot_snap.bin.z — the engine memory image (Python + unicorn + capstone)
#   3. builds out/ui/_UI_BOOT.TRS (fast-start UI pack), tribe icons and lobby minimaps (Node.js)
#   4. optionally: music -> out/audio (ffmpeg with libopenmpt), cinematics -> out/video (ffmpeg)
#   5. links ui/, audio/, video/ next to reimpl/ — the layout the web page expects
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$ROOT"
GAME="${1:-}"; shift || true
MUSIC=0; VIDEO=0
for a in "$@"; do case "$a" in --music) MUSIC=1 ;; --video) VIDEO=1 ;; *) echo "unknown option $a"; exit 1 ;; esac; done
[ -n "$GAME" ] && [ -d "$GAME" ] || { echo "usage: ./setup.sh /path/to/your/game [--music] [--video]"; exit 1; }

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)"; exit 1; }; }
need python3 "Python 3.9+"; need node "Node.js 18+"

say "1/5 linking game files into PWAR/"
mkdir -p PWAR
G="$(cd "$GAME" && pwd)"
for f in "$G"/*; do
  b="$(basename "$f" | tr '[:lower:]' '[:upper:]')"
  case "$b" in PWAR.EXE|_SETUP.DAT|_PWAR??.TR?) ln -sf "$f" "PWAR/$b" ;; esac
done
for f in PWAR.EXE _SETUP.DAT _PWAR01.TRC _PWAR02.TRS _PWAR04.TRS _PWAR05.TRS _PWAR06.TRW _PWAR08.TRC _PWAR09.TRC _PWAR11.TRC; do
  [ -e "PWAR/$f" ] || { echo "required file $f not found in $GAME"; exit 1; }
done
for f in _PWAR10.TRC _PWAR13.TRC; do [ -e "PWAR/$f" ] || echo "note: $f missing — extra/demo maps will be unavailable"; done

say "2/5 engine snapshot (reimpl/data/boot_snap.bin.z)"
python3 -c "import unicorn, capstone" 2>/dev/null || { echo "installing unicorn + capstone"; python3 -m pip install --user unicorn capstone; }
python3 tools/snapshot/make_boot_snap.py --pwar PWAR --out reimpl/data/boot_snap.bin.z

say "3/5 UI pack, tribe icons, minimaps"
python3 tools/ui_bundle.py
mkdir -p out/ui/icons && node tools/tribe_icons.mjs 0 1 2 3 4 5 6 7
node tools/minimaps.mjs || echo "minimaps skipped (needs _PWAR10/_PWAR13)"

if [ "$MUSIC$VIDEO" != "00" ]; then
  say "4/5 unpacking archives for music/video (out/extract)"
  python3 tools/extract_all.py
  [ "$MUSIC" = 1 ] && bash tools/mod2m4a.sh
  [ "$VIDEO" = 1 ] && bash tools/fli2mp4.sh
else
  say "4/5 music and video skipped (run with --music --video to convert them)"
fi

say "5/5 web layout"
mkdir -p out/audio out/video
for d in ui audio video; do ln -sfn "out/$d" "$d"; done
cat <<MSG

Done. Start any static web server in this folder, for example:

    python3 -m http.server 8000

and open   http://localhost:8000/reimpl/web/game.html

MSG
