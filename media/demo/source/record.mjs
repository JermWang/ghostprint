// node record.mjs  — records ../ghostprint-demo.mp4: a person making a Ghost mode trade in the live terminal, start to finish.
//
// Everything on screen is the real app against live data (PumpPortal, Jupiter, DexScreener, Solana RPC). The only
// stand-in is the wallet: inject.js adds a demo wallet that signs for real, and this script answers the RPC calls
// about that wallet and its ghost wallets (balances, token accounts, sends, confirmations) from a small ledger, and
// plays back NEAR Intents' status for the demo's routes. Every transaction it signs is caught here and never reaches
// the network, and no deposit is ever reported to 1Click. Jupiter quotes, 1Click quotes, fees and prices are all real.
//
// No dependencies: Chrome or Edge (BROWSER to override) and ffmpeg (FFMPEG to override; imageio-ffmpeg is found too).
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createPrivateKey, createPublicKey } from "node:crypto";
import { tmpdir } from "node:os";

const here = fileURLToPath(new URL(".", import.meta.url)), repo = resolve(here, "../../.."), out = resolve(here, "..");
const W = 1920, H = 1080, FPS = 30, WALLET = process.env.WALLET || "Phantom";
const START_SOL = BigInt(Math.round(Number(process.env.START_SOL || 3.2146) * 1e9));
const BUY = process.env.BUY || "0.5";
// Same endpoints the terminal uses: through the proxy in config.js when one is set (it holds the RPC and Jupiter keys).
// The proxy only answers allowlisted origins, so the page is served from http://localhost:5178 like local dev.
const PROXY = ((await readFile(join(repo, "config.js"), "utf8")).match(/export const PROXY_URL = "([^"]*)"/)?.[1] || "").replace(/\/$/, "");
const RPC = PROXY ? `${PROXY}/rpc` : "https://api.mainnet-beta.solana.com", JUP = PROXY ? `${PROXY}/jup` : "https://api.jup.ag";
const PORT_WEB = Number(process.env.DEMO_PORT || 5178), ORIGIN = `http://localhost:${PORT_WEB}`;
const BROWSER = process.env.BROWSER || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const FFMPEG = process.env.FFMPEG || (() => { try { return execFileSync("python", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim(); } catch { return "ffmpeg"; } })();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const T0 = Date.now();

/* ---------- base58 ---------- */
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = "1" + s; }
  return s;
}

