// Ghostprint art. Everything visual is drawn in code: a hand-rolled isometric projection, flat three-tone
// faces with ink outlines, one infrared accent, tube cables with flowing dashes, halftone fields, pixel
// glyphs from bitmap strings. One shared animation clock drives it all; it pauses off-screen and
// respects prefers-reduced-motion.

export const NS = "http://www.w3.org/2000/svg";
export const REDUCE = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// Fixed art palette: the drawings look the same on the light site and the dark terminal.
export const C = { INK: "#1D1F22", INK2: "#26292D", INK3: "#31353A", PAPER: "#EEEFEE", GROUND: "#D6D8D9", FACE_L: "#C6C9CB", FACE_R: "#AFB3B6", ACCENT: "#FF5A24", MUTE: "#9A9EA5", UP: "#4FD18B" };
export const NSS = { "vector-effect": "non-scaling-stroke" };
const MONO = "JetBrains Mono, ui-monospace, monospace";

export function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
export function svgEl(viewBox, label) {
  const s = el("svg", { viewBox, role: label ? "img" : "presentation" });
  if (label) s.setAttribute("aria-label", label); else s.setAttribute("aria-hidden", "true");
  return s;
}

/* ---------- one animation clock ---------- */
// animate(fn, host): fn(t seconds) runs every frame while `host` is on screen. With reduced motion it
// runs once at t = 0 so the drawing still settles into a sensible still frame.
const jobs = new Set();
let running = false, t0 = 0;
const seen = new WeakMap();
const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(es => es.forEach(e => seen.set(e.target, e.isIntersecting))) : null;
export function animate(fn, host) {
  if (REDUCE) { fn(0); return () => {}; }
  const job = { fn, host };
  if (host && io) { seen.set(host, true); io.observe(host); }
  jobs.add(job);
  if (!running) { running = true; t0 = performance.now(); requestAnimationFrame(tick); }
  return () => jobs.delete(job);
}
function tick(now) {
  const t = Math.max(0, (now - t0) / 1000);
  for (const j of jobs) {
    if (j.host && !j.host.isConnected) { jobs.delete(j); continue; }
    if (j.host && seen.get(j.host) === false) continue;
    j.fn(t);
  }
  if (jobs.size && !document.hidden) requestAnimationFrame(tick);
  else running = false;
}
document.addEventListener?.("visibilitychange", () => { if (!document.hidden && jobs.size && !running) { running = true; requestAnimationFrame(tick); } });

// Size a drawing's viewBox to what was drawn (plus padding), ignoring moving parts marked data-anim.
// The SVG must be in the rendered document; `fallback` is used when it isn't.
export function fit(svg, { pad = 14, top = 0, fallback = "0 0 800 400", dots = true } = {}) {
  const moving = [...svg.querySelectorAll("[data-anim]")];
  moving.forEach(m => m.setAttribute("display", "none"));
  let b = null;
  try { b = svg.getBBox(); } catch (_) {}
  moving.forEach(m => m.removeAttribute("display"));
  svg.setAttribute("viewBox", b && b.width ? `${(b.x - pad).toFixed(1)} ${(b.y - pad - top).toFixed(1)} ${(b.width + pad * 2).toFixed(1)} ${(b.height + pad * 2 + top).toFixed(1)}` : fallback);
  if (dots) backdrop(svg);
  return svg;
}

/* ---------- isometric projection ---------- */
// A world point (x, y, z) lands on screen at ( ox + (x − y)·cos30°·s , oy + (x + y)·½·s − z·s ).
// topM / leftM / rightM are affine matrices that map flat 2D drawing onto a box face.
export function iso(ox, oy, s) {
  const K = .8660254, P = (x, y, z) => [ox + (x - y) * K * s, oy + (x + y) * .5 * s - z * s];
  const pts = a => a.map(p => P(p[0], p[1], p[2]).map(n => n.toFixed(1)).join(",")).join(" ");
  const api = {
    P, pts, s,
    poly(parent, a, attrs) { return el("polygon", Object.assign({ points: pts(a), "stroke-linejoin": "round" }, attrs), parent); },
    line(parent, a, attrs) { return el("polyline", Object.assign({ points: pts(a), fill: "none", "stroke-linejoin": "round", "stroke-linecap": "round" }, attrs), parent); },
    box(parent, x, y, z, w, d, h, st = {}) {
      const g = el("g", { stroke: st.stroke || C.INK, "stroke-width": st.sw || 1.4 }, parent);
      api.poly(g, [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], { fill: st.left || C.FACE_L });
      api.poly(g, [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], { fill: st.right || C.FACE_R });
      api.poly(g, [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], { fill: st.top || C.PAPER });
      return g;
    },
    cyl(parent, cx, cy, z, r, h, st = {}) {
      const g = el("g", { stroke: st.stroke || C.INK, "stroke-width": st.sw || 1.4 }, parent);
      const [x0, y0] = P(cx, cy, z), [x1, y1] = P(cx, cy, z + h), rx = 1.2247 * r * s, ry = .7071 * r * s;
      el("path", { d: `M${x1 - rx},${y1} L${x0 - rx},${y0} A${rx},${ry} 0 0 0 ${x0 + rx},${y0} L${x1 + rx},${y1} Z`, fill: st.side || C.FACE_R }, g);
      el("ellipse", { cx: x1, cy: y1, rx, ry, fill: st.top || C.PAPER }, g);
      return g;
    },
    topM: z => `matrix(${K * s},${.5 * s},${-K * s},${.5 * s},${ox},${oy - z * s})`,
    leftM: Y => `matrix(${K * s},${.5 * s},0,${s},${ox - K * s * Y},${oy + .5 * s * Y})`,   // face y = Y, local (x, −z)
    rightM: X => `matrix(${K * s},${-.5 * s},0,${s},${ox + K * s * X},${oy + .5 * s * X})`, // face x = X, local (−y, −z)
    plane(parent, m) { return el("g", { transform: m }, parent); }
  };
  return api;
}

