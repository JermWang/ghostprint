// Ghostprint terminal. Views: Pulse, Trending, token page, Tracker, Portfolio. All data comes from public
// sources in the browser (PumpPortal, Jupiter, DexScreener, your Solana RPC, NEAR Intents); every trade is
// signed by your wallet, or locally by your instant/ghost wallets which are derived from one signature of it.
import { TREASURY, FEE_BPS, JUP_BASE, JUP_API_KEY, DEFAULT_SLIPPAGE_BPS, PRIORITY_MAX_LAMPORTS, ONECLICK_JWT, GHOST_CONFIDENTIALITY, GHOST_MAX_SOL, GHOST_GAS_RESERVE } from "./config.js";
import { jupiter, prepareSwap, sendAndConfirm, toRaw, fromRaw, SOL_MINT, SwapError } from "./swap.js";
import { GHOST_MESSAGE, GhostError, deriveGhost, deriveInstant, seedFingerprint, oneclick, solAssetId, routeQuote, fundingTx, exitTx, exitAmount, waitForRoute } from "./ghost.js";
import { trace, DEFAULT_RPC, short, isAddress, base58Encode } from "./trace.js";
import { createBoard, fromPumpPortal, fromJupiter, pnl, isPumpMint } from "./market.js";
import { pumpPortal, tokenTrades, readCurves, metadata, holders, recentSwaps } from "./feeds.js";

const web3 = window.solanaWeb3;
const $ = id => document.getElementById(id);
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- small helpers ---------- */
const make = (tag, cls, s) => { const e = document.createElement(tag); if (cls) e.className = cls; if (s !== undefined && s !== null) e.textContent = s; return e; };
const text = (el, s) => { el.textContent = s; return el; };
const emptyRow = (table, msg) => { const tr = make("tr"), td = make("td", "tdempty", msg); td.colSpan = 12; tr.append(td); table.append(tr); };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
};
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const price = n => {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (n >= 0.001) return `$${n.toPrecision(4)}`;
  let zeros = -Math.floor(Math.log10(n)) - 1, digits = Math.round(n * 10 ** (zeros + 4));
  if (digits >= 10000) { zeros--; digits = Math.round(n * 10 ** (zeros + 4)); }
  return `$0.0${String(zeros).split("").map(d => SUB[d]).join("")}${digits}`;
};
const usd = n => n == null || !isFinite(n) ? "—" : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(Math.abs(n) < 10 ? 2 : 0)}`;
const pct = n => n == null || !isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
const solFmt = n => n == null || !isFinite(n) ? "—" : n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(3) : n.toFixed(4);
const num = n => n == null || !isFinite(n) ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(n < 10 ? 2 : 0);
const ago = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
const cls = (el, n) => { el.classList.toggle("up", n > 0); el.classList.toggle("down", n < 0); return el; };
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const safeUrl = u => typeof u === "string" && /^https:\/\//.test(u) ? u : null;
const icon = (img, url) => { img.onerror = () => { img.onerror = null; img.src = BLANK; }; img.src = safeUrl(url) || BLANK; img.alt = ""; img.loading = "lazy"; return img; };
const link = (href, label, cls) => { const a = make("a", cls, label); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a; };
const solscan = (kind, id) => `https://solscan.io/${kind}/${id}`;
const rejected = e => e && (e.code === 4001 || /reject|cancel|denied|declined/i.test(e.message || ""));
const errMsg = e => rejected(e) ? "Cancelled in wallet. Nothing was sent." : (e && e.message) || String(e);

function toast(msg, kind = "", sig) {
  const t = make("div", `toast ${kind}`, msg);
  if (sig) { t.append(" "); t.append(link(solscan("tx", sig), "Solscan ↗")); }
  $("toasts").append(t);
  setTimeout(() => t.remove(), kind === "err" ? 10000 : 6000);
}

/* ---------- settings ---------- */
const DEFAULTS = {
  quickBuy: "0.1", buyAmounts: ["0.1", "0.5", "1", "2"], sellPcts: [10, 25, 50, 100],
  presets: [
    { slippageBps: DEFAULT_SLIPPAGE_BPS, priority: "high", maxSol: PRIORITY_MAX_LAMPORTS / 1e9 },
    { slippageBps: 1000, priority: "veryHigh", maxSol: 0.003 },
    { slippageBps: 2000, priority: "veryHigh", maxSol: 0.01 }
  ],
  preset: 0, from: "main", finalStretch: 60
};
const settings = Object.assign(structuredClone(DEFAULTS), store.get("ghostprint-settings", {}));
const saveSettings = () => store.set("ghostprint-settings", settings);
const preset = () => settings.presets[settings.preset] || DEFAULTS.presets[0];

/* ---------- services ---------- */
const rpcUrl = (() => { const v = store.get("ghostprint-rpc-url", null) || (() => { try { return localStorage.getItem("ghostprint-rpc"); } catch (_) { return null; } })(); return typeof v === "string" && /^https?:\/\/\S+$/.test(v.trim()) ? v.trim() : DEFAULT_RPC; })();
const connection = new web3.Connection(rpcUrl, "confirmed");
const jup = jupiter({ base: JUP_BASE, apiKey: JUP_API_KEY, minInterval: JUP_API_KEY ? 1050 : 2050 });
const oc = oneclick({ jwt: ONECLICK_JWT });
const S = { solUsd: null, wallet: null, seed: null, instant: null, sol: null, instantSol: null, busy: false, route: null };

async function refreshSolPrice() {
  try {
    const p = await jup.prices([SOL_MINT]);
    S.solUsd = p[SOL_MINT]?.usdPrice ?? S.solUsd;
    text($("solprice"), S.solUsd ? `SOL $${S.solUsd.toFixed(2)}` : "SOL —");
  } catch (_) {}
}
const decimalsCache = new Map();
async function decimalsOf(mint) {
  if (decimalsCache.has(mint)) return decimalsCache.get(mint);
  const r = await connection.getParsedAccountInfo(new web3.PublicKey(mint));
  const d = r.value?.data?.parsed?.info?.decimals;
  if (!Number.isInteger(d)) throw new SwapError("This address isn't a token mint.");
  decimalsCache.set(mint, d);
  return d;
}
const tokenInfo = new Map(); // mint → Jupiter token object
async function lookupTokens(mints) {
  const need = [...new Set(mints)].filter(m => m && !tokenInfo.has(m)).slice(0, 50);
  if (!need.length) return;
  need.forEach(m => tokenInfo.set(m, null));
  try { const list = await jup.search(need.join(",")); (Array.isArray(list) ? list : []).forEach(t => tokenInfo.set(t.id, t)); } catch (_) {}
}
const symbolOf = mint => tokenInfo.get(mint)?.symbol || board.tokens.get(mint)?.symbol || short(mint);
const iconOf = mint => tokenInfo.get(mint)?.icon || board.tokens.get(mint)?.image;

/* ---------- pixel brand ---------- */
(() => {
  const FONT = { G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."], H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"], O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."], S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."], T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."], P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."], R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"], I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"], N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"] };
  const GHOST = ["...####...", ".########.", "##########", "##..##..##", "##..##..##", "##########", "##########", "###....###", "##########", "##########", "##.##.##.#", "#..#..#..#"];
  const NS = "http://www.w3.org/2000/svg";
  document.querySelectorAll("[data-pixel]").forEach(h => {
    const rows = h.dataset.pixel === "ghost" ? GHOST : (() => { const r = Array(7).fill(""); [..."GHOSTPRINT"].forEach((ch, i) => FONT[ch].forEach((row, y) => { r[y] += (i ? "." : "") + row; })); return r; })();
    const svg = document.createElementNS(NS, "svg"), w = Math.max(...rows.map(r => r.length));
    svg.setAttribute("viewBox", `0 0 ${w * 10} ${rows.length * 10}`); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", h.getAttribute("class"));
    rows.forEach((r, y) => [...r].forEach((c, x) => { if (c !== "#") return; const e = document.createElementNS(NS, "rect"); e.setAttribute("x", x * 10 + .7); e.setAttribute("y", y * 10 + .7); e.setAttribute("width", 8.6); e.setAttribute("height", 8.6); e.setAttribute("fill", "currentColor"); svg.appendChild(e); }));
    h.replaceWith(svg);
  });
})();

/* ---------- wallets ---------- */
function providers() {
  const w = window, out = [];
  if (w.phantom?.solana?.isPhantom) out.push({ name: "Phantom", p: w.phantom.solana });
  if (w.solflare?.isSolflare) out.push({ name: "Solflare", p: w.solflare });
  if (w.backpack?.isBackpack) out.push({ name: "Backpack", p: w.backpack });
  if (!out.length && w.solana) out.push({ name: "Wallet", p: w.solana });
  return out;
}
async function connect(w) {
  const r = await w.p.connect();
  const pk = (r && r.publicKey ? r.publicKey : w.p.publicKey).toString();
  S.wallet = { name: w.name, p: w.p, pk };
  S.seed = null; S.instant = null; S.instantSol = null;
  w.p.on?.("accountChanged", next => { if (next) { S.wallet.pk = next.toString(); S.seed = null; S.instant = null; onWallet(); } else disconnect(); });
  onWallet();
}
async function disconnect() {
  try { await S.wallet?.p.disconnect?.(); } catch (_) {}
  S.wallet = null; S.seed = null; S.instant = null; S.sol = S.instantSol = null;
  if (settings.from === "instant") { settings.from = "main"; saveSettings(); }
  onWallet();
}
async function ensureConnected() {
  if (S.wallet) return true;
  const list = providers();
  if (list.length === 1) { await connect(list[0]); return true; }
  openWalletModal();
  return false;
}
function onWallet() {
  renderWalletBtn(); refreshBalances();
  if (S.route === "portfolio") renderPortfolio();
  if (S.route === "token") { renderTradePanel(); renderMine(); }
}
function renderWalletBtn() {
  const b = $("walletbtn");
  if (!S.wallet) { text(b, "Connect"); b.className = "btn primary"; return; }
  b.className = "btn";
  const inst = settings.from === "instant";
  const bal = inst ? S.instantSol : S.sol;
  text(b, `${inst ? "⚡ " : ""}${short(inst && S.instant ? S.instant.pk : S.wallet.pk)} · ${bal != null ? fromRaw(bal, 9, 3) : "…"} SOL`);
}
async function refreshBalances() {
  if (!S.wallet) return renderWalletBtn();
  try {
    S.sol = BigInt(await connection.getBalance(new web3.PublicKey(S.wallet.pk)));
    if (S.instant) S.instantSol = BigInt(await connection.getBalance(S.instant.kp.publicKey));
  } catch (_) {}
  renderWalletBtn();
  if (S.route === "token") { refreshTokenBal(); renderTradePanel(); }
}