/* ---------- the demo wallet ---------- */
const seed = randomBytes(32);
const pub = Buffer.from(createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" })).export({ format: "jwk" }).x, "base64url");
const PK = b58(pub);
log("demo wallet", PK);

/* ---------- ledger: what the chain would say about the demo wallet and its ghosts ---------- */
// Every wallet the demo touches (main, then each ghost the terminal derives) has a SOL balance and token accounts here.
const L = { wallets: new Map(), sigs: new Map(), swaps: new Map(), route: null, slot: 0, slotAt: Date.now() };
const wallet = pk => { if (!L.wallets.has(pk)) L.wallets.set(pk, { sol: 0n, tokens: new Map() }); return L.wallets.get(pk); };
wallet(PK).sol = START_SOL;
const slot = () => L.slot + Math.floor((Date.now() - L.slotAt) / 400);
// this script's own RPC reads share the page's per-IP limit, so they back off and retry instead of failing a send
async function rpc(method, params) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (r.ok) return (await r.json()).result;
      if (i >= 6) throw new Error(`RPC HTTP ${r.status}`);
    } catch (e) { if (i >= 6) throw e; }
    await sleep(400 * 2 ** i);
  }
}
const mints = new Map();
function mintInfo(mint) {
  if (!mints.has(mint)) mints.set(mint, rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]).then(r => ({ decimals: r?.value?.data?.parsed?.info?.decimals ?? 6, program: r?.value?.owner || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" })));
  return mints.get(mint);
}
const SOL_MINT = "So11111111111111111111111111111111111111112", RENT = 2_039_280n, NETWORK = 5_000n;
// a Jupiter swap lands: main wallet swaps carry the 0.5% fee, ghost swaps carry none
async function applySwap(pk, { quote: q, prio }) {
  const w = wallet(pk), fee = pk === PK;
  if (q.inputMint === SOL_MINT) {
    const spend = fee ? BigInt(q.inAmount) * 10000n / 9950n : BigInt(q.inAmount);
    let t = w.tokens.get(q.outputMint);
    if (!t) { t = { amount: 0n, ...(await mintInfo(q.outputMint)), ata: b58(randomBytes(32)) }; w.tokens.set(q.outputMint, t); w.sol -= RENT; }
    w.sol -= spend + NETWORK + prio;
    t.amount += BigInt(q.outAmount);
    log(`${pk === PK ? "main" : "ghost"} buy fills: -${Number(spend) / 1e9} SOL, +${q.outAmount} raw ${q.outputMint.slice(0, 6)}`);
  } else {
    const t = w.tokens.get(q.inputMint), f = fee ? BigInt(q.otherAmountThreshold) * 50n / 10000n : 0n;
    if (t) t.amount -= BigInt(q.inAmount);
    w.sol += BigInt(q.outAmount) - f - NETWORK - prio;
    log(`${pk === PK ? "main" : "ghost"} sell fills: +${(Number(q.outAmount) - Number(f)) / 1e9} SOL`);
  }
}
// The fee payer of a signed transaction (its first account key), legacy or v0.
function payerOf(raw) {
  let i = 0; const cu16 = () => { let v = 0, s = 0, b; do { b = raw[i++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v; };
  const n = cu16(); i += n * 64; // read the count first: `i +=` would use i from before cu16 moves it
  if (raw[i] & 0x80) i++;
  i += 3; cu16();
  return b58(raw.subarray(i, i + 32));
}
// NEAR Intents, as the terminal sees it: a route is quoted (for real), funded (caught here), then delivered by the
// solvers about as fast as 1Click estimates. Delivery is 0.043% short of the deposit, the spread its live quotes show.
const ROUTE_STEPS = [[0, "PENDING_DEPOSIT"], [1500, "KNOWN_DEPOSIT_TX"], [4500, "PROCESSING"], [13500, "SUCCESS"]];
function routeStatus() {
  const r = L.route;
  if (!r || !r.fundedAt) return "PENDING_DEPOSIT";
  const t = Date.now() - r.fundedAt, s = ROUTE_STEPS.filter(([at]) => t >= at).at(-1)[1];
  if (s === "SUCCESS" && !r.delivered) { r.delivered = true; wallet(r.to).sol += r.amount * 99957n / 100000n; log(`route delivered ${Number(r.amount) / 1e9} SOL to ${r.to === PK ? "main" : "ghost"}`); }
  return s;
}
const account = (owner, mint, t) => ({ pubkey: t.ata, account: { data: { program: t.program === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ? "spl-token" : "spl-token-2022", space: 165, parsed: { type: "account", info: {
  isNative: false, mint, owner, state: "initialized",
  tokenAmount: { amount: t.amount.toString(), decimals: t.decimals, uiAmount: Number(t.amount) / 10 ** t.decimals, uiAmountString: (Number(t.amount) / 10 ** t.decimals).toString() } } } },
  executable: false, lamports: Number(RENT), owner: t.program, rentEpoch: 18446744073709551615, space: 165 } });
// one JSON-RPC request about a demo wallet -> its result, or undefined to let it through to the real RPC
async function answer({ method, params = [] }) {
  const ctx = v => ({ context: { slot: slot() }, value: v }), mine = L.wallets.has(params[0]);
  switch (method) {
    case "getBalance": return mine ? ctx(Number(wallet(params[0]).sol)) : undefined;
    case "getParsedTokenAccountsByOwner": case "getTokenAccountsByOwner": {
      if (!mine) return;
      const f = params[1] || {}, list = [...wallet(params[0]).tokens].filter(([m, t]) => f.mint ? m === f.mint : t.program === f.programId);
      return ctx(list.map(([m, t]) => account(params[0], m, t)));
    }
    case "getSignaturesForAddress": return params[0] === PK ? [] : undefined;
    case "sendTransaction": {
      const raw = Buffer.from(params[0], "base64"), sig = b58(raw.subarray(1, 65)), payer = payerOf(raw);
      if (!L.sigs.has(sig)) {
        L.sigs.set(sig, Date.now());
        if (L.swaps.has(payer)) { const s = L.swaps.get(payer); L.swaps.delete(payer); await applySwap(payer, s); }
        else if (L.route && L.route.from === payer && !L.route.fundedAt) {
          // funding a NEAR Intents deposit address: the route amount, plus the fee when the main wallet funds it
          const r = L.route; r.fundedAt = Date.now();
          wallet(payer).sol -= r.amount + (payer === PK ? r.amount * 50n / 9950n : 0n) + NETWORK;
          log(`route funded by ${payer === PK ? "main" : "ghost"}: ${Number(r.amount) / 1e9} SOL`);
        }
        log("caught send", sig.slice(0, 12));
      }
      return sig;
    }
    case "simulateTransaction": return ctx({ err: null, logs: [], accounts: null, unitsConsumed: 98000, returnData: null });
    case "getSignatureStatuses": {
      if (!params[0].every(s => L.sigs.has(s))) return;
      // lands about a second after it's sent, like a real priority-fee swap
      return ctx(params[0].map(s => Date.now() - L.sigs.get(s) < 1100 ? null : { slot: slot() - 2, confirmations: null, err: null, status: { Ok: null }, confirmationStatus: "confirmed" }));
    }
  }
}

/* ---------- static server ---------- */
// The proxy answers allowlisted origins only, so the page must come from localhost:5178. If something already serves
// this repo there (npm start), use it; otherwise serve the repo here.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try { const p = join(repo, decodeURIComponent(new URL(req.url, "http://x").pathname)), body = await readFile(p); res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
const serving = await new Promise(r => { server.once("listening", () => r(true)); server.once("error", () => r(false)); server.listen(PORT_WEB); });
if (!serving) {
  const ok = await fetch(`${ORIGIN}/media/demo/source/inject.js`).then(r => r.ok, () => false);
  if (!ok) throw new Error(`port ${PORT_WEB} is busy with something that isn't this repo; stop it or set DEMO_PORT to another allowlisted port`);
  log(`using the server already on ${ORIGIN}`);
}

// the closing card: the intro post graphic, drawn at 1.2x so it lands at exactly 1920x1080
const END = join(out, ".endcard.png");
await promisify(execFile)(BROWSER, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1.2", "--window-size=1600,900",
  "--virtual-time-budget=4200", `--screenshot=${END}`, `${ORIGIN}/media/posts/source/posts.html?p=intro&f=wide`]); // async: this process is the server it loads from

/* ---------- Chrome over the DevTools protocol ---------- */
const profile = join(tmpdir(), `gp-demo-${Date.now()}`), PORT = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, "--hide-scrollbars",
  "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check", "--mute-audio", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  // keep the chart iframe in the page's process so it gets the page's user agent
  "--disable-site-isolation-trials", "--disable-features=IsolateOrigins,site-per-process", "about:blank"], { stdio: "ignore" });
let targets;
for (let i = 0; i < 100 && !targets; i++) { await sleep(150); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {} }
const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let nextId = 0; const calls = new Map(), handlers = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const c = calls.get(m.id); calls.delete(m.id); m.error ? c.reject(new Error(`${c.method}: ${m.error.message}`)) : c.resolve(m.result); }
  else (handlers.get(m.method) || []).forEach(f => f(m.params));
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; calls.set(id, { resolve, reject, method }); ws.send(JSON.stringify({ id, method, params })); });
const on = (ev, f) => handlers.set(ev, [...(handlers.get(ev) || []), f]);

