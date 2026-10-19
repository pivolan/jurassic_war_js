#!/usr/bin/env bash
# Перекодирование музыки Jurassic War (Amiga MOD, пак 07) в веб-форматы.
#
#   out/extract/07C/000_1.MOD ... 019_START.MOD  ->  out/audio/track01.{m4a,opus}
#
# m4a (AAC-LC, +faststart) — обязательный формат: играется везде, включая Safari.
# opus (Ogg) — опциональный первый источник для Chrome/Firefox, примерно вдвое легче.
#
# Требуется ffmpeg, собранный с --enable-libopenmpt (демуксер libopenmpt отдаёт
# конечную длительность одного прохода трека, зацикливания нет).
#
# Использование: tools/mod2m4a.sh [каталог-с-MOD] [каталог-назначения]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$ROOT/out/extract/07C}"
DST="${2:-$ROOT/out/audio}"

AAC_BITRATE="${AAC_BITRATE:-96k}"
OPUS_BITRATE="${OPUS_BITRATE:-64k}"
MAKE_OPUS="${MAKE_OPUS:-1}"

case "$(ffmpeg -hide_banner -demuxers 2>/dev/null)" in
    *libopenmpt*) ;;
    *) echo "ffmpeg собран без libopenmpt — MOD не декодируется" >&2; exit 1 ;;
esac

mkdir -p "$DST"

for f in "$SRC"/*.MOD; do
    base="$(basename "$f")"
    idx="${base%%_*}"                     # 000..019
    n=$((10#$idx + 1))                    # 1..20
    out=$(printf '%s/track%02d' "$DST" "$n")

    args=( -y -v error
           -f libopenmpt -sample_rate 44100 -layout stereo -i "$f"
           -map 0:a -ac 2 -ar 44100 -c:a aac -b:a "$AAC_BITRATE"
           -movflags +faststart "$out.m4a" )
    if [ "$MAKE_OPUS" = 1 ]; then
        args+=( -map 0:a -ac 2 -ar 48000 -c:a libopus -b:a "$OPUS_BITRATE"
                -vbr on -application audio "$out.opus" )
    fi
    ffmpeg "${args[@]}"
    printf '%-18s -> %s.m4a\n' "$base" "$(basename "$out")"
done
