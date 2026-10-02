// Market logic for the terminal, kept free of DOM and network so it can be tested in Node:
// the Pulse board (which column a token belongs in), wallet-tracker swap parsing, and PnL.
import { readTx } from "./trace.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const QUOTES = new Set([SOL_MINT, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
export const isPumpMint = (mint, launchpad = "") => /pump$/.test(mint) || /pump/i.test(launchpad);

/* ---------- Pulse board ---------- */
// Tokens arrive from several sources (PumpPortal live stream, Jupiter lists, on-chain curve reads)
// and are merged by mint. Columns: New Pairs, Final Stretch (curve past the threshold), Migrated.
export function createBoard({ finalStretch = 60, cap = 60, maxAgeMs = 6 * 3600_000 } = {}) {
  const tokens = new Map();
  const board = {
    tokens,
    settings: { finalStretch, cap, maxAgeMs },
    upsert(t) {
      if (!t || !t.mint) return null;
      const cur = tokens.get(t.mint) || { mint: t.mint, firstSeen: Date.now() };
      for (const [k, v] of Object.entries(t)) if (v !== undefined && v !== null && v !== "") cur[k] = v;
      if (cur.complete && !cur.migratedAt) cur.migratedAt = Date.now();
      tokens.set(t.mint, cur);
      return cur;
    },
    migrate(mint, at = Date.now(), extra = {}) { return board.upsert({ mint, ...extra, migratedAt: at, complete: true, progress: 100 }); },
    column(t) {
      if (t.migratedAt || t.graduatedAt) return "migrated";
      if ((t.progress ?? 0) >= board.settings.finalStretch) return "final";
      return "new";
    },
    // Each column sorted the way traders read it, filtered, capped.
    columns(filter = {}, now = Date.now()) {
      const out = { new: [], final: [], migrated: [] };
      for (const t of tokens.values()) {
        const born = t.createdAt || t.firstSeen;
        if (now - (t.migratedAt || born) > board.settings.maxAgeMs) continue;
        if (!passes(t, filter)) continue;
        out[board.column(t)].push(t);
      }
      out.new.sort((a, b) => (b.createdAt || b.firstSeen) - (a.createdAt || a.firstSeen));
      out.final.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
      out.migrated.sort((a, b) => (b.migratedAt || b.graduatedAt || 0) - (a.migratedAt || a.graduatedAt || 0));
      for (const k in out) out[k] = out[k].slice(0, board.settings.cap);
      return out;
    },
    // Mints whose curve should be re-read from chain: pump tokens not yet complete, newest first.
    curveTargets(limit = 100) {
      return [...tokens.values()].filter(t => t.pump && !t.complete && !t.migratedAt)
        .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0) || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit).map(t => t.mint);
    },
    prune(now = Date.now()) {
      for (const [m, t] of tokens) if (now - (t.migratedAt || t.createdAt || t.firstSeen) > board.settings.maxAgeMs * 2) tokens.delete(m);
    }
  };
  return board;
}
function passes(t, f) {
  if (f.q) { const q = f.q.toLowerCase(); if (!`${t.symbol || ""} ${t.name || ""} ${t.mint}`.toLowerCase().includes(q)) return false; }
  if (f.minMcap && (t.mcapUsd ?? 0) < f.minMcap) return false;
  if (f.maxMcap && (t.mcapUsd ?? Infinity) > f.maxMcap) return false;
  if (f.socials && !(t.twitter || t.telegram || t.website)) return false;
  return true;
}