// A flat slab shaped like the union of world rectangles [x0, y0, x1, y1], snapped to a grid: only the
// outside edges get side faces and outlines, so pads and tracks merge into one board.
export function slab(I, parent, rects, { z = 0, h = 8, step = 6, top = C.PAPER, left = C.FACE_L, right = C.FACE_R, stroke = C.INK, sw = 1.4 } = {}) {
  const sn = v => Math.round(v / step);
  const R = rects.map(([a, b, c, d]) => [sn(Math.min(a, c)), sn(Math.min(b, d)), sn(Math.max(a, c)), sn(Math.max(b, d))]);
  const i0 = Math.min(...R.map(r => r[0])), j0 = Math.min(...R.map(r => r[1])), i1 = Math.max(...R.map(r => r[2])), j1 = Math.max(...R.map(r => r[3]));
  const W = i1 - i0, on = new Uint8Array(W * (j1 - j0));
  for (const [a, b, c, d] of R) for (let j = b; j < d; j++) for (let i = a; i < c; i++) on[(j - j0) * W + i - i0] = 1;
  const at = (i, j) => i >= i0 && i < i1 && j >= j0 && j < j1 && on[(j - j0) * W + i - i0] === 1;
  // runs of cells along one axis where `test` holds, as [start, end) pairs
  const runs = (n, test) => { const out = []; let s = null; for (let k = 0; k <= n; k++) { const v = k < n && test(k); if (v && s === null) s = k; if (!v && s !== null) { out.push([s, k]); s = null; } } return out; };
  const g = el("g", { "stroke-linejoin": "round" }, parent), Z = z + h;
  const sides = el("g", { stroke, "stroke-width": sw }, g), tops = el("g", { fill: top, stroke: top, "stroke-width": .8 }, g), lines = el("g", { stroke, "stroke-width": sw, fill: "none" }, g);
  for (let j = j0; j < j1; j++) {
    for (const [a, b] of runs(W, k => at(i0 + k, j))) I.poly(tops, [[(i0 + a) * step, j * step, Z], [(i0 + b) * step, j * step, Z], [(i0 + b) * step, (j + 1) * step, Z], [(i0 + a) * step, (j + 1) * step, Z]]);
    // front-left faces (+y open) and back edges (−y open)
    for (const [a, b] of runs(W, k => at(i0 + k, j) && !at(i0 + k, j + 1))) { const Y = (j + 1) * step, x0 = (i0 + a) * step, x1 = (i0 + b) * step; I.poly(sides, [[x0, Y, z], [x1, Y, z], [x1, Y, Z], [x0, Y, Z]], { fill: left }); }
    for (const [a, b] of runs(W, k => at(i0 + k, j) && !at(i0 + k, j - 1))) I.line(lines, [[(i0 + a) * step, j * step, Z], [(i0 + b) * step, j * step, Z]]);
  }
  for (let i = i0; i < i1; i++) {
    for (const [a, b] of runs(j1 - j0, k => at(i, j0 + k) && !at(i + 1, j0 + k))) { const X = (i + 1) * step, y0 = (j0 + a) * step, y1 = (j0 + b) * step; I.poly(sides, [[X, y0, z], [X, y1, z], [X, y1, Z], [X, y0, Z]], { fill: right }); }
    for (const [a, b] of runs(j1 - j0, k => at(i, j0 + k) && !at(i - 1, j0 + k))) I.line(lines, [[i * step, (j0 + a) * step, Z], [i * step, (j0 + b) * step, Z]]);
  }
  // front top edges sit on the side faces already; redraw them over the merged tops
  for (let j = j0; j < j1; j++) for (const [a, b] of runs(W, k => at(i0 + k, j) && !at(i0 + k, j + 1))) I.line(lines, [[(i0 + a) * step, (j + 1) * step, Z], [(i0 + b) * step, (j + 1) * step, Z]]);
  for (let i = i0; i < i1; i++) for (const [a, b] of runs(j1 - j0, k => at(i, j0 + k) && !at(i + 1, j0 + k))) I.line(lines, [[(i + 1) * step, (j0 + a) * step, Z], [(i + 1) * step, (j0 + b) * step, Z]]);
  return g;
}

// A tube cable: ink casing, paper core, accent dashes that flow along it.
export function cable(I, parent, pts, { width = 9, speed = 28, host, muted = false } = {}) {
  const g = el("g", {}, parent);
  I.line(g, pts, { stroke: C.INK, "stroke-width": width });
  I.line(g, pts, { stroke: muted ? C.FACE_L : C.PAPER, "stroke-width": width / 2 });
  if (!muted) {
    const flow = I.line(g, pts, { stroke: C.ACCENT, "stroke-width": Math.max(1.6, width / 4.5), "stroke-dasharray": "2 16" });
    animate(t => flow.setAttribute("stroke-dashoffset", (-t * speed).toFixed(1)), host);
  }
  return g;
}

// A halftone dot field that fades out from a centre point. Dots breathe in a slow ripple that runs out
// from the centre while the centre itself drifts a little, so the field never sits still. `squash` > 1
// flattens the falloff into an ellipse (wide drawings). Under reduced motion it draws one still frame.
export function halftone(parent, { x0, y0, x1, y1, cx, cy, step = 9, max = 2.5, fall = 70, fill = C.INK, squash = 1, opacity, host, amp = .18 }) {
  const g = el("g", opacity == null ? { fill } : { fill, opacity }, parent), dots = [];
  for (let row = 0, y = y0; y < y1; y += step, row++)
    for (let x = x0 + (row % 2 ? step / 2 : 0); x < x1; x += step) {
      const d = Math.hypot(x - cx, (y - cy) * squash);
      if ((max - d / fall) * (1 + amp) + step / fall > .35) dots.push({ x, y, c: el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 0 }, g) });
    }
  let last = -1;
  animate(t => {
    if (t - last < .045 && last >= 0) return; // ~22 fps is plenty for a slow ripple
    last = t;
    const dx = Math.sin(t * .37) * step * .7, dy = Math.cos(t * .29) * step * .45;
    for (const o of dots) {
      const d = Math.hypot(o.x - cx - dx, (o.y - cy - dy) * squash);
      const r = (max - d / fall) * (1 + amp * Math.sin(t * 1.5 - d / 16));
      o.c.setAttribute("r", r > .35 ? r.toFixed(2) : 0);
    }
  }, host || parent.ownerSVGElement || parent);
  return g;
}
// A soft halftone pool behind a finished drawing, sized to its viewBox and kept behind everything.
export function backdrop(svg, { step = 11, max = 2.1, reach = .44, opacity = .32 } = {}) {
  const [x, y, w, h] = (svg.getAttribute("viewBox") || "0 0 0 0").split(/\s+/).map(Number);
  if (!w || !h) return null;
  // the pool follows the drawing's shape: flattened for wide drawings, stretched for tall (phone) ones
  const tall = h > w, squash = tall ? .62 : 1.6, fall = (tall ? w * 1.15 : w) * reach / (max - .35);
  const g = halftone(svg, { x0: x, y0: y, x1: x + w, y1: y + h, cx: x + w / 2, cy: y + h * .55, step, max, fall, squash, opacity, host: svg });
  g.setAttribute("data-anim", "");
  svg.insertBefore(g, svg.firstChild);
  return g;
}

