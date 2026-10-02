# Ghostprint

A privacy trading terminal for Solana.

- **Terminal** (`app.html`): connect Phantom, Solflare or Backpack, search any token, see its DexScreener chart, and buy or sell against SOL through Jupiter. It's non-custodial: every trade is a single transaction you sign in your own wallet. A 0.5% fee in SOL goes to the treasury inside that same transaction.
- **Exposure** (on the landing page, and as a tab in the terminal): paste any wallet and see what trackers can link to it: funding source, sibling wallets, exchange links, wallets you move funds between, address-poisoning attempts, the hours you're awake, and what you hold. Read-only.
- **Ghost mode** (beta, in the terminal): buy from a fresh ghost wallet with no on-chain link to yours. Funds go in and out through **NEAR Intents** (1Click API, Confidential Intents): you pay into a one-time deposit address, and NEAR's bridge pays the ghost from its own wallets. Ghost wallets are derived from one signature of your wallet, so signing again on any device rebuilds them. The Ghost tab lists them and can sell, exit back to your wallet, or export a key.

## Run it

The pages load ES modules, so serve the folder over HTTP:

```bash
npm run serve        # python3 -m http.server 5178
open http://localhost:5178          # landing page
open http://localhost:5178/app.html # terminal
```

GitHub Pages serves `main` as-is (`.nojekyll`).

## Configure

`config.js` holds public values only:
- `TREASURY`: the wallet that receives fees
- `FEE_BPS`: the fee (50 = 0.5%). The landing page copy also says 0.5%, so change both together.
- `JUP_BASE` and `JUP_API_KEY`: leave the key empty. A key in a static site is shared by every visitor; see the comment in the file.
- slippage default and the cap on priority fees
- `ONECLICK_JWT`: optional NEAR Intents key. Without it 1Click adds a 0.1–0.2% fee per route; like the Jupiter key it's public in a static site.
- `GHOST_CONFIDENTIALITY` (`basic`), `GHOST_MAX_SOL` (beta cap per ghost buy, 5 SOL), `GHOST_GAS_RESERVE` (0.01 SOL kept in each ghost)

Users can point both the terminal and Exposure at their own RPC node using the "RPC node" field under the tracer. It's stored in their browser and the two share it.

## Test

```bash
npm install   # dev only: @solana/web3.js for the tests
npm test
```

Tests run against a fake chain (`test/mockchain.mjs`), fake Jupiter responses (`test/jupmock.mjs`) and a fake 1Click API (`test/oneclickmock.mjs`). They build real signed transactions with web3.js and decode them to check where the fee goes and how much it is.

## Files

- `index.html`: landing page and the Exposure tracer
- `app.html`: the terminal
- `config.js`: treasury, fee, Jupiter settings
- `swap.js`: Jupiter client, fee math, transaction assembly, sending and confirming
- `ghost.js`: Ghost mode (ghost wallet derivation, NEAR Intents 1Click client, quote checks, funding and exit transactions, route status)
- `trace.js`: wallet exposure analysis
- `vendor/solana-web3.min.js`: the Solana web3.js 1.98.4 browser build, checked in so the site needs no CDN
- `test/`: fake chain, fake Jupiter, tests

See `HANDOFF.md` for the design, what's verified, and the to-do list.