// One signature of a fixed message derives the instant wallet and every ghost wallet. Memory only.
async function walletSeed() {
  if (S.seed) return S.seed;
  if (!S.wallet && !(await ensureConnected())) throw new GhostError("Connect a wallet first.");
  if (!S.wallet.p.signMessage) throw new GhostError(`${S.wallet.name} can't sign messages, which instant and ghost wallets need.`);
  const r = await S.wallet.p.signMessage(new TextEncoder().encode(GHOST_MESSAGE), "utf8");
  const sig = r instanceof Uint8Array ? r : r.signature;
  if (!sig || sig.length !== 64) throw new GhostError("The wallet returned an unexpected signature.");
  const fp = await seedFingerprint(sig), key = `ghostprint-ghostfp-${S.wallet.pk}`, known = store.get(key, null);
  if (known && known !== fp) throw new GhostError("This wallet signed differently than last time, so it would open different instant and ghost wallets. Use the same wallet app as before, or export keys from the device you used.");
  store.set(key, fp);
  return (S.seed = sig);
}
async function instantWallet() {
  if (S.instant) return S.instant;
  const kp = await deriveInstant(web3, await walletSeed());
  S.instant = { kp, pk: kp.publicKey.toBase58() };
  S.instantSol = BigInt(await connection.getBalance(kp.publicKey).catch(() => 0));
  renderWalletBtn();
  return S.instant;
}
async function signerFor(from) {
  if (from === "instant") { const i = await instantWallet(); return { pk: i.pk, local: i.kp, label: "instant" }; }
  if (!S.wallet && !(await ensureConnected())) throw new SwapError("Connect a wallet first.");
  return { pk: S.wallet.pk, local: null, label: "main" };
}
async function signSend(tx, signer, lastValidBlockHeight, onStatus) {
  const signed = signer.local ? (tx.sign([signer.local]), tx) : await S.wallet.p.signTransaction(tx);
  return sendAndConfirm(connection, signed, lastValidBlockHeight, { onStatus });
}

/* ---------- trades ---------- */
const TKEY = pk => `ghostprint-trades-${pk}`;
const tradesOf = pk => store.get(TKEY(pk), []);
function logTrade(pk, t) { const l = tradesOf(pk); l.unshift(t); store.set(TKEY(pk), l.slice(0, 500)); }
const tradedMints = () => { const s = new Set(); for (const pk of [S.wallet?.pk, S.instant?.pk]) if (pk) tradesOf(pk).forEach(t => s.add(t.mint)); return s; };

async function executeTrade({ side, mint, amountRaw, from = settings.from, onStatus = () => {} }) {
  const signer = await signerFor(from), p = preset();
  if (side === "buy") {
    const bal = from === "instant" ? S.instantSol : S.sol;
    if (bal != null && BigInt(amountRaw) + 5_000_000n > bal) throw new SwapError(from === "instant" ? "Not enough SOL in your instant wallet. Deposit from the wallet menu." : "Not enough SOL for this buy plus network fees.");
  }
  onStatus("Routing through Jupiter…");
  const prep = await prepareSwap({ web3, jup, connection, side, mint, amountRaw, user: signer.pk, treasury: TREASURY, feeBps: FEE_BPS, slippageBps: p.slippageBps, priorityMaxLamports: Math.round(p.maxSol * 1e9), priorityLevel: p.priority });
  onStatus(signer.local ? "Sending…" : "Approve in your wallet…");
  const sig = await signSend(prep.tx, signer, prep.lastValidBlockHeight, s => s.state === "sent" && onStatus("Sent. Confirming…"));
  const dec = await decimalsOf(mint);
  const sol = side === "buy" ? Number(amountRaw) / 1e9 : (Number(prep.quote.outAmount) - Number(prep.fee)) / 1e9;
  const tokens = side === "buy" ? Number(prep.quote.outAmount) / 10 ** dec : Number(amountRaw) / 10 ** dec;
  logTrade(signer.pk, { sig, time: Date.now(), side, mint, symbol: symbolOf(mint), sol, tokens, from: signer.label });
  setTimeout(refreshBalances, 1500);
  return { sig, sol, tokens };
}

async function quickBuy(mint, btn) {
  const amount = toRaw($("qbamt").value || settings.quickBuy, 9);
  if (!amount) return toast("Set a quick-buy amount in the top bar.", "err");
  if (btn) btn.disabled = true;
  try {
    if (settings.from === "main" && !S.wallet && !(await ensureConnected())) return;
    const r = await executeTrade({ side: "buy", mint, amountRaw: amount, onStatus: () => {} });
    toast(`Bought ≈${num(r.tokens)} ${symbolOf(mint)} for ${solFmt(r.sol)} SOL`, "ok", r.sig);
  } catch (e) { toast(errMsg(e), "err"); }
  finally { if (btn) btn.disabled = false; }
}

/* ---------- router ---------- */
const VIEWS = ["pulse", "trending", "token", "tracker", "portfolio"];
let leaveToken = () => {};
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  let [name, arg] = h.split("/");
  if (!name) name = "pulse";
  if (isAddress(name)) { location.replace(`#/token/${name}`); return; } // old deep links
  if (!VIEWS.includes(name) || (name === "token" && !isAddress(arg || ""))) name = "pulse";
  if (S.route === "token" && (name !== "token" || arg !== S.tokenMint)) leaveToken();
  S.route = name;
  VIEWS.forEach(v => { $(`v-${v}`).hidden = v !== name; });
  document.querySelectorAll(".nav a").forEach(a => a.setAttribute("aria-current", a.dataset.route === name ? "page" : "false"));
  if (name === "pulse") { document.title = "Pulse · Ghostprint"; renderPulse(true); }
  if (name === "trending") { document.title = "Trending · Ghostprint"; loadTrending(); }
  if (name === "token") openToken(arg);
  if (name === "tracker") { document.title = "Tracker · Ghostprint"; renderTracker(); }
  if (name === "portfolio") { document.title = "Portfolio · Ghostprint"; renderPortfolio(); }
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route);

/* ---------- Pulse ---------- */
const board = createBoard({ finalStretch: settings.finalStretch });
const filters = store.get("ghostprint-pulse-filters", { new: {}, final: {}, migrated: {} });
const cardEls = new Map();
const paused = new Set();
let pulseDirty = true;

function seedPulse() {
  jup.list("recent").then(l => { (l || []).forEach(t => board.upsert(fromJupiter(t))); pulseDirty = true; }).catch(() => {});
  jup.list("toptraded", "5m", 50).then(l => {
    (l || []).filter(t => t.graduatedPool && isPumpMint(t.id, t.launchpad)).forEach(t => board.upsert(fromJupiter(t)));
    pulseDirty = true;
  }).catch(() => {});
}
const pp = pumpPortal({
  onStatus: s => setStatusChip($("pp-status"), s, "pump.fun stream"),
  onNewToken: m => {
    const t = board.upsert(fromPumpPortal(m, S.solUsd));
    t.fresh = true; pulseDirty = true;
    metadata(m.uri).then(meta => { if (meta) { board.upsert({ mint: m.mint, ...meta }); pulseDirty = true; } });
  },
  onMigration: m => {
    board.migrate(m.mint, Date.now(), { pool: m.pool });
    pulseDirty = true;
    const watched = watchlist().some(w => w.mint === m.mint) || tradedMints().has(m.mint);
    if (watched) toast(`${symbolOf(m.mint)} migrated to ${m.pool || "an AMM"}.`, "info");
  }
});
function setStatusChip(el, s, label) {
  el.textContent = ""; const d = make("span", "dot"); d.classList.toggle("live", s === "live"); d.classList.toggle("warn", s !== "live"); el.append(d, `${label}${s === "live" ? "" : ` · ${s}`}`);
}

async function curveLoop() {
  const targets = board.curveTargets(100);
  if (targets.length) {
    try {
      const curves = await readCurves({ connection, web3, mints: targets });
      for (const [mint, c] of curves) board.upsert({ mint, progress: c.progress, complete: c.complete || undefined, mcapSol: c.mcapSol, mcapUsd: S.solUsd ? c.mcapSol * S.solUsd : undefined, priceUsd: S.solUsd ? c.priceSol * S.solUsd : undefined });
      setStatusChip($("curve-status"), "live", `curves · ${curves.size}`);
      pulseDirty = true;
    } catch (_) { setStatusChip($("curve-status"), "rate limited", "curves"); }
  }
  board.prune();
  for (const m of cardEls.keys()) if (!board.tokens.has(m)) cardEls.delete(m);
  setTimeout(curveLoop, S.route === "pulse" ? 6000 : 20000);
}

function renderPulse(force) {
  if (S.route !== "pulse") return;
  if (!force && !pulseDirty) { tickAges(); return; }
  pulseDirty = false;
  board.settings.finalStretch = settings.finalStretch;
  for (const col of document.querySelectorAll(".pcol")) {
    const key = col.dataset.col;
    if (paused.has(key) && !force) continue;
    const list = board.columns(filters[key] || {})[key];
    text(col.querySelector(".count"), String(list.length));
    const host = col.querySelector(".plist");
    if (!list.length) { host.textContent = ""; host.append(make("div", "empty", key === "new" ? "Waiting for new pump.fun launches…" : key === "final" ? `Tokens past ${settings.finalStretch}% of their bonding curve show here.` : "Graduated tokens show here.")); continue; }
    const els = list.map(t => { let el = cardEls.get(t.mint); if (!el) { el = buildCard(t); cardEls.set(t.mint, el); } updateCard(el, t); return el; });
    host.querySelector(".empty")?.remove();
    els.forEach((el, i) => { if (host.children[i] !== el) host.insertBefore(el, host.children[i] || null); });
    while (host.children.length > els.length) host.lastChild.remove();
  }
  for (const t of board.tokens.values()) t.fresh = false;
}
function tickAges() { document.querySelectorAll("#v-pulse .pcard").forEach(el => { const t = board.tokens.get(el.dataset.mint); if (t) text(el.querySelector(".age"), ago(Date.now() - (t.createdAt || t.firstSeen))); }); }

function buildCard(t) {
  const a = make("a", "pcard"); a.href = `#/token/${t.mint}`; a.dataset.mint = t.mint;
  const img = icon(make("img", "tok-icon"), t.image);
  const main = make("div"), top = make("div", "pc-top"), meta = make("div", "pc-meta"), bar = make("div", "pbar");
  top.append(make("b"), make("span", "nm"), make("span", "age"));
  bar.append(make("i"));
  main.append(top, meta, bar);
  const qb = make("button", "qb"); qb.type = "button";
  qb.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); quickBuy(t.mint, qb); });
  a.append(img, main, qb);
  if (t.fresh && !REDUCE) a.classList.add("fresh");
  return a;
}
function updateCard(el, t) {
  const img = el.querySelector("img");
  if (t.image && img.dataset.src !== t.image) { img.dataset.src = t.image; icon(img, t.image); }
  text(el.querySelector(".pc-top b"), t.symbol || short(t.mint));
  text(el.querySelector(".nm"), t.name || "");
  text(el.querySelector(".age"), ago(Date.now() - (t.createdAt || t.firstSeen)));
  const meta = el.querySelector(".pc-meta"); meta.textContent = "";
  const add = (k, v) => { if (v == null || v === "—") return; const s = make("span"); s.append(`${k} `, make("b", "", v)); meta.append(s); };
  add("MC", usd(t.mcapUsd ?? (t.mcapSol && S.solUsd ? t.mcapSol * S.solUsd : null)));
  if (t.liquidityUsd) add("L", usd(t.liquidityUsd));
  if (t.holders) add("H", num(t.holders));
  if (t.topHoldersPct != null) add("T10", `${t.topHoldersPct.toFixed(0)}%`);
  if (t.creator) add("dev", t.creator.slice(0, 4));
  const soc = make("span", "soc");
  for (const [k, u] of [["𝕏", t.twitter], ["TG", t.telegram], ["WEB", t.website]]) { const href = safeUrl(u); if (href) { const l = link(href, k); l.addEventListener("click", e => e.stopPropagation()); soc.append(l); } }
  if (soc.childElementCount) meta.append(soc);
  const bar = el.querySelector(".pbar"), migrated = board.column(t) === "migrated";
  bar.hidden = !t.pump || migrated || t.progress == null;
  bar.classList.toggle("hot", (t.progress ?? 0) >= 80);
  bar.firstChild.style.width = `${Math.min(100, t.progress ?? 0)}%`;
  bar.title = t.progress != null ? `Bonding curve ${t.progress.toFixed(1)}%` : "";
  text(el.querySelector(".qb"), `⚡ ${$("qbamt").value || settings.quickBuy}`);
}
document.querySelectorAll(".pcol").forEach(col => {
  const key = col.dataset.col, f = filters[key] = filters[key] || {};
  col.addEventListener("mouseenter", () => { paused.add(key); col.querySelector(".paused").hidden = false; });
  col.addEventListener("mouseleave", () => { paused.delete(key); col.querySelector(".paused").hidden = true; pulseDirty = true; });
  col.querySelectorAll("[data-f]").forEach(inp => {
    const k = inp.dataset.f;
    if (inp.type === "checkbox") inp.checked = !!f[k]; else inp.value = f[k] || "";
    inp.addEventListener("input", () => { f[k] = inp.type === "checkbox" ? inp.checked : k === "minMcap" ? Number(inp.value) || 0 : inp.value.trim(); store.set("ghostprint-pulse-filters", filters); pulseDirty = true; paused.delete(key); renderPulse(); paused.add(key); });
  });
});
$("mobcols").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  $("mobcols").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
  document.querySelectorAll(".pcol").forEach(c => c.classList.toggle("on", c.dataset.col === b.dataset.col));
});

