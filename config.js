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