/* ---------- pixel art ---------- */
export const FONT = {
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."], H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."], S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."], P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"], I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"], D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"]
};
const GHOST_BODY = ["...####...", ".########.", "##########", "##..##..##", "##..##..##", "##########", "##########", "###....###", "##########", "##########"];
// two skirt frames, so the feet shuffle like an arcade ghost
const SKIRT = [["##.##.##.#", "#..#..#..#"], ["#.##.##.##", ".#..#..#.#"]];
export const GLYPHS = {
  ghost: [...GHOST_BODY, ...SKIRT[0]],
  lock: ["..####..", ".#....#.", ".#....#.", "########", "###..###", "###..###", "########", "########"],
  file: ["#####...", "#...##..", "#...###.", "#.....#.", "#.###.#.", "#.....#.", "#.###.#.", "#######."],
  clock: ["..####..", ".#....#.", "#...#..#", "#...#..#", "#...##.#", "#......#", ".#....#.", "..####.."],
  fuel: ["#####...", "#...#.#.", "#...#..#", "#####..#", "#####..#", "#####.##", "#####...", "######.."],
  stairs: ["......##", "......##", "....####", "....####", "..######", "..######", "########", "########"],
  flame: ["...#....", "...##...", "..###...", "..####.#", ".#######", ".###.###", ".##...##", "..#####."],
  stack: ["..####..", "#......#", ".######.", "#......#", ".######.", "#......#", ".######.", "........"],
  link: ["..##....", ".#..#...", ".#..#...", "..####..", "....#..#", "....#..#", ".....##.", "........"],
  key: ["..###...", ".#...#..", ".#...#..", "..###...", "...#....", "...###..", "...#....", "...##..."],
  bolt: ["....##..", "...##...", "..##....", ".######.", "....##..", "...##...", "..##....", ".##....."],
  target: ["..####..", ".#....#.", "#..##..#", "#.#..#.#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."],
  shield: [".######.", "#......#", "#..##..#", "#.####.#", "#..##..#", ".#....#.", "..#..#..", "...##..."],
  route: ["##......", "##......", ".#......", ".####...", "....#...", "....####", "......##", "......##"],
  chart: ["........", "......#.", ".....##.", "..#.#.#.", ".##.#.#.", "#.#.#.#.", "#.#.#.#.", "########"]
};
export function pixelSVG(rows, cls, cell = 10, gap = 1.4) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const svg = el("svg", { viewBox: `0 0 ${w * cell} ${h * cell}`, "aria-hidden": "true" });
  if (cls) svg.setAttribute("class", cls);
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === "#") el("rect", { x: x * cell + gap / 2, y: y * cell + gap / 2, width: cell - gap, height: cell - gap, fill: "currentColor" }, svg); }));
  return svg;
}
export function wordRows(text) {
  const rows = Array(7).fill("");
  [...text].forEach((ch, i) => FONT[ch].forEach((r, y) => { rows[y] += (i ? "." : "") + r; }));
  return rows;
}
// The ghost logo: body drawn once, two skirt frames swapped every ~0.4 s.
export function ghostLogo(cls) {
  const svg = pixelSVG(GHOST_BODY.concat(["..........", ".........."]), cls);
  const frames = SKIRT.map((rows, f) => {
    const g = el("g", f ? { opacity: 0 } : {}, svg);
    rows.forEach((r, i) => [...r].forEach((c, x) => { if (c === "#") el("rect", { x: x * 10 + .7, y: (10 + i) * 10 + .7, width: 8.6, height: 8.6, fill: "currentColor" }, g); }));
    return g;
  });
  animate(t => { const f = Math.floor(t / .42) % 2; frames[0].setAttribute("opacity", f ? 0 : 1); frames[1].setAttribute("opacity", f ? 1 : 0); }, svg);
  return svg;
}
// Replace every [data-pixel] placeholder: "ghost", "word" (GHOSTPRINT) or any GLYPHS key.
export function renderPixels(root = document, { assembleWord = true } = {}) {
  root.querySelectorAll("[data-pixel]").forEach(host => {
    const kind = host.dataset.pixel, cls = host.getAttribute("class");
    const svg = kind === "ghost" ? ghostLogo(cls) : pixelSVG(kind === "word" ? wordRows("GHOSTPRINT") : GLYPHS[kind] || GLYPHS.ghost, cls);
    host.replaceWith(svg);
    if (kind === "word" && assembleWord && svg.closest(".nav") && !REDUCE) {
      const rects = [...svg.querySelectorAll("rect")];
      rects.forEach(r => { r.style.transition = "transform .8s cubic-bezier(.2,.8,.2,1),opacity .5s ease"; r.style.transform = `translate(${(Math.random() - .5) * 160}px,${(Math.random() - .5) * 90}px)`; r.style.opacity = "0"; r.style.transitionDelay = (Math.random() * .35).toFixed(2) + "s"; });
      requestAnimationFrame(() => requestAnimationFrame(() => rects.forEach(r => { r.style.transform = ""; r.style.opacity = ""; })));
    }
  });
}
function glyphOnPlane(parent, rows, cx, cy, size, fill = C.INK) {
  const n = Math.max(rows.length, ...rows.map(r => r.length)), cell = size / n, x0 = cx - size / 2, y0 = cy - size / 2;
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === "#") el("rect", { x: (x0 + x * cell + cell * .08).toFixed(2), y: (y0 + y * cell + cell * .08).toFixed(2), width: (cell * .84).toFixed(2), height: (cell * .84).toFixed(2), fill }, parent); }));
}