/* ---------- Trending ---------- */
let trCat = "toptrending", trInt = "1h", trTimer = 0;
async function loadTrending() {
  clearTimeout(trTimer);
  if (S.route !== "trending") return;
  const table = $("tr-table");
  if (!table.rows.length) { table.textContent = ""; emptyRow(table, "Loading…"); }
  try {
    const list = await jup.list(trCat, trInt, 50);
    const rows = (Array.isArray(list) ? list : []).filter(t => t.id !== SOL_MINT);
    rows.forEach(t => tokenInfo.set(t.id, t));
    const statKey = { "5m": "stats5m", "1h": "stats1h", "6h": "stats6h", "24h": "stats24h" }[trInt];
    table.textContent = "";
    const head = make("tr");
    ["#", "Token", "Price", trInt, `Vol ${trInt}`, "MC", "Liq", "Holders", "Organic", "Age", ""].forEach((h, i) => head.append(make("th", i > 1 && i < 10 ? "num" : "", h)));
    table.append(head);
    rows.forEach((t, i) => {
      const st = t[statKey] || {}, tr = make("tr", "pick"), tok = make("td"), wrap = make("div", "cell-tok");
      wrap.append(icon(make("img", "tok-icon"), t.icon), make("b", "", t.symbol || short(t.id)), make("span", "muted", (t.name || "").slice(0, 18)));
      tok.append(wrap);
      const chg = make("td", "num", pct(st.priceChange)); cls(chg, st.priceChange);
      const age = Date.parse(t.firstPool?.createdAt || "");
      const qbtd = make("td", "num"), qb = make("button", "qb", `⚡ ${$("qbamt").value || settings.quickBuy}`); qb.type = "button";
      qb.addEventListener("click", e => { e.stopPropagation(); quickBuy(t.id, qb); });
      qbtd.append(qb);
      tr.append(make("td", "muted", String(i + 1)), tok, make("td", "num", price(t.usdPrice)), chg, make("td", "num", usd((st.buyVolume || 0) + (st.sellVolume || 0))), make("td", "num", usd(t.mcap ?? t.fdv)), make("td", "num", usd(t.liquidity)), make("td", "num", num(t.holderCount)), make("td", "num", t.organicScore != null ? t.organicScore.toFixed(0) : "—"), make("td", "num", age ? ago(Date.now() - age) : "—"), qbtd);
      tr.addEventListener("click", () => { location.hash = `#/token/${t.id}`; });
      table.append(tr);
    });
    if (!rows.length) emptyRow(table, "Jupiter returned no tokens for this list.");
    text($("tr-note"), `Jupiter · updated ${new Date().toLocaleTimeString()}`);
  } catch (e) { text($("tr-note"), errMsg(e)); }
  trTimer = setTimeout(loadTrending, 30000);
}
for (const [id, set] of [["tr-cat", v => { trCat = v; }], ["tr-int", v => { trInt = v; }]]) {
  $(id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $(id).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); set(b.dataset.v); $("tr-table").textContent = ""; loadTrending(); });
}

/* ---------- token page ---------- */
const T = { side: "buy", ghost: false, quoteTimer: 0, quoteSeq: 0, tokenBal: null, trades: [], sub: null, curveTimer: 0, statsTimer: 0 };
async function openToken(mint) {
  if (S.tokenMint === mint && S.route === "token" && T.sub) return;
  leaveToken();
  S.tokenMint = mint;
  T.trades = []; T.tokenBal = null; T.decimals = null; T.info = null; T.curve = null;
  $("amt").value = ""; $("quote").hidden = true; setTradeStatus("");
  const b = board.tokens.get(mint) || {};
  text($("t-sym"), b.symbol || short(mint)); text($("t-name"), b.name || ""); text($("t-mint"), `${short(mint)} ⧉`); icon($("t-icon"), b.image);
  ["s-price", "s-mcap", "s-liq", "s-vol", "s-c5", "s-c1", "s-c24"].forEach(id => cls(text($(id), "—"), 0));
  $("chart").textContent = ""; $("chart").append(make("div", "empty", "Loading chart…"));
  $("curvebar").hidden = true;
  renderStar(); renderTrades(); renderMine(); renderTradePanel(); selectTokenTab("tt-trades");
  $("audit").textContent = ""; $("audit").append(make("h3", "", "Token info"), make("span", "muted", "Loading…"));
  document.title = `${b.symbol || short(mint)} · Ghostprint`;

  decimalsOf(mint).then(d => { T.decimals = d; renderTradePanel(); }).catch(e => setTradeStatus(errMsg(e), "err"));
  jup.search(mint).then(l => { const t = (l || []).find(x => x.id === mint); if (t && S.tokenMint === mint) { tokenInfo.set(mint, t); T.info = t; renderTokenHead(); renderAudit(); } else renderAudit(); }).catch(() => renderAudit());
  loadPairs(mint);
  if (isPumpMint(mint, b.launchpad) || b.pump) curveTick(mint);
  refreshTokenBal();
  T.sub = tokenTrades({ rpcHttp: rpcUrl, connection, web3, mint, onStatus: s => { T.stream = s; if (!T.trades.length) renderTrades(); }, onTrade: tr => {
    if (S.tokenMint !== mint || T.trades.some(x => x.sig === tr.sig && x.side === tr.side && x.tokens === tr.tokens)) return;
    T.trades.unshift({ ...tr, fresh: true }); T.trades.length = Math.min(T.trades.length, 120);
    if (tr.priceSol && S.solUsd) text($("s-price"), price(tr.priceSol * S.solUsd));
    renderTrades();
  } });
  T.statsTimer = setInterval(() => loadPairs(mint, true), 30000);
}
leaveToken = () => { T.sub?.close(); T.sub = null; clearTimeout(T.curveTimer); clearInterval(T.statsTimer); clearTimeout(T.quoteTimer); };

function renderTokenHead() {
  const t = T.info, b = board.tokens.get(S.tokenMint) || {};
  const sym = t?.symbol || b.symbol || short(S.tokenMint);
  text($("t-sym"), sym); text($("t-name"), t?.name || b.name || ""); icon($("t-icon"), t?.icon || b.image);
  document.title = `${sym} · Ghostprint`;
  const links = $("t-links"); links.textContent = "";
  const soc = { twitter: t?.twitter || b.twitter, telegram: t?.telegram || b.telegram, website: t?.website || b.website };
  for (const [k, u] of [["𝕏", soc.twitter], ["TG", soc.telegram], ["Web", soc.website]]) { const h = safeUrl(u); if (h) links.append(link(h, k), " "); }
  links.append(link(solscan("token", S.tokenMint), "Solscan"), " ", link(`https://dexscreener.com/solana/${S.tokenMint}`, "DEX"));
  if (isPumpMint(S.tokenMint, t?.launchpad)) links.append(" ", link(`https://pump.fun/coin/${S.tokenMint}`, "pump"));
  if (t) {
    text($("s-price"), price(t.usdPrice)); text($("s-mcap"), usd(t.mcap ?? t.fdv)); text($("s-liq"), usd(t.liquidity));
    cls(text($("s-c5"), pct(t.stats5m?.priceChange)), t.stats5m?.priceChange); cls(text($("s-c1"), pct(t.stats1h?.priceChange)), t.stats1h?.priceChange); cls(text($("s-c24"), pct(t.stats24h?.priceChange)), t.stats24h?.priceChange);
    if (t.stats24h) text($("s-vol"), usd((t.stats24h.buyVolume || 0) + (t.stats24h.sellVolume || 0)));
  }
}
async function loadPairs(mint, statsOnly) {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    const pairs = res.ok ? await res.json() : [];
    if (S.tokenMint !== mint) return;
    const best = (Array.isArray(pairs) ? pairs : []).filter(p => p.chainId === "solana" && isAddress(p.pairAddress || "")).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (best) {
      text($("s-price"), price(Number(best.priceUsd))); text($("s-mcap"), usd(best.marketCap ?? best.fdv)); text($("s-liq"), usd(best.liquidity?.usd)); text($("s-vol"), usd(best.volume?.h24));
      cls(text($("s-c5"), pct(best.priceChange?.m5)), best.priceChange?.m5); cls(text($("s-c1"), pct(best.priceChange?.h1)), best.priceChange?.h1); cls(text($("s-c24"), pct(best.priceChange?.h24)), best.priceChange?.h24);
    }
    if (statsOnly) return;
    const box = $("chart");
    if (!best) { box.textContent = ""; box.append(make("div", "empty", "No pool on DexScreener yet. Live trades below come straight from the chain.")); return; }
    const f = document.createElement("iframe");
    f.title = "Price chart"; f.loading = "lazy";
    f.src = `https://dexscreener.com/solana/${best.pairAddress}?embed=1&theme=dark&trades=0&info=0`;
    box.textContent = ""; box.append(f);
  } catch (_) { if (!statsOnly && S.tokenMint === mint) { $("chart").textContent = ""; $("chart").append(make("div", "empty", "Chart unavailable right now.")); } }
}
async function curveTick(mint) {
  if (S.tokenMint !== mint) return;
  try {
    const c = (await readCurves({ connection, web3, mints: [mint] })).get(mint);
    if (c && S.tokenMint === mint) {
      T.curve = c;
      $("curvebar").hidden = false;
      $("curvebar").querySelector("i").style.width = `${c.progress}%`;
      $("curvebar").querySelector(".pbar").classList.toggle("hot", c.progress >= 80);
      text($("curvepct"), c.complete ? "Complete · migrating" : `${c.progress.toFixed(1)}% · ${solFmt(Number(c.realSolReserves) / 1e9)} SOL in curve`);
      if (S.solUsd) { text($("s-mcap"), usd(c.mcapSol * S.solUsd)); text($("s-price"), price(c.priceSol * S.solUsd)); }
      renderAudit();
      if (c.complete) return;
    }
  } catch (_) {}
  T.curveTimer = setTimeout(() => curveTick(mint), 5000);
}