// PumpPortal messages → board records.
export function fromPumpPortal(m, solUsd) {
  return {
    mint: m.mint, name: m.name, symbol: m.symbol, uri: m.uri, creator: m.traderPublicKey,
    createdAt: Date.now(), pump: true, pool: m.pool, mcapSol: m.marketCapSol,
    mcapUsd: solUsd && m.marketCapSol ? m.marketCapSol * solUsd : undefined,
    progress: 0, devBuySol: m.solAmount, source: "pumpportal"
  };
}
// Jupiter token objects → board records (fields Jupiter doesn't send stay undefined).
export function fromJupiter(t) {
  const created = Date.parse(t.firstPool?.createdAt || t.createdAt || "") || undefined;
  return {
    mint: t.id, name: t.name, symbol: t.symbol, image: t.icon, createdAt: created,
    pump: isPumpMint(t.id, t.launchpad), launchpad: t.launchpad,
    mcapUsd: t.mcap ?? t.fdv, liquidityUsd: t.liquidity, holders: t.holderCount, priceUsd: t.usdPrice,
    volume24h: t.stats24h ? (t.stats24h.buyVolume || 0) + (t.stats24h.sellVolume || 0) : undefined,
    change1h: t.stats1h?.priceChange, twitter: t.twitter, telegram: t.telegram, website: t.website, creator: t.dev,
    graduatedAt: t.graduatedPool ? (Date.parse(t.graduatedAt || "") || created || Date.now()) : undefined,
    progress: typeof t.bondingCurve === "number" ? t.bondingCurve : undefined,
    topHoldersPct: t.audit?.topHoldersPercentage, devPct: t.audit?.devBalancePercentage,
    mintAuthorityDisabled: t.audit?.mintAuthorityDisabled, freezeAuthorityDisabled: t.audit?.freezeAuthorityDisabled,
    organicScore: t.organicScore, verified: t.isVerified, source: "jupiter"
  };
}

/* ---------- wallet tracker ---------- */
// The swaps a wallet made in one transaction: every non-quote token whose balance it changed while
// signing, priced by the SOL (plus wrapped SOL) that moved the other way.
export function walletSwaps(tx, wallet) {
  const x = readTx(tx, wallet);
  if (!x.ownerSigned || x.basicOnly) return [];
  const wsol = x.tokenDeltas[SOL_MINT] || 0;
  const sol = x.solDelta / 1e9 + wsol;
  return Object.entries(x.tokenDeltas).filter(([m, d]) => !QUOTES.has(m) && d !== 0)
    .map(([mint, d]) => ({ sig: x.sig, time: x.time, wallet, mint, side: d > 0 ? "buy" : "sell", tokens: Math.abs(d), sol: Math.abs(sol) }));
}

/* ---------- PnL ---------- */
// Average-cost PnL per token from the terminal's own trade log, valued at current prices (SOL).
export function pnl(trades, pricesSol = {}) {
  const by = new Map();
  for (const t of trades) {
    const p = by.get(t.mint) || { mint: t.mint, symbol: t.symbol, boughtSol: 0, boughtTok: 0, soldSol: 0, soldTok: 0, trades: 0 };
    if (t.side === "buy") { p.boughtSol += t.sol; p.boughtTok += t.tokens; } else { p.soldSol += t.sol; p.soldTok += t.tokens; }
    p.trades++; p.symbol = t.symbol || p.symbol;
    by.set(t.mint, p);
  }
  return [...by.values()].map(p => {
    const avg = p.boughtTok ? p.boughtSol / p.boughtTok : 0;
    const holding = Math.max(0, p.boughtTok - p.soldTok);
    const price = pricesSol[p.mint];
    const realized = p.soldSol - Math.min(p.soldTok, p.boughtTok) * avg;
    const value = price != null ? holding * price : null;
    const unrealized = value != null ? value - holding * avg : null;
    const total = realized + (unrealized ?? 0);
    return { ...p, avg, holding, price, value, realized, unrealized, total, pct: p.boughtSol ? total / p.boughtSol * 100 : 0 };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

// Merge on-chain swaps into the terminal's trade log without duplicating anything already logged.
export function mergeHistory(log, swaps, symbolOf = m => m.slice(0, 4)) {
  const seen = new Set(log.map(t => `${t.sig}:${t.mint}`));
  const add = swaps.filter(s => !seen.has(`${s.sig}:${s.mint}`)).map(s => ({ sig: s.sig, time: (s.time || 0) * 1000, side: s.side, mint: s.mint, symbol: symbolOf(s.mint), sol: s.sol, tokens: s.tokens, from: "chain" }));
  return [...log, ...add].sort((a, b) => b.time - a.time);
}
