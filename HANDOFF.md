# Ghostprint: handoff for the next session

Read this whole brief before touching anything.

## What this is now
Ghostprint started as an in-browser photo metadata scrubber. In October 2026 it pivoted to **on-chain privacy for Solana traders**. **The product is the trading terminal (`app.html`).** Trace/Exposure is the free tool that sells Ghost mode; it is not the product. The scrubber is gone from the page; it's still in git history (commits `7ca1f36` and the ICC fix after it) if it's ever wanted back.

The product plan:
0. **Terminal v1 (built).** Wallet connect, token search, chart, buy and sell against SOL through Jupiter, a 0.5% fee to the treasury, positions, activity, and an Exposure tab. Details below.
1. **Trace / Exposure (built).** Paste any wallet and see what trackers link to it. It's free and read-only, and it's where new users come in.
2. **Ghost mode (beta, built on NEAR Intents).** NEAR was chosen over Monero: NEAR Intents' 1Click API quotes a route, gives a one-time Solana deposit address and pays any Solana recipient from its own bridge wallets, with Confidential Intents (live 8 July 2026) keeping sender, amount and route off the public record. Monero has stronger privacy but no programmable layer; it would need two swaps each way, an in-browser XMR wallet and about 20-minute unlocks, which is unusable for trading. Details are in the Ghost mode section below.
3. **Token (not launched).** Each use is a real job: fee tiers for holders, buyback funded by trading fees earned in SOL, relayer staking with slashing for censoring or leaking, and referrals. Deliberately no governance or revenue share. Ticker and launch details are TBD, and the page says so.
4. **Later: Ghost links.** Stealth-address payment links that reuse the same relayers.

Chain: Solana. Business model: a fee on each Ghost mode trade, like Axiom, Photon and Trojan. Big open risks: execution speed against those bots, privacy that is never perfect (so never say "untraceable"), and legal exposure. A Tornado Cash developer was convicted in 2025; get a lawyer before Ghost mode ships.

## Terminal (app.html, swap.js, config.js)
- **Swaps:** Jupiter `/swap/v1/quote` (with `restrictIntermediateTokens=true` and `maxAccounts=54`, which leaves room for the fee instruction), then `/swap/v1/swap-instructions` (wrapAndUnwrapSol, dynamicComputeUnitLimit, priority fee `veryHigh` capped at `PRIORITY_MAX_LAMPORTS`). `buildSwapTx` assembles a v0 transaction in this order: compute budget, Jupiter's `otherInstructions`, setup, swap, cleanup. Lookup tables come from the RPC.
- **Fee** (`FEE_BPS`, default 50) is a plain `SystemProgram.transfer` to `TREASURY` inside the user's transaction:
  - Buy: `fee = amount × bps`, the transfer goes before the swap, and the quote uses `amount − fee`.
  - Sell: `fee = otherAmountThreshold × bps`, taken from the guaranteed minimum SOL and placed after the cleanup step that unwraps wrapped SOL back into SOL.
  
  This doesn't use Jupiter's referral program. Only SOL pairs are supported, since all fee math is in SOL.
- **Send:** `sendRawTransaction` with preflight on, so a failing trade is caught in simulation before it costs anything. The transaction is rebroadcast every 2 s with `skipPreflight` until it's `confirmed`, it errors, or its block height expires. Errors are mapped to plain English (slippage, insufficient SOL, no route, rate limit, rejected in wallet).
- **Wallets:** injected providers (`window.phantom.solana`, `window.solflare`, `window.backpack`, with `window.solana` as a fallback), using `signTransaction`. A trusted wallet reconnects silently. Wallet Standard isn't supported yet.
- **Safety rails:** the mint's decimals are read from the chain before any trade is allowed (no guessing); 0.005 SOL is kept back for fees and rent; the button explains why it's disabled; amounts are converted with BigInt.
- **Data:** token search, metadata and prices come from Jupiter (`/tokens/v2/search` takes comma-separated mints; prices from `/price/v3`). The chart and live stats come from DexScreener: the `token-pairs/v1/solana/{mint}` API picks the most liquid pool and the chart is DexScreener's embed. Requests to Jupiter are spaced (2.05 s keyless, 1.05 s with a key).
- **Activity** is stored per wallet in localStorage. **Positions** come from token accounts on both token programs, valued with Jupiter prices.
- `vendor/solana-web3.min.js` is the official IIFE build of web3.js 1.98.4. It's checked in because the dev container couldn't reach CDNs, and it removes a third-party CDN from the trust path.