function renderTrades() {
  const host = $("tp-trades"); host.textContent = "";
  if (!T.trades.length) { host.append(make("div", "tdempty", T.stream === "live" ? "Listening for trades on-chain…" : `Connecting to the chain for live trades${T.stream && T.stream !== "connecting" ? ` (${T.stream})` : ""}…`)); return; }
  const table = make("table"), head = make("tr");
  ["Age", "Type", "SOL", "Tokens", "Price", "Maker", ""].forEach((h, i) => head.append(make("th", i > 1 && i < 5 ? "num" : "", h)));
  table.append(head);
  const mine = new Set([S.wallet?.pk, S.instant?.pk].filter(Boolean));
  for (const t of T.trades) {
    const tr = make("tr", `trade-${t.side}${mine.has(t.user) ? " mine" : ""}${t.fresh ? " newrow" : ""}`); t.fresh = false;
    const maker = make("td"); const ml = link(solscan("account", t.user), short(t.user)); maker.append(ml);
    const tx = make("td", "num"); tx.append(link(solscan("tx", t.sig), "↗"));
    tr.append(make("td", "muted", ago(Date.now() - t.time * 1000)), make("td", "side", t.side === "buy" ? "Buy" : "Sell"), make("td", "num", solFmt(t.sol)), make("td", "num", num(t.tokens)), make("td", "num", S.solUsd && t.priceSol ? price(t.priceSol * S.solUsd) : "—"), maker, tx);
    table.append(tr);
  }
  host.append(table);
}
async function renderHolders() {
  const host = $("tp-holders"), mint = S.tokenMint;
  host.textContent = ""; host.append(make("div", "tdempty", "Reading top holders from the chain…"));
  try {
    const creator = T.info?.dev || board.tokens.get(mint)?.creator;
    const h = await holders({ connection, web3, mint, creator });
    if (S.tokenMint !== mint) return;
    T.holders = h; renderAudit();
    host.textContent = "";
    const table = make("table"), head = make("tr");
    ["#", "Holder", "%", "Amount", ""].forEach((x, i) => head.append(make("th", i > 1 && i < 4 ? "num" : "", x)));
    table.append(head);
    h.rows.forEach((r, i) => {
      const tr = make("tr"), who = make("td");
      who.append(link(solscan("account", r.owner || r.account), short(r.owner || r.account)));
      if (r.label) who.append(" ", make("span", r.label === "Dev" ? "warnc" : "muted", r.label));
      const tk = make("td", "num"); const tb = make("button", "btn small", "Track"); tb.type = "button";
      tb.addEventListener("click", () => { addTracked(r.owner || r.account, r.label || `Holder #${i + 1}`); toast("Added to the tracker.", "ok"); });
      if (r.owner && r.label !== "Bonding curve") tk.append(tb);
      tr.append(make("td", "muted", String(i + 1)), who, make("td", "num", `${r.pct.toFixed(2)}%`), make("td", "num", num(r.amount / 10 ** h.decimals)), tk);
      table.append(tr);
    });
    host.append(table);
  } catch (e) { host.textContent = ""; host.append(make("div", "tdempty", `Couldn't read holders: ${errMsg(e)}`)); }
}
function renderMine() {
  const host = $("tp-mine"); host.textContent = "";
  const list = [S.wallet?.pk, S.instant?.pk].filter(Boolean).flatMap(pk => tradesOf(pk)).filter(t => t.mint === S.tokenMint).sort((a, b) => b.time - a.time);
  if (!list.length) { host.append(make("div", "tdempty", S.wallet ? "No trades in this token from this terminal yet." : "Connect a wallet to see your trades.")); return; }
  host.append(tradeTable(list));
}
function tradeTable(list) {
  const table = make("table"), head = make("tr");
  ["When", "Type", "Token", "SOL", "Tokens", "From", ""].forEach((h, i) => head.append(make("th", i > 2 && i < 5 ? "num" : "", h)));
  table.append(head);
  for (const t of list) {
    const tr = make("tr", `trade-${t.side}`), tx = make("td", "num"); tx.append(link(solscan("tx", t.sig), "↗"));
    const tok = make("td"); const a = make("a", "", t.symbol || short(t.mint)); a.href = `#/token/${t.mint}`; tok.append(a);
    tr.append(make("td", "muted", new Date(t.time).toLocaleString()), make("td", "side", t.side === "buy" ? "Buy" : "Sell"), tok, make("td", "num", solFmt(t.sol)), make("td", "num", num(t.tokens)), make("td", "muted", t.from || "main"), tx);
    table.append(tr);
  }
  return table;
}
function renderAudit() {
  const a = $("audit"), t = T.info, b = board.tokens.get(S.tokenMint) || {}, h = T.holders, c = T.curve;
  a.textContent = ""; a.append(make("h3", "", "Token info"));
  const row = (k, v, cl) => { const r = make("div", "row"); r.append(make("span", "k", k), make("span", cl || "", v)); a.append(r); };
  const mintOff = h ? !h.mintAuthority : t?.audit?.mintAuthorityDisabled, freezeOff = h ? !h.freezeAuthority : t?.audit?.freezeAuthorityDisabled;
  row("Mint authority", mintOff == null ? "—" : mintOff ? "Revoked ✓" : "Active ⚠", mintOff == null ? "" : mintOff ? "up" : "down");
  row("Freeze authority", freezeOff == null ? "—" : freezeOff ? "Revoked ✓" : "Active ⚠", freezeOff == null ? "" : freezeOff ? "up" : "down");
  const top10 = h ? h.top10 : t?.audit?.topHoldersPercentage;
  row("Top 10 holders", top10 != null ? `${top10.toFixed(1)}%` : "Open Holders", top10 > 30 ? "warnc" : "");
  const dev = h && h.devPct ? h.devPct : t?.audit?.devBalancePercentage;
  if (dev != null) row("Dev holds", `${dev.toFixed(2)}%`, dev > 5 ? "warnc" : "");
  if (t?.holderCount) row("Holders", num(t.holderCount));
  if (t?.organicScore != null) row("Organic score", `${t.organicScore.toFixed(0)} ${t.organicScoreLabel || ""}`);
  if (c) row("Bonding curve", c.complete ? "Complete" : `${c.progress.toFixed(1)}%`);
  const created = Date.parse(t?.firstPool?.createdAt || "") || b.createdAt;
  if (created) row("Age", ago(Date.now() - created));
  const creator = t?.dev || b.creator;
  if (creator) {
    const r = make("div", "row"), v = make("span"), tb = make("button", "btn small", "Trace dev"); tb.type = "button";
    v.append(link(solscan("account", creator), short(creator)), " ", tb);
    tb.addEventListener("click", async () => {
      tb.disabled = true; text(tb, "Tracing…");
      try { const r2 = await trace(creator, { url: rpcUrl, recent: 60, depthWallets: 3 }); text(tb, `${r2.score}/100 ${r2.grade}`); tb.title = r2.findings.map(f => `${f.k}: ${f.v}`).join("\n"); }
      catch (e) { text(tb, "Trace failed"); tb.title = errMsg(e); }
    });
    r.append(make("span", "k", "Dev wallet"), v); a.append(r);
  }
  const desc = b.description;
  if (desc) a.append(make("p", "", desc));
}
function selectTokenTab(id) {
  document.querySelectorAll("#v-token [role=tab]").forEach(t => { const on = t.id === id; t.setAttribute("aria-selected", on); $(t.getAttribute("aria-controls")).hidden = !on; });
  if (id === "tt-holders") renderHolders();
  if (id === "tt-mine") renderMine();
}
document.querySelectorAll("#v-token [role=tab]").forEach(t => t.addEventListener("click", () => selectTokenTab(t.id)));
$("t-mint").addEventListener("click", async () => { try { await navigator.clipboard.writeText(S.tokenMint); toast("Mint address copied.", "ok"); } catch (_) {} });