/* ---------- the hero machine ---------- */
export function machine(svg) {
  const I = iso(300, 330, .85), { P, poly, box, cyl, plane, topM, leftM, rightM } = I;
  halftone(svg, { x0: 20, y0: 34, x1: 340, y1: 330, cx: 150, cy: 150, host: svg });
  const cables = el("g", {}, svg);
  box(svg, -130, -130, -9, 260, 260, 9, { top: C.INK, left: C.INK, right: C.INK });
  box(svg, -130, -130, 0, 260, 260, 18);
  [[-100, 70], [30, 70]].forEach(([u, w]) => {
    el("rect", Object.assign({ x: u, y: -13, width: w, height: 8, fill: C.ACCENT, stroke: C.INK, "stroke-width": 1.2 }, NSS), plane(svg, leftM(130)));
    el("rect", Object.assign({ x: u, y: -13, width: w, height: 8, fill: C.ACCENT, stroke: C.INK, "stroke-width": 1.2 }, NSS), plane(svg, rightM(130)));
  });
  el("rect", Object.assign({ x: -120, y: -120, width: 240, height: 240, fill: "none", stroke: C.INK, "stroke-width": 1, "stroke-dasharray": "3 5" }, NSS), plane(svg, topM(18)));
  box(svg, -104, -104, 18, 208, 208, 8);
  cable(I, cables, [[130, 95, 7], [205, 95, 7], [205, 170, 7], [260, 170, 7]], { host: svg });
  cable(I, cables, [[130, -8, 7], [182, -8, 7]], { host: svg });
  // shredder bin
  box(svg, 180, -44, 0, 54, 54, 46);
  el("rect", { x: 189, y: -26, width: 36, height: 9, fill: C.INK }, plane(svg, topM(46)));
  const binFace = plane(svg, leftM(10));
  el("rect", Object.assign({ x: 188, y: -34, width: 38, height: 13, fill: C.ACCENT, stroke: C.INK, "stroke-width": 1.2 }, NSS), binFace);
  el("text", { x: 207, y: -24.5, "text-anchor": "middle", "font-family": MONO, "font-size": 8, "font-weight": 700, fill: C.INK }, binFace).textContent = "LINK→0";
  const bits = el("g", {}, svg);
  for (let i = 0; i < 3; i++) {
    const b = el("rect", { width: 6, height: 6, fill: C.ACCENT, stroke: C.INK, "stroke-width": 1 }, bits);
    animate(t => { const p = (t * .7 + i / 3) % 1, [x, y] = P(207, -22, 110 - p * 64); b.setAttribute("x", (x - 3 + Math.sin(i * 2 + t) * 3).toFixed(1)); b.setAttribute("y", (y - 3).toFixed(1)); b.setAttribute("opacity", p > .92 ? 0 : 1); }, svg);
  }
  // chamber
  poly(svg, [[-56, -56, 26], [56, -56, 26], [56, 56, 26], [-56, 56, 26]], { fill: C.ACCENT, "fill-opacity": .28, stroke: C.INK, "stroke-width": 1.2 });
  box(svg, -62, -62, 26, 6, 6, 170, { top: C.INK, left: C.INK3, right: C.INK });
  poly(svg, [[-56, -56, 26], [-56, 56, 26], [-56, 56, 196], [-56, -56, 196]], { fill: C.PAPER, "fill-opacity": .3, stroke: C.INK, "stroke-width": 1 });
  poly(svg, [[-56, -56, 26], [56, -56, 26], [56, -56, 196], [-56, -56, 196]], { fill: C.PAPER, "fill-opacity": .3, stroke: C.INK, "stroke-width": 1 });
  // wallet card with a candle chart
  const card = el("g", {}, plane(svg, leftM(0)));
  el("rect", Object.assign({ x: -40, y: -164, width: 80, height: 98, rx: 3, fill: C.PAPER, stroke: C.INK, "stroke-width": 1.5 }, NSS), card);
  el("rect", { x: -34, y: -158, width: 68, height: 58, fill: C.INK }, card);
  [[-108, -113], [-113, -110], [-110, -121], [-121, -117], [-117, -129], [-129, -125], [-125, -139], [-139, -147]].forEach(([o, c], i) => {
    const x = -29 + i * 8, up = c < o;
    el("line", { x1: x + 2.5, y1: Math.min(o, c) - 3, x2: x + 2.5, y2: Math.max(o, c) + 3, stroke: up ? C.ACCENT : C.MUTE, "stroke-width": 1 }, card);
    el("rect", { x, y: Math.min(o, c), width: 5, height: Math.abs(o - c), fill: up ? C.ACCENT : C.MUTE }, card);
  });
  for (let y = -155; y < -100; y += 4) for (let x = -31; x < 34; x += 4) el("circle", { cx: x, cy: y, r: .7, fill: C.PAPER, "fill-opacity": .12 }, card);
  el("rect", { x: -34, y: -93, width: 40, height: 4, fill: C.INK }, card);
  el("rect", { x: -34, y: -85, width: 26, height: 4, fill: C.MUTE }, card);
  const badge = el("g", {}, card);
  el("rect", Object.assign({ x: 12, y: -95, width: 22, height: 11, rx: 2, fill: C.ACCENT, stroke: C.INK, "stroke-width": 1 }, NSS), badge);
  el("text", { x: 23, y: -86.8, "text-anchor": "middle", "font-family": MONO, "font-size": 7, "font-weight": 700, fill: C.INK }, badge).textContent = "TX";
  const scan = el("polygon", { fill: C.ACCENT, "fill-opacity": .2, stroke: C.ACCENT, "stroke-width": 1.6 }, svg);
  animate(t => {
    const z = 32 + (Math.sin(t * .9 - 1.5) * .5 + .5) * 158;
    scan.setAttribute("points", I.pts([[-55, -55, z], [55, -55, z], [55, 55, z], [-55, 55, z]]));
    card.setAttribute("transform", `translate(0,${(Math.sin(t * 1.3) * 3).toFixed(2)})`);
    badge.setAttribute("opacity", z > 84 ? .12 : 1);
  }, svg);
  // front glass and posts
  poly(svg, [[-56, 56, 26], [56, 56, 26], [56, 56, 196], [-56, 56, 196]], { fill: C.PAPER, "fill-opacity": .16, stroke: C.INK, "stroke-width": 1.2 });
  poly(svg, [[56, -56, 26], [56, 56, 26], [56, 56, 196], [56, -56, 196]], { fill: C.PAPER, "fill-opacity": .2, stroke: C.INK, "stroke-width": 1.2 });
  const glare = plane(svg, leftM(56));
  el("line", Object.assign({ x1: -44, y1: -60, x2: -14, y2: -160, stroke: "#fff", "stroke-width": 3, "stroke-opacity": .7, "stroke-linecap": "round" }, NSS), glare);
  el("line", Object.assign({ x1: -30, y1: -52, x2: -20, y2: -86, stroke: "#fff", "stroke-width": 2, "stroke-opacity": .6, "stroke-linecap": "round" }, NSS), glare);
  box(svg, 56, -62, 26, 6, 6, 170, { top: C.INK, left: C.INK3, right: C.INK });
  box(svg, -62, 56, 26, 6, 6, 170, { top: C.INK, left: C.INK3, right: C.INK });
  box(svg, 56, 56, 26, 6, 6, 170, { top: C.INK, left: C.INK3, right: C.INK });
  // cap
  box(svg, -68, -68, 196, 136, 136, 24);
  const vents = plane(svg, leftM(68));
  for (let x = -54; x <= 54; x += 9) el("line", Object.assign({ x1: x, y1: -217, x2: x, y2: -203, stroke: C.INK, "stroke-width": 1.4 }, NSS), vents);
  const lights = plane(svg, rightM(68)), leds = [];
  for (let i = 0; i < 6; i++) leds.push(el("rect", Object.assign({ x: -48 + i * 12, y: -214, width: 8, height: 7, fill: C.INK, stroke: C.INK, "stroke-width": 1 }, NSS), lights));
  animate(t => { const k = Math.floor(t * 5) % 6; leds.forEach((r, i) => r.setAttribute("fill", i === k || i === (k + 1) % 6 ? C.ACCENT : C.INK)); }, svg);
  cyl(svg, 0, 0, 220, 26, 7, { top: C.INK });
  el("circle", Object.assign({ cx: 0, cy: 0, r: 16, fill: "none", stroke: C.ACCENT, "stroke-width": 2 }, NSS), plane(svg, topM(227)));
  // intake tray
  box(svg, -66, 168, 0, 72, 56, 16);
  const tray = plane(svg, topM(16));
  el("rect", Object.assign({ x: -56, y: 176, width: 52, height: 40, fill: C.PAPER, stroke: C.INK, "stroke-width": 1.2 }, NSS), tray);
  el("polyline", Object.assign({ points: "-52,210 -40,194 -32,203 -22,188 -8,210", fill: "none", stroke: C.INK, "stroke-width": 1.2 }, NSS), tray);
  cable(I, cables, [[6, 196, 7], [64, 196, 7], [64, 132, 7]], { host: svg });
  // the links a tracker draws, rising out of the port
  const chips = el("g", { "font-family": MONO, "font-size": 10 }, svg);
  ["FUNDER", "CEX LINK", "PNL", "TIME ZONE"].forEach((txt, i) => {
    const g = el("g", {}, chips), w = txt.length * 6.1 + 18;
    el("rect", { x: -w / 2, y: -10, width: w, height: 20, rx: 5, fill: C.INK, stroke: C.ACCENT, "stroke-width": 1.4 }, g);
    el("text", { x: 0, y: 3.5, "text-anchor": "middle", fill: C.PAPER }, g).textContent = txt;
    const side = i % 2 ? 1 : -1;
    animate(t => {
      const p = ((t + i * 1.5) / 6) % 1, [x, y] = P(0, 0, 236 + p * 110);
      g.setAttribute("transform", `translate(${(x + side * (58 + p * 40)).toFixed(1)},${y.toFixed(1)})`);
      g.setAttribute("opacity", (p < .1 ? p / .1 : Math.max(0, 1 - (p - .1) / .6)).toFixed(2));
    }, svg);
  });
}

