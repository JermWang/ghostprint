// node render.mjs [post ...]  — writes ../<post>-wide.png (1600x900) and ../<post>-square.png (1080x1080).
// No dependencies: serves the repo root itself and screenshots with headless Chrome or Edge (set BROWSER to override).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url)), repo = resolve(here, "../../.."), out = resolve(here, "..");
const POSTS = process.argv.slice(2).length ? process.argv.slice(2) : ["intro", "ghost", "exposure", "onetx", "instant", "browser", "toolkit"];
const BROWSER = process.env.BROWSER || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };

const server = createServer(async (req, res) => {
  try { const p = join(repo, decodeURIComponent(new URL(req.url, "http://x").pathname)); res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise(r => server.on("listening", r));
const base = `http://127.0.0.1:${server.address().port}/media/posts/source/posts.html`;

for (const p of POSTS) for (const [f, name, w, h] of [["wide", "wide", 1600, 900], ["sq", "square", 1080, 1080]]) {
  const file = join(out, `${p}-${name}.png`);
  // virtual time lets the fonts load and the drawings' packets move into a mid-route still
  await promisify(execFile)(BROWSER, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${w},${h}`,
    "--virtual-time-budget=4200", `--screenshot=${file}`, `${base}?p=${p}&f=${f}`]);
  console.log(file);
}
server.close();
