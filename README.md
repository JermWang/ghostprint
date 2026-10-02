# Ghostprint

A privacy trading terminal for Solana.

- **Terminal** (`app.html`), an Axiom/Padre-style trench terminal:
  - **Pulse:** New Pairs, Final Stretch and Migrated columns. They stream live from PumpPortal's free feed of pump.fun launches and migrations, are seeded from Jupiter's recent and top-traded lists, and show bonding-curve progress and market cap read straight from the curve accounts on-chain. Each column has filters, pauses while you hover, and has ⚡ one-click buys.
  - **Trending:** Jupiter's trending, most-traded and organic lists, plus new pools, at 5m, 1h, 6h or 24h.
  - **Token pages:** DexScreener chart and stats, a bonding-curve bar, and live trades (pump.fun trade events decoded from logs or inner instructions over your RPC websocket, plus any other DEX's swaps). Also top holders labelled curve or dev, with a Track button; authorities, top-10 and dev holdings; a dev-wallet trace; a watchlist star; and your own trades.
  - **Trade panel:** buy/sell, quick amounts, sell percentages, P1–P3 presets (slippage, priority level, priority cap), a choice of trading from Main or ⚡ Instant, and Ghost mode.
  - **⚡ Instant wallet:** derived from one signature of your wallet. Trades sign in the tab with no popups. Deposit directly or privately through NEAR, withdraw directly or privately, export the key.
  - **Tracker:** follow wallets, get a live swap feed and toasts, copy-buy with ⚡.
  - **Portfolio:** positions for Main or Instant with average cost and realized/unrealized PnL, sell 50%/100%, ghost wallets, Exposure, and activity.
  - **Orders:**
    - **Limit orders** (buy below, or sell above as a take-profit) are Jupiter Trigger v1 orders. They sit on-chain and are filled by Jupiter's keepers even with the tab closed. You can list and cancel them from the token page or Portfolio.
    - **Autopilot** runs inside the terminal and signs with the ⚡ Instant wallet, so it only acts while the terminal is open:
      - take profit, stop loss and trailing stop by %;
      - a **migration sniper** (🎯 on Pulse cards) that buys the moment a token migrates, with optional automatic TP/SL afterwards.
  - **Jito:** each preset can carry a Jito tip so swaps land faster. With MEV protect on, swaps go only through Jito's block engine and never touch the public mempool.
  - **Also:**
    - Posts from X on token pages (needs the proxy with an X key).
    - Import on-chain history, so PnL covers trades made elsewhere.
    - A watchlist bar, settings (quick amounts, presets, Jito, autopilot defaults, Final Stretch threshold, RPC), hotkeys (`/` search, `b`/`s` buy/sell, `1`–`3` presets, `p` Pulse) and migration alerts.
  - Every trade routes through Jupiter. A 0.5% SOL fee goes to the treasury inside the same transaction, from Main or Instant. Ghost wallets never pay it; ghost buys pay at funding.
- **Exposure** (on the landing page, and as a tab in the terminal): paste any wallet and see what trackers can link to it: funding source, sibling wallets, exchange links, wallets you move funds between, address-poisoning attempts, the hours you're awake, and what you hold. Read-only.
- **Ghost mode** (beta, in the terminal): buy from a fresh ghost wallet with no on-chain link to yours. Funds go in and out through **NEAR Intents** (1Click API, Confidential Intents): you pay into a one-time deposit address, and NEAR's bridge pays the ghost from its own wallets. Ghost wallets are derived from one signature of your wallet, so signing again on any device rebuilds them. The Ghost tab lists them and can sell, exit back to your wallet, or export a key.

## Run it

The pages load ES modules, so serve the folder over HTTP:

```bash
npm run serve        # python3 -m http.server 5178
open http://localhost:5178          # landing page
open http://localhost:5178/app.html # terminal
open http://localhost:5178/docs.html # docs
```

GitHub Pages serves `main` as-is (`.nojekyll`).

## Proxy (recommended before launch)

`worker/` is a Cloudflare Worker that holds the API keys: your paid Solana RPC, Jupiter, the NEAR Intents JWT and X. It also relays Jito. Deploy it (see `worker/README.md`) and set `PROXY_URL` in `config.js`. Every visitor then shares paid capacity instead of being rate limited on free endpoints, and no key ever ships in the page.

## Configure

`config.js` holds public values only:
- `TREASURY`: the wallet that receives fees
- `FEE_BPS`: the fee (50 = 0.5%). The docs read it from `config.js`; the landing page copy and the transaction diagram label say 0.5%, so update those too.
- `JUP_BASE` and `JUP_API_KEY`: leave the key empty. A key in a static site is shared by every visitor; see the comment in the file.
- slippage default and the cap on priority fees
- `ONECLICK_JWT`: optional NEAR Intents key. Without it 1Click adds a 0.1–0.2% fee per route; like the Jupiter key it's public in a static site.
- `GHOST_CONFIDENTIALITY` (`basic`), `GHOST_MAX_SOL` (beta cap per ghost buy, 5 SOL), `GHOST_GAS_RESERVE` (0.01 SOL kept in each ghost)
- `PROXY_URL`: the deployed worker URL (empty means talk to public endpoints directly)

Users can point both the terminal and Exposure at their own RPC node using the "RPC node" field under the tracer. It's stored in their browser and the two share it.

## Test

```bash
npm install   # dev only: @solana/web3.js for the tests
npm test
```

Tests run against a fake chain (`test/mockchain.mjs`), fake Jupiter responses (`test/jupmock.mjs`) and a fake 1Click API (`test/oneclickmock.mjs`). `pump.test.mjs` and `market.test.mjs` cover curve and trade-event decoding, the Pulse columns, tracker parsing and PnL. They build real signed transactions with web3.js and decode them to check where the fee goes and how much it is.

## Files

- `index.html` + `landing.js`: landing page and the Exposure tracer
- `docs.html` + `docs.js`: documentation, with live isometric diagrams
- `art.js`: the shared art toolkit (isometric projection, boxes, cables, union slabs, halftone, pixel glyphs, the animated ghost logo, the hero machine, `flow`/`txStack`/`curveTank` diagram builders, terminal emblems), one animation clock that pauses off-screen and honors reduced motion
- `diagrams.js`: the explanatory drawings (ghost route and exit, wallet derivation, overview, proxy, Pulse sources, limit order, autopilot, transaction stack, bonding curve), shared by the landing page and the docs
- `app.html`: the terminal's markup and styles; `terminal.js`: its views and logic
- `pump.js`: pump.fun bonding-curve and trade-event decoding
- `feeds.js`: PumpPortal websocket, RPC live trades, curve reads, metadata, holders, tracked-wallet swaps
- `market.js`: Pulse board, wallet swap parsing, PnL (no DOM or network, so it's tested in Node)
- `config.js`: treasury, fee, Jupiter settings
- `swap.js`: Jupiter client, fee math, transaction assembly, sending and confirming
- `orders.js`: Jupiter Trigger limit orders (create, execute, cancel, list), limit amount math, autopilot rules
- `worker/`: the Cloudflare Worker proxy (keys, RPC method allowlist, Jito relay, X search)
- `ghost.js`: Ghost mode (ghost wallet derivation, NEAR Intents 1Click client, quote checks, funding and exit transactions, route status)
- `trace.js`: wallet exposure analysis
- `vendor/solana-web3.min.js`: the Solana web3.js 1.98.4 browser build, checked in so the site needs no CDN
- `test/`: fake chain, fake Jupiter, tests

See `HANDOFF.md` for the design, what's verified, and the to-do list.