/* ---------- trade panel ---------- */
const amt = $("amt");
function setTradeStatus(msg, kind = "", sig) {
  const st = $("status"); st.textContent = msg; st.className = "status " + kind;
  if (sig) { st.append(" "); st.append(link(solscan("tx", sig), "Solscan ↗")); }
}
async function refreshTokenBal() {
  if (S.route !== "token" || !S.tokenMint) return;
  const pk = settings.from === "instant" ? S.instant?.pk : S.wallet?.pk;
  if (!pk) { T.tokenBal = null; return renderTradePanel(); }
  try {
    const r = await connection.getParsedTokenAccountsByOwner(new web3.PublicKey(pk), { mint: new web3.PublicKey(S.tokenMint) });
    T.tokenBal = r.value.reduce((n, a) => n + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
  } catch (_) { T.tokenBal = 0n; }
  renderTradePanel();
}
function renderTradePanel() {
  if (!S.tokenMint) return;
  const buy = T.side === "buy", sym = symbolOf(S.tokenMint), inst = settings.from === "instant";
  if (inst || !buy) T.ghost = false;
  $("side-buy").setAttribute("aria-pressed", buy); $("side-sell").setAttribute("aria-pressed", !buy);
  $("fromseg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.w === settings.from));
  text($("amt-label"), buy ? "Amount (SOL)" : `Amount (${sym})`);
  text($("amt-unit"), buy ? "SOL" : sym);
  const solBal = inst ? S.instantSol : S.sol;
  text($("bal"), buy ? `Bal ${solBal != null ? fromRaw(solBal, 9, 3) : "—"} SOL` : `Bal ${T.tokenBal != null && T.decimals != null ? num(Number(T.tokenBal) / 10 ** T.decimals) : "—"}`);
  const q = $("quick"); q.textContent = "";
  (buy ? settings.buyAmounts : settings.sellPcts).forEach(v => {
    const b = make("button", "", buy ? String(v) : `${v}%`); b.type = "button";
    b.addEventListener("click", () => {
      if (buy) amt.value = String(v);
      else if (T.tokenBal != null && T.decimals != null) amt.value = fromRaw(v >= 100 ? T.tokenBal : T.tokenBal * BigInt(Math.round(v * 100)) / 10000n, T.decimals, T.decimals);
      scheduleQuote();
    });
    q.append(b);
  });
  const ps = $("presets"); ps.textContent = "";
  settings.presets.forEach((p, i) => {
    const b = make("button"); b.type = "button"; b.setAttribute("aria-pressed", settings.preset === i);
    b.append(make("b", "", `P${i + 1}`), `${p.slippageBps / 100}% · ${p.priority === "veryHigh" ? "turbo" : p.priority}`);
    b.title = `Slippage ${p.slippageBps / 100}%, priority ${p.priority} up to ${p.maxSol} SOL`;
    b.addEventListener("click", () => { settings.preset = i; saveSettings(); renderTradePanel(); scheduleQuote(); });
    ps.append(b);
  });
  const gs = $("ghost-switch");
  gs.disabled = inst || !buy;
  gs.setAttribute("aria-checked", T.ghost);
  $("ghost-box").classList.toggle("on", T.ghost);
  text($("ghost-sub"), inst ? "Instant trades already use a separate wallet" : !buy ? "Ghost positions sell from Portfolio" : "Buy from a fresh wallet via NEAR Intents");
  updateGo();
}
function amountRaw() {
  if (T.side === "sell" && T.decimals == null) return null;
  return toRaw(amt.value, T.side === "buy" ? 9 : T.decimals);
}
function problem() {
  if (T.decimals == null) return "Loading token…";
  const raw = amountRaw();
  if (!raw) return "Enter an amount";
  if (T.ghost && raw > toRaw(String(GHOST_MAX_SOL), 9)) return `Ghost beta limit is ${GHOST_MAX_SOL} SOL`;
  if (T.ghost && raw <= GHOST_GAS_RESERVE * 2n) return "Ghost buys start at 0.02 SOL";
  const inst = settings.from === "instant";
  if (inst && !S.instant) return null; // unlocking happens on click
  if (!inst && !S.wallet) return null;
  const sol = inst ? S.instantSol : S.sol;
  if (T.side === "buy" && sol != null && raw + 5_000_000n > sol) return inst ? "Deposit SOL to instant wallet" : "Not enough SOL";
  if (T.side === "sell" && T.tokenBal != null && raw > T.tokenBal) return `Not enough ${symbolOf(S.tokenMint)}`;
  return null;
}
function updateGo() {
  if (S.busy) return;
  const go = $("go"), p = problem(), inst = settings.from === "instant", sym = symbolOf(S.tokenMint);
  const needConnect = !S.wallet;
  go.disabled = !!p && !needConnect;
  text(go, needConnect ? "Connect wallet" : p || `${T.ghost ? "Ghost buy" : T.side === "buy" ? "Buy" : "Sell"} ${sym}${inst ? " ⚡" : ""}`);
  go.className = `btn go ${needConnect || !p ? (T.side === "buy" ? "buy" : "primary") : ""}`;
  const pr = preset();
  text($("fine"), T.ghost
    ? `Ghost: ${FEE_BPS / 100}% fee from your wallet plus the NEAR Intents routing fee, then a fresh ghost wallet buys. Funding and exit amounts and timing can still be matched, so vary them.`
    : `${FEE_BPS / 100}% fee in SOL · P${settings.preset + 1}: ${pr.slippageBps / 100}% slippage, ${pr.priority} priority up to ${pr.maxSol} SOL · ${inst ? "signed instantly by your instant wallet" : "you approve every trade in your wallet"}`);
}
function scheduleQuote() {
  updateGo(); clearTimeout(T.quoteTimer);
  if (!amountRaw()) { $("quote").hidden = true; return; }
  T.quoteTimer = setTimeout(previewQuote, 600);
}
async function previewQuote() {
  const seq = ++T.quoteSeq, raw = amountRaw(), mint = S.tokenMint;
  if (!raw) return;
  const buy = T.side === "buy", fee = buy ? raw * BigInt(FEE_BPS) / 10000n : 0n;
  const spend = buy ? raw - fee - (T.ghost ? GHOST_GAS_RESERVE : 0n) : raw;
  if (spend <= 0n) return;
  try {
    const qt = await jup.quote({ inputMint: buy ? SOL_MINT : mint, outputMint: buy ? mint : SOL_MINT, amount: spend, slippageBps: preset().slippageBps });
    if (seq !== T.quoteSeq || mint !== S.tokenMint) return;
    renderQuote(qt, buy ? fee : BigInt(qt.otherAmountThreshold) * BigInt(FEE_BPS) / 10000n);
  } catch (e) { if (seq === T.quoteSeq) { const box = $("quote"); box.hidden = false; box.textContent = ""; box.append(make("div", "row", errMsg(e))); } }
}
function renderQuote(qt, fee) {
  const buy = T.side === "buy", outDec = buy ? T.decimals : 9, outSym = buy ? symbolOf(S.tokenMint) : "SOL";
  const route = [...new Set((qt.routePlan || []).map(r => r.swapInfo?.label).filter(Boolean))].slice(0, 3).join(" → ");
  const rows = [["You get ≈", `${fromRaw(qt.outAmount, outDec, 4)} ${outSym}`], ["Minimum", `${fromRaw(qt.otherAmountThreshold, outDec, 4)} ${outSym}`], ["Price impact", `${(Number(qt.priceImpactPct || 0) * 100).toFixed(2)}%`], ["Route", route || "—"], [`Fee ${FEE_BPS / 100}%`, `${fromRaw(fee, 9, 6)} SOL`]];
  if (T.ghost) rows.push(["Ghost route", "NEAR Intents → fresh wallet, 0.01 SOL kept for gas"]);
  const box = $("quote"); box.textContent = "";
  for (const [k, v] of rows) { const r = make("div", "row"); r.append(make("span", "k", k), make("span", "", v)); box.append(r); }
  box.hidden = false;
}
$("side-buy").addEventListener("click", () => { T.side = "buy"; amt.value = ""; $("quote").hidden = true; renderTradePanel(); });
$("side-sell").addEventListener("click", () => { T.side = "sell"; amt.value = ""; $("quote").hidden = true; renderTradePanel(); });
$("fromseg").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  settings.from = b.dataset.w; saveSettings();
  if (settings.from === "instant") { try { await instantWallet(); } catch (err) { settings.from = "main"; saveSettings(); setTradeStatus(errMsg(err), "err"); } }
  renderWalletBtn(); refreshTokenBal(); renderTradePanel();
});
$("bal").addEventListener("click", () => {
  if (T.side === "sell" && T.tokenBal != null && T.decimals != null) amt.value = fromRaw(T.tokenBal, T.decimals, T.decimals);
  else if (T.side === "buy") { const s = settings.from === "instant" ? S.instantSol : S.sol; if (s != null) amt.value = fromRaw(s > 10_000_000n ? s - 10_000_000n : 0n, 9, 4); }
  scheduleQuote();
});
amt.addEventListener("input", () => { amt.value = amt.value.replace(/,/g, ".").replace(/[^\d.]/g, ""); scheduleQuote(); });
$("ghost-switch").addEventListener("click", () => { T.ghost = !T.ghost; renderTradePanel(); scheduleQuote(); });
$("go").addEventListener("click", async () => {
  if (!S.wallet) { await ensureConnected(); return; }
  if (S.busy || problem()) return;
  if (T.ghost) return ghostBuy();
  const go = $("go"), raw = amountRaw(), mint = S.tokenMint, sym = symbolOf(mint), side = T.side;
  S.busy = true; go.disabled = true;
  try {
    const r = await executeTrade({ side, mint, amountRaw: raw, onStatus: m => { text(go, m); setTradeStatus(m); } });
    setTradeStatus(side === "buy" ? `Bought ≈${num(r.tokens)} ${sym}.` : `Sold ${num(r.tokens)} ${sym} for ≈${solFmt(r.sol)} SOL.`, "ok", r.sig);
    amt.value = ""; $("quote").hidden = true;
    setTimeout(() => { refreshTokenBal(); renderMine(); }, 1500);
  } catch (e) { setTradeStatus(errMsg(e), "err"); }
  finally { S.busy = false; updateGo(); }
});