/* ---------- small icons ---------- */
export const ICONS = {
  funding(svg, I) {
    cable(I, svg, [[-44, 10, 6], [40, 10, 6]], { speed: 22, host: svg });
    I.box(svg, -92, -14, 0, 48, 48, 36);
    [36, 41, 46].forEach((z, i) => I.cyl(svg, -68, 10, z, 13, 5, i === 2 ? { top: C.ACCENT } : {}));
    I.box(svg, 40, -14, 0, 48, 48, 36);
    I.cyl(svg, 64, 10, 36, 13, 5, { top: C.ACCENT });
  },
  linked(svg, I) {
    const spots = [[-70, -40], [30, -50], [-20, 40]], c = ([x, y]) => [x + 18, y + 18, 6];
    [[0, 1], [1, 2], [2, 0]].forEach(([a, b]) => cable(I, svg, [c(spots[a]), [c(spots[b])[0], c(spots[a])[1], 6], c(spots[b])], { width: 8, speed: 20, host: svg }));
    spots.forEach(([x, y], i) => I.box(svg, x, y, 0, 36, 36, 30, i === 0 ? { top: C.ACCENT } : {}));
  },
  clock(svg, I) {
    I.cyl(svg, 0, 0, 0, 64, 14);
    const face = I.plane(svg, I.topM(14));
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, r1 = i % 3 ? 52 : 46;
      el("line", Object.assign({ x1: Math.cos(a) * r1, y1: Math.sin(a) * r1, x2: Math.cos(a) * 58, y2: Math.sin(a) * 58, stroke: C.INK, "stroke-width": i % 3 ? 1 : 2 }, NSS), face);
    }
    const hour = el("line", Object.assign({ x1: 0, y1: 0, x2: -30, y2: -16, stroke: C.INK, "stroke-width": 3, "stroke-linecap": "round" }, NSS), face);
    const min = el("line", Object.assign({ x1: 0, y1: 0, x2: 34, y2: -30, stroke: C.ACCENT, "stroke-width": 3, "stroke-linecap": "round" }, NSS), face);
    el("circle", { cx: 0, cy: 0, r: 4, fill: C.INK }, face);
    animate(t => { const a = t * .5; min.setAttribute("x2", (Math.cos(a) * 45).toFixed(1)); min.setAttribute("y2", (Math.sin(a) * 45).toFixed(1)); hour.setAttribute("x2", (Math.cos(a / 12 + 2.6) * 32).toFixed(1)); hour.setAttribute("y2", (Math.sin(a / 12 + 2.6) * 32).toFixed(1)); }, svg);
  },
  serial(svg, I) {
    I.box(svg, -50, -50, 0, 116, 72, 6, { top: C.GROUND });
    const lift = el("g", {}, svg);
    I.box(lift, -62, -26, 12, 116, 72, 6);
    const tag = I.plane(lift, I.topM(18));
    let x = -52;
    [2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 2, 1, 3].forEach((w, i) => { if (i % 2 === 0) el("rect", { x, y: -16, width: w * 2.2, height: 40, fill: C.INK }, tag); x += w * 2.2 + 1; });
    el("circle", Object.assign({ cx: 40, cy: 10, r: 8, fill: C.ACCENT, stroke: C.INK, "stroke-width": 1.4 }, NSS), tag);
    animate(t => lift.setAttribute("transform", `translate(0,${(-2 - Math.sin(t * 1.4) * 2.5).toFixed(2)})`), svg);
  }
};
export function renderIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach(host => {
    const svg = svgEl("0 0 240 150");
    halftone(svg, { x0: 0, y0: 0, x1: 240, y1: 150, cx: 120, cy: 84, step: 8, max: 1.9, fall: 62, squash: 1.5, opacity: .4, host: svg });
    ICONS[host.dataset.icon](svg, iso(120, 92, .62));
    host.appendChild(svg);
  });
}

