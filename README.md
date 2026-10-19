# Jurassic War — JavaScript reimplementation

A from-scratch port of the engine of **Jurassic War** (T.R.I.C., 1996/97, DOS) to plain JavaScript
that runs in a browser. It is **not an emulator**: no original machine code runs at play time.
Every routine of the original executable was rewritten by hand and checked against the original
step by step.

This repository contains **only our code**: the engine, the web front end, tools and technical
notes. It contains **no game data**. To play, you need your own copy of the original game
(version **1.05E**). `setup.sh` builds everything else from your files.

---

## What is in here

| Path | Contents |
|---|---|
| `reimpl/js/` | the engine: simulation (`port/`), rendering (`render/`), UI shell (`ui/`), AI (`ai/`), network play (`net/`), tests (`test/`) |
| `reimpl/web/` | the game page `game.html` + `game.js`, plus a level browser, a pathfinding bench, an AI arena and a debug viewer |
| `reimpl/data/` | our metadata and tables recovered during reverse engineering (screen layouts, engine tables, fonts for RU/PL translations, new beasts) |
| `tools/` | archive unpackers, asset converters, the engine-snapshot builder, spec checkers that compare the port with the original, AI benches and trainers, network relay |
| `tools/snapshot/` | `make_boot_snap.py` + `oracle.py`: build the engine memory image from your `PWAR.EXE` |
| `android/` | an experimental Kotlin port of the core (no assets included) |
| `notes/` | detailed write-ups of the subsystems, with addresses and numbers (mostly in Russian) |
| `setup.sh` | one-shot preparation from your game folder |

## How the port works

The game memory is a single 6.4 MB `Uint8Array` with everything at the same addresses as in the
DOS version (units are 96-byte records at `0xe4400`, grids, palette at `0x44980`, …). Functions
are named after their original addresses (`F[0x17e1c]`) and take pseudo-registers. This lets us
compare the port with the real game field by field. Movement has been checked on 63,827
transitions and the AI on 1,111,298 comparisons, with no differences. The original's bugs are
reproduced as well, because they affect gameplay.

Rendering goes into the same 8-bit 640×480 frame buffer and is copied to a canvas through the
palette. A captured browser frame matches the DOS reference frame pixel for pixel.

At start-up the page loads an **engine snapshot** (`reimpl/data/boot_snap.bin.z`). This is the
original engine's data segment right after initialisation, just before the main menu: all the
static tables, unit stats, AI scripts and so on. It is game data, so it is not distributed.
`tools/snapshot/make_boot_snap.py` recreates it from your `PWAR.EXE`:

1. It loads the LE executable and relocates it.
2. It runs the real initialisation code once under the [Unicorn](https://www.unicorn-engine.org/)
   CPU emulator (`oracle.py`), with DOS/DPMI services emulated and the CD check, intro and sound
   skipped.
3. It dumps the segment and writes the compressed image.

On 1.05E the result is byte-identical to the image we develop with.

Beyond the original game:
- skirmish against several AI opponents (scripted and neural);
- network play: lockstep through a small WebSocket relay;
- a level browser;
- Russian and Polish translations;
- two new beasts (a demon and a brontosaurus, test pages only);
- many AI experiments.

---

## Requirements

- **Your own copy of Jurassic War, version 1.05E.** The title screen shows the version, and
  `PWAR.EXE` contains the string `TRIC(R) Jurassic war V1.05E`; md5 is
  `0c0271736050189548b1df45e85c8097`. Other versions are untested; the snapshot builder warns about
  them. We do not provide the game and do not link to downloads.
- **Python 3.9+** with `pip`. `setup.sh` installs `unicorn` and `capstone` if they are missing.
- **Node.js 18+** for the icon and minimap generators and the tools.
- Optional: **ffmpeg** to convert music (needs ffmpeg built with `libopenmpt`) and the cinematics.
- Any static web server (`python3 -m http.server` is fine) and a modern browser (Chrome, Firefox,
  Safari, desktop or mobile).

### Files needed from the original game

All files come from the game folder or CD. File names are case-insensitive.

| File | Needed for |
|---|---|
| `PWAR.EXE` | building the engine snapshot (only at setup, never served) |
| `_SETUP.DAT` | building the snapshot |
| `_PWAR01.TRC` | engine start |
| `_PWAR02.TRS` | menus and screens |
| `_PWAR04.TRS`, `_PWAR05.TRS`, `_PWAR06.TRW` | missions: graphics and sound |
| `_PWAR08.TRC`, `_PWAR09.TRC` | campaign maps, briefings |
| `_PWAR11.TRC` | read by the original at boot (snapshot only); source of cinematics |
| `_PWAR10.TRC`, `_PWAR13.TRC` | optional: demo maps and extra maps |
| `_PWAR07.TRC` | optional: music (converted by `--music`) |

---

## Setup

```bash
git clone https://github.com/pivolan/jurassic_war_js.git
cd jurassic_war_js
./setup.sh /path/to/your/JurassicWar           # add --music --video to convert those too
python3 -m http.server 8000
# open http://localhost:8000/reimpl/web/game.html
```

`setup.sh` does the following (each step can also be run by hand):

1. **Links your game files** into `./PWAR/`, with upper-case names.
2. **Builds the engine snapshot**, about 15 s:
   `python3 tools/snapshot/make_boot_snap.py --pwar PWAR --out reimpl/data/boot_snap.bin.z`
3. **Builds the fast-start UI pack** `out/ui/_UI_BOOT.TRS` (`python3 tools/ui_bundle.py`). This is
   a 0.3 MB subset of `_PWAR02.TRS` that the page loads first, so the menu appears quickly; the full
   pack is fetched later. The same step builds tribe icons (`node tools/tribe_icons.mjs 0 1 2 3 4 5 6 7` →
   `out/ui/icons/`) and lobby minimaps (`node tools/minimaps.mjs` → `out/ui/minimap/`).
4. Optional:
   - `python3 tools/extract_all.py` unpacks the archives into `out/extract/`;
   - `tools/mod2m4a.sh` converts the MOD music to `out/audio/track*.m4a|opus`;
   - `tools/fli2mp4.sh` converts the FLI cinematics to `out/video/*.mp4|webm`.

   Without them the game runs silent and skips the movies.
5. **Creates the web layout**: symlinks `ui → out/ui`, `audio → out/audio`, `video → out/video`.

### Layout the page expects

The page `reimpl/web/game.html` loads its files by relative paths. Serve the **repository root**
so the tree looks like this:

```
<web root>/
  PWAR/            your original archives (served to the browser: _PWAR01,02,04,05,06,08,09,10,13)
  ui/              _UI_BOOT.TRS, icons/, minimap/          (built by setup.sh)
  audio/           music, optional
  video/           cinematics, optional
  reimpl/
    web/game.html  ← open this
    js/  data/     (data/boot_snap.bin.z is built by setup.sh)
```

Do **not** expose `PWAR.EXE` or anything else from your game folder publicly. If you put this on
a public server, remember that the archives are copyrighted game data.

### Hosting tips

- Serve the archives compressed (`gzip_static on;` in nginx with pre-made `.gz` files, or any
  on-the-fly gzip). The campaign map pack shrinks by about 85 %.
- `.mjs`/`.js` need the `text/javascript` MIME type (the default in common servers).
- No server code is needed for single-player.

### Network play (optional)

Multiplayer uses a tiny lockstep relay:

```bash
node tools/net_server.mjs 8791     # listens on 127.0.0.1:8791
```

The page connects to `ws(s)://<same host>/jw/net`. Proxy that path to the relay, for example in
nginx: `location /jw/net { proxy_pass http://127.0.0.1:8791; proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }`. The relay also
stores replays and server-side saves under `out/`.

### Page options (URL parameters)

| Parameter | Effect |
|---|---|
| `?battle=1` | quick skirmish |
| `?lab=1` | AI lab: watch scripted scenes |
| `?demon=1&bronto=1` | test scene with the two new beasts |
| `?duel=script` | two AIs fight each other (spectator) |

The interface language (English, Russian, Polish) is switched in the in-game *Options* menu.
Translated mission briefings are not included, so in RU/PL the briefings fall back to the original
English text. Interface strings and fonts are included.

Optional hooks: `window.JW_QUIT_URL` (where *Quit* in the main menu leads) and
`window.JW_STATS_URL` (an endpoint for anonymous play counters). Both are off by default.

Some experimental modes call external services and do nothing without your own server-side proxy:
`?duel=llm` (an LLM commander through a `/jw/jev` endpoint) and `?jev=1`. The proxies are not
included.

---

## Tests and checks

```bash
node tools/net_test.mjs 4 2000              # lockstep self-test: 4 engines in one process stay in sync
node tools/ai_smoke.mjs 1                   # every AI training scene runs headless (takes several minutes)
```

The reference traces used to verify the port against the original (`reimpl/traces`, `reimpl/cases`)
contain game memory and are not included. Recreate them with the emulator (`tools/snapshot/oracle.py`)
if you need them.

## Notes on the code

- Identifiers and comments are mostly in **Russian**: the project was developed that way. Engine
  functions are keyed by their original addresses, so the notes in `notes/` (`port-*.md`,
  `*-spec.md`) map one-to-one onto the code.
- Neural-network AI weights are not included. The scripted AIs work without them; the trainers are
  in `tools/ai_*`.

## Legal

Jurassic War is © T.R.I.C. / its rights holders. This project ships **no original game content**:
no executable code, graphics, sound, music, video, maps or texts of the game. It is an
independent reimplementation intended for owners of the original game. Trademarks belong to their
owners.

Third-party: the new-beast animations used open motion-capture libraries (Bandai Namco Research
Motion Dataset, CC BY-NC; CMU Graphics Lab Motion Capture Database).
