// The explainer videos, composed in the page and driven frame by frame: __frame(t) poses everything at
// video time t (seconds). Diagrams come from the site's own art (diagrams.js) in one iframe per scene, so
// each scene's animation clock starts with the scene. CUES lists the sound events for the audio pass.
import { ghostLogo, pixelSVG, wordRows } from "../../../art.js";

const q = new URLSearchParams(location.search), V = +q.get("v") || 1, SQ = q.get("ar") === "sq";
const W = SQ ? 1080 : 1920, H = 1080;

// beat: { t0, t1, card | d, start (diagram clock offset from t0), packets: [steps, step, rest], cap: { k, h, p, steps: [[at, text]] } }
const VIDEOS = {
  1: { label: "What it is", beats: [
    { t0: 0, t1: 3, card: { word: true, tag: "A Solana trading terminal that<br><b>leaves fewer tracks.</b>" } },
    { t0: 3, t1: 7, d: "walletTree", start: .6, packets: [2, 1.15, .9],
      cap: { k: "01 · Wallets", h: "Sign once.<br>Every wallet follows.", p: "Your main wallet signs one message. Instant and ghost wallets derive from it, so signing again rebuilds them anywhere." } },
    { t0: 7, t1: 11, d: "tradeTx", start: .25, build: false, tx: 6,
      cap: { k: "02 · Trading", h: "One buy.<br>One transaction.", p: "Jupiter routes across Solana's DEXs. The 0.5% fee rides inside, in SOL. If the swap fails, no fee." } },
    { t0: 11, t1: 13.5, d: "overview", start: .5, packets: [3, 1.15, .9],
      cap: { k: "03 · Non-custodial", h: "It runs in<br>your browser.", p: "You sign every trade. Ghostprint never holds funds." } },
    { t0: 13.5, t1: 15, card: { word: true, end: true, tag: "Private funding · best-price routing", fine: "Trade from your browser." } }
  ] },
  2: { label: "Ghost mode", beats: [
    { t0: 0, t1: 2.5, card: { title: "Ghost mode", tag: "Buy from a wallet<br><b>nothing points back to.</b>" } },
    { t0: 2.5, t1: 5, d: "tracked", start: .55, packets: [2, 1.2, .5],
      cap: { k: "The problem", h: "Trackers follow<br>the SOL.", p: "Whoever funds a wallet is assumed to own it." } },
    { t0: 5, t1: 11, d: "ghostRoute", start: .6, packets: [4, 1.15, .9],
      cap: { k: "Ghost buy · NEAR Intents", h: "The bridge pays<br>your ghost.", steps: [
        [.75, "You pay a shared deposit address, plus the 0.5% fee."], [1.9, "NEAR Intents settles it, confidentially."],
        [3.05, "The bridge funds a fresh ghost wallet."], [4.2, "The ghost buys on Jupiter."]] } },
    { t0: 11, t1: 13.5, d: "ghostExit", start: .5, packets: [3, 1.15, .9],
      cap: { k: "Exit", h: "Home the<br>same way.", p: "The ghost sells and routes its SOL back through NEAR Intents. Exits pay no Ghostprint fee." } },
    { t0: 13.5, t1: 15, card: { title: "Ghost mode", pill: "Beta · up to 5 SOL per buy", fine: "Vary your amounts. Nothing is untraceable.", end: true } }
  ] },
  3: { label: "The toolkit", beats: [
    { t0: 0, t1: 2, card: { title: "The toolkit", tag: "Everything a fast terminal does.<br><b>Right in your browser.</b>" } },
    { t0: 2, t1: 4.5, d: "pulseSources", start: .5, packets: [3, 1.15, .9],
      cap: { k: "Pulse", h: "New pairs.<br>Final stretch.<br>Migrated.", p: "Three live columns, merged from PumpPortal, the chain and Jupiter." } },
    { t0: 4.5, t1: 6.5, d: "limitOrder", start: .45, packets: [3, .8, .3],
      cap: { k: "Limit orders", h: "Fills with the<br>tab closed.", p: "Escrowed on-chain with Jupiter's Trigger program." } },
    { t0: 6.5, t1: 8.5, d: "autopilot", start: .45, packets: [3, .8, .3],
      cap: { k: "Autopilot", h: "Sells while<br>you watch.", p: "Take profit, stop loss, trailing stop. Checked every 4&nbsp;s." } },
    { t0: 8.5, t1: 11, d: "bondingCurve", start: -3, tank: true,
      cap: { k: "Migration sniper", h: "Buy the<br>migration.", p: "Arm a snipe. The instant wallet buys the moment the curve completes." } },
    { t0: 11, t1: 13, d: "tracker", start: .45, packets: [2, .9, .3],
      cap: { k: "Tracker · PnL", h: "Follow wallets.<br>Keep score.", p: "New swaps every 20&nbsp;s. Realized and unrealized PnL in SOL." } },
    { t0: 13, t1: 15, card: { word: true, end: true, tag: "Pulse · limits · autopilot · sniper · PnL", fine: "One terminal. Fewer tracks." } }
  ] }
};
const VID = VIDEOS[V], BEATS = VID.beats, DUR = BEATS[BEATS.length - 1].t1;