await send("Page.enable"); await send("Runtime.enable");
// headless Chrome names itself "HeadlessChrome", and DexScreener's chart serves no data to that; present as plain Chrome
const { userAgent } = await send("Browser.getVersion");
await send("Emulation.setUserAgentOverride", { userAgent: userAgent.replace("HeadlessChrome", "Chrome"), acceptLanguage: "en-US,en" });
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const inject = (await readFile(join(here, "inject.js"), "utf8")).replace("__SEED__", JSON.stringify([...seed])).replace("__NAME__", JSON.stringify(WALLET));
await send("Page.addScriptToEvaluateOnNewDocument", { source: inject });
on("Runtime.exceptionThrown", p => log("page error:", p.exceptionDetails?.exception?.description?.split("\n")[0] || p.exceptionDetails?.text));

// the network seam: answer RPC about the demo wallet, remember the quote behind each swap, and never let a send out
await send("Fetch.enable", { patterns: [{ urlPattern: `${RPC}*` }, { urlPattern: "*/swap/v1/swap-instructions*" }, { urlPattern: "*block-engine.jito.wtf*" },
  ...(PROXY ? [{ urlPattern: `${PROXY}/jito*` }] : []), { urlPattern: "*/v0/quote*" }, { urlPattern: "*/v0/deposit/submit*" }, { urlPattern: "*/v0/status*" }] });
