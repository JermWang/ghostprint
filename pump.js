// pump.fun on-chain reading: bonding curve state and trade events, straight from the chain.
// Layouts: BondingCurve = 8-byte discriminator, virtualTokenReserves u64, virtualSolReserves u64,
// realTokenReserves u64, realSolReserves u64, tokenTotalSupply u64, complete bool (newer versions
// append more fields, which we ignore). TradeEvent = discriminator bddb7fd34ee661ee, mint, solAmount u64,
// tokenAmount u64, isBuy bool, user, timestamp i64, virtualSolReserves u64, virtualTokenReserves u64.

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const TRADE_EVENT = Uint8Array.from([0xbd, 0xdb, 0x7f, 0xd3, 0x4e, 0xe6, 0x61, 0xee]);
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n; // 793.1M tokens, 6 decimals
export const TOKEN_DECIMALS = 6;

const u64 = (b, o) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]); return v; };
const i64 = (b, o) => { const v = u64(b, o); return v >= 1n << 63n ? v - (1n << 64n) : v; };
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes) {
  const d = [];
  for (const byte of bytes) {
    let c = byte;
    for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; }
    while (c) { d.push(c % 58); c = (c / 58) | 0; }
  }
  let s = "";
  for (const byte of bytes) { if (byte) break; s += "1"; }
  for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  return s;
}
export const fromBase64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export function bondingCurveAddress(web3, mint) {
  return web3.PublicKey.findProgramAddressSync([new TextEncoder().encode("bonding-curve"), new web3.PublicKey(mint).toBytes()], new web3.PublicKey(PUMP_PROGRAM))[0].toBase58();
}

export function decodeCurve(bytes) {
  if (!bytes || bytes.length < 49) return null;
  const c = {
    virtualTokenReserves: u64(bytes, 8), virtualSolReserves: u64(bytes, 16),
    realTokenReserves: u64(bytes, 24), realSolReserves: u64(bytes, 32),
    tokenTotalSupply: u64(bytes, 40), complete: bytes[48] === 1
  };
  c.progress = curveProgress(c);
  c.priceSol = c.virtualTokenReserves ? Number(c.virtualSolReserves) / 1e9 / (Number(c.virtualTokenReserves) / 1e6) : 0;
  c.mcapSol = c.priceSol * Number(c.tokenTotalSupply) / 1e6;
  return c;
}

// Share of the sellable supply already bought off the curve, 0–100. Complete curves are 100.
export function curveProgress(c) {
  if (c.complete) return 100;
  if (c.realTokenReserves >= INITIAL_REAL_TOKEN_RESERVES) return 0;
  return Number(((INITIAL_REAL_TOKEN_RESERVES - c.realTokenReserves) * 10000n) / INITIAL_REAL_TOKEN_RESERVES) / 100;
}

// Find a TradeEvent anywhere in a byte array: in "Program data:" logs it sits at offset 0, in
// emit_cpi inner instructions it follows an 8-byte event tag.
export function findTradeEvent(bytes) {
  outer: for (let i = 0; i + 8 + 129 <= bytes.length; i++) {
    for (let j = 0; j < 8; j++) if (bytes[i + j] !== TRADE_EVENT[j]) continue outer;
    const o = i + 8;
    return {
      mint: b58(bytes.subarray(o, o + 32)),
      solAmount: u64(bytes, o + 32),
      tokenAmount: u64(bytes, o + 40),
      isBuy: bytes[o + 48] === 1,
      user: b58(bytes.subarray(o + 49, o + 81)),
      timestamp: Number(i64(bytes, o + 81)),
      virtualSolReserves: u64(bytes, o + 89),
      virtualTokenReserves: u64(bytes, o + 97)
    };
  }
  return null;
}

// All trade events in a set of logs ("Program data: <base64>" lines).
export function tradesFromLogs(logs) {
  const out = [];
  for (const line of logs || []) {
    const m = /^Program data: ([A-Za-z0-9+/=]+)$/.exec(line);
    if (!m) continue;
    let bytes;
    try { bytes = fromBase64(m[1]); } catch (_) { continue; }
    const ev = findTradeEvent(bytes);
    if (ev) out.push(ev);
  }
  return out;
}

// All trade events carried in a transaction's inner instructions (emit_cpi), jsonParsed or json.
export function tradesFromTx(tx, decodeData) {
  const out = [];
  for (const group of tx?.meta?.innerInstructions || []) for (const ix of group.instructions || []) {
    if (!ix.data || ix.parsed) continue;
    let bytes;
    try { bytes = decodeData(ix.data); } catch (_) { continue; }
    const ev = findTradeEvent(bytes);
    if (ev) out.push(ev);
  }
  return out.length ? out : tradesFromLogs(tx?.meta?.logMessages);
}

export const eventPriceSol = ev => ev.virtualTokenReserves ? Number(ev.virtualSolReserves) / 1e9 / (Number(ev.virtualTokenReserves) / 1e6) : 0;
