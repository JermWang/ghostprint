// Profile picture (?k=pfp, 1000x1000) and header banner (?k=banner, 1500x500), drawn with the site's art.
import { C, el, iso, slab, svgEl, pixelSVG, wordRows, GLYPHS, fit } from "../../../art.js";
import { ghostRoute } from "../../../diagrams.js";

const k = new URLSearchParams(location.search).get("k") || "pfp", root = document.getElementById("c");

// The pixel ghost built from isometric voxels standing on a board: every "#" is one cube.
function voxelGhost(svg, { u = 10, depth = .7, ox = 0, oy = 0, s = 1 } = {}) {
  const I = iso(ox, oy, s), rows = GLYPHS.ghost, H = rows.length, W = rows[0].length, d = u * depth;
  slab(I, svg, [[-u * 1.5, -u * 1.5, (W + 1.5) * u, d + u * 1.5]], { z: -14, h: 6, top: C.INK, left: C.INK, right: C.INK, step: u / 2 });
  slab(I, svg, [[-u * 1.5, -u * 1.5, (W + 1.5) * u, d + u * 1.5]], { z: -8, h: 8, step: u / 2 });
  const cubes = [], on = new Set();
  rows.forEach((r, ri) => [...r].forEach((ch, c) => { if (ch === "#") { cubes.push([c, H - 1 - ri]); on.add(`${c},${H - 1 - ri}`); } }));
  const has = (c, z) => on.has(`${c},${z}`);
  cubes.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[1] - b[1]);
  // faces without seams, then ink only on the polycube's real edges, so it reads as one solid ghost
  for (const [c, z] of cubes) {
    const x0 = c * u, x1 = x0 + u, z0 = z * u, z1 = z0 + u, g = el("g", { "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    const face = (pts, fill) => I.poly(g, pts, { fill, stroke: fill, "stroke-width": 1 });
    const edge = (a, b) => I.line(g, [a, b], { stroke: C.INK, "stroke-width": 1.6 });
    const right = !has(c + 1, z), top = !has(c, z + 1);
    face([[x0, d, z0], [x1, d, z0], [x1, d, z1], [x0, d, z1]], C.PAPER);
    if (right) face([[x1, 0, z0], [x1, d, z0], [x1, d, z1], [x1, 0, z1]], C.FACE_R);
    if (top) face([[x0, 0, z1], [x1, 0, z1], [x1, d, z1], [x0, d, z1]], C.FACE_L);
    if (!has(c - 1, z)) edge([x0, d, z0], [x0, d, z1]);
    if (right) edge([x1, d, z0], [x1, d, z1]);
    if (top) edge([x0, d, z1], [x1, d, z1]);
    if (!has(c, z - 1)) edge([x0, d, z0], [x1, d, z0]);
    if (right) {
      edge([x1, 0, z0], [x1, 0, z1]);
      if (!(has(c, z + 1) && !has(c + 1, z + 1))) edge([x1, 0, z1], [x1, d, z1]);
      if (!(has(c, z - 1) && !has(c + 1, z - 1))) edge([x1, 0, z0], [x1, d, z0]);
    }
    if (top) {
      edge([x0, 0, z1], [x1, 0, z1]);
      if (!(has(c - 1, z) && !has(c - 1, z + 1))) edge([x0, 0, z1], [x0, d, z1]);
      if (!(has(c + 1, z) && !has(c + 1, z + 1))) edge([x1, 0, z1], [x1, d, z1]);
    }
  }
  return I;
}

if (k === "pfp") {
  Object.assign(root.style, { width: "1000px", height: "1000px", background: C.ACCENT });
  root.innerHTML = '<div class="dots" style="opacity:.55;-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 30%,#000 75%);mask-image:radial-gradient(circle at 50% 50%,transparent 30%,#000 75%)"></div>';
  const svg = svgEl("0 0 10 10", "Ghostprint"); root.appendChild(svg);
  Object.assign(svg.style, { position: "absolute", left: "190px", top: "170px", width: "620px", height: "640px" });
  voxelGhost(svg, { u: 10 });
  fit(svg, { pad: 2 });
} else {
  Object.assign(root.style, { width: "1500px", height: "500px", background: "radial-gradient(circle at 72% 50%,#EEEFEE,#D6D8D9 60%)" });
  root.innerHTML = '<div class="dots" style="-webkit-mask-image:linear-gradient(90deg,transparent 25%,#000 60%);mask-image:linear-gradient(90deg,transparent 25%,#000 60%)"></div>';
  // left third stays quiet: the profile picture sits over the bottom-left corner
  const copy = document.createElement("div"); copy.className = "copy"; root.appendChild(copy);
  Object.assign(copy.style, { left: "470px", top: "120px" });
  const word = pixelSVG(wordRows("GHOSTPRINT")); word.style.height = "46px"; word.style.color = C.INK; copy.appendChild(word);
  copy.insertAdjacentHTML("beforeend", "<h1>Trade Solana.<br>Leave fewer tracks.</h1><p><b>Ghost mode</b> · Pulse · Sniper · PnL</p>");
  const svg = svgEl("0 0 10 10", "Ghost route"); root.appendChild(svg);
  Object.assign(svg.style, { position: "absolute", left: "930px", top: "40px", width: "540px", height: "420px" });
  ghostRoute(svg);
}
window.__ready = true;
