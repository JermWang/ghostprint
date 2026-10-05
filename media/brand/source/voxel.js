// The pixel ghost built from isometric voxels, shared by the brand images and the post graphics.
import { C, el, iso, slab, GLYPHS } from "../../../art.js";

// Standing on a board: every "#" is one cube.
export function voxelGhost(svg, { u = 10, depth = .7, ox = 0, oy = 0, s = 1 } = {}) {
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
