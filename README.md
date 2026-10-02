# Ghostprint

A privacy terminal for Solana traders. The first piece is **Trace**: paste any wallet address and see what wallet trackers can link to it (funding source, sibling wallets, exchange links, wallets you move funds between, address-poisoning attempts, the hours you're awake, and what you hold). It's read-only and runs in your browser against the Solana RPC node you choose. There's no wallet connection and no Ghostprint server.

**Ghost mode** (trading from fresh unlinked wallets, with returns routed through existing Solana shielded pools) and the token are described on the page but not built.

## Run it

`index.html` imports `trace.js` as an ES module, so it has to be served over HTTP. Opening it as a file won't work.

```bash
npm run serve        # python3 -m http.server 5178
open http://localhost:5178
```

## Test

```bash
npm test
```

The tests run the whole pipeline against `test/mockchain.mjs`, an in-memory chain that answers the same RPC calls with data shaped like Solana's `jsonParsed` responses. They don't touch mainnet.

## Files

- `index.html` – the page, its styles, and the code-drawn art and canvas tracer
- `trace.js` – the RPC client (`rpcClient`), history collection (`collect`) and the analysis (`analyze`)
- `test/` – the fake chain and the engine tests

See `HANDOFF.md` for how it works, what's verified, and the to-do list.
