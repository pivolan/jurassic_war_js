#!/bin/bash
# Jurassic War: перекодирование игровых роликов FLI (пак 11) в веб-видео.
#
#   tools/fli2mp4.sh [--only NAME] [--no-webm]
#
# Источник: out/extract/11C/NNN_*.FLI  (Autodesk Animator FLI, 320x200x8, 14 fps, без звука)
# Результат: out/video/{intro,winNN}.{mp4,webm} + poster_intro.jpg/png
#
# Решения:
#  * 320x200 -> 640x400 nearest (целочисленный x2, чёткий пиксель; при 4:2:0 хрома
#    получается ровно в разрешении исходника, т.е. цвет не теряется вообще);
#  * H.264 High@3.1, yuv420p, faststart, GOP 5 c  -> играет везде (Safari macOS/iOS,
#    Chrome, Firefox, Android), аппаратный декод;
#  * цвет явно приводится и тегируется bt709 (иначе разные браузеры трактуют
#    нетегированный SD как bt601/bt709 и цвета плывут), дизеринг swscale выключен;
#  * VP9/WebM — второй вариант, на этом дизеренном материале заметно меньше при
#    той же картинке (см. отчёт), подключать как <source> ПЕРЕД mp4;
#  * последний («кольцевой») кадр FLI отбрасывается — иначе ролик в конце моргает
#    своим первым кадром;
#  * записи NULLDAT (1 чёрный кадр) пропускаются — для этих стадий игра показывает
#    WINnn.SPR из пака 09.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/out/extract/11C"
DST="$ROOT/out/video"

# Качество: интро длинное (~2.5 мин), ему CRF пожёстче; ролики победы короткие.
CRF_INTRO_H264=26
CRF_CLIP_H264=24
CRF_INTRO_VP9=38
CRF_CLIP_VP9=36

# Важно: pal8 -> yuv420p одним шагом swscale делает С ДИЗЕРИНГОМ, который не
# отключается (и который на этом материале раздувает битрейт в ~5 раз). Поэтому
# сначала честный pal8 -> rgb24 (точное развёртывание палитры), потом rgb24 ->
# yuv420p с "-sws_dither none" и матрицей bt709.
SCALE="scale=640:400:flags=neighbor,format=rgb24,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
SWS=(-sws_dither none)
GOP=70          # 5 секунд при 14 fps — вменяемая перемотка

ONLY=""
DO_WEBM=1
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --no-webm) DO_WEBM=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$DST"

# запись пака 11 -> имя на выходе (0 = интро, N = ролик победы стадии N)
name_for() {
  case "$1" in
    0) echo intro ;;
    *) printf 'win%02d\n' "$1" ;;
  esac
}

fli_frames() {   # число кадров из заголовка FLI (u16 @ 0x06, little-endian)
  od -An -tu2 -j6 -N2 "$1" | tr -d ' \n'
}

is_nulldat() {   # 1 кадр в заголовке FLI = заглушка
  python3 - "$1" <<'PY'
import struct, sys
d = open(sys.argv[1], 'rb').read(18)
_, magic, frames = struct.unpack('<IHH', d[:8])
sys.exit(0 if (magic == 0xAF11 and frames <= 1) else 1)
PY
}

encode_h264() {  # $1 src  $2 dst  $3 crf  $4 кадров
  ffmpeg -nostdin -v warning -stats "${SWS[@]}" -i "$1" \
    -vf "$SCALE" -fps_mode cfr -r 14 -frames:v "$4" \
    -c:v libx264 -preset slow -crf "$3" \
    -profile:v high -level 3.1 -g "$GOP" -keyint_min 14 -sc_threshold 40 \
    -x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709 \
    -movflags +faststart -an -y "$2"
}

encode_vp9() {   # $1 src  $2 dst  $3 crf  $4 кадров  (two-pass constant quality)
  local log; log="$(mktemp -u "${TMPDIR:-/tmp}/vp9log.XXXXXX")"
  local common=(-vf "$SCALE" -fps_mode cfr -r 14 -frames:v "$4"
                -c:v libvpx-vp9 -crf "$3" -b:v 0 -g "$GOP"
                -row-mt 1 -tile-columns 2 -frame-parallel 0
                -auto-alt-ref 1 -lag-in-frames 25
                -color_primaries bt709 -color_trc bt709 -colorspace bt709 -an)
  ffmpeg -nostdin -v warning -stats "${SWS[@]}" -i "$1" "${common[@]}" -cpu-used 4 -pass 1 -passlogfile "$log" -f webm -y /dev/null
  ffmpeg -nostdin -v warning -stats "${SWS[@]}" -i "$1" "${common[@]}" -cpu-used 1 -pass 2 -passlogfile "$log" -y "$2"
  rm -f "${log}"-*.log
}

skipped=()
for f in "$SRC"/[0-9][0-9][0-9]_*.FLI; do
  base="$(basename "$f")"
  rec=$((10#${base:0:3}))
  out="$(name_for "$rec")"
  [ -n "$ONLY" ] && [ "$ONLY" != "$out" ] && continue
  if is_nulldat "$f"; then
    skipped+=("$base (запись $rec)")
    echo "== skip $base — заглушка NULLDAT, ролика нет"
    continue
  fi
  if [ "$out" = intro ]; then ch=$CRF_INTRO_H264; cv=$CRF_INTRO_VP9; else ch=$CRF_CLIP_H264; cv=$CRF_CLIP_VP9; fi

  # ffmpeg отдаёт на 1 кадр больше, чем в заголовке: последний кадр FLI —
  # «кольцевой» (дельта обратно на первый кадр, для зацикливания в аниматоре).
  # Без обрезки ролик в конце моргает своим первым кадром.
  nf="$(fli_frames "$f")"

  echo "== $base -> $out.mp4 (crf $ch, $nf кадров)"
  encode_h264 "$f" "$DST/$out.mp4" "$ch" "$nf"
  if [ "$DO_WEBM" = 1 ]; then
    echo "== $base -> $out.webm (vp9 crf $cv)"
    encode_vp9 "$f" "$DST/$out.webm" "$cv" "$nf"
  fi
done

# постер интро (титульная карточка «JURASSIC WAR»), PNG + JPEG
if [ -z "$ONLY" ] || [ "$ONLY" = intro ]; then
  POSTER_FRAME=${POSTER_FRAME:-2080}
  ffmpeg -nostdin -v error "${SWS[@]}" -i "$SRC/000_WIN00-EN.FLI" \
    -vf "select=eq(n\,$POSTER_FRAME),scale=640:400:flags=neighbor" -frames:v 1 -y "$DST/poster_intro.png"
  ffmpeg -nostdin -v error -i "$DST/poster_intro.png" -q:v 3 -y "$DST/poster_intro.jpg"
fi

echo
echo "== готово, out/video:"
ls -la "$DST"
if [ ${#skipped[@]} -gt 0 ]; then
  echo "== заглушки (ролика нет, показывать WINnn.SPR из пака 09):"
  printf '   %s\n' "${skipped[@]}"
fi