const CORS = [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: "*" }];
const fulfill = (requestId, obj) => send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: CORS, body: Buffer.from(JSON.stringify(obj)).toString("base64") });
on("Fetch.requestPaused", async ({ requestId, request }) => {
  try {
    const url = request.url;
    // NEAR Intents: the demo route's status is played back, and its deposit is never reported to 1Click (nothing was sent)
    if (/\/v0\/status\?/.test(url)) return await fulfill(requestId, { status: routeStatus(), updatedAt: new Date().toISOString() });
    if (/\/v0\/deposit\/submit/.test(url)) return await fulfill(requestId, {});
    if (request.method !== "POST" || !request.postData) return await send("Fetch.continueRequest", { requestId });
    const body = JSON.parse(request.postData);
    // the real 1Click quote goes through (it opens a deposit address nobody funds); remember who it routes between
    if (/\/v0\/quote/.test(url)) {
      if (body.recipient && body.refundTo) { L.route = { from: body.refundTo, to: body.recipient, amount: BigInt(body.amount) }; wallet(body.recipient); }
      return await send("Fetch.continueRequest", { requestId });
    }
    if (url.includes("swap-instructions")) {
      const lv = body.prioritizationFeeLamports?.priorityLevelWithMaxLamports;
      L.swaps.set(body.userPublicKey, { quote: body.quoteResponse, prio: BigInt(Math.min(lv?.maxLamports || 0, lv?.priorityLevel === "veryHigh" ? 140_000 : 52_000)) });
      return await send("Fetch.continueRequest", { requestId });
    }
    if (/jito/.test(url)) { const sig = b58(Buffer.from(body.params[0], "base64").subarray(1, 65)); return await fulfill(requestId, { jsonrpc: "2.0", id: body.id, result: sig }); }
    if (Array.isArray(body)) {
      if (body.some(c => c && c.method === "sendTransaction")) throw new Error("refusing to pass a batched send through");
      return await send("Fetch.continueRequest", { requestId });
    }
    const result = await answer(body);
    if (result === undefined) {
      if (body.method === "sendTransaction") throw new Error("refusing to pass a send through"); // can't happen: every send is answered above
      return await send("Fetch.continueRequest", { requestId });
    }
    await fulfill(requestId, { jsonrpc: "2.0", id: body.id, result });
  } catch (e) { log("fetch handler:", e.message); send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {}); }
});

/* ---------- reading the page ---------- */
const evaluate = async expr => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
async function waitFor(expr, ms = 30000, what = expr) {
  const end = Date.now() + ms;
  for (;;) { try { if (await evaluate(expr)) return; } catch {} if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(150); }
}
const box = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);

