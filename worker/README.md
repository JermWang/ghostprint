# Ghostprint proxy

A Cloudflare Worker that holds Ghostprint's API keys so the static site never ships them, and gives every visitor shared paid capacity instead of each browser's free-tier limit.

| Path | Upstream | Notes |
|---|---|---|
| `/rpc` | your Solana RPC (`RPC_URL`) | JSON-RPC over HTTP with a method allowlist; websocket subscriptions pass through |
| `/jup/*` | `api.jup.ag` + `JUP_API_KEY` | token lists cached for 20 s, prices for 5 s |
| `/1click/*` | NEAR Intents 1Click + `ONECLICK_JWT` | removes the 0.1–0.2% keyless fee |
| `/jito` | Jito block engine | only `sendTransaction` |
| `/x/search` | X recent search + `X_BEARER` | results cached for 5 minutes; X charges per post read |
| `/ipfs/<cid>` | ipfs.io, dweb.link, Pinata (raced) | token images and metadata, cached at the edge for a week; images and JSON only |
| `/health` | none | shows which upstreams are configured |

## Deploy

```bash
cd worker
npx wrangler login
npx wrangler secret put RPC_URL        # e.g. a Helius mainnet URL
npx wrangler secret put JUP_API_KEY
npx wrangler secret put ONECLICK_JWT   # optional
npx wrangler secret put X_BEARER       # optional
npx wrangler deploy
```

Then set `PROXY_URL` in `../config.js` to the worker's URL (for example `https://ghostprint-proxy.<you>.workers.dev`) and push. The site then routes RPC, Jupiter, NEAR Intents, Jito and X through the proxy automatically.

Edit `ALLOWED_ORIGINS` in `wrangler.toml` if the site moves to another domain (it allows ghostprint-black.vercel.app, jermwang.github.io and localhost).