/* ---------- animated flow diagrams ---------- */
// A node's name on a dark chip floating above its top face; f is the label's font size.
function chip(I, svg, n, f) {
  const k = f / 10, [tx, ty] = I.P(n.x + n.w / 2, n.y + n.d / 2, n.h);
  const g = el("g", { "font-family": MONO }, svg), h = (n.sub ? 28 : 18) * k, top = ty - 16 - h;
  const w = (Math.max(n.label.length, (n.sub || "").length * .8) * 6.4 + 16) * k;
  el("rect", { x: tx - w / 2, y: top, width: w, height: h, rx: 4 * k, fill: C.INK, stroke: n.tone === "accent" ? C.ACCENT : C.INK }, g);
  el("text", { x: tx, y: top + 13 * k, "text-anchor": "middle", "font-size": f, "font-weight": 700, fill: n.tone === "accent" ? C.ACCENT : C.PAPER }, g).textContent = n.label;
  if (n.sub) el("text", { x: tx, y: top + 23 * k, "text-anchor": "middle", "font-size": 7.5 * k, fill: C.MUTE }, g).textContent = n.sub;
}

// flow(svg, spec): isometric boxes on a plate, joined by cables; accent cubes carry a "packet" along each
// step of `sequence` (each step is a list of link indexes that run together), and the receiving box's
// lights blink when it arrives. Labels are printed on the boxes' front faces;
// with `chips` (a font size) they float above each node as flat chips instead, so a drawing shrunk
// onto a phone stays readable.
// node: { id, x, y, w, d, h, label, sub, tone: "paper"|"ink"|"accent", glyph, kind: "box"|"cyl" }
export function flow(svg, { ox, oy, s = 1, nodes, links = [], sequence, plate = true, step = 1.15, rest = .9, tags = [], chips = 0 }) {
  const I = iso(ox, oy, s), byId = new Map(nodes.map(n => [n.id, { w: 60, d: 60, h: 40, tone: "paper", kind: "box", ...n }]));
  const N = [...byId.values()], centre = n => [n.x + n.w / 2, n.y + n.d / 2];
  const route = l => { const A = byId.get(l.from), B = byId.get(l.to), [ax, ay] = centre(A), [bx, by] = centre(B); return l.pts || (l.bend === "yx" ? [[ax, ay, 5], [ax, by, 5], [bx, by, 5]] : [[ax, ay, 5], [bx, ay, 5], [bx, by, 5]]); };
  if (plate) {
    // a board that follows the parts: a pad under each node, a track under each cable
    const rects = N.map(n => [n.x - 18, n.y - 18, n.x + n.w + 18, n.y + n.d + 18]);
    for (const l of links) { const p = route(l); for (let i = 1; i < p.length; i++) rects.push([Math.min(p[i - 1][0], p[i][0]) - 14, Math.min(p[i - 1][1], p[i][1]) - 14, Math.max(p[i - 1][0], p[i][0]) + 14, Math.max(p[i - 1][1], p[i][1]) + 14]); }
    slab(I, svg, rects, { z: -14, h: 6, top: C.INK, left: C.INK, right: C.INK });
    slab(I, svg, rects, { z: -8, h: 8 });
  }
  const L = links.map(l => {
    const A = byId.get(l.from), B = byId.get(l.to), pts = route(l);
    cable(I, svg, pts, { width: 8, speed: 22, host: svg, muted: !!l.muted });
    const segs = []; let len = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push([pts[i - 1], pts[i], len, d]); len += d; }
    return { ...l, pts, segs, len, to: B, from: A };
  });
  const leds = new Map(), labels = [];
  N.sort((a, b) => (a.x + a.y + a.w / 2 + a.d / 2) - (b.x + b.y + b.w / 2 + b.d / 2)).forEach(n => {
    const tone = n.tone === "ink" ? { top: C.INK3, left: C.INK, right: C.INK2, stroke: C.INK } : n.tone === "accent" ? { top: C.ACCENT } : {};
    if (n.kind === "cyl") {
      const [cx, cy] = centre(n), r = Math.min(n.w, n.d) / 2;
      I.cyl(svg, cx, cy, 0, r, n.h, n.tone === "accent" ? { top: C.ACCENT } : n.tone === "ink" ? { top: C.INK3, side: C.INK } : {});
      if (n.glyph) glyphOnPlane(I.plane(svg, I.topM(n.h)), GLYPHS[n.glyph], cx, cy, r * 1.1, n.tone === "ink" ? C.PAPER : C.INK);
      if (chips) labels.push(n); else chip(I, svg, n, 10);
      leds.set(n.id, []);
      return;
    }
    I.box(svg, n.x, n.y, 0, n.w, n.d, n.h, tone);
    const face = I.plane(svg, I.leftM(n.y + n.d)), ink = n.tone === "ink";
    const size = Math.min(11, (n.w - 8) / Math.max(4, n.label.length) * 1.6);
    if (chips) labels.push(n);
    else el("text", { x: n.x + n.w / 2, y: -n.h / 2 + (n.sub ? -1 : 3.5), "text-anchor": "middle", "font-family": MONO, "font-size": size.toFixed(1), "font-weight": 700, fill: ink ? C.PAPER : C.INK }, face).textContent = n.label;
    if (n.sub && !chips) el("text", { x: n.x + n.w / 2, y: -n.h / 2 + 9, "text-anchor": "middle", "font-family": MONO, "font-size": Math.min(7.5, size * .78).toFixed(1), fill: ink ? C.MUTE : C.INK3 }, face).textContent = n.sub;
    const right = I.plane(svg, I.rightM(n.x + n.w)), ls = [];
    for (let i = 0; i < 3; i++) ls.push(el("rect", Object.assign({ x: -(n.y + n.d) + 6 + i * 8, y: -n.h + 5, width: 5, height: 3.5, fill: C.INK, stroke: C.INK, "stroke-width": .8 }, NSS), right));
    leds.set(n.id, ls);
    if (n.glyph) glyphOnPlane(I.plane(svg, I.topM(n.h)), GLYPHS[n.glyph], n.x + n.w / 2, n.y + n.d / 2, Math.min(n.w, n.d) * .5, ink ? C.PAPER : n.tone === "accent" ? C.INK : C.INK);
  });
  labels.forEach(n => chip(I, svg, n, chips));
  // packets
  const steps = sequence || L.map((_, i) => [i]);
  const cubes = L.map(() => { const g = el("g", { stroke: C.INK, "stroke-width": 1, opacity: 0, "data-anim": "" }, svg); return { g, f: [0, 1, 2].map(i => el("polygon", { fill: i === 2 ? C.ACCENT : i === 0 ? "#D94818" : "#B83C14" }, g)) }; });
  // floating tags (2D chips) anchored to world points
  for (const tg of tags) {
    const k = chips ? chips / 10 : 1, [x, y] = I.P(tg.at[0], tg.at[1], tg.at[2] || 0), g = el("g", { "font-family": MONO, "font-size": 9 * k }, svg), w = (tg.text.length * 5.6 + 14) * k;
    el("rect", { x: x - w / 2, y: y - 9 * k, width: w, height: 18 * k, rx: 9 * k, fill: tg.accent ? C.ACCENT : C.PAPER, stroke: C.INK, "stroke-width": 1.2 }, g);
    el("text", { x, y: y + 3.2 * k, "text-anchor": "middle", fill: C.INK, "font-weight": 700 }, g).textContent = tg.text;
  }
  const at = (l, p) => { const d = p * l.len; for (const [a, b, s0, len] of l.segs) if (d <= s0 + len || len === 0) { const k = len ? (d - s0) / len : 0; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; } const e = l.pts[l.pts.length - 1]; return [e[0], e[1]]; };
  const cycle = steps.length * step + rest;
  animate(t => {
    const tc = t % cycle, k = Math.floor(tc / step), p = (tc - k * step) / step;
    L.forEach((l, i) => {
      const on = steps[k] && steps[k].includes(i), c = cubes[i];
      if (!on) { c.g.setAttribute("opacity", 0); return; }
      const [x, y] = at(l, Math.min(1, p * 1.15)), z = 9 + Math.sin(Math.min(1, p * 1.15) * Math.PI) * 6, q = 4;
      c.f[0].setAttribute("points", I.pts([[x - q, y + q, z], [x + q, y + q, z], [x + q, y + q, z + 2 * q], [x - q, y + q, z + 2 * q]]));
      c.f[1].setAttribute("points", I.pts([[x + q, y - q, z], [x + q, y + q, z], [x + q, y + q, z + 2 * q], [x + q, y - q, z + 2 * q]]));
      c.f[2].setAttribute("points", I.pts([[x - q, y - q, z + 2 * q], [x + q, y - q, z + 2 * q], [x + q, y + q, z + 2 * q], [x - q, y + q, z + 2 * q]]));
      const inside = n => x > n.x - 2 && x < n.x + n.w + 2 && y > n.y - 2 && y < n.y + n.d + 2;
      c.g.setAttribute("opacity", p > .95 || inside(l.from) || inside(l.to) ? 0 : 1);
    });
    for (const [id, ls] of leds) {
      const hot = L.some((l, i) => l.to.id === id && ((steps[k] && steps[k].includes(i) && p > .82) || (k > 0 && steps[k - 1] && steps[k - 1].includes(i) && p < .35)));
      ls.forEach((r, j) => r.setAttribute("fill", hot && (Math.floor(t * 10) + j) % 2 ? C.ACCENT : hot ? "#FF8A5E" : C.INK));
    }
  }, svg);
  return I;
}