/* ---------- Ghost mode ---------- */
let solAsset = null;
const GKEY = pk => `ghostprint-ghosts-${pk}`;
const ghostRecords = () => S.wallet ? store.get(GKEY(S.wallet.pk), []) : [];
function saveGhost(rec) { const list = ghostRecords().filter(g => g.index !== rec.index); list.push(rec); list.sort((a, b) => a.index - b.index); store.set(GKEY(S.wallet.pk), list); }
const ROUTE_LABEL = { PENDING_DEPOSIT: "waiting for the deposit", KNOWN_DEPOSIT_TX: "deposit seen", INCOMPLETE_DEPOSIT: "deposit incomplete", PROCESSING: "routing privately", SUCCESS: "delivered" };
const routeAsset = async () => solAsset || (solAsset = await oc.tokens().then(solAssetId).catch(() => undefined));
function gsteps(n) { [...$("gsteps").children].forEach((li, i) => { li.className = i < n ? "done" : i === n ? "active" : ""; }); $("gsteps").hidden = n < 0; }
async function waitForSol(pk, min, ms = 90000) {
  const until = Date.now() + ms;
  for (;;) {
    const b = BigInt(await connection.getBalance(new web3.PublicKey(pk)));
    if (b >= min) return b;
    if (Date.now() > until) throw new GhostError("NEAR Intents reported delivery but the wallet hasn't received SOL yet. Check Portfolio in a minute.");
    await new Promise(r => setTimeout(r, 2500));
  }
}
async function ghostBuy() {
  const raw = amountRaw(), mint = S.tokenMint, sym = symbolOf(mint), main = S.wallet.pk, go = $("go");
  S.busy = true; go.disabled = true;
  let rec = null;
  try {
    text(go, "Sign in wallet…"); setTradeStatus("Sign the Ghostprint message so the terminal can open a fresh ghost wallet. It sends nothing.");
    const seed = await walletSeed();
    const index = ghostRecords().reduce((m, g) => Math.max(m, g.index + 1), 0);
    const ghost = await deriveGhost(web3, seed, index), gpk = ghost.publicKey.toBase58();
    const fee = raw * BigInt(FEE_BPS) / 10000n, routeAmount = raw - fee;
    gsteps(0); text(go, "Routing…"); setTradeStatus("Getting a private route from NEAR Intents…");
    const { quote, confidential } = await routeQuote({ oc, asset: await routeAsset(), amount: routeAmount, from: main, to: gpk, confidentiality: GHOST_CONFIDENTIALITY });
    rec = { index, address: gpk, mint, symbol: sym, state: "funding", depositAddress: quote.depositAddress, confidential, createdAt: Date.now() };
    saveGhost(rec);
    text(go, "Approve in wallet…"); setTradeStatus(`Approve sending ${fromRaw(raw, 9, 4)} SOL into ${confidential ? "a Confidential Intents" : "a NEAR Intents"} route.`);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const fsig = await signSend(fundingTx(web3, { from: main, depositAddress: quote.depositAddress, amount: routeAmount, fee, treasury: TREASURY, blockhash }), { local: null }, lastValidBlockHeight);
    oc.submitDeposit(fsig, quote.depositAddress).catch(() => {});
    saveGhost({ ...rec, state: "routing", fundingSig: fsig });
    gsteps(1); text(go, "Routing privately…");
    await waitForRoute(oc, quote.depositAddress, { onStatus: s => setTradeStatus(`NEAR Intents: ${ROUTE_LABEL[s] || s.toLowerCase()}${confidential ? " (confidential)" : ""}…`) });
    const bal = await waitForSol(gpk, GHOST_GAS_RESERVE + 1n);
    saveGhost({ ...rec, state: "funded" });
    gsteps(2); text(go, "Ghost buying…"); setTradeStatus(`Ghost wallet #${index} received ${fromRaw(bal, 9, 4)} SOL. Buying ${sym}…`);
    const p = preset();
    const prep = await prepareSwap({ web3, jup, connection, side: "buy", mint, amountRaw: bal - GHOST_GAS_RESERVE, user: gpk, treasury: TREASURY, feeBps: 0, slippageBps: p.slippageBps, priorityMaxLamports: Math.round(p.maxSol * 1e9), priorityLevel: p.priority });
    const bsig = await signSend(prep.tx, { local: ghost }, prep.lastValidBlockHeight);
    saveGhost({ ...rec, state: "holding", buySig: bsig });
    gsteps(3);
    const dec = T.decimals ?? await decimalsOf(mint);
    const out = Number(prep.quote.outAmount) / 10 ** dec;
    logTrade(main, { sig: bsig, time: Date.now(), side: "buy", mint, symbol: sym, sol: Number(raw) / 1e9, tokens: out, from: `ghost #${index}` });
    setTradeStatus(`Ghost wallet #${index} bought ≈${num(out)} ${sym}. Nothing on-chain links it to your wallet.`, "ok", bsig);
    amt.value = ""; $("quote").hidden = true;
    refreshBalances(); renderMine();
  } catch (e) {
    setTradeStatus(`${errMsg(e)}${rec ? ` Ghost wallet #${rec.index} is listed in Portfolio if it received anything.` : ""}`, "err");
  } finally { S.busy = false; setTimeout(() => gsteps(-1), 8000); updateGo(); }
}
async function ghostExit(index, row) {
  if (S.busy) return;
  S.busy = true;
  const say = (m, k = "") => { text(row.querySelector(".meta"), m); if (k) toast(m, k); };
  try {
    const ghost = await deriveGhost(web3, await walletSeed(), index), gpk = ghost.publicKey.toBase58(), owner = ghost.publicKey;
    const accounts = async () => (await Promise.all(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"].map(p =>
      connection.getParsedTokenAccountsByOwner(owner, { programId: new web3.PublicKey(p) }).then(r => r.value.map(a => ({ address: a.pubkey.toBase58(), programId: p, lamports: a.account.lamports, mint: a.account.data.parsed.info.mint, raw: BigInt(a.account.data.parsed.info.tokenAmount.amount) }))).catch(() => [])))).flat();
    for (const a of (await accounts()).filter(a => a.raw > 0n && a.mint !== SOL_MINT)) {
      say(`Ghost #${index}: selling ${symbolOf(a.mint)}…`);
      const prep = await prepareSwap({ web3, jup, connection, side: "sell", mint: a.mint, amountRaw: a.raw, user: gpk, treasury: TREASURY, feeBps: 0, slippageBps: Math.max(preset().slippageBps, 500), priorityMaxLamports: PRIORITY_MAX_LAMPORTS });
      await signSend(prep.tx, { local: ghost }, prep.lastValidBlockHeight);
    }
    const left = await accounts(), stuck = left.filter(a => a.raw > 0n), close = left.filter(a => a.raw === 0n);
    const amount = exitAmount(await connection.getBalance(owner), close);
    if (amount <= 0n) throw new GhostError(`Ghost #${index} has nothing left to send.`);
    say(`Ghost #${index}: getting a private route home…`);
    const { quote, confidential } = await routeQuote({ oc, asset: await routeAsset(), amount, from: gpk, to: S.wallet.pk, confidentiality: GHOST_CONFIDENTIALITY });
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const sig = await sendAndConfirm(connection, exitTx(web3, { ghost, depositAddress: quote.depositAddress, amount, closeAccounts: close, blockhash }), lastValidBlockHeight);
    oc.submitDeposit(sig, quote.depositAddress).catch(() => {});
    const rec = ghostRecords().find(g => g.index === index) || { index, address: gpk };
    saveGhost({ ...rec, state: "exiting", exitDeposit: quote.depositAddress });
    await waitForRoute(oc, quote.depositAddress, { onStatus: s => say(`Ghost #${index} → your wallet: ${ROUTE_LABEL[s] || s.toLowerCase()}${confidential ? " (confidential)" : ""}…`) });
    saveGhost({ ...rec, state: stuck.length ? "partial" : "closed" });
    toast(`Ghost #${index} is back in your wallet: ${fromRaw(BigInt(quote.amountOut), 9, 4)} SOL${stuck.length ? `. ${stuck.length} token(s) had no route and stayed behind` : ""}.`, "ok", sig);
    refreshBalances();
  } catch (e) { say(errMsg(e), "err"); }
  finally { S.busy = false; renderGhosts(); }
}
async function renderGhosts(extra = 3) {
  const list = $("g-list");
  if (!S.wallet) { list.textContent = ""; list.append(make("span", "muted mono", "Connect a wallet to see its ghost wallets.")); return; }
  if (!S.seed) return;
  text($("g-unlock"), "Scan further");
  list.textContent = ""; list.append(make("span", "muted mono", "Scanning ghost wallets…"));
  const recs = ghostRecords(), top = recs.reduce((m, g) => Math.max(m, g.index), -1) + extra, rows = [];
  for (let i = 0; i <= top; i++) {
    const ghost = await deriveGhost(web3, S.seed, i), pk = ghost.publicKey;
    const [bal, toks] = await Promise.all([connection.getBalance(pk).catch(() => 0), connection.getParsedTokenAccountsByOwner(pk, { programId: new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }).then(r => r.value).catch(() => [])]);
    const held = toks.map(a => a.account.data.parsed.info).filter(t => BigInt(t.tokenAmount.amount) > 0n);
    const rec = recs.find(g => g.index === i);
    if (!bal && !held.length && !(rec && rec.state !== "closed")) continue;
    rows.push({ i, ghost, bal: BigInt(bal), held, rec });
  }
  list.textContent = "";
  if (!rows.length) list.append(make("span", "muted mono", "No ghost wallets with funds. Turn on Ghost mode in the trade panel to make one."));
  for (const r of rows) {
    const row = make("div", "ghost-row"), meta = make("div", "meta"), acts = make("div", "acts");
    meta.append(make("b", "", `Ghost #${r.i}`), ` · ${short(r.ghost.publicKey.toBase58())} · ${fromRaw(r.bal, 9, 4)} SOL`);
    for (const t of r.held) meta.append(` · ${num(Number(t.tokenAmount.uiAmountString || t.tokenAmount.uiAmount))} ${symbolOf(t.mint)}`);
    if (r.rec) meta.append(` · ${r.rec.state}`);
    const exit = make("button", "btn small primary", r.held.length ? "Sell all & exit" : "Exit to wallet"); exit.type = "button";
    exit.addEventListener("click", () => ghostExit(r.i, row));
    const key = make("button", "btn small", "Export key"); key.type = "button";
    key.addEventListener("click", () => { const old = row.querySelector(".keybox"); if (old) return old.remove(); row.append(make("div", "keybox", `Secret key for ghost #${r.i} (import into Phantom or Solflare): ${base58Encode(r.ghost.secretKey)}`)); });
    acts.append(exit, key); row.append(meta, acts); list.append(row);
  }
}
$("g-unlock").addEventListener("click", async () => {
  try { if (!S.wallet && !(await ensureConnected())) return; await walletSeed(); S.ghostScan = (S.ghostScan || 3) + 7; await renderGhosts(S.ghostScan); }
  catch (e) { toast(errMsg(e), "err"); }
});

/* ---------- Tracker ---------- */
const tracked = () => store.get("ghostprint-tracked", []);
function addTracked(address, label) {
  if (!isAddress(address)) return toast("That isn't a Solana address.", "err");
  const l = tracked().filter(w => w.address !== address); l.push({ address, label: label || short(address) });
  store.set("ghostprint-tracked", l); renderTracker(); startTracker();
}
const feed = [];
const seenSigs = new Map();
let trackerTimer = 0, trackerRunning = false;
async function trackerPass() {
  const list = tracked();
  if (!list.length) { setStatusChip($("tk-status"), "idle", "tracker"); return; }
  setStatusChip($("tk-status"), "live", `${list.length} wallet${list.length === 1 ? "" : "s"}`);
  for (const w of list) {
    const first = !seenSigs.has(w.address);
    if (first) seenSigs.set(w.address, new Set());
    try {
      const swaps = await recentSwaps({ connection, web3, wallet: w.address, seen: seenSigs.get(w.address), limit: first ? 10 : 6 });
      if (!swaps.length) continue;
      await lookupTokens(swaps.map(s => s.mint));
      for (const s of swaps) {
        feed.unshift({ ...s, label: w.label, fresh: !first });
        if (!first) toast(`${w.label} ${s.side === "buy" ? "bought" : "sold"} ${symbolOf(s.mint)} for ${solFmt(s.sol)} SOL`, "info", s.sig);
      }
      feed.sort((a, b) => b.time - a.time); feed.length = Math.min(feed.length, 200);
      if (S.route === "tracker") renderFeed();
    } catch (_) { setStatusChip($("tk-status"), "rate limited", "tracker"); }
  }
}
function startTracker() {
  if (trackerRunning) return;
  trackerRunning = true;
  const loop = async () => { await trackerPass(); trackerTimer = setTimeout(loop, 20000); };
  loop();
}
function renderTracker() {
  const ul = $("tk-list"); ul.textContent = "";
  for (const w of tracked()) {
    const li = make("li"), info = make("div"), x = make("button", "", "✕"); x.type = "button"; x.setAttribute("aria-label", `Stop tracking ${w.label}`);
    info.append(make("div", "lab", w.label), link(solscan("account", w.address), short(w.address)));
    x.addEventListener("click", () => { store.set("ghostprint-tracked", tracked().filter(t => t.address !== w.address)); seenSigs.delete(w.address); renderTracker(); });
    li.append(info, x); ul.append(li);
  }
  renderFeed();
}
function renderFeed() {
  const table = $("tk-feed"); table.textContent = "";
  if (!tracked().length) { emptyRow(table, "Add a wallet to see its swaps here. Tip: the Holders tab on any token has a Track button."); return; }
  if (!feed.length) { emptyRow(table, "Watching… swaps show up within about 20 seconds."); return; }
  const head = make("tr"); ["Age", "Wallet", "Type", "Token", "SOL", "Tokens", "", ""].forEach((h, i) => head.append(make("th", i > 3 && i < 6 ? "num" : "", h))); table.append(head);
  for (const s of feed) {
    const tr = make("tr", `trade-${s.side}${s.fresh ? " newrow" : ""}`); s.fresh = false;
    const tok = make("td"), wrap = make("a", "cell-tok"); wrap.href = `#/token/${s.mint}`; wrap.append(icon(make("img", "tok-icon"), iconOf(s.mint)), make("span", "", symbolOf(s.mint))); tok.append(wrap);
    const qbtd = make("td", "num"), qb = make("button", "qb", `⚡ ${$("qbamt").value || settings.quickBuy}`); qb.type = "button"; qb.addEventListener("click", () => quickBuy(s.mint, qb)); qbtd.append(qb);
    const tx = make("td", "num"); tx.append(link(solscan("tx", s.sig), "↗"));
    tr.append(make("td", "muted", s.time ? ago(Date.now() - s.time * 1000) : "—"), make("td", "", s.label), make("td", "side", s.side === "buy" ? "Buy" : "Sell"), tok, make("td", "num", solFmt(s.sol)), make("td", "num", num(s.tokens)), qbtd, tx);
    table.append(tr);
  }
}
$("tk-form").addEventListener("submit", e => { e.preventDefault(); addTracked($("tk-addr").value.trim(), $("tk-label").value.trim()); $("tk-addr").value = ""; $("tk-label").value = ""; });

