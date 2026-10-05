// Ghostprint on a plain Node server (Railway): serves the static site and runs the same proxy as the
// Cloudflare Worker in worker/ on the same origin. Env vars are the worker's secrets and vars:
// RPC_URL, RPC_WS_URL, JUP_API_KEY, ONECLICK_JWT, X_BEARER, JITO_URL, ALLOWED_ORIGINS. No dependencies.
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import worker from "./worker/src/index.js";

// Stand-in for Cloudflare's edge cache (caches.default), which the worker uses for Jupiter token lists and
// prices, X searches and IPFS reads. In memory, honors max-age, evicts the oldest entries past the cap.
const CACHE_CAP = 64 * 2 ** 20, ENTRY_CAP = 4 * 2 ** 20;
const mem = new Map();
let memBytes = 0;
const dropEntry = k => { memBytes -= mem.get(k).body.byteLength; mem.delete(k); };
globalThis.caches ??= { default: {
  async match(key) {
    const k = String(key.url || key), e = mem.get(k);
    if (!e) return undefined;
    if (e.expires < Date.now()) { dropEntry(k); return undefined; }
    return new Response(e.body, { status: e.status, headers: e.headers });
  },
  async put(key, res) {
    const k = String(key.url || key), maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1] || 0);
    if (!maxAge) return;
    const body = await res.arrayBuffer();
    if (body.byteLength > ENTRY_CAP) return;
    if (mem.has(k)) dropEntry(k);
    mem.set(k, { body, status: res.status, headers: [...res.headers], expires: Date.now() + maxAge * 1000 });
    memBytes += body.byteLength;
    for (const old of mem.keys()) { if (memBytes <= CACHE_CAP) break; dropEntry(old); }
  }
} };

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 5178;
const PROXY_PATH = /^\/(rpc|jito|health|x\/search)$|^\/(jup|1click|ipfs)\//;
const HIDDEN = /^(\.|node_modules$|test$|worker$|server\.mjs$|package(-lock)?\.json$)/;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".mp4": "video/mp4", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"
};

const selfOrigin = req => `${(req.headers["x-forwarded-proto"] || "http").split(",")[0]}://${req.headers.host}`;
const clientIp = req => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "anon";
// The site always may use its own proxy, on top of whatever ALLOWED_ORIGINS lists.
const envFor = req => ({ ...process.env, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? `${process.env.ALLOWED_ORIGINS},${selfOrigin(req)}` : "" });

async function proxy(req, res) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("cf-connecting-ip", clientIp(req));
  // same-origin GETs carry no Origin header; the worker's allowlist expects one
  if (!headers.has("origin") && req.headers["sec-fetch-site"] === "same-origin") headers.set("origin", selfOrigin(req));
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") { const parts = []; for await (const c of req) parts.push(c); body = Buffer.concat(parts); }
  const r = await worker.fetch(new Request(new URL(req.url, selfOrigin(req)), { method: req.method, headers, body }), envFor(req), { waitUntil: p => Promise.resolve(p).catch(() => {}) });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  if (r.body && req.method !== "HEAD") Readable.fromWeb(r.body).pipe(res); else res.end();
}

function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const rel = normalize(path).replace(/^[\\/]+/, "");
  if (rel.split(/[\\/]/).some(p => HIDDEN.test(p) || p === "..")) return notFound(res);
  let file = join(ROOT, rel), st = stat(file);
  if (st && st.isDirectory()) { res.writeHead(301, { location: `${path}/` }); return res.end(); }
  if (!st && !extname(rel)) { file += ".html"; st = stat(file); }
  if (!st || !file.startsWith(ROOT.replace(/[\\/]$/, "") + sep)) return notFound(res);
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  const headers = { "content-type": type, "cache-control": /\.html$/.test(file) ? "no-cache" : "public, max-age=300", "accept-ranges": "bytes", "x-content-type-options": "nosniff" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { "content-range": `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
    return req.method === "HEAD" ? res.end() : createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": st.size });
  req.method === "HEAD" ? res.end() : createReadStream(file).pipe(res);
}

// /env.js: deploy-time values from this server's environment (see env.js). Any origin may load it, so the
// Vercel copy of the site reads the same TOKEN_CA. The address stays private until its mint exists on-chain:
// set TOKEN_CA before launch and the site switches from "Coming soon" to the address by itself once it's live.
const mintLive = { ca: "", live: false, checkedAt: 0, pending: null };
async function tokenLive(ca) {
  if (mintLive.ca !== ca) Object.assign(mintLive, { ca, live: false, checkedAt: 0, pending: null });
  if (mintLive.live || Date.now() - mintLive.checkedAt < 15000) return mintLive.live;
  mintLive.pending ??= (async () => {
    try {
      const r = await fetch(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [ca, { encoding: "base64" }] }), signal: AbortSignal.timeout(4000) });
      mintLive.live = !!(await r.json()).result?.value;
    } catch (_) {}
    mintLive.checkedAt = Date.now(); mintLive.pending = null;
  })();
  await mintLive.pending;
  return mintLive.live;
}
async function serveEnv(req, res) {
  const ca = (process.env.TOKEN_CA || "").trim(), valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca);
  const body = `export const TOKEN_CA = ${JSON.stringify(valid && await tokenLive(ca) ? ca : "")};\n`;
  res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-cache", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" });
  res.end(req.method === "HEAD" ? undefined : body);
}

function stat(file) { try { return statSync(file); } catch (_) { return null; } }
function notFound(res) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); }

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  Promise.resolve().then(() => pathname === "/env.js" ? serveEnv(req, res) : PROXY_PATH.test(pathname) ? proxy(req, res) : serveStatic(req, res)).catch(() => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream error" }));
  });
});

// Websocket subscriptions on /rpc are piped straight to the upstream RPC (RPC_WS_URL, or RPC_URL as ws).
server.on("upgrade", (req, socket, head) => {
  const reject = code => { socket.end(`HTTP/1.1 ${code}\r\nconnection: close\r\n\r\n`); };
  const env = envFor(req), origin = req.headers.origin || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (new URL(req.url, "http://x").pathname !== "/rpc") return reject("404 Not Found");
  if (allowed.length && !allowed.includes(origin)) return reject("403 Forbidden");
  if (!env.RPC_URL) return reject("503 Service Unavailable");
  const target = new URL(env.RPC_WS_URL || env.RPC_URL.replace(/^http/, "ws"));
  const secure = target.protocol === "wss:", port = Number(target.port) || (secure ? 443 : 80);
  const up = secure ? tls.connect(port, target.hostname, { servername: target.hostname }) : net.connect(port, target.hostname);
  up.once(secure ? "secureConnect" : "connect", () => {
    const keep = ["upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"];
    const lines = [`GET ${target.pathname}${target.search} HTTP/1.1`, `host: ${target.host}`];
    for (const k of keep) if (req.headers[k]) lines.push(`${k}: ${req.headers[k]}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PORT, () => console.log(`ghostprint on :${PORT}`));
