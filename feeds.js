// Live data for the terminal. Network only; parsing lives in pump.js and market.js.
import { bondingCurveAddress, decodeCurve, tradesFromLogs, tradesFromTx, fromBase64, eventPriceSol, PUMP_PROGRAM } from "./pump.js";
import { base58Decode } from "./trace.js";
import { walletSwaps, SOL_MINT } from "./market.js";
import { imageSources, socialUrl, decodeMetaplex, decodeToken2022Meta, METAPLEX, TOKEN_2022 } from "./media.js";
export { GATEWAYS, ipfsPath, imageSources, socialUrl, setMediaProxy, decodeMetaplex, decodeToken2022Meta, METAPLEX, identicon } from "./media.js";

export const PUMPPORTAL_WS = "wss://pumpportal.fun/api/data";

// A websocket that reconnects with backoff and re-sends its subscriptions.
function socket(url, { onOpen, onMessage, onStatus = () => {}, WS = globalThis.WebSocket }) {
  let ws, closed = false, retry = 0, timer = 0;
  const open = () => {
    onStatus("connecting");
    try { ws = new WS(url); } catch (_) { return later(); }
    ws.onopen = () => { retry = 0; onStatus("live"); onOpen(ws); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onMessage(m, ws); };
    ws.onclose = () => { if (!closed) later(); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  };
  const later = () => { onStatus("reconnecting"); clearTimeout(timer); timer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++)); };
  open();
  return { close() { closed = true; clearTimeout(timer); try { ws && ws.close(); } catch (_) {} }, send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); } };
}

// PumpPortal's free streams: every new pump.fun token and every migration.
export function pumpPortal({ url = PUMPPORTAL_WS, onNewToken, onMigration, onStatus, WS }) {
  return socket(url, {
    WS, onStatus,
    onOpen: ws => { ws.send(JSON.stringify({ method: "subscribeNewToken" })); ws.send(JSON.stringify({ method: "subscribeMigration" })); },
    onMessage: m => {
      if (!m || typeof m.mint !== "string") return;
      if (m.txType === "create") onNewToken && onNewToken(m);
      else if (m.txType === "migrate" || m.txType === "migration" || (!m.txType && m.pool && m.pool !== "pump")) onMigration && onMigration(m);
    }
  });
}

export const wsUrl = httpUrl => httpUrl.replace(/^http/, "ws");

// Live trades for one token. pump.fun curve trades are decoded straight from the logs; anything else
// (PumpSwap, Raydium, Meteora…) is read from the transaction, rate limited, newest first.
export function tokenTrades({ rpcHttp, connection, web3, mint, onTrade, onStatus, WS, maxFetch = 2, queueCap = 12 }) {
  const queue = [];
  let active = 0, stopped = false;
  const pump = () => {
    while (!stopped && active < maxFetch && queue.length) {
      const sig = queue.shift();
      active++;
      connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
        .then(tx => tx && fromTransaction(tx, sig))
        .catch(() => {})
        .finally(() => { active--; pump(); });
    }
  };
  const fromTransaction = (tx, sig) => {
    const evs = tradesFromTx({ meta: tx.meta }, base58Decode).filter(e => e.mint === mint);
    if (evs.length) return evs.forEach(e => onTrade(eventTrade(e, sig)));
    // generic swap: the fee payer's token and SOL change
    const keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
    const signer = keys[0].toBase58 ? keys[0].toBase58() : String(keys[0]);
    const parsed = { blockTime: tx.blockTime, transaction: { signatures: [sig], message: { accountKeys: keys.map((k, i) => ({ pubkey: k.toBase58 ? k.toBase58() : String(k), signer: i === 0 })), instructions: [{ programId: "x" }] } }, meta: tx.meta };
    for (const s of walletSwaps(parsed, signer)) if (s.mint === mint && s.tokens) onTrade({ sig, time: s.time || Math.floor(Date.now() / 1000), user: signer, side: s.side, sol: s.sol, tokens: s.tokens, priceSol: s.sol / s.tokens });
  };
  const sub = socket(wsUrl(rpcHttp), {
    WS, onStatus,
    onOpen: ws => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [mint] }, { commitment: "confirmed" }] })),
    onMessage: m => {
      const v = m && m.method === "logsNotification" && m.params?.result?.value;
      if (!v || v.err) return;
      const evs = tradesFromLogs(v.logs).filter(e => e.mint === mint);
      if (evs.length) return evs.forEach(e => onTrade(eventTrade(e, v.signature)));
      if (!(v.logs || []).some(l => /Instruction: (Buy|Sell|Swap)|swap/i.test(l))) return;
      queue.unshift(v.signature);
      queue.length = Math.min(queue.length, queueCap);
      pump();
    }
  });
  return { close() { stopped = true; sub.close(); } };
}
const eventTrade = (e, sig) => ({ sig, time: e.timestamp, user: e.user, side: e.isBuy ? "buy" : "sell", sol: Number(e.solAmount) / 1e9, tokens: Number(e.tokenAmount) / 1e6, priceSol: eventPriceSol(e) });