/* ---------- helpers ---------- */
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = k => 1 - (1 - k) ** 3;
const easeBack = k => k >= 1 ? 1 : 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;
const h = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// fade/slide a block in at `a` and out at `b`
function inOut(e, t, a, b, dy = 26, dur = .45) {
  const i = easeOut(clamp((t - a) / dur)), o = clamp((t - (b - .3)) / .3);
  e.style.opacity = (i * (1 - o)).toFixed(3);
  e.style.transform = `translateY(${((1 - i) * dy - easeOut(o) * 14).toFixed(2)}px)`;
}
// pixels fly in from scattered positions and land on the grid
function scatter(svg, seed, spread) {
  const r = rng(seed);
  return [...svg.querySelectorAll("rect")].map(rect => ({ rect, dx: (r() - .5) * spread, dy: (r() - .5) * spread * .6, d: r() * .3 }));
}
function assemble(px, t, dur = .6) {
  for (const p of px) {
    const k = clamp((t - p.d) / dur), e = easeOut(k);
    p.rect.setAttribute("transform", `translate(${(p.dx * (1 - e)).toFixed(1)},${(p.dy * (1 - e)).toFixed(1)})`);
    p.rect.setAttribute("opacity", clamp(k * 3).toFixed(2));
  }
}

/* ---------- build the stage ---------- */
const stage = document.getElementById("stage");
document.body.classList.toggle("sq", SQ);
stage.style.width = W + "px"; stage.style.height = H + "px";
const L = SQ ? { pad: 56, dia: [30, 118, 1020, 560], cap: [64, 668, 960] } : { pad: 96, dia: [700, 90, 1180, 930], cap: [110, null, 640] };

const brand = h("div", "brand", null, stage);
brand.style.left = L.pad + "px"; brand.style.top = (L.pad - 6) + "px";
const bGhost = ghostLogo(); bGhost.style.width = "34px"; brand.appendChild(bGhost);
const bWord = pixelSVG(wordRows("GHOSTPRINT")); bWord.style.height = "22px"; brand.appendChild(bWord);
const meta = h("div", "meta", `<b>0${V}</b> / 03 · ${VID.label}`, stage);
meta.style.right = L.pad + "px"; meta.style.top = L.pad + "px";
const prog = h("div", "prog", null, stage);
Object.assign(prog.style, { left: L.pad + "px", right: L.pad + "px", bottom: (SQ ? 36 : 52) + "px" });
const bars = BEATS.map(() => h("i", null, null, h("span", null, null, prog)));

const scenes = BEATS.map((b, i) => {
  const s = { b };
  if (b.card) {
    const c = s.card = h("div", "card", null, stage), parts = [];
    const g = ghostLogo("ghost"); c.appendChild(g); s.px = scatter(g, 11 + i, 520);
    if (b.card.word) { const w = pixelSVG(wordRows("GHOSTPRINT"), "word"); c.appendChild(w); s.wpx = scatter(w, 29 + i, 900); }
    if (b.card.title) parts.push([h("h1", null, b.card.title, c), .45]);
    if (b.card.tag) parts.push([h("p", "tag", b.card.tag, c), .75]);
    if (b.card.pill) parts.push([h("div", "pill", b.card.pill, c), .7]);
    if (b.card.fine) parts.push([h("p", "fine", b.card.fine, c), .95]);
    s.parts = parts;
  } else {
    const f = s.frame = h("iframe", "dia", null, stage), [x, y, w, hh] = L.dia;
    Object.assign(f.style, { left: x + "px", top: y + "px", width: w + "px", height: hh + "px", opacity: 0 });
    f.src = `frame.html?d=${b.d}&start=${b.t0 + b.start}&build=${b.build === false ? 0 : 1}`;
    const cap = s.cap = h("div", "cap", null, stage);
    cap.style.left = L.cap[0] + "px"; cap.style.width = L.cap[2] + "px";
    if (L.cap[1] != null) cap.style.top = L.cap[1] + "px"; else { cap.style.top = "50%"; cap.style.translate = "0 -50%"; }
    s.lines = [h("div", "k", b.cap.k, cap), h("h2", null, b.cap.h, cap)];
    if (b.cap.p) s.lines.push(h("p", null, b.cap.p, cap));
    if (b.cap.steps) { const ol = h("ol", null, null, cap); s.steps = b.cap.steps.map(([at, text], j) => ({ at, li: h("li", null, `<i>${j + 1}</i><span>${text}</span>`, ol) })); }
  }
  return s;
});

