// Fake 1Click API: quotes, deposit submission and a status that turns SUCCESS after a few polls.
import web3 from "@solana/web3.js";
export function createOneClick({ confidential = true, pollsUntilDone = 2, tamper = null } = {}) {
  const routes = new Map(), quotes = [];
  function handle(method, url, body) {
    const u = new URL(url);
    if (u.pathname === "/v0/tokens") return [{ assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 150, priceUpdatedAt: "2026-10-02T00:00:00Z" }, { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, blockchain: "sol", symbol: "USDC", price: 1, priceUpdatedAt: "2026-10-02T00:00:00Z", contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }];
    if (u.pathname === "/v0/quote") {
      quotes.push(body);
      if (body.confidentiality && !confidential) return { status: 400, body: { message: "Confidential Intents not supported for this route" } };
      const depositAddress = web3.Keypair.generate().publicKey.toBase58();
      const out = BigInt(body.amount) * 998n / 1000n;
      const res = { correlationId: "c", timestamp: new Date().toISOString(), signature: "ed25519:x", quoteRequest: { ...body },
        quote: { depositAddress, amountIn: body.amount, amountInFormatted: "", amountInUsd: "", minAmountIn: body.amount, amountOut: String(out), amountOutFormatted: "", amountOutUsd: "", minAmountOut: String(out * 99n / 100n), deadline: body.deadline, timeEstimate: 20 } };
      if (tamper) tamper(res);
      routes.set(depositAddress, { polls: 0, body });
      return res;
    }
    if (u.pathname === "/v0/deposit/submit") return { status: "KNOWN_DEPOSIT_TX" };
    if (u.pathname === "/v0/status") {
      const r = routes.get(u.searchParams.get("depositAddress"));
      if (!r) return { status: 404, body: { message: "not found" } };
      r.polls++;
      return { correlationId: "c", status: r.polls > pollsUntilDone ? "SUCCESS" : r.polls > 1 ? "PROCESSING" : "PENDING_DEPOSIT", updatedAt: "", swapDetails: {} };
    }
    return { status: 404, body: { message: "unmocked " + u.pathname } };
  }
  const fetch = async (url, init = {}) => {
    const out = handle(init.method || "GET", url, init.body ? JSON.parse(init.body) : null);
    const status = out && out.status && typeof out.status === "number" ? out.status : 200;
    const body = status === 200 ? out : out.body;
    return { ok: status === 200, status, json: async () => body };
  };
  return { fetch, handle, quotes, routes };
}
