// Landing page: the code-drawn art (art.js) and the read-only Exposure tracer.
import { trace, isAddress, short, DEFAULT_RPC } from "./trace.js";
import { C, REDUCE, renderPixels, renderIcons, machine } from "./art.js";
import { ghostRoute } from "./diagrams.js";

renderPixels(document);
renderIcons(document);
machine(document.getElementById("machine"));
const route = document.getElementById("ghost-route");
if (route) { ghostRoute(route); const a = route.parentElement; if (a.scrollWidth > a.clientWidth) a.scrollLeft = (a.scrollWidth - a.clientWidth) / 2; }

/* ---------- Exposure tracer ---------- */
const INK3 = C.INK3, PAPER = C.PAPER, ACCENT = C.ACCENT, MUTE_INK = C.MUTE;
const idle = () => ({ graph: { nodes: [{ id: "you", kind: "you", label: "YOU" }], edges: [] } });
const $ = id => document.getElementById(id);

const cv = $("tr-canvas"), ctx = cv.getContext("2d");
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const ACC = rgb(ACCENT), PAP = rgb(PAPER), MUT = rgb(MUTE_INK);
const mix = (from, h) => `rgb(${from.map((c, i) => Math.round(c + (ACC[i] - c)*h)).join(",")})`;
const COL = { paper: PAPER, acc: ACCENT, mute: MUTE_INK };
const G = { W: 0, H: 0, dots: [], grid: [], edges: [], labels: [], you: { x: 0, y: 0 }, phase: "done", result: idle(), start: 0, frac: 0, shown: 0 };
const RAD = { you: 24, exchange: 16, funder: 14, linked: 10, deposit: 8 };
const RING = { funder: 0, siblings: 1, exchange: 2, linked: 3 };

function disc(cx, cy, R, col, out) {
  const p = 4.2, rows = Math.ceil(R/(p*.866));
  for (let row = -rows; row <= rows; row++) {
    const y = row*p*.866;
    for (let x = -R + (row & 1 ? p/2 : 0); x <= R; x += p) {
      const d = Math.hypot(x, y);
      if (d <= R) out.push({ tx: cx + x, ty: cy + y, tr: 1.7*(1 - .5*(d/R)**2), col });
    }
  }
}

function layout() {
  const { W, H } = G;
  if (!W) return;
  const s = Math.min(1, W/460), you = G.you = { x: Math.max(44, W*.2), y: H*.48 };
  G.grid = [];
  for (let row = 0, y = 6; y < H; y += 8, row++) for (let x = row % 2 ? 6 : 10; x < W; x += 8) G.grid.push({ x, y, d: Math.hypot(x - you.x, y - you.y) });
  const g = G.result.graph, pos = new Map(), rad = new Map(), targets = [], labels = [];
  const me = g.nodes.find(n => n.kind === "you");
  pos.set(me.id, you); rad.set(me.id, RAD.you*s);
  const ring = g.nodes.filter(n => n.kind in RING).sort((a, b) => RING[a.kind] - RING[b.kind]);
  const rx = W - you.x - 52*s, ry = H*.38;
  ring.forEach((n, i) => {
    const a = ring.length === 1 ? 0 : -1 + 2*i/(ring.length - 1);
    pos.set(n.id, { x: you.x + Math.cos(a)*rx, y: you.y + Math.sin(a)*ry });
    rad.set(n.id, (n.kind === "linked" ? RAD.linked + Math.min(4, Math.max(0, (n.weight || 3) - 3)) : RAD[n.kind] || 13)*s);
  });
  // a deposit address sits on the way to the exchange it sweeps into
  for (const n of g.nodes.filter(n => n.kind === "deposit")) {
    const e = g.edges.find(e => e.a === n.id && pos.has(e.b)), to = e ? pos.get(e.b) : { x: you.x + rx*.6, y: you.y };
    pos.set(n.id, { x: you.x + (to.x - you.x)*.5, y: you.y + (to.y - you.y)*.5 - 16*s });
    rad.set(n.id, RAD.deposit*s);
  }
  for (const n of g.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const col = n.kind === "exchange" ? "acc" : n.kind === "deposit" || n.kind === "siblings" ? "mute" : "paper";
    if (n.kind === "siblings") {
      const k = Math.min(7, n.weight || 3), rr = Math.max(11, 13*s);
      for (let i = 0; i < k; i++) { const a = i/k*6.283 - 1.57; disc(p.x + Math.cos(a)*rr, p.y + Math.sin(a)*rr*.8, Math.max(5, 5.5*s), col, targets); }
      rad.set(n.id, rr + 6);
    } else disc(p.x, p.y, rad.get(n.id), col, targets);
    labels.push({ x: p.x, y: n.kind === "deposit" ? p.y - rad.get(n.id) - 6 : p.y + rad.get(n.id) + 12, text: n.label, acc: n.kind === "exchange" });
  }
  G.labels = labels;
  G.edges = [];
  for (const e of g.edges) {
    const A = pos.get(e.a), B = pos.get(e.b);
    if (!A || !B) continue;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), ra = rad.get(e.a) + 5, rb = rad.get(e.b) + 5, pts = [];
    for (let d = ra; d <= L - rb; d += 6) pts.push({ x: A.x + dx*d/L, y: A.y + dy*d/L, f: (d - ra)/Math.max(1, L - ra - rb) });
    G.edges.push({ pts, ph: (G.edges.length*.37) % 1 });
  }
  targets.forEach((t, i) => {
    let d = G.dots[i];
    if (!d) { d = { x: you.x, y: you.y, vx: 0, vy: 0, r: 0, heat: 1 }; G.dots.push(d); }
    Object.assign(d, t, { out: false });
  });
  for (let i = targets.length; i < G.dots.length; i++) { G.dots[i].out = true; G.dots[i].tr = 0; }
  if (REDUCE) for (const d of G.dots) { d.x = d.tx; d.y = d.ty; d.r = d.tr; d.heat = 0; }
}

