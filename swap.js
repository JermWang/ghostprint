// Ghostprint terminal: Jupiter-routed swaps against SOL, with the platform fee added as a
// plain SOL transfer to the treasury inside the same transaction the user signs.
// The Solana web3.js library is passed in, so this module runs in the browser and in Node tests.

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS = 1_000_000_000n;

export class SwapError extends Error {}

// Jito: a tip to one of these accounts makes the transaction eligible for Jito's block engine,
// which forwards it straight to the leader (and, sent only there, keeps it out of the public mempool).
export const JITO_URL = "https://mainnet.block-engine.jito.wtf/api/v1/transactions";
export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5", "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY", "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh", "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL", "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
];
export const JITO_MIN_TIP = 1000n;
const toB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export async function jitoSend(url, raw, f = globalThis.fetch.bind(globalThis)) {
  const res = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [toB64(raw), { encoding: "base64" }] }) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new SwapError(`Jito: ${body?.error?.message || `HTTP ${res.status}`}`);
  return body.result;
}

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
    get: path => call(path),
    post: (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
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
export function buildSwapTx(web3, { parts, user, treasury, fee, side, blockhash, lookupTables = [], tip = null }) {
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
    ...(side === "sell" && feeIx ? [feeIx] : []),
    ...(tip && BigInt(tip.lamports) >= JITO_MIN_TIP ? [web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: new web3.PublicKey(tip.account), lamports: BigInt(tip.lamports) })] : [])
  ];
  const message = new web3.TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  return new web3.VersionedTransaction(message);
}

// Quote, build and return everything the UI needs to show before the user signs.
export async function prepareSwap({ web3, jup, connection, side, mint, amountRaw, user, treasury, feeBps, slippageBps, priorityMaxLamports, priorityLevel, tipLamports = 0n }) {
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
  const tip = BigInt(tipLamports) >= JITO_MIN_TIP ? { lamports: BigInt(tipLamports), account: JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)] } : null;
  const tx = buildSwapTx(web3, { parts, user, treasury, fee, side, blockhash, lookupTables, tip });
  if (tx.serialize().length > 1232) throw new SwapError("This route is too large for one transaction. Try a different amount.");
  return { tx, quote, fee, lastValidBlockHeight, tip };
}

// Simulate an unsigned transaction on our RPC before any wallet sees it. Phantom refuses what its own
// simulation says will fail ("This dApp could be malicious"), so a transaction that can't land never
// reaches the wallet: the user gets the reason here instead. (Phantom docs: simulate with sigVerify false.)
export async function preflight(connection, tx) {
  const sim = await connection.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed" }).catch(() => null);
  const err = sim && sim.value && sim.value.err;
  if (err) throw new SwapError(simError({ message: JSON.stringify(err) + " " + (sim.value.logs || []).slice(-3).join(" ") }));
}

// Send, keep rebroadcasting until confirmed or the blockhash expires.
// jito: block engine URL to also send through. mevProtect: send only through Jito (after a simulation check).
export async function sendAndConfirm(connection, signed, lastValidBlockHeight, { onStatus = () => {}, interval = 2000, jito = null, mevProtect = false, fetch: f } = {}) {
  const raw = signed.serialize();
  const viaJito = () => jito ? jitoSend(jito, raw, f) : Promise.reject(new SwapError("Jito isn't configured."));
  let sig;
  if (jito && mevProtect) {
    await preflight(connection, signed);
    sig = await viaJito();
  } else {
    sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" })
      .catch(e => { throw new SwapError(simError(e)); });
    if (jito) viaJito().catch(() => {});
  }
  onStatus({ state: "sent", sig });
  return confirmSent(connection, sig, lastValidBlockHeight, {
    onStatus, interval,
    rebroadcast: () => { if (!mevProtect) connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {}); if (jito) viaJito().catch(() => {}); }
  });
}

// Wait for a sent signature to confirm, fail or expire. rebroadcast runs between checks.
export async function confirmSent(connection, sig, lastValidBlockHeight, { onStatus = () => {}, interval = 2000, rebroadcast = () => {} } = {}) {
  for (;;) {
    const { value: [st] } = await connection.getSignatureStatuses([sig]);
    if (st && st.err) throw new SwapError(`The transaction failed on-chain${slippageHint(st.err)}. Nothing but the network fee was spent.`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) { onStatus({ state: "confirmed", sig }); return sig; }
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new SwapError("The transaction didn't land before it expired. Nothing was spent. Try again, or raise priority or the Jito tip.");
    await new Promise(r => setTimeout(r, interval));
    rebroadcast();
  }
}
function simError(e) {
  const m = String(e && e.message || e);
  if (/InsufficientFundsForRent/.test(m)) return "That amount is below the 0.00089 SOL a new Solana account needs to exist. Send more.";
  if (/insufficient (funds|lamports)|AccountNotFound/i.test(m) || /0x1\b/.test(m)) return "Not enough SOL to cover this, the fee and network costs.";
  if (/slippage|0x1771|6001/i.test(m)) return "Price moved past your slippage limit. Raise slippage or try again.";
  return "The network would reject this transaction: " + m.slice(0, 140);
}
const slippageHint = err => /6001|1771/.test(JSON.stringify(err)) ? " (price moved past your slippage limit)" : "";
