// Ghostprint "Trace me": read-only exposure analysis for a Solana wallet.
// Everything here runs in the visitor's browser against a Solana RPC node they choose.
// collect() reads public history, analyze() turns it into the links a wallet tracker would draw.

export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

// Only labels we have confirmed against an explorer. Anything else that looks like an exchange is
// caught by the balance heuristic (EXCHANGE_LAMPORTS) and labelled as "likely", never by name.
export const KNOWN = {
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": { name: "Binance 2", kind: "exchange" }
};

const LAMPORTS = 1e9;
const EXCHANGE_LAMPORTS = 20000 * LAMPORTS; // a counterparty this rich is a custodian, not a person
const DUST_LAMPORTS = 1e6;                  // 0.001 SOL
const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",  // wrapped SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"  // USDT
]);
// Programs that move funds without trading. A transaction made only of these is a plain transfer.
const BASIC = new Set([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "ComputeBudget111111111111111111111111111111",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"
]);

/* ---------- addresses ---------- */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s) {
  const bytes = [];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 255; carry >>= 8; }
    while (carry) { bytes.push(carry & 255); carry >>= 8; }
  }
  for (const ch of s) { if (ch !== "1") break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}
export function base58Encode(u8) {
  const digits = [];
  for (const b of u8) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (const b of u8) { if (b) break; out += "1"; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}
export const isAddress = s => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && (base58Decode(s) || []).length === 32;
export const short = a => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "";
// lookalikes share the first and last four characters, so show where they differ
const long = a => `${a.slice(0, 8)}…${a.slice(-4)}`;
const sol = l => l / LAMPORTS;
// Address poisoners copy the first and last characters of an address you really use.
const lookalike = (a, b) => a !== b && a.slice(0, 4) === b.slice(0, 4) && a.slice(-4) === b.slice(-4);

/* ---------- RPC ---------- */
export class RpcError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function rpcClient(url, { fetch: f = globalThis.fetch.bind(globalThis), concurrency = 4, retries = 5, backoff = 400 } = {}) {
  let id = 0, active = 0;
  const queue = [];
  async function call(method, params) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      } catch (e) {
        if (attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
        throw new RpcError(`Couldn't reach the RPC node (${e.message || e})`, 0);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
      if (res.status === 429) throw new RpcError("The RPC node is rate limiting this browser. Try again in a minute, or use your own RPC URL.", 429);
      if (!res.ok) throw new RpcError(`The RPC node answered HTTP ${res.status}`, res.status);
      const body = await res.json();
      if (body.error) {
        if (attempt < retries && /rate|limit|too many/i.test(body.error.message || "")) { await sleep(backoff * 2 ** attempt); continue; }
        throw new RpcError(`${method}: ${body.error.message}`, 200);
      }
      return body.result;
    }
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      call(job.method, job.params).then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  }
  return { call: (method, params) => new Promise((resolve, reject) => { queue.push({ method, params, resolve, reject }); pump(); }) };
}