## Ghost mode (ghost.js, Ghost tab in app.html)
- **Ghost wallets:** the user signs `GHOST_MESSAGE` once. Ghost #i's key is `Keypair.fromSeed(SHA-256(signature ‖ "ghostprint/ghost/i"))`. Ed25519 signatures are deterministic, so the same wallet rebuilds the same ghosts on any device and nothing secret is stored. A 16-hex fingerprint of the signature is kept in localStorage; if a later signature differs (another wallet app, or a Ledger that can't sign messages), Ghost mode refuses instead of opening different ghosts. localStorage also keeps a record per ghost (index, mint, state, deposit address), but recovery doesn't depend on it: the Ghost tab scans indices past the highest record, and "Scan further" adds 7 more. "Export key" shows a ghost's base58 secret key for importing into a wallet.
- **Ghost buy:**
  1. `routeQuote` POSTs `/v0/quote`: SOL (`nep141:sol.omft.near`, looked up from `/v0/tokens`) to SOL, `EXACT_INPUT`, `depositType ORIGIN_CHAIN`, `recipient` = the ghost, `refundTo` = the main wallet, a 30-minute deadline, `confidentiality: "basic"`, `referral: "ghostprint"`. If the confidential rail refuses with a 4xx that mentions confidentiality or support, it retries as public and the UI says "NEAR Intents" instead of "confidential".
  2. `checkQuote` refuses any quote whose recipient, refund address, assets or amount differ from what was asked, or whose deposit address is invalid or one of our own wallets.
  3. The main wallet signs one transaction: the deposit transfer plus the 0.5% fee to `TREASURY`. Then `/v0/deposit/submit` is called (best effort), and `/v0/status` is polled until SUCCESS (REFUNDED and FAILED stop with a message).
  4. Wait for the ghost's balance, then the ghost buys through Jupiter with `feeBps 0`, signed locally, keeping `GHOST_GAS_RESERVE`.
- **Exit:** the ghost sells every token through Jupiter (minimum 5% slippage). One transaction then closes its empty token accounts and sends SOL plus the reclaimed rent minus the 5000-lamport fee into a new route back to the main wallet (refunds go to the ghost). Tokens with no route stay in the ghost and are reported.
- **Fee design:** the fee is charged once, from the main wallet at funding. Ghosts never pay the treasury, so the treasury doesn't cluster ghosts together.
- **Limits:** beta cap `GHOST_MAX_SOL` (5) per ghost buy; minimum 0.02 SOL. Sell-side ghost trades happen from the Ghost tab.
- **Honest limits, also stated in the UI:** funding and exit amounts and timing can be matched by a determined analyst. Nothing yet splits amounts or adds random delays. The 1Click service itself sees both ends.
- **The 1Click API format** was taken from the official `@defuse-protocol/one-click-sdk-typescript` 0.1.26 types; the docs sites were blocked from the dev container. Base URL `https://1click.chaindefuser.com`. A JWT is optional; without one 1Click charges 0.1–0.2% per route.

