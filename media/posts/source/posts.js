// Static post graphics, drawn with the site's art. ?p=<post>&f=wide (1600x900) or &f=sq (1080x1080).
import { C, svgEl, pixelSVG, wordRows, GLYPHS, flow, fit } from "../../../art.js";
import { DIAGRAMS } from "../../../diagrams.js";
import { voxelGhost } from "../../brand/source/voxel.js";

const N = (id, cx, cy, o = {}) => { const w = o.w || 60, d = o.d || 60; return { id, x: cx - w / 2, y: cy - d / 2, w, d, h: 40, ...o }; };
// trackers follow the SOL: main funds a fresh wallet, and the link is public (same drawing as video 02)
function tracked(svg) {
  flow(svg, { ox: 0, oy: 0, step: 1.2, rest: .5,
    nodes: [N("main", 0, 0, { label: "MAIN", sub: "your wallet", glyph: "key", h: 44 }), N("new", 220, 0, { label: "NEW WALLET", sub: "funded by you", w: 70, d: 70, h: 40 }), N("eye", 220, -170, { label: "TRACKER", sub: "follows SOL", tone: "ink", glyph: "target", h: 48, w: 74, d: 74 })],
    links: [{ from: "main", to: "new" }, { from: "new", to: "eye" }],
    tags: [{ at: [110, 0, 30], text: "LINKED", accent: true }] });
  return fit(svg);
}

const TOOLS = [
  ["flame", "Pulse", "New pairs, final stretch and migrated, streaming live.", true],
  ["bolt", "Migration sniper", "Buys the moment the bonding curve completes."],
  ["target", "Limit orders", "Sit on-chain with Jupiter. Fill with the tab closed."],
  ["chart", "Autopilot", "Take profit, stop loss and trailing stop."],
  ["link", "Wallet tracker", "Follow wallets and copy-buy in one click."],
  ["stack", "PnL in SOL", "Positions, cost basis, realized and unrealized."]
];

const POSTS = {
  intro: { kicker: ["ghost", "Solana trading terminal"], h1: "Trade Solana.<br>Leave fewer tracks.",
    body: "Pulse, sniper, autopilot and PnL in one browser tab. Plus <b>Ghost mode</b>: buy from a wallet nothing points back to.",
    note: "Non-custodial · best-price routing · private funding", voxel: true },
  ghost: { kicker: ["ghost", "Ghost mode · beta"], h1: "Buy from a wallet nothing points back to.",
    body: "Your SOL goes in through <b>NEAR Intents</b>. The bridge pays a fresh ghost wallet from its own funds. Exits pay no Ghostprint fee.",
    note: "Up to 5 SOL per buy. Vary your amounts. Nothing is untraceable.", art: DIAGRAMS.ghostRoute },
  exposure: { kicker: ["target", "Exposure"], h1: "See what trackers see.",
    body: "Paste any wallet. Get its funding source, sibling wallets, exchange links, poisoning attempts and the hours you're awake.",
    note: "<b>Free</b> · read-only · no wallet connect", art: tracked },
  onetx: { kicker: ["stack", "Every trade"], h1: "One buy.<br>One transaction.",
    body: "Jupiter finds the route. The 0.5% fee rides inside the same transaction, so <b>if the swap fails, there's no fee</b>.",
    note: "Optional Jito tip · MEV protect", art: DIAGRAMS.tradeTx, at: 4500 },
  instant: { kicker: ["bolt", "Instant wallet"], h1: "Sign once.<br>Every wallet follows.",
    body: "Instant and ghost wallets are derived from one signature. Trades sign in the tab, <b>no popups</b>. Sign again on any device to rebuild them.",
    note: "Signature never stored · export any key", art: DIAGRAMS.walletTree },
  browser: { kicker: ["shield", "Non-custodial"], h1: "It runs in your browser.",
    body: "Your keys sign locally and talk straight to Solana, Jupiter and NEAR. <b>Ghostprint never holds funds.</b>",
    note: "No account · no deposit · no custody", art: DIAGRAMS.overview },
  toolkit: { kicker: ["chart", "The toolkit"], h1: "Everything for the trenches.", tools: true, art: DIAGRAMS.bondingCurve, at: 5300 }
};

const q = new URLSearchParams(location.search), post = POSTS[q.get("p")] || POSTS.intro, wide = q.get("f") !== "sq";
const W = wide ? 1600 : 1080, H = wide ? 900 : 1080, root = document.getElementById("c");
Object.assign(root.style, { width: W + "px", height: H + "px" });
await Promise.all(["400 20px Sora", "600 20px Sora", "700 20px Sora", "400 20px \"JetBrains Mono\"", "700 20px \"JetBrains Mono\""].map(f => document.fonts.load(f)));
await document.fonts.ready;

