// One diagram per frame. Its clock starts at ?start= (seconds of video time), so each scene's packets
// begin when the scene does. __pose(t) runs the build-in: the drawing's parts drop onto the plate in order.
import { flow, fit } from "../../../art.js";
import { DIAGRAMS } from "../../../diagrams.js";

const N = (id, cx, cy, o = {}) => { const w = o.w || 60, d = o.d || 60; return { id, x: cx - w / 2, y: cy - d / 2, w, d, h: 40, ...o }; };
const CUSTOM = {
  // trackers follow the SOL: main funds a fresh wallet, and the link is public
  tracked(svg) {
    flow(svg, { ox: 0, oy: 0, step: 1.2, rest: .5,
      nodes: [N("main", 0, 0, { label: "MAIN", sub: "your wallet", glyph: "key", h: 44 }), N("new", 220, 0, { label: "NEW WALLET", sub: "funded by you", w: 70, d: 70, h: 40 }), N("eye", 220, -170, { label: "TRACKER", sub: "follows SOL", tone: "ink", glyph: "target", h: 48, w: 74, d: 74 })],
      links: [{ from: "main", to: "new" }, { from: "new", to: "eye" }],
      tags: [{ at: [110, 0, 30], text: "LINKED", accent: true }] });
    return fit(svg);
  },
  tracker(svg) {
    flow(svg, { ox: 0, oy: 0,
      nodes: [N("w0", 0, 0, { label: "WALLET A", glyph: "key", h: 32, w: 54, d: 54 }), N("w1", 0, -100, { label: "WALLET B", glyph: "key", h: 32, w: 54, d: 54 }), N("w2", 0, -200, { label: "WALLET C", glyph: "key", h: 32, w: 54, d: 54 }),
        N("tr", 170, -100, { label: "TRACKER", sub: "every 20 s", w: 80, d: 80, h: 50, tone: "ink", glyph: "target" }), N("pnl", 330, -100, { label: "PORTFOLIO", sub: "PnL in SOL", tone: "accent", glyph: "chart", h: 44, w: 70, d: 70 })],
      links: [{ from: "w0", to: "tr", pts: [[0, 0, 5], [85, 0, 5], [85, -100, 5], [170, -100, 5]] }, { from: "w1", to: "tr" }, { from: "w2", to: "tr", pts: [[0, -200, 5], [85, -200, 5], [85, -100, 5], [170, -100, 5]] }, { from: "tr", to: "pnl" }],
      sequence: [[0, 1, 2], [3]], step: .9, rest: .3 });
    return fit(svg);
  }
};

const q = new URLSearchParams(location.search), name = q.get("d"), svg = document.getElementById("d");
await Promise.all(["400 20px Sora", "700 20px Sora", "400 20px \"JetBrains Mono\"", "700 20px \"JetBrains Mono\""].map(f => document.fonts.load(f)));
await document.fonts.ready;
(CUSTOM[name] || DIAGRAMS[name])(svg, false);
const parts = [...svg.children].map(c => { const g = document.createElementNS(svg.namespaceURI, "g"); c.replaceWith(g); g.appendChild(c); return g; }), drop = q.get("build") !== "0";
window.__pose = t => {
  if (!drop) return;
  const n = parts.length, span = Math.min(.75, n * .03);
  parts.forEach((p, i) => {
    const k = Math.max(0, Math.min(1, (t - (n > 1 ? i / (n - 1) : 0) * span) / .42));
    const e = k === 1 ? 1 : 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2; // ease-out with a small overshoot
    p.setAttribute("transform", `translate(0,${(-(1 - e) * 46).toFixed(2)})`);
    p.style.opacity = Math.min(1, k * 2.5).toFixed(3);
  });
};
window.__pose(0);
window.__ready = true;