// Read up to 100 bonding curves in one RPC call.
export async function readCurves({ connection, web3, mints }) {
  const out = new Map();
  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    const keys = batch.map(m => new web3.PublicKey(bondingCurveAddress(web3, m)));
    const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
    infos.forEach((info, j) => { if (info && info.owner.toBase58() === PUMP_PROGRAM) { const c = decodeCurve(new Uint8Array(info.data)); if (c) out.set(batch[j], c); } });
  }
  return out;
}

// Token metadata JSON (image, socials, description), cached by URI, a few at a time. A failed read is
// forgotten after a minute so it gets another chance.
const metaCache = new Map();
let metaActive = 0;
const metaQueue = [];
export const ipfs = u => typeof u === "string" ? u.replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/") : u;
export function metadata(uri) {
  if (!uri || !/^(https|ipfs|ar):\/\//.test(uri)) return Promise.resolve(null);
  if (metaCache.has(uri)) return metaCache.get(uri);
  const p = new Promise(resolve => { metaQueue.push({ uri, resolve }); drain(); });
  metaCache.set(uri, p);
  p.then(r => { if (!r) setTimeout(() => metaCache.delete(uri), 60_000); });
  return p;
}
const timed = (url, ms) => { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms); return fetch(url, { signal: ctl.signal }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).finally(() => clearTimeout(t)); };
async function readJson(uri) {
  const u = uri.replace(/^ar:\/\//, "https://arweave.net/"), list = imageSources(ipfs(u));
  // race the first two sources, then fall back one at a time
  try { return await Promise.any(list.slice(0, 2).map(x => timed(x, 7000))); } catch (_) {}
  for (const x of list.slice(2)) { try { return await timed(x, 6000); } catch (_) {} }
  return null;
}
function drain() {
  while (metaActive < 6 && metaQueue.length) {
    const { uri, resolve } = metaQueue.shift();
    metaActive++;
    readJson(uri).then(j => resolve(j && typeof j === "object" ? {
      image: typeof j.image === "string" ? ipfs(j.image.trim()) : undefined,
      twitter: socialUrl("twitter", j.twitter ?? j.extensions?.twitter), telegram: socialUrl("telegram", j.telegram ?? j.extensions?.telegram),
      website: socialUrl("website", j.website ?? j.extensions?.website),
      description: typeof j.description === "string" ? j.description.slice(0, 280) : undefined
    } : null)).catch(() => resolve(null)).finally(() => { metaActive--; drain(); });
  }
}

// Name, symbol and metadata URI straight from the chain, for tokens that reach the terminal without
// them (migrations, pasted mints, tokens no indexer has seen yet). Metaplex metadata first; Token-2022
// mints that carry their own metadata extension second.
export async function onchainMeta({ connection, web3, mints }) {
  const out = new Map(), prog = new web3.PublicKey(METAPLEX), enc = new TextEncoder();
  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    const pdas = batch.map(m => web3.PublicKey.findProgramAddressSync([enc.encode("metadata"), prog.toBytes(), new web3.PublicKey(m).toBytes()], prog)[0]);
    const infos = await connection.getMultipleAccountsInfo(pdas, "confirmed");
    const missing = [];
    infos.forEach((info, j) => { const d = info && decodeMetaplex(new Uint8Array(info.data)); if (d && (d.uri || d.symbol)) out.set(batch[j], d); else missing.push(batch[j]); });
    if (missing.length) {
      const minfos = await connection.getMultipleAccountsInfo(missing.map(m => new web3.PublicKey(m)), "confirmed");
      minfos.forEach((info, j) => { if (info && info.owner.toBase58() === TOKEN_2022) { const d = decodeToken2022Meta(new Uint8Array(info.data)); if (d) out.set(missing[j], d); } });
    }
  }
  return out;
}

