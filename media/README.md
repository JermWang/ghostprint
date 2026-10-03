# Media

Brand assets and explainer videos, all drawn with the site's own art (`art.js`, `diagrams.js`).

## videos/
Three 15-second explainers, each in 1920x1080 (`-wide`) and 1080x1080 (`-square`), H.264 + AAC.

| File | What it covers |
|---|---|
| `ghostprint-01-*.mp4` | What Ghostprint is: one signature, one-transaction buys with the 0.5% fee, runs in your browser |
| `ghostprint-02-*.mp4` | Ghost mode: trackers follow SOL, the bridge pays a fresh ghost via NEAR Intents, exits |
| `ghostprint-03-*.mp4` | The toolkit: Pulse, limit orders, autopilot, migration sniper, tracker and PnL |

`storyboard.md` has the shot list. `source/` re-renders them: serve the repo root on port 8765 (`python3 -m http.server 8765`), then in `source/` run `node render.mjs <1|2|3> <wide|sq> out/name.mp4` and `./mux.sh out/name`. Needs Playwright, ffmpeg, and Python with numpy and scipy. Music and sound effects are synthesized by `synth.py`; no samples.

## brand/
| File | Size | Use |
|---|---|---|
| `pfp.png` / `pfp.svg` | 1000x1000 | Profile picture: the pixel ghost as isometric voxels |
| `banner.png` | 1500x500 | X header. The left third stays empty because the profile picture covers the bottom-left |

`source/` re-renders both: serve the repo root on 8765, then `node render.mjs` in `brand/source/`.
