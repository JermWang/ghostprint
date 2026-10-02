// Ghost mode: trade from fresh wallets that have no on-chain link to your main wallet.
//
// Funds move between your wallet and a ghost wallet through NEAR Intents (1Click API): you pay
// SOL into a one-time deposit address, and NEAR's bridge pays SOL out to the ghost from its own
// wallets. With Confidential Intents the sender, amount and route stay off the public record.
//
// Ghost wallets are derived from one signature of GHOST_MESSAGE by your main wallet, so they can
// always be rebuilt by signing again. Nothing secret is stored.

export const ONECLICK_BASE = "https://1click.chaindefuser.com";
export const SOL_ASSET = "nep141:sol.omft.near"; // native SOL inside NEAR Intents
export const GHOST_MESSAGE = "Ghostprint ghost wallets v1\n\nSigning this creates your private trading wallets. It sends no transaction and costs nothing. Only sign it on Ghostprint: anyone with this signature can open your ghost wallets.";
export const BASE_FEE = 5000n; // lamports per signature

export class GhostError extends Error {}

/* ---------- ghost wallets ---------- */
async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); }
const enc = new TextEncoder();

// A short public fingerprint of the signature, kept so we can tell if a wallet ever signs differently.
export async function seedFingerprint(signature) {
  return Array.from((await sha256(signature)).slice(0, 8), b => b.toString(16).padStart(2, "0")).join("");
}
export async function deriveGhost(web3, signature, index) {
  const tag = enc.encode(`ghostprint/ghost/${index}`);
  const seed = await sha256(new Uint8Array([...signature, ...tag]));
  return web3.Keypair.fromSeed(seed);
}

// The instant trading wallet: same signature, its own derivation path, so it never collides with ghosts.
export async function deriveInstant(web3, signature) {
  const seed = await sha256(new Uint8Array([...signature, ...enc.encode("ghostprint/instant/0")]));
  return web3.Keypair.fromSeed(seed);
}

/* ---------- 1Click client ---------- */
export function oneclick({ base = ONECLICK_BASE, jwt = "", fetch: f = globalThis.fetch.bind(globalThis) } = {}) {
  const auth = jwt ? { authorization: `Bearer ${jwt}` } : {};
  async function call(path, init = {}) {
    let res;
    try { res = await f(base + path, { ...init, headers: { ...auth, ...(init.headers || {}) } }); }
    catch (_) { throw new GhostError("Couldn't reach NEAR Intents. Check your connection."); }
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (res.status === 429) throw new GhostError("NEAR Intents is rate limiting this browser. Wait a moment and try again.");
    if (!res.ok) { const e = new GhostError(`NEAR Intents: ${String(body?.message || body?.error || `HTTP ${res.status}`).slice(0, 180)}`); e.status = res.status; throw e; }
    return body;
  }
  const json = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    tokens: () => call("/v0/tokens"),
    quote: req => call("/v0/quote", json(req)),
    submitDeposit: (txHash, depositAddress) => call("/v0/deposit/submit", json({ txHash, depositAddress })),
    status: depositAddress => call(`/v0/status?${new URLSearchParams({ depositAddress })}`)
  };
}

export function solAssetId(tokens) {
  const t = (Array.isArray(tokens) ? tokens : []).find(x => x.blockchain === "sol" && x.symbol === "SOL" && !x.contractAddress);
  return t ? t.assetId : SOL_ASSET;
}

// Quote a SOL→SOL route on Solana from one wallet to another. Asks for Confidential Intents first;
// if 1Click won't route this pair confidentially it falls back to standard intents and says so.
export async function routeQuote({ oc, asset = SOL_ASSET, amount, from, to, slippageBps = 100, confidentiality = "basic", now = Date.now() }) {
  const request = level => ({
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: slippageBps,
    originAsset: asset, depositType: "ORIGIN_CHAIN", destinationAsset: asset,
    amount: String(amount), refundTo: from, refundType: "ORIGIN_CHAIN",
    recipient: to, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + 30 * 60 * 1000).toISOString(),
    ...(level !== "public" ? { confidentiality: level } : {}),
    referral: "ghostprint"
  });
  let res, confidential = confidentiality !== "public";
  try { res = await oc.quote(request(confidentiality)); }
  catch (e) {
    if (!confidential || !(e.status >= 400 && e.status < 500) || !/confiden|private|not supported|unsupported/i.test(e.message)) throw e;
    confidential = false;
    res = await oc.quote(request("public"));
  }
  checkQuote(res, { asset, amount, from, to });
  return { res, quote: res.quote, confidential };
}

