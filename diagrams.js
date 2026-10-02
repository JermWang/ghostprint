// The explanatory drawings used on the landing page and in the docs. Each one draws into an empty
// <svg> already in the page and sizes its viewBox to fit. Built from art.js: boxes, cables, packets.
import { flow, txStack, curveTank, fit } from "./art.js";

// A node placed by its centre, so cables line up without arithmetic in the specs below.
const N = (id, cx, cy, o = {}) => { const w = o.w || 60, d = o.d || 60; return { id, x: cx - w / 2, y: cy - d / 2, w, d, h: 40, ...o }; };

// Main wallet → 1Click deposit → NEAR Intents → ghost wallet → Jupiter, with the fee split off at the start.
export function ghostRoute(svg, narrow = false) {
  // on a phone the chain zigzags down the screen instead of running across it
  const at = narrow ? { main: [0, 0], fee: [0, -120], dep: [170, 0], near: [170, 180], ghost: [360, 180], jup: [360, 350] }
    : { main: [0, 0], fee: [0, 120], dep: [150, 0], near: [150, -160], ghost: [350, -160], jup: [350, -310] };
  flow(svg, {
    ox: 0, oy: 0, chips: narrow ? 15 : 0,
    nodes: [
      N("main", ...at.main, { label: "MAIN", sub: "your wallet", glyph: "key", h: 44 }),
      N("fee", ...at.fee, { w: 46, d: 46, h: 26, label: "FEE", sub: "0.5%" }),
      N("dep", ...at.dep, { label: "DEPOSIT", sub: "one-time", w: 56, d: 56, h: 32 }),
      N("near", ...at.near, { label: "NEAR INTENTS", sub: "confidential", w: 84, d: 84, h: 56, tone: "ink", glyph: "lock" }),
      N("ghost", ...at.ghost, { label: "GHOST", sub: "fresh wallet", tone: "accent", glyph: "ghost", h: 46 }),
      N("jup", ...at.jup, { label: "JUPITER", sub: "swap", glyph: "route", h: 36 })
    ],
    links: [{ from: "main", to: "dep" }, { from: "main", to: "fee" }, { from: "dep", to: "near" }, { from: "near", to: "ghost" }, { from: "ghost", to: "jup" }],
    sequence: [[0, 1], [2], [3], [4]],
    tags: narrow ? [{ at: [225, 180, 10], text: "BRIDGE PAYS", accent: true }, { at: [82, 0, 14], text: "SOL" }]
      : [{ at: [262, -160, 26], text: "BRIDGE PAYS", accent: true }, { at: [75, 0, 34], text: "SOL" }]
  });
  return fit(svg);
}

// Ghost exit: sell on Jupiter, then back to the main wallet through NEAR Intents.
export function ghostExit(svg, narrow = false) {
  const at = narrow ? { jup: [0, 0], ghost: [170, 0], near: [170, 180], main: [360, 180] }
    : { jup: [0, 0], ghost: [150, 0], near: [150, -160], main: [350, -160] };
  flow(svg, {
    ox: 0, oy: 0, chips: narrow ? 15 : 0,
    nodes: [
      N("jup", ...at.jup, { label: "JUPITER", sub: "sell", glyph: "route", h: 36 }),
      N("ghost", ...at.ghost, { label: "GHOST", sub: "holds SOL", tone: "accent", glyph: "ghost", h: 46 }),
      N("near", ...at.near, { label: "NEAR INTENTS", sub: "confidential", w: 84, d: 84, h: 56, tone: "ink", glyph: "lock" }),
      N("main", ...at.main, { label: "MAIN", sub: "your wallet", glyph: "key", h: 44 })
    ],
    links: [{ from: "jup", to: "ghost" }, { from: "ghost", to: "near" }, { from: "near", to: "main" }],
    tags: [narrow ? { at: [240, 180, 10], text: "NO FEE" } : { at: [262, -160, 26], text: "NO FEE" }]
  });
  return fit(svg);
}

