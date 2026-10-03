// node render.mjs <v> <wide|sq> <out.mp4|stills:t1,t2,...> — renders the studio page frame by frame through ffmpeg.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [v, ar, out] = process.argv.slice(2), FPS = 30, BASE = process.env.BASE || "http://127.0.0.1:8765/media/videos/source/studio.html";
const shim = () => {
  const q = [], start = +new URLSearchParams(location.search).get("start") || 0; let T = 0;
  performance.now = () => Math.max(0, T - start * 1000);
  window.requestAnimationFrame = cb => q.push(cb);
  window.cancelAnimationFrame = () => {};
  window.IntersectionObserver = undefined;
  window.__step = ms => { T = ms; const n = performance.now(); q.splice(0).forEach(cb => cb(n)); };
};
const browser = await chromium.launch();
const size = ar === "sq" ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 };
const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await page.addInitScript(shim);
page.on("pageerror", e => console.error("pageerror", e.message));
page.on("console", m => m.type() === "error" && console.error("console", m.text()));
await page.goto(`${BASE}?v=${v}&ar=${ar}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 30000, polling: 100 });
const { cues, dur } = await page.evaluate(() => ({ cues: window.CUES, dur: window.DUR }));

if (out.startsWith("stills:")) {
  for (const t of out.slice(7).split(",").map(Number)) {
    await page.evaluate(t => window.__frame(t), t);
    await page.screenshot({ path: `${process.env.STILLS || "."}/v${v}-${ar}-${t.toFixed(2)}.png` });
  }
} else {
  writeFileSync(out.replace(/\.mp4$/, ".cues.json"), JSON.stringify({ dur, cues }, null, 1));
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out.replace(/\.mp4$/, ".silent.mp4")], { stdio: ["pipe", "inherit", "inherit"] });
  const n = Math.round(dur * FPS);
  for (let f = 0; f < n; f++) {
    await page.evaluate(t => window.__frame(t), f / FPS);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise(r => ff.on("close", r));
}
await browser.close();