const box = (cls, s, parent = root) => { const d = document.createElement("div"); d.className = cls; Object.assign(d.style, s); parent.appendChild(d); return d; };
const px = (rows, h) => { const s = pixelSVG(rows); s.style.height = h + "px"; return s; };

// background: dots fade in towards the drawing
box("dots", wide ? { maskImage: "linear-gradient(90deg,transparent 30%,#000 65%)", webkitMaskImage: "linear-gradient(90deg,transparent 30%,#000 65%)" }
  : { maskImage: "linear-gradient(180deg,transparent 35%,#000 70%)", webkitMaskImage: "linear-gradient(180deg,transparent 35%,#000 70%)" });

// the orange stage for the voxel ghost
let panel;
if (post.voxel) panel = box("panel", wide ? { left: "980px", top: 0, width: "620px", height: H + "px" } : { left: 0, top: "600px", width: W + "px", height: "480px" });

// copy
const pad = wide ? 104 : 84, copy = box("copy", wide ? { left: pad + "px", top: 0, bottom: "110px", width: (post.voxel ? 800 : 640) + "px", justifyContent: "center" } : { left: pad + "px", top: "88px", width: W - pad * 2 + "px" });
const k = box("kicker", {}, copy); k.appendChild(px(GLYPHS[post.kicker[0]] || wordRows("G"), 24)); k.insertAdjacentText("beforeend", post.kicker[1]);
const h1 = document.createElement("h1"); h1.innerHTML = post.h1; copy.appendChild(h1);
if (!wide) h1.style.fontSize = "72px";
if (post.tools && wide) h1.style.fontSize = "66px";
if (post.body) { const p = box("body", wide ? {} : { maxWidth: "900px", fontSize: "26px", marginTop: "24px" }, copy); p.innerHTML = post.body; }
if (post.tools) {
  const g = box("tools", wide ? { gridTemplateColumns: "1fr", gap: "16px", marginTop: "32px" } : { gap: "22px 40px", marginTop: "34px" }, copy);
  for (const [glyph, name, line, hot] of TOOLS) {
    const t = box("tool" + (hot ? " hot" : ""), {}, g); t.appendChild(pixelSVG(GLYPHS[glyph]));
    t.insertAdjacentHTML("beforeend", `<div><h3>${name}</h3><p>${line}</p></div>`);
  }
  if (wide) copy.style.width = "620px";
}
if (post.note) { const n = box("note", {}, copy); n.innerHTML = post.note; }

// footer: ghost + wordmark | url
const foot = box("foot", wide ? { left: pad + "px", bottom: "60px" } : { left: pad + "px", bottom: "52px" });
if (post.voxel && !wide) foot.style.color = C.INK;
foot.appendChild(px(GLYPHS.ghost, 26)); foot.appendChild(px(wordRows("GHOSTPRINT"), 20)); foot.appendChild(document.createElement("i"));
foot.insertAdjacentText("beforeend", "ghostprint.xyz");

// the drawing
const svg = svgEl("0 0 10 10", post.h1.replace(/<br>/g, " "));
if (post.voxel) {
  panel.appendChild(svg);
  box("dots", { opacity: .55, maskImage: "radial-gradient(circle at 50% 50%,transparent 30%,#000 75%)", webkitMaskImage: "radial-gradient(circle at 50% 50%,transparent 30%,#000 75%)" }, panel).style.zIndex = 0;
  Object.assign(svg.style, wide ? { position: "absolute", left: "90px", top: "150px", width: "440px", height: "560px", zIndex: 1 } : { position: "absolute", left: "560px", top: "40px", width: "420px", height: "400px", zIndex: 1 });
  voxelGhost(svg, { u: 10 });
  fit(svg, { pad: 2, dots: false });
  if (!wide) { copy.querySelector(".body").style.maxWidth = "880px"; foot.style.bottom = "56px"; foot.style.zIndex = 2; }
} else if (post.art) {
  root.appendChild(svg); svg.classList.add("art");
  let r;
  if (wide) r = post.tools ? { x: 820, y: 120, w: 700, h: 640 } : { x: 780, y: 70, w: 760, h: 740 };
  else { const top = copy.offsetTop + copy.offsetHeight + 30; r = { x: 70, y: top, w: W - 140, h: H - top - 120 }; }
  if (r) { Object.assign(svg.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" }); post.art(svg, false); }
}
window.__step(post.at || 1850); // packets mid-route; a full stack; a curve migrating
window.__ready = true;