## Code
- `index.html`: the page. Styles are inline. It ends in one `<script type="module">` that imports `trace.js`, so **it must be served over HTTP** (`npm run serve`); opening it as a file breaks the import.
- `trace.js`: an ES module with no dependencies.
  - `rpcClient(url, {fetch, concurrency=4, retries=5})`: a JSON-RPC client with a concurrency cap and exponential backoff on HTTP 429/5xx and on rate-limit errors.
  - `collect(address, {rpc, recent=100, oldest=6, maxPages=5, depthTx=15, depthWallets=5})`: pages `getSignaturesForAddress` (up to 5,000 signatures) and fetches the 100 most recent transactions plus the 6 oldest, but only if it reached the start of the history. It also fetches the balance and the count of non-zero token accounts. Then it goes **one hop out**: for the funder and the top counterparties it fetches the balance and 15 transactions. That's about 70 RPC calls for a typical wallet.
  - `analyze(address, txs, extra)`: pure, and the main thing to test. It reads `jsonParsed` transactions (system transfers and createAccount, spl-token transfer and transferChecked, pre/post token balances) and produces:
    - **funding**: the first incoming SOL ≥ 0.001 SOL, claimed only when the start of the history was reached.
    - **siblings**: other wallets the funder sent SOL to.
    - **exchanges**: a direct counterparty in `KNOWN`, or a counterparty holding ≥ 20k SOL (labelled "Likely exchange or custodian"), or a **deposit address**, meaning a counterparty that forwards to a `KNOWN` exchange or sweeps everything to one wallet and keeps itself empty.
    - **linked wallets**, scored: funds go both ways +3, 3 or more transfers +2, ≥ 0.1 SOL +1, same funder +3; kept at a score of 3 or more.
    - **address poisoning**: dust from an address whose first 4 and last 4 characters match a wallet you've sent to.
    - **trades**: the owner signed, a non-transfer program was involved, and a non-quote token moved.
    - **activity hours**: the quietest 7-hour run of signed transactions is taken as sleep, giving a UTC offset. It needs at least 25 transactions and a quiet run holding no more than 8% of activity.
    - an **exposure score** (0–100) with a grade, findings sorted by severity, and a graph for the canvas.
  - Transfers only count from "plain" transactions (System, Token, ATA, ComputeBudget and Memo programs), so swaps don't make DEX pools look like linked wallets.
- `test/mockchain.mjs`: a fake chain with a seeded random generator. It contains a user wallet, a funder that also funds 3 siblings, a Binance 2 withdrawal, a linked wallet with two-way flow, a deposit address that sweeps to Binance 2, a lookalike poisoner, and 40 swaps timed so the user looks asleep from 05:00 to 12:00 UTC (UTC−5). Playwright reuses it by intercepting `api.mainnet-beta.solana.com`.
- The page's **example** result (`SAMPLE` in `index.html`) is the engine's real output on that fake chain. If the shape of `analyze`'s output changes, regenerate it the same way.

## Visual system (kept from the scrubber)
- Tokens: ground `#D6D8D9`, paper `#EEEFEE`, ink `#1D1F22`, infrared accent `#FF5A24`. Fonts are Sora and JetBrains Mono. Single theme on purpose.
- All art is code: the `iso()` toolkit, pixel glyphs and the 5×7 wordmark font. The hero machine now holds a wallet card with a candlestick chart, its rising tags are tracker links, and the bin reads "LINK→0". The leak-card icons are funding (two wallets, a tube and coins), KYC (the old serial-tag card), linked wallets (three connected cubes) and a clock.
- **The tracer canvas**: a dot-matrix graph with the wallet at left and funder, siblings, exchanges and linked wallets on an arc to the right. Deposit addresses sit halfway to their exchange. Nodes are hex-dot discs whose particles spring into place. Edges carry a pulse in the direction funds moved. While tracing, a radar ring sweeps the background lattice and the readout shows progress. It honors `prefers-reduced-motion`.
- The "how it works" section ends with a **24-hour signing strip**, with the quiet window highlighted.
- Values from the chain are written with `textContent` only. Keep it that way.

## What's verified and what isn't
- **Verified:**
  - `npm test` passes all 7 tests: the full trace on the fake chain, not claiming a funder when history is truncated, a fresh wallet scoring 0, address validation, the RPC client's retry and rate-limit message, refusing a time zone on thin data, and legacy string account keys.
  - End to end in headless Chromium at 1280 px and 375 px with the RPC intercepted: bad input is rejected, the trace makes 69 calls and renders all 8 findings, there's no horizontal overflow, and there are no page errors.
- **Terminal verified:**
  - `npm test` passes all 15 tests: 7 for Trace and 8 for swaps. The swap tests cover amount conversion, fee math, instruction order for buys and sells, no transfer when the fee is 0, prepareSwap quoting the post-fee amount, sell fees taken from the guaranteed minimum, and Jupiter error messages.
  - End to end in headless Chromium with fake Jupiter, RPC, DexScreener and a fake wallet that really signs: connect, buy 1 SOL, sell 50%. Each transaction the page sent was decoded. The buy paid `TREASURY` 5,000,000 lamports before the swap; the sell paid it after cleanup, matching the expected fee to the lamport. The signatures verify against the wallet's key. There's no horizontal overflow at 375 px and no page errors.