/* ---------- collection ---------- */
const TX_OPTS = { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" };

async function signatures(rpc, address, maxPages, pageSize = 1000) {
  const all = [];
  let before, reachedStart = false;
  for (let page = 0; page < maxPages; page++) {
    const batch = await rpc.call("getSignaturesForAddress", [address, before ? { limit: pageSize, before } : { limit: pageSize }]);
    all.push(...batch);
    if (batch.length < pageSize) { reachedStart = true; break; }
    before = batch[batch.length - 1].signature;
  }
  return { all, reachedStart };
}

async function transactions(rpc, sigs, onEach) {
  return (await Promise.all(sigs.map(s => rpc.call("getTransaction", [s, TX_OPTS]).then(tx => { onEach && onEach(); return tx; })))).filter(Boolean);
}

// Reads the wallet's public history, then looks one hop out at the wallets that matter most.
export async function collect(address, { rpc, recent = 100, oldest = 6, maxPages = 5, pageSize = 1000, depthTx = 15, depthWallets = 5, onProgress = () => {} } = {}) {
  if (!isAddress(address)) throw new RpcError("That isn't a Solana address.", 0);
  onProgress({ step: "history", done: 0, total: 0 });
  const [{ all, reachedStart }, balance, tokens] = await Promise.all([
    signatures(rpc, address, maxPages, pageSize),
    rpc.call("getBalance", [address]).then(r => r.value),
    tokenCount(rpc, address)
  ]);
  const ok = all.filter(s => !s.err);
  const pick = ok.slice(0, recent).map(s => s.signature);
  if (reachedStart) for (const s of ok.slice(-oldest)) if (!pick.includes(s.signature)) pick.push(s.signature);
  let done = 0;
  const txs = await transactions(rpc, pick, () => onProgress({ step: "transactions", done: ++done, total: pick.length }));

  // one hop out: the funder and the busiest counterparties
  const first = analyze(address, txs, { balance, tokens, reachedStart, signatureCount: all.length });
  const hop = [first.funding && first.funding.address, ...first.counterparties.map(c => c.address)]
    .filter((a, i, arr) => a && !KNOWN[a] && arr.indexOf(a) === i).slice(0, depthWallets);
  const depth = {};
  done = 0;
  const totalHop = hop.length;
  await Promise.all(hop.map(async a => {
    const [bal, sigs] = await Promise.all([
      rpc.call("getBalance", [a]).then(r => r.value),
      rpc.call("getSignaturesForAddress", [a, { limit: depthTx }])
    ]);
    const htxs = await transactions(rpc, sigs.filter(s => !s.err).map(s => s.signature));
    depth[a] = { balance: bal, txs: htxs };
    onProgress({ step: "neighbours", done: ++done, total: totalHop });
  }));
  return { address, txs, balance, tokens, reachedStart, signatureCount: all.length, depth };
}

async function tokenCount(rpc, owner) {
  const programs = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  const res = await Promise.all(programs.map(p => rpc.call("getTokenAccountsByOwner", [owner, { programId: p }, { encoding: "jsonParsed" }]).then(r => r.value).catch(() => [])));
  return res.flat().filter(a => Number(a.account?.data?.parsed?.info?.tokenAmount?.amount || 0) > 0).length;
}

export async function trace(address, opts = {}) {
  const rpc = opts.rpc || rpcClient(opts.url || DEFAULT_RPC, { fetch: opts.fetch });
  const raw = await collect(address, { ...opts, rpc });
  return analyze(address, raw.txs, raw);
}

/* ---------- reading one transaction ---------- */
export function readTx(tx, owner) {
  const msg = tx.transaction.message, meta = tx.meta || {};
  const keys = msg.accountKeys.map(k => typeof k === "string" ? { pubkey: k, signer: false } : k);
  const ownerIdx = keys.findIndex(k => k.pubkey === owner);
  const tokenAcct = {};
  for (const b of [...(meta.preTokenBalances || []), ...(meta.postTokenBalances || [])]) {
    const k = keys[b.accountIndex];
    if (k) tokenAcct[k.pubkey] = { owner: b.owner, mint: b.mint, decimals: b.uiTokenAmount?.decimals ?? 0 };
  }
  const top = msg.instructions || [];
  const inner = (meta.innerInstructions || []).flatMap(i => i.instructions);
  const programs = top.map(i => i.programId);
  const out = {
    sig: tx.transaction.signatures[0],
    time: tx.blockTime || 0,
    ownerSigned: ownerIdx >= 0 && !!keys[ownerIdx].signer,
    basicOnly: programs.every(p => BASIC.has(p)),
    sol: [], tokens: [], solDelta: 0, tokenDeltas: {}
  };
  for (const ix of [...top, ...inner]) {
    const p = ix.parsed;
    if (!p || typeof p !== "object") continue;
    const info = p.info || {};
    if (ix.program === "system") {
      if (p.type === "transfer" || p.type === "transferWithSeed") out.sol.push({ from: info.source, to: info.destination, lamports: Number(info.lamports) || 0 });
      else if (p.type === "createAccount" || p.type === "createAccountWithSeed") out.sol.push({ from: info.source, to: info.newAccount, lamports: Number(info.lamports) || 0, create: true });
    } else if (ix.program === "spl-token" && (p.type === "transfer" || p.type === "transferChecked")) {
      const src = tokenAcct[info.source], dst = tokenAcct[info.destination];
      const mint = info.mint || src?.mint || dst?.mint;
      const decimals = info.tokenAmount?.decimals ?? src?.decimals ?? dst?.decimals ?? 0;
      const amount = info.tokenAmount ? Number(info.tokenAmount.uiAmount || 0) : Number(info.amount || 0) / 10 ** decimals;
      out.tokens.push({ from: src?.owner || info.authority || info.multisigAuthority, to: dst?.owner, mint, amount });
    }
  }
  if (ownerIdx >= 0 && meta.preBalances && meta.postBalances) out.solDelta = meta.postBalances[ownerIdx] - meta.preBalances[ownerIdx];
  const add = (b, sign) => { if (b.owner === owner) out.tokenDeltas[b.mint] = (out.tokenDeltas[b.mint] || 0) + sign * Number(b.uiTokenAmount?.uiAmount || 0); };
  (meta.preTokenBalances || []).forEach(b => add(b, -1));
  (meta.postTokenBalances || []).forEach(b => add(b, 1));
  return out;
}

/* ---------- analysis ---------- */
export function analyze(address, txs, extra = {}) {
  const read = txs.map(t => readTx(t, address)).sort((a, b) => a.time - b.time);
  const depth = extra.depth || {};
  const exchangeOf = a => KNOWN[a] ? { name: KNOWN[a].name, sure: true }
    : depth[a] && depth[a].balance >= EXCHANGE_LAMPORTS ? { name: "Likely exchange or custodian", sure: false } : null;

  // trades: signed by the owner, touching a non-transfer program, moving a non-quote token
  const trades = [];
  for (const x of read) {
    if (!x.ownerSigned || x.basicOnly) continue;
    const moved = Object.entries(x.tokenDeltas).filter(([m, d]) => !QUOTE_MINTS.has(m) && Math.abs(d) > 0);
    if (moved.length) trades.push({ sig: x.sig, time: x.time, mints: moved.map(([m, d]) => ({ mint: m, side: d > 0 ? "buy" : "sell" })) });
  }

  // transfers with other wallets, from plain transfer transactions only (swaps send funds to pools)
  const cp = new Map();
  const dust = [];
  const touch = a => { if (!cp.has(a)) cp.set(a, { address: a, inCount: 0, outCount: 0, inLamports: 0, outLamports: 0, tokenIn: 0, tokenOut: 0, first: Infinity, last: 0 }); return cp.get(a); };
  for (const x of read) {
    if (!x.basicOnly) continue;
    for (const t of x.sol) {
      if (t.from === t.to) continue;
      if (t.to === address && t.from) {
        if (t.lamports < DUST_LAMPORTS && !x.ownerSigned) { dust.push({ from: t.from, time: x.time, kind: "sol" }); continue; }
        const c = touch(t.from); c.inCount++; c.inLamports += t.lamports; c.first = Math.min(c.first, x.time); c.last = Math.max(c.last, x.time);
      } else if (t.from === address && t.to) {
        const c = touch(t.to); c.outCount++; c.outLamports += t.lamports; c.first = Math.min(c.first, x.time); c.last = Math.max(c.last, x.time);
      }
    }
    for (const t of x.tokens) {
      if (!t.from || !t.to || t.from === t.to) continue;
      if (t.to === address) {
        if (!x.ownerSigned && t.amount < 0.01) { dust.push({ from: t.from, time: x.time, kind: "token", mint: t.mint }); continue; }
        const c = touch(t.from); c.tokenIn++; c.first = Math.min(c.first, x.time); c.last = Math.max(c.last, x.time);
      } else if (t.from === address) {
        const c = touch(t.to); c.tokenOut++; c.first = Math.min(c.first, x.time); c.last = Math.max(c.last, x.time);
      }
    }
  }
  const counterparties = [...cp.values()]
    .map(c => ({ ...c, transfers: c.inCount + c.outCount + c.tokenIn + c.tokenOut, volume: c.inLamports + c.outLamports }))
    .sort((a, b) => b.volume - a.volume || b.transfers - a.transfers);

  // funding: the first SOL that arrived, if we reached the start of the history
  let funding = null;
  if (extra.reachedStart) {
    for (const x of read) {
      const t = x.sol.find(s => s.to === address && s.from && s.from !== address && s.lamports >= DUST_LAMPORTS);
      if (t) { funding = { address: t.from, lamports: t.lamports, time: x.time, exchange: exchangeOf(t.from) }; break; }
    }
  }

  // siblings: other wallets the funder sent SOL to (seen in its recent history)
  const siblings = [];
  if (funding && depth[funding.address] && !funding.exchange) {
    const seen = new Set();
    for (const t of depth[funding.address].txs) for (const s of readTx(t, funding.address).sol)
      if (s.from === funding.address && s.to && s.to !== address && !seen.has(s.to) && s.lamports >= DUST_LAMPORTS) { seen.add(s.to); siblings.push(s.to); }
  }

  // exchange links: direct, or through a deposit address that forwards to a known exchange
  const exchanges = [];
  for (const c of counterparties) {
    const ex = exchangeOf(c.address);
    if (ex) { exchanges.push({ address: c.address, name: ex.name, sure: ex.sure, via: null, direction: c.inCount + c.tokenIn > 0 ? (c.outCount + c.tokenOut > 0 ? "both" : "withdrawal") : "deposit" }); continue; }
    const d = depth[c.address];
    if (!d || !(c.outCount + c.tokenOut)) continue;
    const dests = new Set();
    for (const t of d.txs) {
      const r = readTx(t, c.address);
      for (const s of r.sol) if (s.from === c.address && s.to) dests.add(s.to);
      for (const s of r.tokens) if (s.from === c.address && s.to) dests.add(s.to);
    }
    const hit = [...dests].find(a => KNOWN[a]);
    if (hit) exchanges.push({ address: hit, name: KNOWN[hit].name, sure: true, via: c.address, direction: "deposit" });
    else if (dests.size === 1 && d.balance < 0.01 * LAMPORTS && d.txs.length >= 2) exchanges.push({ address: [...dests][0], name: "Likely exchange (sweeps a deposit address)", sure: false, via: c.address, direction: "deposit" });
  }
  const exchangeSet = new Set(exchanges.flatMap(e => [e.address, e.via]).filter(Boolean));

  // wallets that probably belong to the same person
  const linked = counterparties
    .filter(c => !exchangeSet.has(c.address))
    .map(c => {
      let score = 0;
      const why = [];
      if ((c.inCount + c.tokenIn) && (c.outCount + c.tokenOut)) { score += 3; why.push("funds go both ways"); }
      if (c.transfers >= 3) { score += 2; why.push(`${c.transfers} transfers`); }
      if (c.volume >= 0.1 * LAMPORTS) { score += 1; }
      if (funding && c.address === funding.address) { score += 3; why.push("funded this wallet"); }
      if (siblings.includes(c.address)) { score += 3; why.push("same funder"); }
      return { address: c.address, score, why, transfers: c.transfers, volume: c.volume };
    })
    .filter(l => l.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // address poisoning: dust from a lookalike of a wallet you have really sent to
  const sentTo = counterparties.filter(c => c.outCount + c.tokenOut > 0).map(c => c.address);
  const poison = [];
  for (const d of dust) {
    const target = sentTo.find(a => lookalike(d.from, a));
    if (target && !poison.some(p => p.from === d.from)) poison.push({ from: d.from, mimics: target, time: d.time });
  }

  const hours = activityHours(read.filter(x => x.ownerSigned && x.time));
  const findings = [], graph = { nodes: [{ id: address, kind: "you", label: "YOU" }], edges: [] };
  const node = (id, kind, label, weight = 1) => { if (!graph.nodes.some(n => n.id === id)) graph.nodes.push({ id, kind, label, weight }); };

  let score = 0;
  if (exchanges.length) {
    const sure = exchanges.find(e => e.sure) || exchanges[0];
    score += sure.sure ? 32 : 22;
    findings.push({ g: "Identity", sev: "high", k: "Exchange", v: `${sure.direction === "deposit" ? "Deposits to" : sure.direction === "both" ? "Moves funds with" : "Withdrawal from"} ${sure.name}${sure.via ? ` via ${short(sure.via)}` : ""}${exchanges.length > 1 ? ` · +${exchanges.length - 1} more` : ""}`, why: "Exchanges hold your ID. One link ties this wallet to your name in their records." });
    for (const e of exchanges.slice(0, 3)) { node(e.address, "exchange", e.sure ? e.name.toUpperCase() : "EXCHANGE?"); if (e.via) { node(e.via, "deposit", "DEPOSIT"); graph.edges.push({ a: address, b: e.via }, { a: e.via, b: e.address }); } else graph.edges.push({ a: address, b: e.address }); }
  }
  if (funding) {
    score += funding.exchange ? 6 : 14;
    findings.push({ g: "Funding", sev: funding.exchange ? "med" : "high", k: "Funded by", v: `${funding.exchange ? funding.exchange.name : short(funding.address)} · ${sol(funding.lamports).toFixed(3)} SOL`, why: "Trackers group every wallet that shares a funder." });
    if (!funding.exchange) { node(funding.address, "funder", "FUNDER"); graph.edges.push({ a: funding.address, b: address }); }
    else if (!graph.nodes.some(n => n.id === funding.address)) { node(funding.address, "exchange", funding.exchange.sure ? funding.exchange.name.toUpperCase() : "EXCHANGE?"); graph.edges.push({ a: funding.address, b: address }); }
  } else {
    findings.push({ g: "Funding", sev: "low", k: "Funded by", v: extra.reachedStart ? "No incoming SOL found" : `Not reached (${extra.signatureCount || 0}+ transactions)`, why: "The first deposit is the strongest link trackers use." });
  }
  if (siblings.length) {
    score += Math.min(12, 4 + siblings.length);
    findings.push({ g: "Cluster", sev: "high", k: "Siblings", v: `${siblings.length} other wallet${siblings.length === 1 ? "" : "s"} share your funder`, why: "Wallets funded from one source are treated as one owner." });
    node("siblings", "siblings", `SIBLINGS ×${siblings.length}`, siblings.length);
    if (funding) graph.edges.push({ a: funding.address, b: "siblings" });
  }
  const linkedOnly = linked.filter(l => !(funding && l.address === funding.address));
  if (linkedOnly.length) {
    score += Math.min(20, linkedOnly.length * 6);
    findings.push({ g: "Cluster", sev: linkedOnly[0].score >= 5 ? "high" : "med", k: "Linked", v: `${linkedOnly.length} wallet${linkedOnly.length === 1 ? "" : "s"} · ${linkedOnly.slice(0, 2).map(l => short(l.address)).join(", ")}`, why: cap(linkedOnly[0].why.join(", ")) + "." });
    linkedOnly.slice(0, 4).forEach(l => { node(l.address, "linked", short(l.address), l.score); graph.edges.push({ a: address, b: l.address }); });
  }
  if (trades.length) {
    const mints = new Set(trades.flatMap(t => t.mints.map(m => m.mint)));
    score += trades.length >= 20 ? 14 : trades.length >= 5 ? 9 : 4;
    findings.push({ g: "Trading", sev: trades.length >= 5 ? "med" : "low", k: "Trades", v: `${trades.length} recent swaps · ${mints.size} token${mints.size === 1 ? "" : "s"}`, why: "Every entry and exit is public. Copy-traders can follow it in seconds." });
  }
  if (hours.zone) {
    score += 10;
    findings.push({ g: "Habits", sev: "med", k: "Awake", v: `Quiet ${pad(hours.quietStart)}:00–${pad((hours.quietStart + 7) % 24)}:00 UTC → ${hours.zone}`, why: "When you sign gives away roughly where you live." });
  }
  const tokenNote = extra.tokens ? ` + ${extra.tokens} token${extra.tokens === 1 ? "" : "s"}` : "";
  if (typeof extra.balance === "number") findings.push({ g: "Holdings", sev: extra.balance >= 10 * LAMPORTS ? "med" : "low", k: "Balance", v: `${sol(extra.balance).toFixed(2)} SOL${tokenNote} visible`, why: "Anyone you pay can see this." });
  if (poison.length) findings.push({ g: "Warning", sev: "warn", k: "Poisoning", v: `${long(poison[0].from)} fakes ${long(poison[0].mimics)}`, why: "A lookalike address sent you dust so you copy it by mistake. Never copy addresses from your history." });

  score = Math.min(100, score);
  const order = { high: 0, warn: 1, med: 2, low: 3 };
  findings.sort((a, b) => order[a.sev] - order[b.sev]);
  return {
    address, score, grade: score >= 75 ? "Exposed" : score >= 50 ? "High" : score >= 25 ? "Moderate" : "Low",
    findings, graph, funding, siblings, exchanges, linked, trades: trades.length, poison, hours, counterparties,
    scanned: read.length, signatureCount: extra.signatureCount || read.length, reachedStart: !!extra.reachedStart
  };
}

const pad = n => String(n).padStart(2, "0");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Hourly histogram of signed transactions; the quietest 7-hour run is probably sleep.
export function activityHours(read) {
  const h = Array(24).fill(0);
  for (const x of read) h[new Date(x.time * 1000).getUTCHours()]++;
  const total = h.reduce((a, b) => a + b, 0);
  let best = 0, bestSum = Infinity;
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += h[(s + i) % 24];
    if (sum < bestSum) { bestSum = sum; best = s; }
  }
  const out = { histogram: h, total, quietStart: best, zone: null, offset: null };
  // need enough activity and a clearly quiet window before claiming a time zone
  if (total < 25 || bestSum / total > 0.08) return out;
  // assume the quiet run starts around local midnight
  const offset = ((-best % 24) + 24 + 12) % 24 - 12;
  out.offset = offset;
  const region = offset <= -3 ? "Americas" : offset <= 3 ? "Europe / Africa" : offset <= 6 ? "Middle East / South Asia" : "East Asia / Oceania";
  out.zone = `UTC${offset === 0 ? "" : offset > 0 ? "+" + offset : "−" + -offset} ±2 · ${region}`;
  return out;
}