/* ---------- pose ---------- */
window.__frame = t => {
  window.__step(t * 1000);
  let cardOn = 0;
  scenes.forEach((s, i) => {
    const { t0, t1 } = s.b, lt = t - t0, live = t >= t0 - .05 && t < t1 + .05;
    bars[i].style.width = (clamp((t - t0) / (t1 - t0)) * 100).toFixed(2) + "%";
    if (s.card) {
      s.card.style.visibility = live ? "visible" : "hidden";
      if (!live) return;
      const last = i === scenes.length - 1, out = last ? 0 : clamp((t - (t1 - .35)) / .35), inn = i === 0 ? 1 : clamp(lt / .3);
      s.card.style.opacity = (inn * (1 - out)).toFixed(3);
      s.card.style.transform = `translateY(${(-easeOut(out) * 30).toFixed(1)}px) scale(${(1 + .03 * clamp(lt / (t1 - t0))).toFixed(4)})`;
      cardOn = Math.max(cardOn, inn * (1 - out));
      assemble(s.px, lt);
      if (s.wpx) assemble(s.wpx, lt - .3, .7);
      for (const [e, a] of s.parts) inOut(e, lt, a, last ? 99 : t1 - t0, 22);
      return;
    }
    const f = s.frame, w = f.contentWindow;
    f.style.visibility = live ? "visible" : "hidden";
    s.cap.style.visibility = live ? "visible" : "hidden";
    if (w && w.__step) w.__step(t * 1000);
    if (!live) return;
    if (w && w.__pose) w.__pose(lt);
    const out = clamp((t - (t1 - .35)) / .35), drift = clamp(lt / (t1 - t0));
    f.style.opacity = (clamp(lt / .15) * (1 - out)).toFixed(3);
    f.style.transform = `translateY(${(-easeOut(out) * 28).toFixed(1)}px) scale(${(1 + .035 * drift).toFixed(4)})`;
    s.lines.forEach((e, j) => inOut(e, lt, .12 + j * .08, t1 - t0));
    if (s.steps) s.steps.forEach(({ at, li }) => { inOut(li, lt, at - .1, t1 - t0, 16, .35); li.classList.toggle("on", lt >= at - .1 && !s.steps.some(o => o.at > at && lt >= o.at - .1)); });
  });
  brand.style.opacity = meta.style.opacity = (1 - cardOn).toFixed(3);
};

/* ---------- sound cues ---------- */
const CUES = [], cue = (t, type, x = 0) => { if (t >= 0 && t <= DUR) CUES.push({ t: +t.toFixed(3), type, x }); };
BEATS.forEach((b, i) => {
  if (i) cue(b.t0 - .14, "whoosh", i);
  if (b.card) { cue(b.t0 + .02, "sparkle", i); cue(b.t0 + .62, b.card.end ? "finale" : "chime", i); return; }
  if (b.build !== false) for (let k = 0; k < 4; k++) cue(b.t0 + .08 + k * .17, "drop", k);
  if (b.packets) {
    const [n, step, rest] = b.packets, cyc = n * step + rest;
    for (let c = 0; c < 4; c++) for (let k = 0; k < n; k++) { const at = b.t0 + b.start + c * cyc + k * step + step * .86; if (at < b.t1 - .3) cue(at, "blip", k); }
  }
  if (b.tx) for (let k = 0; k < b.tx; k++) cue(b.t0 + b.start + k * .55 + .5, "thud", k);
  if (b.tank) { cue(b.t0 + b.start + 4.6, "migrate", 0); }
});
CUES.sort((a, b) => a.t - b.t);
window.CUES = CUES; window.DUR = DUR; window.SIZE = [W, H];

await Promise.all(["400 20px Sora", "700 20px Sora", "400 20px \"JetBrains Mono\"", "700 20px \"JetBrains Mono\""].map(f => document.fonts.load(f)));
await document.fonts.ready;
await Promise.all(scenes.filter(s => s.frame).map(s => new Promise(res => { const poll = () => s.frame.contentWindow?.__ready ? res() : setTimeout(poll, 30); poll(); })));
window.__frame(0);
window.__ready = true;
