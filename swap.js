// Ghostprint terminal: Jupiter-routed swaps against SOL, with the platform fee added as a
// plain SOL transfer to the treasury inside the same transaction the user signs.
// The Solana web3.js library is passed in, so this module runs in the browser and in Node tests.

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS = 1_000_000_000n;

export class SwapError extends Error {}

export function jupiter({ base = "https://api.jup.ag", apiKey = "", fetch: f = globalThis.fetch.bind(globalThis), minInterval = 0 } = {}) {
  const headers = apiKey ? { "x-api-key": apiKey } : {};
  // Jupiter's free tiers allow about one request per second, so requests queue up and go out spaced.
  let next = 0;
  async function slot() {
    const now = Date.now(), at = Math.max(now, next);
    next = at + minInterval;
    if (at > now) await new Promise(r => setTimeout(r, at - now));
  }
  async function call(path, init = {}) {
    await slot();
    let res;
    try { res = await f(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } }); }
    catch (e) { throw new SwapError("Couldn't reach Jupiter. Check your connection."); }
    if (res.status === 429) throw new SwapError("Jupiter is rate limiting this browser. Wait a few seconds and try again.");
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (!res.ok || (body && body.error)) throw new SwapError(jupMessage(body && (body.error || body.message)) || `Jupiter answered HTTP ${res.status}.`);
    return body;
  }
  return {
    quote: ({ inputMint, outputMint, amount, slippageBps }) => call(`/swap/v1/quote?${new URLSearchParams({
      inputMint, outputMint, amount: String(amount), slippageBps: String(slippageBps),
      restrictIntermediateTokens: "true",
      maxAccounts: "54" // leaves room in the transaction for the fee transfer
    })}`),
    instructions: ({ quote, user, priorityMaxLamports, priorityLevel = "veryHigh" }) => call("/swap/v1/swap-instructions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: priorityMaxLamports, priorityLevel } }
      })
    }),
    search: q => call(`/tokens/v2/search?${new URLSearchParams({ query: q })}`),
    // token lists: "recent", or a category (toptrending, toptraded, toporganicscore) with an interval (5m, 1h, 6h, 24h)
    list: (category, interval, limit = 50) => call(category === "recent" ? "/tokens/v2/recent" : `/tokens/v2/${category}/${interval}?${new URLSearchParams({ limit: String(limit) })}`),
    prices: ids => ids.length ? call(`/price/v3?${new URLSearchParams({ ids: ids.slice(0, 50).join(",") })}`) : Promise.resolve({})
  };
}

function jupMessage(m) {
  if (!m) return "";
  if (/no route|could not find any route|COULD_NOT_FIND_ANY_ROUTE/i.test(m)) return "No route for this trade. The token may have no liquidity yet.";
  if (/amount.*too small|ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT/i.test(m)) return "That amount is too small to route.";
  return String(m).slice(0, 160);
}

// Raw integer amounts from a decimal string, without floating point.
export function toRaw(text, decimals) {
  const s = String(text).trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}
export function fromRaw(raw, decimals, places = 6) {
  const n = BigInt(raw), d = 10n ** BigInt(decimals), whole = n / d, frac = (n % d).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

// How the fee splits a trade. Buys: the fee comes off the SOL before it is swapped.
// Sells: the fee is taken from the minimum SOL the quote guarantees, after the swap.
export function feeOnBuy(lamports, feeBps) {
  const fee = (BigInt(lamports) * BigInt(feeBps)) / 10000n;
  return { fee, swapAmount: BigInt(lamports) - fee };
}
export function feeOnSell(quote, feeBps) {
  return (BigInt(quote.otherAmountThreshold) * BigInt(feeBps)) / 10000n;
}

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export function toInstruction(web3, ix) {
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(ix.programId),
    keys: ix.accounts.map(a => ({ pubkey: new web3.PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: b64(ix.data)
  });
}

// Assemble Jupiter's pieces plus the fee transfer into one v0 transaction for the user to sign.
export function buildSwapTx(web3, { parts, user, treasury, fee, side, blockhash, lookupTables = [] }) {
  const payer = new web3.PublicKey(user);
  const ix = x => toInstruction(web3, x);
  const feeIx = BigInt(fee) > 0n
    ? web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: new web3.PublicKey(treasury), lamports: BigInt(fee) })
    : null;
  const instructions = [
    ...(parts.computeBudgetInstructions || []).map(ix),
    ...(parts.otherInstructions || []).map(ix),
    ...(parts.setupInstructions || []).map(ix),
    ...(side === "buy" && feeIx ? [feeIx] : []),
    ix(parts.swapInstruction),
    ...(parts.cleanupInstruction ? [ix(parts.cleanupInstruction)] : []),
    ...(side === "sell" && feeIx ? [feeIx] : [])
  ];
  const message = new web3.TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  return new web3.VersionedTransaction(message);
}

// Quote, build and return everything the UI needs to show before the user signs.
export async function prepareSwap({ web3, jup, connection, side, mint, amountRaw, user, treasury, feeBps, slippageBps, priorityMaxLamports, priorityLevel }) {
  let quote, fee;
  if (side === "buy") {
    const split = feeOnBuy(amountRaw, feeBps);
    if (split.swapAmount <= 0n) throw new SwapError("That amount is too small.");
    quote = await jup.quote({ inputMint: SOL_MINT, outputMint: mint, amount: split.swapAmount, slippageBps });
    fee = split.fee;
  } else {
    quote = await jup.quote({ inputMint: mint, outputMint: SOL_MINT, amount: amountRaw, slippageBps });
    fee = feeOnSell(quote, feeBps);
  }
  const parts = await jup.instructions({ quote, user, priorityMaxLamports, priorityLevel });
  const [lookupTables, { blockhash, lastValidBlockHeight }] = await Promise.all([
    Promise.all((parts.addressLookupTableAddresses || []).map(a => connection.getAddressLookupTable(new web3.PublicKey(a)).then(r => r.value))).then(v => v.filter(Boolean)),
    connection.getLatestBlockhash("confirmed")
  ]);
  const tx = buildSwapTx(web3, { parts, user, treasury, fee, side, blockhash, lookupTables });
  if (tx.serialize().length > 1232) throw new SwapError("This route is too large for one transaction. Try a different amount.");
  return { tx, quote, fee, lastValidBlockHeight };
}

// Send, keep rebroadcasting until confirmed or the blockhash expires.
export async function sendAndConfirm(connection, signed, lastValidBlockHeight, { onStatus = () => {}, interval = 2000 } = {}) {
  const raw = signed.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" })
    .catch(e => { throw new SwapError(simError(e)); });
  onStatus({ state: "sent", sig });
  for (;;) {
    const { value: [st] } = await connection.getSignatureStatuses([sig]);
    if (st && st.err) throw new SwapError(`The swap failed on-chain${slippageHint(st.err)}. Nothing but the network fee was spent.`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) { onStatus({ state: "confirmed", sig }); return sig; }
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new SwapError("The swap didn't land before it expired. Nothing was spent. Try again.");
    await new Promise(r => setTimeout(r, interval));
    connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  }
}
function simError(e) {
  const m = String(e && e.message || e);
  if (/insufficient (funds|lamports)/i.test(m) || /0x1\b/.test(m)) return "Not enough SOL to cover the trade, the fee and network costs.";
  if (/slippage|0x1771|6001/i.test(m)) return "Price moved past your slippage limit. Raise slippage or try again.";
  return "The network rejected the swap: " + m.slice(0, 140);
}
const slippageHint = err => /6001|1771/.test(JSON.stringify(err)) ? " (price moved past your slippage limit)" : "";