// Top holders with owners and labels, plus mint authorities.
export async function holders({ connection, web3, mint, creator }) {
  const pk = new web3.PublicKey(mint);
  const [largest, supplyRes, mintInfo] = await Promise.all([
    connection.getTokenLargestAccounts(pk, "confirmed"),
    connection.getTokenSupply(pk, "confirmed"),
    connection.getParsedAccountInfo(pk, "confirmed")
  ]);
  const supply = Number(supplyRes.value.amount);
  const accts = largest.value.slice(0, 20);
  const infos = accts.length ? await connection.getMultipleParsedAccounts(accts.map(a => a.address), { commitment: "confirmed" }) : { value: [] };
  const curve = bondingCurveAddress(web3, mint);
  const rows = accts.map((a, i) => {
    const owner = infos.value[i]?.data?.parsed?.info?.owner || null;
    const label = owner === curve ? "Bonding curve" : owner && creator && owner === creator ? "Dev" : null;
    return { account: a.address.toBase58(), owner, amount: Number(a.amount), pct: supply ? Number(a.amount) / supply * 100 : 0, label };
  });
  const people = rows.filter(r => r.label !== "Bonding curve");
  const info = mintInfo.value?.data?.parsed?.info || {};
  return {
    rows, supply, decimals: supplyRes.value.decimals,
    top10: people.slice(0, 10).reduce((n, r) => n + r.pct, 0),
    devPct: rows.filter(r => r.label === "Dev").reduce((n, r) => n + r.pct, 0),
    mintAuthority: info.mintAuthority || null, freezeAuthority: info.freezeAuthority || null
  };
}

// Recent swaps by a wallet (wallet tracker), newest first, skipping signatures already seen.
export async function recentSwaps({ connection, web3, wallet, seen, limit = 8 }) {
  const sigs = await connection.getSignaturesForAddress(new web3.PublicKey(wallet), { limit });
  const fresh = sigs.filter(s => !s.err && !seen.has(s.signature));
  fresh.forEach(s => seen.add(s.signature));
  const txs = await Promise.all(fresh.map(s => connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null)));
  const out = [];
  txs.forEach((tx, i) => { if (!tx) return; const json = JSON.parse(JSON.stringify(tx)); json.transaction.signatures = [fresh[i].signature]; out.push(...walletSwaps(json, wallet)); });
  return out;
}
export { SOL_MINT };

// A wallet's swap history from the chain, newest first, a few transactions at a time (for PnL on
// trades made outside the terminal). `before` pages further back.
export async function walletHistory({ connection, web3, wallet, limit = 100, before, concurrency = 4, onProgress = () => {} }) {
  const sigs = (await connection.getSignaturesForAddress(new web3.PublicKey(wallet), before ? { limit, before } : { limit })).filter(s => !s.err);
  const out = [];
  let done = 0;
  for (let i = 0; i < sigs.length; i += concurrency) {
    const batch = sigs.slice(i, i + concurrency);
    const txs = await Promise.all(batch.map(s => connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null)));
    txs.forEach((tx, j) => { if (!tx) return; const json = JSON.parse(JSON.stringify(tx)); json.transaction.signatures = [batch[j].signature]; out.push(...walletSwaps(json, wallet)); });
    onProgress((done += batch.length), sigs.length);
  }
  return { swaps: out, last: sigs.length ? sigs[sigs.length - 1].signature : null };
}
