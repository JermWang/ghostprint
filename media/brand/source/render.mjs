// node render.mjs  — writes pfp.png (1000x1000), banner.png (1500x500) and pfp.svg next to this folder.
// Serve the repo root on :8765 first (python3 -m http.server 8765).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:8765/media/brand/source/brand.html";
const shim = () => { const q = []; let T = 0; performance.now = () => T; window.requestAnimationFrame = cb => q.push(cb); window.IntersectionObserver = undefined; window.__step = ms => { T = ms; q.splice(0).forEach(cb => cb(T)); }; };
const browser = await chromium.launch();
for (const [k, width, height] of [["pfp", 1000, 1000], ["banner", 1500, 500]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(shim);
  page.on("pageerror", e => console.error(k, e.message));
  await page.goto(`${BASE}?k=${k}`);
  await page.waitForFunction(() => window.__ready, null, { polling: 100 });
  await page.evaluate(async () => { await document.fonts.ready; window.__step(1850); }); // a packet mid-route on the banner
  await page.screenshot({ path: `../${k}.png`, clip: { x: 0, y: 0, width, height } });
  if (k === "pfp") writeFileSync("../pfp.svg", await page.evaluate(() => { const s = document.querySelector("#c svg").cloneNode(true); s.setAttribute("xmlns", "http://www.w3.org/2000/svg"); s.removeAttribute("style"); s.setAttribute("width", 1000); s.setAttribute("height", 1000); const vb = s.getAttribute("viewBox").split(" ").map(Number), side = Math.max(vb[2], vb[3]) * 1.45, cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2; s.setAttribute("viewBox", `${cx - side / 2} ${cy - side / 2} ${side} ${side}`); s.insertAdjacentHTML("afterbegin", `<rect x="${cx - side / 2}" y="${cy - side / 2}" width="${side}" height="${side}" fill="#FF5A24"/>`); return s.outerHTML; }));
  await page.close();
}
await browser.close();