/* ---------- Portfolio ---------- */
let pfWallet = "main";
async function renderPortfolio() {
  const cards = $("pf-cards"), table = $("pf-table"), act = $("pf-act");
  $("pf-wallet").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.w === pfWallet));
  cards.textContent = ""; table.textContent = ""; act.textContent = "";
  const card = (k, v, c) => { const d = make("div", "panel card"); d.append(make("div", "k", k), cls(make("div", "v", v), c)); cards.append(d); };
  if (!S.wallet) { card("Wallet", "Not connected"); emptyRow(table, "Connect a wallet to see positions."); renderGhosts(); return; }
  const pk = pfWallet === "instant" ? S.instant?.pk : S.wallet.pk;
  if (!pk) { card("Instant wallet", "Locked"); const tr = table.insertRow(), td = make("td", "tdempty"); const b = make("button", "btn small primary", "Unlock instant wallet"); b.type = "button"; b.addEventListener("click", async () => { try { await instantWallet(); renderPortfolio(); } catch (e) { toast(errMsg(e), "err"); } }); td.append(b); tr.append(td); renderGhosts(); return; }
  emptyRow(table, "Loading positions…");
  try {
    const owner = new web3.PublicKey(pk);
    const [bal, accts] = await Promise.all([connection.getBalance(owner), Promise.all(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"].map(p => connection.getParsedTokenAccountsByOwner(owner, { programId: new web3.PublicKey(p) }).then(r => r.value).catch(() => []))).then(x => x.flat())]);
    const held = new Map();
    for (const a of accts) { const i = a.account.data.parsed.info, n = Number(i.tokenAmount.uiAmountString ?? i.tokenAmount.uiAmount ?? 0); if (n > 0 && i.mint !== SOL_MINT) held.set(i.mint, (held.get(i.mint) || 0) + n); }
    const log = tradesOf(pk);
    const mints = [...new Set([...held.keys(), ...log.map(t => t.mint)])].slice(0, 50);
    const [prices] = await Promise.all([jup.prices(mints).catch(() => ({})), lookupTokens(mints)]);
    const solUsd = S.solUsd || 0;
    const pSol = Object.fromEntries(mints.map(m => [m, prices[m]?.usdPrice && solUsd ? prices[m].usdPrice / solUsd : undefined]));
    const rows = pnl(log, pSol);
    const byMint = new Map(rows.map(r => [r.mint, r]));
    const all = mints.map(m => { const r = byMint.get(m) || { mint: m, avg: 0, realized: 0, unrealized: null, total: 0, pct: 0 }; const h = held.get(m) || 0; const value = pSol[m] != null ? h * pSol[m] : null; return { ...r, onchain: h, value, unrealized: r.boughtTok ? (value != null ? value - Math.min(h, r.holding) * r.avg : null) : null }; })
      .filter(r => r.onchain > 0 || r.realized).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const total = all.reduce((n, r) => n + (r.value || 0), 0), unreal = all.reduce((n, r) => n + (r.unrealized || 0), 0), real = all.reduce((n, r) => n + (r.realized || 0), 0);
    card(`${pfWallet === "instant" ? "Instant" : "Main"} SOL`, `${solFmt(bal / 1e9)} SOL`);
    card("Positions value", `${solFmt(total)} SOL${solUsd ? ` · ${usd(total * solUsd)}` : ""}`);
    card("Unrealized PnL", `${unreal >= 0 ? "+" : ""}${solFmt(unreal)} SOL`, unreal);
    card("Realized PnL", `${real >= 0 ? "+" : ""}${solFmt(real)} SOL`, real);
    table.textContent = "";
    const head = make("tr"); ["Token", "Holding", "Value", "Avg cost", "Unrealized", "Realized", "Sell"].forEach((h, i) => head.append(make("th", i ? "num" : "", h))); table.append(head);
    if (!all.length) emptyRow(table, "No positions yet.");
    for (const r of all) {
      const tr = make("tr"), tok = make("td"), a = make("a", "cell-tok"); a.href = `#/token/${r.mint}`; a.append(icon(make("img", "tok-icon"), iconOf(r.mint)), make("b", "", symbolOf(r.mint))); tok.append(a);
      const sells = make("td", "num");
      for (const pctv of [50, 100]) {
        const b = make("button", "btn small", `${pctv}%`); b.type = "button";
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            const dec = await decimalsOf(r.mint), accts2 = await connection.getParsedTokenAccountsByOwner(owner, { mint: new web3.PublicKey(r.mint) });
            const rawBal = accts2.value.reduce((n, x) => n + BigInt(x.account.data.parsed.info.tokenAmount.amount), 0n);
            const amountRaw = pctv === 100 ? rawBal : rawBal * BigInt(pctv) / 100n;
            const res = await executeTrade({ side: "sell", mint: r.mint, amountRaw, from: pfWallet });
            toast(`Sold ${num(Number(amountRaw) / 10 ** dec)} ${symbolOf(r.mint)} for ≈${solFmt(res.sol)} SOL`, "ok", res.sig);
            setTimeout(renderPortfolio, 2000);
          } catch (e) { toast(errMsg(e), "err"); b.disabled = false; }
        });
        sells.append(b, " ");
      }
      tr.append(tok, make("td", "num", num(r.onchain)), make("td", "num", r.value != null ? `${solFmt(r.value)} SOL` : "—"), make("td", "num", r.avg ? price(r.avg * solUsd) : "—"), cls(make("td", "num", r.unrealized != null ? `${r.unrealized >= 0 ? "+" : ""}${solFmt(r.unrealized)}` : "—"), r.unrealized), cls(make("td", "num", r.realized ? `${r.realized >= 0 ? "+" : ""}${solFmt(r.realized)}` : "—"), r.realized), sells);
      table.append(tr);
    }
    if (log.length) act.append(tradeTable(log)); else emptyRow(act, "Trades you make in this terminal show up here.");
  } catch (e) { table.textContent = ""; emptyRow(table, `Couldn't load positions: ${errMsg(e)}`); }
  renderGhosts();
}
$("pf-wallet").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; pfWallet = b.dataset.w; renderPortfolio(); });
$("x-run").addEventListener("click", async () => {
  if (!S.wallet && !(await ensureConnected())) return;
  const btn = $("x-run"); btn.disabled = true; text(btn, "Tracing…");
  try {
    const r = await trace(S.wallet.pk, { url: rpcUrl, onProgress: p => text($("x-grade"), p.step === "transactions" ? `Reading transactions ${p.done}/${p.total}` : p.step === "neighbours" ? `Checking neighbouring wallets ${p.done}/${p.total}` : "Reading history…") });
    cls(text($("x-score"), `${r.score}/100`), r.score >= 50 ? -1 : 1);
    text($("x-grade"), `${r.grade} · read ${r.scanned} transactions. Ghost mode keeps new buys off this graph.`);
    const ul = $("x-list"); ul.textContent = "";
    for (const f of r.findings) { const li = make("li"), d = make("div"); d.append(make("div", "lab", `${f.k}: ${f.v}`), make("div", "muted", f.why)); li.append(d, make("span", f.sev === "high" || f.sev === "warn" ? "down" : "muted", f.sev)); ul.append(li); }
  } catch (e) { text($("x-grade"), errMsg(e)); }
  finally { btn.disabled = false; text(btn, "Trace again"); }
});

/* ---------- watchlist ---------- */
const watchlist = () => store.get("ghostprint-watchlist", []);
let watchPrices = {};
function renderStar() { const on = watchlist().some(w => w.mint === S.tokenMint); $("t-star").setAttribute("aria-pressed", on); $("t-star").setAttribute("aria-label", on ? "Remove from watchlist" : "Add to watchlist"); }
$("t-star").addEventListener("click", () => {
  const l = watchlist(), on = l.some(w => w.mint === S.tokenMint);
  store.set("ghostprint-watchlist", on ? l.filter(w => w.mint !== S.tokenMint) : [...l, { mint: S.tokenMint, symbol: symbolOf(S.tokenMint), icon: iconOf(S.tokenMint) }]);
  renderStar(); renderWatchbar(); refreshWatch();
});
function renderWatchbar() {
  const bar = $("watchbar"), l = watchlist(); bar.textContent = "";
  bar.append(make("span", "lab", "Watchlist"));
  if (!l.length) { bar.append(make("span", "muted mono", "Star a token to pin it here.")); return; }
  for (const w of l) {
    const a = make("a"); a.href = `#/token/${w.mint}`;
    const p = watchPrices[w.mint];
    a.append(icon(make("img"), w.icon), make("b", "", w.symbol || short(w.mint)), make("span", "", p ? price(p.usdPrice) : ""), cls(make("span", "", p?.priceChange24h != null ? pct(p.priceChange24h) : ""), p?.priceChange24h));
    bar.append(a);
  }
}
async function refreshWatch() { const l = watchlist(); if (l.length) { try { watchPrices = await jup.prices(l.map(w => w.mint)); } catch (_) {} } renderWatchbar(); }

/* ---------- search ---------- */
const q = $("q"), results = $("results");
let searchTimer = 0, searchSeq = 0;
q.addEventListener("input", () => { clearTimeout(searchTimer); const v = q.value.trim(); if (!v) return closeResults(); if (isAddress(v)) { closeResults(); q.value = ""; location.hash = `#/token/${v}`; return; } searchTimer = setTimeout(() => search(v), 400); });
q.addEventListener("keydown", e => {
  const items = [...results.querySelectorAll("button")], i = items.findIndex(b => b.getAttribute("aria-selected") === "true");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]; items.forEach(b => b.setAttribute("aria-selected", b === n)); n && n.scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Enter") { e.preventDefault(); (items[i] || items[0])?.click(); }
  else if (e.key === "Escape") { closeResults(); q.blur(); }
});
document.addEventListener("click", e => { if (!e.target.closest(".search")) closeResults(); });
function closeResults() { results.hidden = true; q.setAttribute("aria-expanded", "false"); }
async function search(v) {
  const seq = ++searchSeq;
  results.textContent = ""; results.append(make("li", "note", "Searching…")); results.hidden = false; q.setAttribute("aria-expanded", "true");
  try {
    const list = (await jup.search(v) || []).filter(t => t && t.id && t.id !== SOL_MINT).slice(0, 12);
    if (seq !== searchSeq) return;
    results.textContent = "";
    if (!list.length) { results.append(make("li", "note", "No tokens found.")); return; }
    for (const t of list) {
      tokenInfo.set(t.id, t);
      const li = make("li"), b = make("button"), mid = make("div"), n2 = make("div", "num");
      b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", "false");
      mid.append(make("div", "sym", `${t.symbol || "?"}${t.isVerified ? " ✓" : ""}`), make("div", "nm", `${t.name || ""} · ${short(t.id)}`));
      n2.append(make("div", "", price(t.usdPrice)), make("div", "", `MC ${usd(t.mcap)}`));
      b.append(icon(make("img", "tok-icon"), t.icon), mid, n2);
      b.addEventListener("click", () => { closeResults(); q.value = ""; location.hash = `#/token/${t.id}`; });
      li.append(b); results.append(li);
    }
  } catch (err) { if (seq === searchSeq) { results.textContent = ""; results.append(make("li", "note", errMsg(err))); } }
}

/* ---------- modals: wallet + settings ---------- */
const modal = $("modal");
function openModal(title, build) { text($("m-title"), title); const body = $("m-body"); body.textContent = ""; build(body); if (!modal.open) modal.showModal(); }
$("m-close").addEventListener("click", () => modal.close());
modal.addEventListener("click", e => { if (e.target === modal) modal.close(); });

