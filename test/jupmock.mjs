// Fake Jupiter responses shaped like /swap/v1/quote and /swap/v1/swap-instructions.
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const CB = "ComputeBudget111111111111111111111111111111";
const b64 = bytes => Buffer.from(bytes).toString("base64");

export function quoteFor({ inputMint, outputMint, amount, slippageBps }) {
  const out = (BigInt(amount) * 1000n);              // 1 lamport buys 1000 raw token units, and back
  const fwd = inputMint.startsWith("So111") ? out : BigInt(amount) / 1000n;
  const min = fwd - (fwd * BigInt(slippageBps)) / 10000n;
  return { inputMint, outputMint, inAmount: String(amount), outAmount: String(fwd), otherAmountThreshold: String(min), swapMode: "ExactIn", slippageBps: Number(slippageBps), priceImpactPct: "0.0123", routePlan: [{ swapInfo: { label: "Pump.fun Amm" }, percent: 100 }] };
}
export function instructionsFor(user) {
  const ix = (programId, data, accounts = [{ pubkey: user, isSigner: true, isWritable: true }]) => ({ programId, accounts, data: b64(data) });
  return {
    computeBudgetInstructions: [ix(CB, [2, 0x40, 0x0d, 0x03, 0], [])],
    setupInstructions: [ix(MEMO, [...Buffer.from("setup")])],
    swapInstruction: ix(MEMO, [...Buffer.from("swap")]),
    cleanupInstruction: ix(MEMO, [...Buffer.from("cleanup")]),
    otherInstructions: [],
    addressLookupTableAddresses: []
  };
}
export function handleJupiter(url, body) {
  const u = new URL(url);
  if (u.pathname === "/swap/v1/quote") return quoteFor(Object.fromEntries(u.searchParams));
  if (u.pathname === "/swap/v1/swap-instructions") return instructionsFor(body.userPublicKey);
  if (u.pathname === "/tokens/v2/search") return [{ id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", name: "Bonk", symbol: "Bonk", icon: null, decimals: 5, usdPrice: 0.0000213, mcap: 1.6e9, liquidity: 4.1e6, isVerified: true, stats24h: { priceChange: -3.2 } }];
  if (u.pathname === "/price/v3") return Object.fromEntries(u.searchParams.get("ids").split(",").map(id => [id, { usdPrice: id.startsWith("So111") ? 150 : 0.00002, decimals: 9 }]));
  throw new Error("unmocked " + u.pathname);
}