/* ---------- a person's hands ---------- */
let mx = W * .72, my = H * .62;
const rnd = (a, b) => a + Math.random() * (b - a);
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1, ...extra });
// a curved, eased path with a little settle at the end, at roughly the speed a hand moves a mouse
async function moveTo(x, y, speed = 1) {
  const x0 = mx, y0 = my, d = Math.hypot(x - x0, y - y0);
  if (d < 2) return;
  const ms = Math.min(1150, 260 + d * .55) / speed, n = Math.max(8, Math.round(ms / 16));
  const bend = rnd(-.18, .18) * d, nx = -(y - y0) / d, ny = (x - x0) / d;
  const c1 = [x0 + (x - x0) * .3 + nx * bend, y0 + (y - y0) * .3 + ny * bend], c2 = [x0 + (x - x0) * .75 + nx * bend * .4, y0 + (y - y0) * .75 + ny * bend * .4];
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2, u = 1 - e;
    mx = u ** 3 * x0 + 3 * u * u * e * c1[0] + 3 * u * e * e * c2[0] + e ** 3 * x;
    my = u ** 3 * y0 + 3 * u * u * e * c1[1] + 3 * u * e * e * c2[1] + e ** 3 * y;
    await mouse("mouseMoved", mx, my); await sleep(16);
  }
  mx = x; my = y; await mouse("mouseMoved", mx, my);
}
async function moveToSel(sel, { fx = .5, fy = .5, jitter = .12, speed } = {}) {
  await waitFor(`!!document.querySelector(${JSON.stringify(sel)})`, 20000, sel);
  await evaluate(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: "nearest" })`);
  const b = await box(sel);
  await moveTo(b.x + b.w * (fx + rnd(-jitter, jitter) * .5), b.y + b.h * (fy + rnd(-jitter, jitter)), speed);
}
async function click() { await sleep(rnd(70, 140)); await mouse("mousePressed", mx, my); await sleep(rnd(60, 110)); await mouse("mouseReleased", mx, my); }
async function clickSel(sel, o) { await moveToSel(sel, o); await click(); }
async function type(text) { for (const ch of text) { await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch }); await sleep(rnd(110, 210)); } }
async function drift(ms, r = 26) { const end = Date.now() + ms; while (Date.now() < end) { await moveTo(mx + rnd(-r, r), my + rnd(-r * .6, r * .6), .6); await sleep(rnd(250, 600)); } }

/* ---------- recording ---------- */
const framesDir = join(out, ".frames"); await rm(framesDir, { recursive: true, force: true }); await mkdir(framesDir, { recursive: true });
const frames = []; let recording = false;
on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  if (!recording) return;
  const f = join(framesDir, `${String(frames.length).padStart(5, "0")}.jpg`);
  frames.push({ f, t: metadata.timestamp }); await writeFile(f, Buffer.from(data, "base64"));
});

/* ---------- the session ---------- */
const statusIs = re => `${re}.test(document.getElementById("status").textContent) || document.getElementById("status").classList.contains("err")`;
const failed = async what => { if (await evaluate(`document.getElementById("status").classList.contains("err")`)) throw new Error(`${what} failed: ${await evaluate(`document.getElementById("status").textContent`)}`); };
try {
  const s0 = await rpc("getSlot", []); L.slot = s0; L.slotAt = Date.now();
  await send("Page.navigate", { url: `${ORIGIN}/app.html#/` });
  await waitFor(`document.querySelectorAll('.pcol[data-col="new"] .pcard').length >= 6 && document.querySelectorAll('.pcol[data-col="migrated"] .pcard').length >= 2`, 60000, "Pulse to fill");
  log("pulse is live; letting images and curves settle");
  await sleep(9000);

  // pick the token: a migrated pair that Jupiter routes well (checked the way the terminal will quote it)
  // the biggest migrated tokens on screen first: deep pools, so a 0.5 SOL buy barely moves them
  const cands = await evaluate(`[...document.querySelectorAll('.pcol[data-col="migrated"] .pcard')].map(e => ({ m: e.dataset.mint, mc: window.__gp.board.tokens.get(e.dataset.mint)?.mcapUsd || 0 })).sort((a, b) => b.mc - a.mc).slice(0, 6).map(x => x.m)`);
  let mint = process.env.MINT || null;
  for (const m of mint ? [] : cands) {
    const q = await (await fetch(`${JUP}/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${m}&amount=${Math.round(Number(BUY) * 0.985e9)}&slippageBps=300&restrictIntermediateTokens=true&maxAccounts=54`, { headers: { origin: ORIGIN } })).json().catch(() => ({}));
    log("candidate", m, q.outAmount ? `impact ${(q.priceImpactPct * 100).toFixed(2)}%` : q.error);
    if (q.outAmount && Number(q.priceImpactPct) < .03) { mint = m; break; }
    await sleep(PROXY ? 400 : 2300);
  }
  if (!mint) throw new Error("no migrated token with a good route right now; try again or pass MINT=<address>");
  log("trading", mint);
  await mintInfo(mint); // read once now, so landing a swap never waits on the RPC
  await sleep(PROXY ? 800 : 3500); // let Jupiter's per-IP limit recover before the terminal quotes

  await mouse("mouseMoved", mx, my);
  await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(400); recording = true;
  log("recording");

  // 1. Pulse: look over the new launches (hovering pauses the column), then the migrated ones
  await sleep(1400);
  await moveToSel('.pcol[data-col="new"] .plist', { fy: .35 }); await drift(2200);
  await moveToSel('.pcol[data-col="migrated"] .pcard', { fx: .45 }); await sleep(900);

  // 2. connect the wallet
  await clickSel("#walletbtn");
  await waitFor(`document.getElementById("modal").open`, 5000, "wallet modal"); await sleep(700);
  await clickSel("#m-body button.btn.primary");
  await waitFor(`/[0-9] SOL$/.test(document.getElementById("walletbtn").textContent)`, 15000, "wallet balance");
  await sleep(1500);
  await clickSel("#m-close"); await sleep(700);

  // 3. open the token
  const card = `.pcol[data-col="migrated"] .pcard[data-mint="${mint}"]`;
  await moveToSel(card, { fx: .3 }); await sleep(600); await click();
  await waitFor(`!!document.querySelector("#chart iframe")`, 20000, "chart");
  await sleep(1200);
  await moveToSel("#chart", { fx: .55, fy: .45 }); await drift(3600, 60);
  await moveToSel("#tt-trades", { fy: .5 }); await sleep(1300);

  // 4. a ghost buy: Ghost mode is on by default, so the buy goes through NEAR Intents to a fresh wallet
  await moveToSel("#ghost-box", { fx: .35 }); await sleep(1600);
  await clickSel("#amt", { fx: .4 }); await sleep(350);
  await type(BUY);
  await waitFor(`!document.getElementById("quote").hidden && /Ghost route/.test(document.getElementById("quote").textContent)`, 20000, "ghost quote");
  await moveToSel("#quote", { fx: .6, fy: .5 }); await sleep(2400);
  await clickSel("#go");
  await waitFor(statusIs("/^Ghost wallet #\\d+ bought/"), 150000, "ghost buy to land");
  await failed("ghost buy");
  await moveTo(mx - rnd(30, 60), my + rnd(20, 40), .7); await sleep(3000);
  await clickSel("#tt-mine"); await sleep(2600);

  // 5. portfolio: the ghost holds the position; sell it and route the SOL home through NEAR Intents
  await clickSel('a[data-route="portfolio"]');
  await waitFor(`!!document.querySelector("#g-list .ghost-row")`, 40000, "ghost wallet row");
  await sleep(900);
  await moveToSel("#pf-cards", { fx: .5, fy: .5 }); await sleep(1400);
  await moveToSel("#g-list .ghost-row", { fx: .3 }); await sleep(2000);
  await clickSel("#g-list .ghost-row .acts button.primary");
  await waitFor(`[...document.querySelectorAll("#toasts .toast")].some(t => /is back in your wallet|err/.test(t.textContent + t.className))`, 150000, "ghost exit");
  if (await evaluate(`[...document.querySelectorAll("#toasts .toast.err")].length > 0`)) throw new Error("ghost exit failed: " + await evaluate(`document.querySelector("#toasts .toast.err").textContent`));
  await moveTo(mx + rnd(-40, 40), my - rnd(60, 120), .6); await sleep(2500);
  await moveToSel("#walletbtn", { fx: .5 }); await sleep(2200);
  await moveToSel("#pf-act", { fx: .4, fy: .3 }); await sleep(2600);

  recording = false;
  await send("Page.stopScreencast");
  log(`captured ${frames.length} frames`);
} finally {
  ws.close(); chrome.kill(); if (serving) server.close();
  setTimeout(() => rm(profile, { recursive: true, force: true }).catch(() => {}), 1500);
}