function openWalletModal() {
  openModal("Wallet", body => {
    if (!S.wallet) {
      const list = providers();
      const box = make("div", "box");
      if (!list.length) {
        box.append(make("p", "", "No Solana wallet found in this browser."));
        [["Phantom", "https://phantom.com/download"], ["Solflare", "https://solflare.com/download"], ["Backpack", "https://backpack.app/downloads"]].forEach(([n, u]) => box.append(link(u, `Get ${n} ↗`, "btn small")));
      } else list.forEach(w => { const b = make("button", "btn primary", `Connect ${w.name}`); b.type = "button"; b.addEventListener("click", async () => { try { await connect(w); openWalletModal(); } catch (e) { toast(errMsg(e), "err"); } }); box.append(b); });
      body.append(box);
      return;
    }
    // main
    const main = make("div", "box"), r1 = make("div", "row");
    r1.append(make("b", "", `${S.wallet.name} · ${short(S.wallet.pk)}`), make("span", "", `${S.sol != null ? fromRaw(S.sol, 9, 4) : "…"} SOL`));
    const r2 = make("div", "row"), copy = make("button", "btn small", "Copy address"), out = make("button", "btn small", "Disconnect"); copy.type = out.type = "button";
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(S.wallet.pk); toast("Address copied.", "ok"); } catch (_) {} });
    out.addEventListener("click", async () => { await disconnect(); modal.close(); });
    r2.append(copy, out);
    main.append(make("h3", "", "Main wallet"), r1, r2);
    // trade from
    const from = make("div", "box"), seg = make("div", "seg");
    for (const [w, label] of [["main", "Main · approve each trade"], ["instant", "⚡ Instant · no popups"]]) {
      const b = make("button", "", label); b.type = "button"; b.setAttribute("aria-pressed", settings.from === w);
      b.addEventListener("click", async () => { try { if (w === "instant") await instantWallet(); settings.from = w; saveSettings(); renderWalletBtn(); if (S.route === "token") { refreshTokenBal(); renderTradePanel(); } openWalletModal(); } catch (e) { toast(errMsg(e), "err"); } });
      seg.append(b);
    }
    from.append(make("h3", "", "Trade from"), seg, make("p", "", "⚡ buttons, presets and the trade panel use this wallet."));
    // instant
    const inst = make("div", "box");
    inst.append(make("h3", "", "⚡ Instant wallet"));
    if (!S.instant) {
      inst.append(make("p", "", "A trading wallet derived from one signature of your main wallet. Trades sign in this tab with no popups, like Axiom. Rebuild it on any device by signing again. Keep only what you're actively trading in it."));
      const u = make("button", "btn primary", "Unlock instant wallet"); u.type = "button";
      u.addEventListener("click", async () => { try { await instantWallet(); openWalletModal(); } catch (e) { toast(errMsg(e), "err"); } });
      inst.append(u);
    } else {
      const r = make("div", "row"); r.append(make("span", "", short(S.instant.pk)), make("b", "", `${S.instantSol != null ? fromRaw(S.instantSol, 9, 4) : "…"} SOL`)); inst.append(r);
      const dep = make("div", "row"), amtIn = make("input", "inp"); amtIn.placeholder = "SOL amount"; amtIn.inputMode = "decimal"; amtIn.setAttribute("aria-label", "Deposit amount in SOL");
      const dDirect = make("button", "btn small", "Deposit"), dPrivate = make("button", "btn small primary", "Deposit privately (NEAR)"); dDirect.type = dPrivate.type = "button";
      dep.append(amtIn, dDirect, dPrivate); inst.append(dep);
      const wd = make("div", "row"), wDirect = make("button", "btn small", "Withdraw all"), wPrivate = make("button", "btn small", "Withdraw privately (NEAR)"), key = make("button", "btn small", "Export key");
      wDirect.type = wPrivate.type = key.type = "button";
      wd.append(wDirect, wPrivate, key); inst.append(wd);
      const st = make("p", "", "A direct deposit links the two wallets on-chain. A private deposit goes through NEAR Intents, so it doesn't.");
      inst.append(st);
      const busy = async (fn, btn) => { if (S.busy) return; S.busy = true; btn.disabled = true; try { await fn(m => text(st, m)); } catch (e) { text(st, errMsg(e)); toast(errMsg(e), "err"); } finally { S.busy = false; btn.disabled = false; await refreshBalances(); } };
      const amount = () => { const r2 = toRaw(amtIn.value, 9); if (!r2) throw new SwapError("Enter an amount to deposit."); return r2; };
      dDirect.addEventListener("click", () => busy(async say => {
        const a = amount(); say("Approve the deposit in your wallet…");
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const sig = await signSend(fundingTx(web3, { from: S.wallet.pk, depositAddress: S.instant.pk, amount: a, blockhash }), { local: null }, lastValidBlockHeight);
        say("Deposited."); toast(`Deposited ${fromRaw(a, 9, 4)} SOL to your instant wallet.`, "ok", sig);
      }, dDirect));
      dPrivate.addEventListener("click", () => busy(async say => {
        const a = amount(); say("Getting a private route from NEAR Intents…");
        const { quote, confidential } = await routeQuote({ oc, asset: await routeAsset(), amount: a, from: S.wallet.pk, to: S.instant.pk, confidentiality: GHOST_CONFIDENTIALITY });
        say("Approve the deposit in your wallet…");
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const sig = await signSend(fundingTx(web3, { from: S.wallet.pk, depositAddress: quote.depositAddress, amount: a, blockhash }), { local: null }, lastValidBlockHeight);
        oc.submitDeposit(sig, quote.depositAddress).catch(() => {});
        await waitForRoute(oc, quote.depositAddress, { onStatus: s => say(`NEAR Intents: ${ROUTE_LABEL[s] || s.toLowerCase()}${confidential ? " (confidential)" : ""}…`) });
        say("Delivered."); toast(`≈${fromRaw(BigInt(quote.amountOut), 9, 4)} SOL arrived in your instant wallet privately.`, "ok", sig);
      }, dPrivate));
      const withdraw = (priv, btn) => busy(async say => {
        const bal = BigInt(await connection.getBalance(S.instant.kp.publicKey)), a = exitAmount(bal);
        if (a <= 0n) throw new SwapError("Nothing to withdraw.");
        let to = S.wallet.pk, route = null;
        if (priv) { say("Getting a private route home…"); route = await routeQuote({ oc, asset: await routeAsset(), amount: a, from: S.instant.pk, to: S.wallet.pk, confidentiality: GHOST_CONFIDENTIALITY }); to = route.quote.depositAddress; }
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const sig = await sendAndConfirm(connection, exitTx(web3, { ghost: S.instant.kp, depositAddress: to, amount: a, blockhash }), lastValidBlockHeight);
        if (route) { oc.submitDeposit(sig, to).catch(() => {}); await waitForRoute(oc, to, { onStatus: s => say(`NEAR Intents: ${ROUTE_LABEL[s] || s.toLowerCase()}…`) }); }
        say("Withdrawn."); toast(`Withdrew ${fromRaw(a, 9, 4)} SOL to your main wallet${priv ? " privately" : ""}. Tokens stay in the instant wallet.`, "ok", sig);
      }, btn);
      wDirect.addEventListener("click", () => withdraw(false, wDirect));
      wPrivate.addEventListener("click", () => withdraw(true, wPrivate));
      key.addEventListener("click", () => { const old = inst.querySelector(".keybox"); if (old) return old.remove(); inst.append(make("div", "keybox", `Instant wallet secret key (import into Phantom or Solflare): ${base58Encode(S.instant.kp.secretKey)}`)); });
    }
    body.append(main, from, inst);
  });
}
$("walletbtn").addEventListener("click", openWalletModal);

$("settingsbtn").addEventListener("click", () => openModal("Settings", body => {
  const field = (label, value, attrs = {}) => { const l = make("label", "", label), i = make("input", "inp"); i.value = value; Object.assign(i, attrs); l.append(i); return [l, i]; };
  const qb = make("div", "box"); qb.append(make("h3", "", "Quick amounts"));
  const g1 = make("div", "grid"), buyIns = settings.buyAmounts.map((v, i) => { const [l, inp] = field(`Buy ${i + 1} (SOL)`, v, { inputMode: "decimal" }); g1.append(l); return inp; }); qb.append(g1);
  const g2 = make("div", "grid"), sellIns = settings.sellPcts.map((v, i) => { const [l, inp] = field(`Sell ${i + 1} (%)`, v, { inputMode: "numeric" }); g2.append(l); return inp; }); qb.append(g2);
  const pr = make("div", "box"); pr.append(make("h3", "", "Presets"), make("p", "", "Slippage, priority level and the most you'll pay for priority. P1–P3 switch in the trade panel or with keys 1–3."));
  const presetIns = settings.presets.map((p, i) => {
    const g = make("div", "grid");
    const [l1, s] = field(`P${i + 1} slippage %`, p.slippageBps / 100, { inputMode: "decimal" });
    const l2 = make("label", "", `P${i + 1} priority`), sel = make("select", "inp"); ["medium", "high", "veryHigh"].forEach(v => { const o = make("option", "", v === "veryHigh" ? "turbo" : v); o.value = v; o.selected = p.priority === v; sel.append(o); }); l2.append(sel);
    const [l3, m] = field(`P${i + 1} max priority SOL`, p.maxSol, { inputMode: "decimal" });
    g.append(l1, l2, l3); pr.append(g);
    return { s, sel, m };
  });
  const pulse = make("div", "box"); pulse.append(make("h3", "", "Pulse"));
  const [lfs, fs] = field("Final Stretch starts at bonding curve %", settings.finalStretch, { inputMode: "numeric" }); pulse.append(lfs);
  const net = make("div", "box"); net.append(make("h3", "", "Network"), make("p", "", "The public Solana RPC is rate limited. A Helius, Triton or QuickNode URL makes Pulse, trades and the tracker much faster. Reloads the page."));
  const [lrpc, rpcIn] = field("RPC URL", rpcUrl, { spellcheck: false }); net.append(lrpc);
  const save = make("button", "btn primary", "Save"); save.type = "button";
  save.addEventListener("click", () => {
    buyIns.forEach((inp, i) => { if (toRaw(inp.value, 9)) settings.buyAmounts[i] = inp.value.trim(); });
    sellIns.forEach((inp, i) => { const v = Math.round(Number(inp.value)); if (v > 0 && v <= 100) settings.sellPcts[i] = v; });
    presetIns.forEach((p, i) => { const s = Number(p.s.value), m = Number(p.m.value); settings.presets[i] = { slippageBps: Math.round(Math.min(50, Math.max(0.1, s || 3)) * 100), priority: p.sel.value, maxSol: Math.min(0.1, Math.max(0, m || 0.001)) }; });
    const f = Number(fs.value); if (f >= 10 && f <= 99) settings.finalStretch = f;
    saveSettings();
    const newRpc = rpcIn.value.trim();
    if (newRpc !== rpcUrl && /^https?:\/\/\S+$/.test(newRpc)) { store.set("ghostprint-rpc-url", newRpc); location.reload(); return; }
    modal.close(); pulseDirty = true; renderPulse(true); if (S.route === "token") renderTradePanel();
    toast("Settings saved.", "ok");
  });
  body.append(qb, pr, pulse, net, save);
}));

/* ---------- quick-buy amount + hotkeys ---------- */
$("qbamt").value = settings.quickBuy;
$("qbamt").addEventListener("input", () => {
  const v = $("qbamt").value.replace(/,/g, ".").replace(/[^\d.]/g, ""); $("qbamt").value = v;
  if (toRaw(v, 9)) { settings.quickBuy = v; saveSettings(); document.querySelectorAll(".qb").forEach(b => text(b, `⚡ ${v}`)); }
});
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || modal.open;
  if (e.key === "/" && !typing) { e.preventDefault(); q.focus(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (S.route === "token") {
    if (e.key === "b") { $("side-buy").click(); amt.focus(); e.preventDefault(); }
    else if (e.key === "s") { $("side-sell").click(); amt.focus(); e.preventDefault(); }
    else if (["1", "2", "3"].includes(e.key)) { settings.preset = Number(e.key) - 1; saveSettings(); renderTradePanel(); }
  }
  if (e.key === "p") location.hash = "#/";
});

/* ---------- boot ---------- */
refreshSolPrice(); setInterval(refreshSolPrice, 60000);
renderWatchbar(); refreshWatch(); setInterval(refreshWatch, 30000);
seedPulse(); setTimeout(curveLoop, 1500);
setInterval(() => renderPulse(), 1000);
setInterval(() => { if (S.route === "token") renderTrades(); }, 5000);
if (tracked().length) startTracker();
route();
// reconnect silently if a wallet already trusts this site
for (const w of providers()) { if (w.p.isConnected || w.p.publicKey) { w.p.connect?.({ onlyIfTrusted: true }).then(() => connect(w)).catch(() => {}); break; } }
window.__gp = { board, settings, S, T }; // handy for debugging from the console
