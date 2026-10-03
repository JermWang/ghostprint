// Terminal settings. Public values only: nothing here can move funds.

// Where trading fees go. Only the public key belongs in this repo.
export const TREASURY = "DGorZp9ari8RGGdiQbXCsQ62HDmkxSL66xxQcYvWfWMP";

// Fee on every terminal trade, in basis points (50 = 0.5%). Charged in SOL:
// on buys from the SOL you spend, on sells from the minimum SOL you receive.
export const FEE_BPS = 50;

// Jupiter routes the swaps. Each visitor's browser calls Jupiter from its own IP, so keyless
// limits (0.5 requests/s) apply per visitor. A key placed here is public AND shared by every
// visitor, so leave it empty until requests go through a server proxy that holds the key.
// Jupiter has said keyless access will be phased out; the proxy is the fix when that lands.
export const JUP_BASE = "https://api.jup.ag";
export const JUP_API_KEY = "";

export const DEFAULT_SLIPPAGE_BPS = 300;           // 3%: memecoins move fast
export const PRIORITY_MAX_LAMPORTS = 1_000_000;     // cap on the priority fee (0.001 SOL)

// Ghost mode routes through NEAR Intents (1Click API). Without a JWT, 1Click adds a 0.1–0.2% fee
// per route; a JWT from the NEAR Intents partner dashboard removes it. Like the Jupiter key, a JWT
// here is public, so it belongs behind the same server proxy.
export const ONECLICK_JWT = "";
export const GHOST_CONFIDENTIALITY = "basic";       // "basic" or "advanced" Confidential Intents; "public" to opt out
export const GHOST_MAX_SOL = 5;                     // per ghost buy while Ghost mode is in beta
export const GHOST_GAS_RESERVE = 10_000_000n;       // 0.01 SOL kept in each ghost wallet for fees and token account rent

// Solana RPC every visitor uses (HTTP, plus websockets for live trades) when PROXY_URL is empty and the
// visitor hasn't picked their own in Settings. Empty = the public mainnet-beta node (heavily rate limited).
export const RPC_URL = "";

// After deploying worker/ (see worker/README.md), set this to the worker URL, e.g.
// "https://ghostprint-proxy.<you>.workers.dev". RPC, Jupiter, NEAR Intents, Jito and X then go through
// the proxy, which holds the keys. Empty = browsers talk to the public endpoints directly.
export const PROXY_URL = "";
