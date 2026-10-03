# Ghostprint explainers: storyboard

Three 15 s videos, 1920x1080 and 1080x1080, H.264 + AAC, 30 fps. Every drawing is the site's own isometric art (art.js / diagrams.js), animated in code. Captions only, no voiceover. Music bed and SFX are synthesized from scratch (120 BPM, A minor, Am-F-C-G); no samples.

## 01 · What it is
| Time | Scene | Caption | Sound |
|---|---|---|---|
| 0-3 s | Pixel ghost + GHOSTPRINT wordmark assemble | A Solana trading terminal that leaves fewer tracks. | sparkle, chime |
| 3-7 s | walletTree: main → signature → instant + ghost wallets | Sign once. Every wallet follows. | whoosh, drop clicks, packet blips |
| 7-11 s | tradeTx: transaction layers drop in (compute, token acct, 0.5% fee, Jupiter swap, cleanup, Jito tip) | One buy. One transaction. Fee rides inside; if the swap fails, no fee. | thud per layer |
| 11-13.5 s | overview: your browser ↔ RPC, Jupiter, 1Click, PumpPortal, Jito, DexScreener | It runs in your browser. Ghostprint never holds funds. | blips |
| 13.5-15 s | End card | Non-custodial · best-price routing · private funding | finale chord |

## 02 · Ghost mode
| Time | Scene | Caption |
|---|---|---|
| 0-2.5 s | Title card | Ghost mode. Buy from a wallet nothing points back to. |
| 2.5-5 s | main funds a new wallet, tracker watches, "LINKED" | Trackers follow the SOL. |
| 5-11 s | ghostRoute with 4 steps synced to the packets | The bridge pays your ghost: deposit + 0.5% fee → NEAR Intents (confidential) → fresh ghost → Jupiter |
| 11-13.5 s | ghostExit | Home the same way. Exits pay no Ghostprint fee. |
| 13.5-15 s | End card | Beta · up to 5 SOL per buy. Vary your amounts. Nothing is untraceable. |

## 03 · The toolkit
| Time | Scene | Caption |
|---|---|---|
| 0-2 s | Title card | The toolkit |
| 2-4.5 s | pulseSources | Pulse: new pairs, final stretch, migrated |
| 4.5-6.5 s | limitOrder | Limit orders fill with the tab closed (Jupiter Trigger escrow) |
| 6.5-8.5 s | autopilot | TP / SL / trailing, checked every 4 s |
| 8.5-11 s | bonding-curve tank fills → MIGRATING | Migration sniper buys the moment the curve completes |
| 11-13 s | tracker → portfolio | Follow wallets (every 20 s). PnL in SOL. |
| 13-15 s | End card | Pulse · limits · autopilot · sniper · PnL |

## Re-rendering
`source/` holds the composition. From the repo root run `python3 -m http.server 8765`, then in `media/videos/source/`: `node render.mjs <1|2|3> <wide|sq> out/name.mp4` and `./mux.sh out/name`. Captions and timing live in the VIDEOS table at the top of studio.js.