let running = false, visible = true;
function frame(now) {
  running = false;
  if (!visible || document.hidden) return;
  const { W, H } = G, t = now/1000, tracing = G.phase === "tracing";
  ctx.clearRect(0, 0, W, H);
  // background lattice; while tracing, a radar ring sweeps out from the wallet
  const ring = tracing && !REDUCE ? ((now - G.start)/1600 % 1)*Math.hypot(W, H) : -99;
  const hotGrid = [];
  // the lattice is a halftone too: dots swell in a slow ripple running out from the wallet
  ctx.fillStyle = INK3; ctx.beginPath();
  for (const p of G.grid) {
    if (Math.abs(p.d - ring) < 12) { hotGrid.push(p); continue; }
    const r = REDUCE ? .8 : .8 + .38 * Math.sin(t * 1.5 - p.d / 22);
    ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, 6.283);
  }
  ctx.fill();
  if (hotGrid.length) { ctx.fillStyle = ACCENT; ctx.beginPath(); for (const p of hotGrid) { ctx.moveTo(p.x + 1.2, p.y); ctx.arc(p.x, p.y, 1.2, 0, 6.283); } ctx.fill(); }
  // edges carry a pulse in the direction funds moved
  for (const e of G.edges) {
    const at = REDUCE ? -9 : (t*.4 + e.ph) % 1;
    for (const p of e.pts) {
      const h = Math.max(0, 1 - Math.abs(p.f - at)*6);
      ctx.fillStyle = h ? mix(MUT, h) : MUTE_INK;
      ctx.beginPath(); ctx.arc(p.x, p.y, .9 + h*.9, 0, 6.283); ctx.fill();
    }
  }
  // node particles: settled ones batched by colour, hot ones one by one
  const batches = { paper: [], acc: [], mute: [] }, hot = [];
  let removed = false;
  for (const d of G.dots) {
    if (!REDUCE) { d.vx = (d.vx + (d.tx - d.x)*.07)*.8; d.vy = (d.vy + (d.ty - d.y)*.07)*.8; d.x += d.vx; d.y += d.vy; d.r += (d.tr - d.r)*.12; }
    if (d.heat > 0) d.heat = Math.max(0, d.heat - (REDUCE ? 1 : .02));
    if (d.out && d.r < .1) { removed = true; continue; }
    if (d.r < .15) continue;
    (d.heat > .03 ? hot : batches[d.col]).push(d);
  }
  for (const k in batches) {
    if (!batches[k].length) continue;
    ctx.fillStyle = COL[k]; ctx.beginPath();
    for (const d of batches[k]) { ctx.moveTo(d.x + d.r, d.y); ctx.arc(d.x, d.y, d.r, 0, 6.283); }
    ctx.fill();
  }
  for (const d of hot) { ctx.fillStyle = mix(d.col === "mute" ? MUT : PAP, d.heat); ctx.beginPath(); ctx.arc(d.x, d.y, d.r*(1 + d.heat*.3), 0, 6.283); ctx.fill(); }
  if (removed) G.dots = G.dots.filter(d => !(d.out && d.r < .1));
  // labels
  ctx.font = "500 9px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
  if (!tracing) for (const l of G.labels) {
    const w = ctx.measureText(l.text).width/2 + 4;
    ctx.fillStyle = l.acc ? ACCENT : MUTE_INK;
    ctx.fillText(l.text, Math.min(W - w, Math.max(w, l.x)), Math.min(H - 4, l.y));
  }
  // readout
  ctx.textAlign = "left"; ctx.fillStyle = MUTE_INK; ctx.font = "500 9px 'JetBrains Mono', monospace";
  ctx.fillText(tracing ? "TRACING" : "EXPOSURE", 12, 18);
  ctx.font = "700 24px 'JetBrains Mono', monospace";
  if (tracing) { ctx.fillStyle = PAPER; ctx.fillText(`${Math.round(G.frac*100)}%`, 12, 44); }
  else if (G.result.score !== undefined) {
    G.shown += (G.result.score - G.shown)*(REDUCE ? 1 : .08);
    if (Math.abs(G.result.score - G.shown) < .5) G.shown = G.result.score;
    ctx.fillStyle = G.result.score >= 50 ? ACCENT : PAPER;
    ctx.fillText(String(Math.round(G.shown)), 12, 44);
    ctx.font = "500 9px 'JetBrains Mono', monospace"; ctx.fillStyle = MUTE_INK;
    ctx.fillText(`/100 ${G.result.grade.toUpperCase()}`, 12, 58);
  } else { ctx.fillStyle = INK3; ctx.fillText("--", 12, 44); }
  kick();
}
function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }
function resize() {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  G.W = r.width; G.H = r.height; cv.width = Math.round(r.width*dpr); cv.height = Math.round(r.height*dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout(); kick();
}
new ResizeObserver(resize).observe(cv);
new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(cv);
document.addEventListener("visibilitychange", kick);

/* ---------- UI state ---------- */
const form = $("tr-form"), addrIn = $("tr-addr"), go = $("tr-go"), chip = $("tr-chip"), list = $("tr-fields"), meta = $("tr-meta");
const copyBtn = $("tr-copy"), rpcIn = $("tr-rpc");
const pad = n => String(n).padStart(2, "0");

function setChip(text, cls) { chip.textContent = text; chip.className = "chip " + cls; }
function setMeta(parts) { meta.textContent = ""; parts.forEach(p => { if (typeof p === "string") meta.append(p); else { const b = document.createElement("b"); b.textContent = p.b; meta.append(b); } }); }
function note(text) { list.textContent = ""; const li = document.createElement("li"); li.className = "empty"; li.textContent = text; list.appendChild(li); }

function renderFindings(fs) {
  list.textContent = "";
  for (const f of fs) {
    const li = document.createElement("li");
    li.className = "sev-" + f.sev;
    for (const [c, t] of [["k", f.k], ["v", f.v], ["g", f.sev === "warn" ? "Warning" : f.g], ["why", f.why]]) {
      const s = document.createElement("span"); s.className = c; s.textContent = t; li.appendChild(s);
    }
    list.appendChild(li);
  }
}

function renderHours(h, name) {
  const host = $("hours"), max = Math.max(1, ...h.histogram);
  host.textContent = "";
  h.histogram.forEach((n, i) => {
    const col = document.createElement("div"), bw = document.createElement("div"), bar = document.createElement("div"), lab = document.createElement("div");
    col.className = "col" + (h.zone && (i - h.quietStart + 24) % 24 < 7 ? " q" : "");
    col.title = `${pad(i)}:00 UTC · ${n} signed`;
    bw.className = "bw"; bar.className = "bar"; bar.style.height = `${(n/max*100).toFixed(1)}%`;
    lab.className = "h"; lab.textContent = i % 3 ? "" : pad(i);
    bw.appendChild(bar); col.append(bw, lab); host.appendChild(col);
  });
  $("hr-name").textContent = name;
  $("hr-zone").textContent = h.zone ? `Quiet ${pad(h.quietStart)}:00–${pad((h.quietStart + 7) % 24)}:00 UTC → ${h.zone}` : "Not enough signed transactions to place a time zone";
}

function show(res) {
  G.result = res; G.phase = "done"; G.shown = 0;
  for (const d of G.dots) d.heat = .9;
  layout(); kick();
  renderFindings(res.findings);
  renderHours(res.hours, short(res.address));
  setChip(`${res.grade} · ${res.score}`, res.score >= 50 ? "leak" : res.score >= 25 ? "busy" : "clean");
  setMeta([{ b: short(res.address) }, ` · read ${res.scanned} of ${res.signatureCount}${res.reachedStart ? "" : "+"} transactions${res.reachedStart ? ", back to its first" : ". Its first transactions are older than this window"}.`]);
  copyBtn.disabled = false;
}
// Nothing traced yet: a lone wallet on the lattice, an empty hours strip.
function ready() {
  G.result = idle(); G.phase = "done";
  layout(); kick();
  note("Findings appear here: funding source, exchange links, linked wallets, signing hours, poisoning attempts.");
  renderHours({ histogram: Array(24).fill(0) }, "the wallet you trace");
  $("hr-zone").textContent = "";
  setChip("Ready", "busy");
  setMeta(["Paste any address. Your browser reads the chain directly; nothing is sent to Ghostprint."]);
  copyBtn.disabled = true;
}

const RPC_KEY = "ghostprint-rpc";
try { rpcIn.value = localStorage.getItem(RPC_KEY) || DEFAULT_RPC; } catch (_) { rpcIn.value = DEFAULT_RPC; }
rpcIn.addEventListener("change", () => { try { localStorage.setItem(RPC_KEY, rpcIn.value.trim()); } catch (_) {} });
const rpcUrl = () => /^https?:\/\/\S+$/.test(rpcIn.value.trim()) ? rpcIn.value.trim() : DEFAULT_RPC;

function progress(p) {
  if (p.step === "history") { G.frac = .05; setMeta(["Reading the wallet's history…"]); }
  else if (p.step === "transactions") { G.frac = .1 + .7*p.done/Math.max(1, p.total); setMeta([`Reading transactions ${p.done}/${p.total}`]); }
  else if (p.step === "neighbours") { G.frac = .8 + .2*p.done/Math.max(1, p.total); setMeta([`Checking neighbouring wallets ${p.done}/${p.total}`]); }
}

let busy = false;
form.addEventListener("submit", async e => {
  e.preventDefault();
  if (busy) return;
  const a = addrIn.value.trim();
  if (!isAddress(a)) {
    setChip("Not an address", "busy");
    setMeta(["Paste a Solana wallet address: 32 to 44 letters and numbers, like ", { b: "5tzF…uAi9" }, "."]);
    addrIn.focus();
    return;
  }
  busy = true; go.disabled = copyBtn.disabled = true;
  G.result = { address: a, graph: { nodes: [{ id: a, kind: "you", label: "YOU" }], edges: [] } };
  G.phase = "tracing"; G.start = performance.now(); G.frac = 0;
  layout(); kick();
  note("Reading public history…");
  setChip("Tracing…", "busy");
  try {
    show(await trace(a, { url: rpcUrl(), onProgress: progress }));
  } catch (err) {
    G.phase = "done";
    setChip("Can't read", "busy");
    setMeta([err && err.message ? err.message : "Something went wrong reading the chain."]);
    note("No result. Check the address and the RPC node, then try again.");
  } finally { busy = false; go.disabled = false; }
});

// Shareable summary. Addresses are masked so a copied result doesn't link wallets for anyone.
copyBtn.addEventListener("click", async () => {
  const r = G.result;
  if (!r || !r.findings) return;
  const mask = s => s.replace(/[1-9A-HJ-NP-Za-km-z]{4,8}…[1-9A-HJ-NP-Za-km-z]{4}/g, "••••");
  const text = [`My Solana wallet exposure on Ghostprint: ${r.score}/100 (${r.grade})`, ...r.findings.map(f => `· ${f.k}: ${mask(f.v)}`), location.href.split("#")[0]].join("\n");
  try { await navigator.clipboard.writeText(text); setMeta(["Copied. Wallet addresses are masked."]); }
  catch (_) { setMeta(["Couldn't reach the clipboard in this view."]); }
});

/* ---------- boot ---------- */
ready();