// One signature, many wallets: SHA-256(signature ‖ path) seeds each keypair.
export function walletTree(svg) {
  flow(svg, {
    ox: 0, oy: 0,
    nodes: [
      N("main", 0, 0, { label: "MAIN", sub: "signs once", glyph: "key", h: 44 }),
      N("sig", 150, 0, { label: "SIGNATURE", sub: "never stored", kind: "cyl", w: 64, d: 64, h: 18, tone: "ink" }),
      N("inst", 300, 0, { label: "INSTANT", sub: "instant/0", glyph: "bolt", h: 40 }),
      N("g0", 300, -110, { label: "GHOST 0", sub: "ghost/0", tone: "accent", glyph: "ghost", h: 34 }),
      N("g1", 300, -220, { label: "GHOST 1", sub: "ghost/1", tone: "accent", glyph: "ghost", h: 34 }),
      N("g2", 300, -330, { label: "GHOST 2", sub: "ghost/2", tone: "accent", glyph: "ghost", h: 34 })
    ],
    links: [{ from: "main", to: "sig" }, { from: "sig", to: "inst" }, { from: "sig", to: "g0", bend: "xy" }, { from: "sig", to: "g1" }, { from: "sig", to: "g2" }],
    sequence: [[0], [1, 2, 3, 4]],
    tags: [{ at: [236, 0, 12], text: "SHA-256" }]
  });
  return fit(svg);
}

// Everything the browser talks to. No Ghostprint server sits in the middle unless you deploy the proxy.
export function overview(svg, narrow = false) {
  // on a phone the spokes pull in and the names float above the boxes in bigger type
  const r = narrow ? 150 : 190;
  flow(svg, {
    ox: 0, oy: 0, chips: narrow ? 17 : 0,
    nodes: [
      N("you", 0, 0, { label: "YOUR BROWSER", sub: "keys + signing", w: 92, d: 92, h: 58, tone: "ink", glyph: "ghost" }),
      N("rpc", r, 0, { label: "SOLANA RPC", sub: "chain reads", h: 38 }),
      N("jup", -r, 0, { label: "JUPITER", sub: "routes, prices", glyph: "route", h: 38 }),
      N("near", 0, r, { label: "NEAR 1CLICK", sub: "ghost routes", glyph: "lock", h: 38 }),
      N("pump", 0, -r, { label: "PUMPPORTAL", sub: "new launches", glyph: "flame", h: 38 }),
      N("jito", r, -r, { label: "JITO", sub: "block engine", glyph: "shield", h: 34 }),
      N("dex", -r, r, { label: "DEXSCREENER", sub: "charts", glyph: "chart", h: 34 })
    ],
    links: [{ from: "you", to: "rpc" }, { from: "you", to: "jup" }, { from: "you", to: "near", bend: "yx" }, { from: "you", to: "pump", bend: "yx" }, { from: "you", to: "jito" }, { from: "you", to: "dex", bend: "yx" }],
    sequence: [[0, 3], [1, 4], [2, 5]]
  });
  return fit(svg);
}

// The optional proxy: the browser calls one Worker, which adds the keys and forwards.
export function proxy(svg) {
  flow(svg, {
    ox: 0, oy: 0,
    nodes: [
      N("you", 0, 0, { label: "BROWSER", sub: "no keys", glyph: "ghost", h: 40 }),
      N("worker", 160, 0, { label: "WORKER", sub: "holds the keys", w: 76, d: 76, h: 52, tone: "ink", glyph: "key" }),
      N("rpc", 320, 0, { label: "RPC", h: 32, w: 52, d: 52 }),
      N("jup", 320, -95, { label: "JUPITER", h: 32, w: 52, d: 52 }),
      N("near", 320, -190, { label: "1CLICK", h: 32, w: 52, d: 52 }),
      N("x", 320, -285, { label: "X POSTS", h: 32, w: 52, d: 52 })
    ],
    links: [{ from: "you", to: "worker" }, { from: "worker", to: "rpc" }, { from: "worker", to: "jup" }, { from: "worker", to: "near" }, { from: "worker", to: "x" }],
    sequence: [[0], [1, 2, 3, 4]],
    tags: [{ at: [240, 0, 30], text: "+ API KEY", accent: true }]
  });
  return fit(svg);
}

// Where Pulse gets its tokens.
export function pulseSources(svg) {
  flow(svg, {
    ox: 0, oy: 0,
    nodes: [
      N("pump", 0, 0, { label: "PUMPPORTAL", sub: "launches, live", glyph: "flame", h: 36 }),
      N("rpc", 0, -95, { label: "RPC", sub: "curve %", glyph: "stack", h: 36 }),
      N("jup", 0, -190, { label: "JUPITER", sub: "token lists", glyph: "route", h: 36 }),
      N("board", 190, -95, { label: "PULSE", sub: "3 columns", w: 88, d: 88, h: 54, tone: "ink", glyph: "chart" })
    ],
    links: [{ from: "pump", to: "board", bend: "yx", pts: [[0, 0, 5], [95, 0, 5], [95, -95, 5], [190, -95, 5]] }, { from: "rpc", to: "board" }, { from: "jup", to: "board", pts: [[0, -190, 5], [95, -190, 5], [95, -95, 5], [190, -95, 5]] }],
    sequence: [[0], [1], [2]]
  });
  return fit(svg);
}