// A transaction drawn as a stack of slabs that drop into place one by one, then hold.
export function txStack(svg, { ox, oy, s = 1, layers, w = 200, d = 120, h = 13, gap = 5 }) {
  const I = iso(ox, oy, s);
  I.box(svg, -w / 2 - 16, -d / 2 - 16, -14, w + 32, d + 32, 6, { top: C.INK, left: C.INK, right: C.INK });
  I.box(svg, -w / 2 - 16, -d / 2 - 16, -8, w + 32, d + 32, 8);
  const groups = layers.map((ly, i) => {
    const g = el("g", {}, svg), z = i * (h + gap);
    I.box(g, -w / 2, -d / 2, z, w, d, h, ly.accent ? { top: C.ACCENT, left: "#E2531F", right: "#C2451A" } : ly.ink ? { top: C.INK3, left: C.INK, right: C.INK2 } : {});
    const face = I.plane(g, I.leftM(d / 2));
    el("text", { x: -w / 2 + 8, y: -z - h / 2 + 3.4, "font-family": MONO, "font-size": 8.5, "font-weight": 700, fill: ly.ink ? C.PAPER : C.INK }, face).textContent = ly.label;
    if (ly.note) el("text", { x: w / 2 - 8, y: -z - h / 2 + 3.2, "text-anchor": "end", "font-family": MONO, "font-size": 7, fill: ly.ink ? C.MUTE : C.INK3 }, face).textContent = ly.note;
    return g;
  });
  const n = layers.length, drop = .55, hold = 2.6, cycle = n * drop + hold + .6;
  animate(t => {
    const tc = t % cycle;
    groups.forEach((g, i) => {
      const start = i * drop, p = Math.max(0, Math.min(1, (tc - start) / drop)), ease = 1 - (1 - p) ** 3;
      const out = tc > n * drop + hold ? Math.min(1, (tc - n * drop - hold) / .6) : 0;
      g.setAttribute("transform", `translate(0,${(-(1 - ease) * 70 * s).toFixed(1)})`);
      g.setAttribute("opacity", (p <= 0 ? 0 : 1 - out).toFixed(2));
    });
  }, svg);
  return I;
}