- **Ghost mode verified:**
  - 10 tests in `test/ghost.test.mjs`: ghost wallets are deterministic and distinct, finding native SOL, the confidential quote request, the public fallback, refusing 5 kinds of tampered quote, funding transaction contents, the exit transaction (close plus send, signed by the ghost), status handling, and the JWT header.
  - End to end in Chromium with fake 1Click, Jupiter and RPC and a fake wallet:
    - One message signature.
    - Funding: main → deposit 0.995 SOL, plus 0.005 SOL to the treasury.
    - Ghost buy: paid and signed by the ghost, with no treasury transfer.
    - Ghost tab listing and key export.
    - Exit: the ghost sells, then closes its token account and sends to a route whose recipient is the main wallet.
- **Not verified, and the first thing to do:**
  - **A real Ghost buy and exit with about 0.05 SOL.** Confirm that 1Click accepts SOL→SOL (same asset, different recipient) on Solana, and whether `confidentiality: "basic"` works with `ORIGIN_CHAIN` deposits or falls back to public. Note how long routes take and what 1Click charges.
  - **A real mainnet trade.** Make a small buy and sell with a real wallet and check the treasury receives the fee. Watch for: CORS on `api.jup.ag` and DexScreener from the github.io origin, the shape of the real `/swap-instructions` response, transactions exceeding the 1232-byte limit on complex routes (the code refuses rather than sending), and how well transactions land through the public RPC.
  - **Real mainnet data.** This cloud environment's network policy blocked `api.mainnet-beta.solana.com` and `lite-api.jup.ag`, so nothing has run against the real chain. Check:
    - that the public RPC allows browser CORS and what its rate limits are for about 70 calls;
    - trade detection on real Jupiter, Pump.fun and PumpSwap transactions and on trading-bot wallets;
    - v0 transactions whose account keys come from lookup tables (in `jsonParsed` they should appear in `accountKeys`);
    - how noisy "linked" and "deposit address" are on real wallets.
  - Only **Binance 2** (`5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9`) is a confirmed label. Don't add exchange addresses from memory; confirm each one on Solscan first. Wrong labels would accuse people of exchange links they don't have.
  - The page has not been published as an artifact. The old artifact (https://claude.ai/artifact/DuMz2azcGjuQLJqruzgPqe) still shows the photo scrubber. An artifact page may also block outgoing RPC requests through its security policy, so a real deploy (any static host) is a better test.

## Known limitations
- `getSignaturesForAddress(wallet)` doesn't return incoming token transfers into an existing token account (the wallet isn't in the account keys), so incoming token transfers are undercounted. A proper fix needs an indexer such as Helius.
- Funding is unknown for wallets with more than 5,000 transactions. The page says "not reached" instead of guessing.
- There's no copy-trader detection yet ("who is copying your trades"). It needs per-token trade feeds, which means an indexer.

## TODO, roughly in priority order
0. Make a small real buy and sell in the terminal (see above), then fix whatever mainnet shows up.
0b. **A small server proxy** for Jupiter and RPC (for example a Cloudflare Worker) holding a Jupiter key and a paid RPC such as Helius or Triton. That fixes rate limits, transactions landing poorly through the public RPC, and Jupiter ending keyless access. Optionally send through Jito for faster inclusion.
1. Run Trace on real wallets (your own, a known trader, a fresh wallet) and tune the heuristics.
2. Add a Helius option (enhanced transactions plus labels) for faster, deeper traces, with the public RPC as fallback.
3. Deploy as a static site (Vercel or Cloudflare Pages). Decide on the name and domain, and check that "Ghostprint" is free.
4. Ghost mode prototype on devnet: fresh wallet per trade, return through one existing shielded pool, relayer-paid gas.
5. Token design doc (supply, fee split, relayer staking and slashing) and a legal review before anything launches.

## About me / how I like to work
- Iterating fast. Keep updates short, show me the page, and ask before outward-facing actions (pushing to new remotes, deploying, buying domains, anything token-related).
- GitHub: **JermWang**.