// A limit order lives with Jupiter's keepers, so it fills with the tab closed.
export function limitOrder(svg) {
  flow(svg, {
    ox: 0, oy: 0,
    nodes: [
      N("you", 0, 0, { label: "YOU", sub: "sign once", glyph: "key", h: 40 }),
      N("vault", 160, 0, { label: "TRIGGER", sub: "Jupiter keepers", w: 80, d: 80, h: 54, tone: "ink", glyph: "target" }),
      N("pool", 320, 0, { label: "MARKET", sub: "fills at price", glyph: "chart", h: 36 }),
      N("back", 320, -150, { label: "YOUR WALLET", sub: "receives", glyph: "key", h: 40, w: 70, d: 70 })
    ],
    links: [{ from: "you", to: "vault" }, { from: "vault", to: "pool" }, { from: "pool", to: "back" }],
    tags: [{ at: [80, 0, 34], text: "ESCROWED" }]
  });
  return fit(svg);
}

// Autopilot: this tab watches the price and sells from the instant wallet.
export function autopilot(svg) {
  flow(svg, {
    ox: 0, oy: 0,
    nodes: [
      N("price", 0, 0, { label: "PRICE", sub: "every 4 s", glyph: "chart", h: 36 }),
      N("tab", 150, 0, { label: "THIS TAB", sub: "TP · SL · trail", w: 76, d: 76, h: 50, tone: "ink", glyph: "target" }),
      N("inst", 150, -150, { label: "INSTANT", sub: "signs, no popup", glyph: "bolt", tone: "accent", h: 42 }),
      N("jup", 300, -150, { label: "JUPITER", sub: "sell", glyph: "route", h: 36 })
    ],
    links: [{ from: "price", to: "tab" }, { from: "tab", to: "inst" }, { from: "inst", to: "jup" }]
  });
  return fit(svg);
}

// What one terminal buy puts in its transaction, bottom to top.
export function tradeTx(svg) {
  txStack(svg, {
    ox: 0, oy: 0, w: 220, d: 110, h: 14, gap: 5,
    layers: [
      { label: "COMPUTE BUDGET", note: "limit + priority" },
      { label: "TOKEN ACCOUNT", note: "opened if needed" },
      { label: "GHOSTPRINT FEE", note: "0.5% → treasury", accent: true },
      { label: "JUPITER SWAP", note: "best route", ink: true },
      { label: "CLEANUP", note: "unwrap SOL" },
      { label: "JITO TIP", note: "if preset sets one", ink: true }
    ]
  });
  return fit(svg, { top: 60 });
}

export function bondingCurve(svg) {
  curveTank(svg, { ox: 0, oy: 0 });
  return fit(svg, { top: 10 });
}

export const DIAGRAMS = { ghostRoute, ghostExit, walletTree, overview, proxy, pulseSources, limitOrder, autopilot, tradeTx, bondingCurve };

// Diagrams with a phone layout, and the width below which their drawing area switches to it.
const NARROW = new Set(["ghostRoute", "ghostExit", "overview"]), NARROW_PX = 560;
const isNarrow = svg => NARROW.has(svg.dataset.diagram) && (svg.parentElement?.clientWidth || Infinity) < NARROW_PX;
function draw(svg) {
  const narrow = isNarrow(svg);
  svg.toggleAttribute("data-narrow", narrow);
  DIAGRAMS[svg.dataset.diagram](svg, narrow);
}

// Draw every <svg data-diagram="name"> in root, and redraw the ones with a phone layout when their
// width crosses over. A redraw swaps in a fresh <svg> so the old drawing's animation stops with it.
export function renderDiagrams(root = document) {
  const live = [...root.querySelectorAll("svg[data-diagram]")].filter(svg => DIAGRAMS[svg.dataset.diagram] && !svg.childNodes.length);
  live.forEach(draw);
  const flip = live.filter(svg => NARROW.has(svg.dataset.diagram));
  if (!flip.length || typeof ResizeObserver !== "function") return;
  const ro = new ResizeObserver(() => flip.forEach((svg, i) => {
    if (isNarrow(svg) === svg.hasAttribute("data-narrow")) return;
    const fresh = svg.cloneNode(false);
    svg.replaceWith(fresh);
    flip[i] = fresh;
    draw(fresh);
  }));
  flip.forEach(svg => ro.observe(svg.parentElement));
}