// A bonding curve as a glass tank that fills; at 100% the liquidity flows out to an AMM pool.
export function curveTank(svg, { ox, oy, s = 1 }) {
  const I = iso(ox, oy, s), { P } = I;
  I.box(svg, -150, -70, -14, 300, 140, 6, { top: C.INK, left: C.INK, right: C.INK });
  I.box(svg, -150, -70, -8, 300, 140, 8);
  const pipe = [[-60, 0, 6], [60, 0, 6]];
  cable(I, svg, pipe, { width: 9, speed: 24, host: svg });
  // pool (right)
  I.box(svg, 60, -36, 0, 72, 72, 30, {});
  const pf = I.plane(svg, I.leftM(36));
  el("text", { x: 96, y: -12, "text-anchor": "middle", "font-family": MONO, "font-size": 9, "font-weight": 700, fill: C.INK }, pf).textContent = "AMM POOL";
  const poolLed = el("rect", Object.assign({ x: -30, y: -25, width: 12, height: 4, fill: C.INK }, NSS), I.plane(svg, I.rightM(132)));
  // tank (left): base ring, liquid column, glass
  const cx = -100, cy = 0, r = 38, H = 120;
  I.cyl(svg, cx, cy, 0, r + 6, 8, { top: C.INK3, side: C.INK });
  const liquid = el("g", {}, svg);
  const side = el("path", { fill: C.ACCENT, stroke: C.INK, "stroke-width": 1 }, liquid), top = el("ellipse", { fill: "#FF7A4D", stroke: C.INK, "stroke-width": 1 }, liquid);
  const [x0, y0] = P(cx, cy, 8), rx = 1.2247 * r * s, ry = .7071 * r * s;
  el("path", { d: `M${x0 - rx},${y0 - H * s} L${x0 - rx},${y0} A${rx},${ry} 0 0 0 ${x0 + rx},${y0} L${x0 + rx},${y0 - H * s}`, fill: C.PAPER, "fill-opacity": .18, stroke: C.INK, "stroke-width": 1.4 }, svg);
  el("ellipse", { cx: x0, cy: y0 - H * s, rx, ry, fill: C.PAPER, "fill-opacity": .25, stroke: C.INK, "stroke-width": 1.4 }, svg);
  for (let k = 1; k < 5; k++) { const yy = y0 - H * s * k / 5; el("line", { x1: x0 + rx - 8, y1: yy, x2: x0 + rx, y2: yy, stroke: C.INK, "stroke-width": 1 }, svg); }
  const label = el("g", { "font-family": MONO }, svg), [lx, ly] = P(cx, cy, H + 30);
  el("rect", { x: lx - 40, y: ly - 12, width: 80, height: 22, rx: 5, fill: C.INK }, label);
  const pct = el("text", { x: lx, y: ly + 3.5, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: C.PAPER }, label);
  const coin = el("g", { opacity: 0, "data-anim": "" }, svg), coinTop = el("ellipse", { rx: 9 * s, ry: 5 * s, fill: C.ACCENT, stroke: C.INK, "stroke-width": 1 }, coin);
  animate(t => {
    const cyc = 7, tc = t % cyc, fill = Math.min(1, tc / 4.6), ease = fill < 1 ? fill * (2 - fill) : 1;
    const hgt = 4 + ease * (H - 8), [, yb] = P(cx, cy, 8), [, yt] = P(cx, cy, 8 + hgt);
    side.setAttribute("d", `M${x0 - rx},${yt} L${x0 - rx},${yb} A${rx},${ry} 0 0 0 ${x0 + rx},${yb} L${x0 + rx},${yt} Z`);
    top.setAttribute("cx", x0); top.setAttribute("cy", yt); top.setAttribute("rx", rx); top.setAttribute("ry", ry);
    pct.textContent = fill < 1 ? `CURVE ${Math.round(ease * 100)}%` : "MIGRATING";
    const m = Math.max(0, Math.min(1, (tc - 4.7) / 1.4));
    coin.setAttribute("opacity", m > 0 && m < 1 ? 1 : 0);
    const [cxp, cyp] = P(-60 + m * 120, 0, 12 + Math.sin(m * Math.PI) * 10);
    coinTop.setAttribute("cx", cxp); coinTop.setAttribute("cy", cyp);
    poolLed.setAttribute("fill", tc > 6 ? C.ACCENT : C.INK);
  }, svg);
  return I;
}

// Small emblems for empty states in the terminal: one box, a flowing cable, a hovering card.
export function emblem(kind = "stream") {
  const svg = svgEl("0 0 200 120");
  halftone(svg, { x0: 0, y0: 0, x1: 200, y1: 120, cx: 100, cy: 74, step: 7, max: 1.5, fall: 46, squash: 1.6, fill: C.MUTE, opacity: .4, host: svg });
  const I = iso(100, 78, .55);
  if (kind === "stream") {
    I.box(svg, -95, -40, -10, 190, 80, 6, { top: C.INK, left: C.INK, right: C.INK });
    I.box(svg, -95, -40, -4, 190, 80, 4, { top: C.INK3, left: C.INK2, right: C.INK });
    flow(svg, { ox: 100, oy: 78, s: .55, plate: false, nodes: [{ id: "a", x: -80, y: -24, w: 44, d: 44, h: 26, label: "", tone: "paper" }, { id: "b", x: 36, y: -24, w: 44, d: 44, h: 38, label: "", tone: "accent", glyph: "ghost" }], links: [{ from: "a", to: "b" }], step: 1.4, rest: .4 });
  } else {
    I.box(svg, -60, -60, -10, 120, 120, 8, { top: C.INK3, left: C.INK2, right: C.INK });
    const card = el("g", {}, svg);
    I.box(card, -34, -34, 6, 68, 68, 10, { top: C.PAPER });
    glyphOnPlane(I.plane(card, I.topM(16)), GLYPHS[kind === "chart" ? "chart" : "ghost"], 0, 0, 40, C.INK);
    animate(t => card.setAttribute("transform", `translate(0,${(-Math.sin(t * 1.6) * 3 - 3).toFixed(2)})`), svg);
  }
  return svg;
}