// Never send funds on a quote that doesn't say exactly what we asked for.
export function checkQuote(res, { asset, amount, from, to }) {
  const q = res && res.quote, r = res && res.quoteRequest;
  const bad = m => { throw new GhostError(`Refusing this route: ${m}.`); };
  if (!q || !r) bad("the quote is incomplete");
  if (r.recipient !== to) bad("it pays a different wallet");
  if (r.refundTo !== from) bad("refunds go to a different wallet");
  if (r.originAsset !== asset || r.destinationAsset !== asset) bad("it swaps different assets");
  if (String(r.amount) !== String(amount) || String(q.amountIn) !== String(amount)) bad("the amount changed");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.depositAddress || "")) bad("there is no valid Solana deposit address");
  if (q.depositAddress === to || q.depositAddress === from) bad("the deposit address is one of your own wallets");
  if (!(BigInt(q.minAmountOut || 0) > 0n)) bad("it pays out nothing");
}

/* ---------- transactions ---------- */
// Main wallet → deposit address (+ fee to the treasury), one transaction signed in the user's wallet.
export function fundingTx(web3, { from, depositAddress, amount, fee = 0n, treasury, blockhash }) {
  const payer = new web3.PublicKey(from);
  const ixs = [web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: new web3.PublicKey(depositAddress), lamports: BigInt(amount) })];
  if (BigInt(fee) > 0n) ixs.push(web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: new web3.PublicKey(treasury), lamports: BigInt(fee) }));
  return new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
}

// Ghost → deposit address, closing empty token accounts first so their rent comes along.
export function exitTx(web3, { ghost, depositAddress, amount, closeAccounts = [], blockhash }) {
  const owner = ghost.publicKey;
  const ixs = closeAccounts.map(a => new web3.TransactionInstruction({
    programId: new web3.PublicKey(a.programId),
    keys: [{ pubkey: new web3.PublicKey(a.address), isSigner: false, isWritable: true }, { pubkey: owner, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }],
    data: Uint8Array.from([9]) // CloseAccount
  }));
  ixs.push(web3.SystemProgram.transfer({ fromPubkey: owner, toPubkey: new web3.PublicKey(depositAddress), lamports: BigInt(amount) }));
  const tx = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  tx.sign([ghost]);
  return tx;
}

// Everything a ghost can send out: its SOL plus the rent locked in empty token accounts, minus the fee.
export function exitAmount(balance, closeAccounts = []) {
  const total = BigInt(balance) + closeAccounts.reduce((n, a) => n + BigInt(a.lamports), 0n) - BASE_FEE;
  return total > 0n ? total : 0n;
}

/* ---------- waiting on NEAR Intents ---------- */
export async function waitForRoute(oc, depositAddress, { onStatus = () => {}, interval = 3000, timeoutMs = 20 * 60 * 1000, now = () => Date.now() } = {}) {
  const until = now() + timeoutMs;
  let last = "";
  for (;;) {
    let st = null;
    try { st = await oc.status(depositAddress); } catch (e) { if (!(e.status >= 500) && e.status !== 404) throw e; }
    const s = st && st.status;
    if (s && s !== last) { last = s; onStatus(s, st); }
    if (s === "SUCCESS") return st;
    if (s === "REFUNDED") throw new GhostError("NEAR Intents couldn't complete the route and refunded the deposit to the sending wallet.");
    if (s === "FAILED") throw new GhostError("NEAR Intents reported the route as failed. Check the sending wallet for a refund.");
    if (now() > until) throw new GhostError("The route is taking longer than expected. It may still complete, so check Portfolio in a few minutes. If it can't, NEAR Intents refunds the sending wallet.");
    await new Promise(r => setTimeout(r, interval));
  }
}