/* ---------- encode ---------- */
// frames arrive when the screen changes; each one holds until the next, then everything is resampled to a steady 30 fps
const list = frames.map((fr, i) => `file '${fr.f.replace(/\\/g, "/")}'\nduration ${((frames[i + 1]?.t ?? fr.t + 1 / FPS) - fr.t).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1).f.replace(/\\/g, "/")}'\n`;
await writeFile(join(framesDir, "list.txt"), list);
const dur = frames.at(-1).t - frames[0].t + 1 / FPS;
const end = END, hasEnd = existsSync(end), FADE = .6, HOLD = 3.4;
const args = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(framesDir, "list.txt")];
if (hasEnd) args.push("-loop", "1", "-t", String(HOLD + FADE), "-framerate", String(FPS), "-i", end,
  "-filter_complex", `[0:v]fps=${FPS},scale=${W}:${H},format=yuv420p,setsar=1[a];[1:v]fps=${FPS},scale=${W}:${H},format=yuv420p,setsar=1[b];[a][b]xfade=transition=fade:duration=${FADE}:offset=${(dur - FADE).toFixed(3)},format=yuv420p[v]`, "-map", "[v]");
else args.push("-vf", `fps=${FPS},format=yuv420p`);
args.push("-c:v", "libx264", "-preset", "slow", "-crf", "17", "-movflags", "+faststart", join(out, "ghostprint-demo.mp4"));
execFileSync(FFMPEG, args, { stdio: "inherit" });
await rm(framesDir, { recursive: true, force: true }); await rm(END, { force: true });
log("wrote", join(out, "ghostprint-demo.mp4"), `${(dur + (hasEnd ? HOLD : 0)).toFixed(1)}s`);
