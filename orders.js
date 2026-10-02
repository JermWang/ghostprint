// Orders beyond market swaps.
// - Limit orders (buy below, sell above = take-profit) are Jupiter Trigger v1 orders: placed on-chain,
//   filled by Jupiter's keepers even when this tab is closed.
// - The autopilot (stop-loss, trailing stop, take-profit by %, migration sniper) runs inside the terminal
//   tab and signs with the instant wallet, so it only acts while the terminal is open.
import { SOL_MINT } from "./swap.js";

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

/* ---------- limit orders (Jupiter Trigger v1) ---------- */
export function triggerApi(jup) {
  return {
    create: ({ inputMint, outputMint, maker, making, taking, slippageBps, expiredAt }) => jup.post("/trigger/v1/createOrder", {
      inputMint, outputMint, maker, payer: maker,
      params: { makingAmount: String(making), takingAmount: String(taking), ...(slippageBps ? { slippageBps: String(slippageBps) } : {}), ...(expiredAt ? { expiredAt: String(expiredAt) } : {}) },
      computeUnitPrice: "auto", wrapAndUnwrapSol: true
    }),
    execute: (signedTransaction, requestId) => jup.post("/trigger/v1/execute", { signedTransaction, requestId }),
    cancel: (maker, order) => jup.post("/trigger/v1/cancelOrder", { maker, order, computeUnitPrice: "auto" }),
    list: (user, orderStatus = "active", page = 1) => jup.get(`/trigger/v1/getTriggerOrders?${new URLSearchParams({ user, orderStatus, page: String(page), includeFailedTx: "false" })}`)
  };
}

// Raw amounts for a limit order at a target USD price per token. BigInt throughout so large supplies stay exact.
// buy: spend `amountRaw` lamports, receive tokens at or below the price. sell: sell `amountRaw` token units for SOL at or above it.
export function limitAmounts({ side, mint, amountRaw, priceUsd, solUsd, decimals }) {
  if (!(priceUsd > 0) || !(solUsd > 0)) throw new Error("Set a target price.");
  const P = BigInt(Math.round(priceUsd / solUsd * 1e18)); // lamports per raw token, scaled by 1e9 (SOL per token × 1e18)
  if (P <= 0n) throw new Error("That price is too small.");
  const unit = 10n ** BigInt(decimals) * 1_000_000_000n;
  const amount = BigInt(amountRaw);
  if (side === "buy") return { inputMint: SOL_MINT, outputMint: mint, making: amount, taking: amount * unit / P };
  return { inputMint: mint, outputMint: SOL_MINT, making: amount, taking: amount * P / unit };
}

// Sign Jupiter's order transaction with the given signer and hand it back to Jupiter to submit.
export async function signAndExecute({ web3, api, res, sign }) {
  if (!res || !res.transaction || !res.requestId) throw new Error(res?.error || "Jupiter didn't return an order transaction.");
  const tx = web3.VersionedTransaction.deserialize(b64(res.transaction));
  const signed = await sign(tx);
  const out = await api.execute(toB64(signed.serialize()), res.requestId);
  if (!out || out.status !== "Success") throw new Error(out?.error || "Jupiter couldn't submit the order transaction.");
  return { signature: out.signature, order: out.order || res.order };
}

// Human view of a Trigger order: which side, how much, at what USD price.
export function describeOrder(o, solUsd) {
  const buy = o.inputMint === SOL_MINT;
  const making = Number(o.makingAmount), taking = Number(o.takingAmount);
  const tokens = buy ? taking : making, sol = buy ? making : taking;
  return { key: o.orderKey, side: buy ? "buy" : "sell", mint: buy ? o.outputMint : o.inputMint, tokens, sol, priceUsd: tokens && solUsd ? sol / tokens * solUsd : null,
    filledPct: making ? (1 - Number(o.remainingMakingAmount ?? making) / making) * 100 : 0, createdAt: o.createdAt, expiredAt: o.expiredAt, status: o.status };
}

/* ---------- autopilot rules ---------- */
// rule: { id, wallet, mint, symbol, kind: "tp"|"sl"|"trail", pct, sellPct, entryUsd, peakUsd, status }
export function evaluateRule(rule, priceUsd) {
  if (rule.status !== "armed" || !(priceUsd > 0) || !(rule.entryUsd > 0)) return { fire: false };
  if (rule.kind === "tp") return { fire: priceUsd >= rule.entryUsd * (1 + rule.pct / 100) };
  if (rule.kind === "sl") return { fire: priceUsd <= rule.entryUsd * (1 - rule.pct / 100) };
  if (rule.kind === "trail") {
    const peakUsd = Math.max(rule.peakUsd || rule.entryUsd, priceUsd);
    return { fire: priceUsd <= peakUsd * (1 - rule.pct / 100), peakUsd };
  }
  return { fire: false };
}
export const ruleTarget = r => r.kind === "tp" ? r.entryUsd * (1 + r.pct / 100) : r.kind === "sl" ? r.entryUsd * (1 - r.pct / 100) : (r.peakUsd || r.entryUsd) * (1 - r.pct / 100);
export function newRule({ wallet, mint, symbol, kind, pct, sellPct = 100, entryUsd }) {
  if (!["tp", "sl", "trail"].includes(kind)) throw new Error("Unknown rule.");
  if (!(pct > 0) || (kind !== "tp" && pct >= 100)) throw new Error("Set a percentage.");
  if (!(sellPct > 0 && sellPct <= 100)) throw new Error("Sell between 1% and 100%.");
  if (!(entryUsd > 0)) throw new Error("No price for this token yet.");
  return { id: `${kind}-${mint.slice(0, 6)}-${Date.now().toString(36)}`, wallet, mint, symbol, kind, pct, sellPct, entryUsd, peakUsd: entryUsd, status: "armed", createdAt: Date.now() };
}
