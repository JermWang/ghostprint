// Token media without DOM or network: IPFS link handling, the list of image sources to try, social
// link cleanup, on-chain metadata decoding, and a generated avatar for tokens with no image.
// Token images mostly live on IPFS, and public gateways are slow or rate limited at random. Any IPFS
// link is reduced to its CID and path, then tried through several gateways (and the proxy, if set).
export const GATEWAYS = ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/", "https://gateway.pinata.cloud/ipfs/"];
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;
let mediaProxy = "";
export const setMediaProxy = url => { mediaProxy = (url || "").replace(/\/$/, ""); };
export function ipfsPath(u) {
  if (typeof u !== "string") return null;
  let m = u.match(/^ipfs:\/\/(?:ipfs\/)?([^/?#]+)(\/[^?#]*)?/);
  if (!m) m = u.match(/^https?:\/\/[^/]+\/ipfs\/([^/?#]+)(\/[^?#]*)?/);
  if (!m) { const sub = u.match(/^https?:\/\/([a-z0-9]+)\.ipfs\.[^/]+(\/[^?#]*)?/); if (sub) m = [null, sub[1], sub[2]]; }
  if (!m || !CID.test(m[1])) return null;
  const rest = (m[2] || "").replace(/\/+$/, "");
  return /^[\w\-./%]*$/.test(rest) ? m[1] + rest : null;
}
// Every URL worth trying for one image, best first. Never returns a non-https URL.
export function imageSources(url, { mint, proxy = mediaProxy } = {}) {
  const out = [], add = u => { if (u && /^https:\/\//.test(u) && !out.includes(u)) out.push(u); };
  const path = ipfsPath(url);
  if (path) {
    if (proxy) add(`${proxy}/ipfs/${path}`);
    if (/^https:/.test(url)) add(url);
    GATEWAYS.forEach(g => add(g + path));
  } else add(url);
  // DexScreener keeps an image for most tokens it has indexed
  if (mint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) add(`https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png`);
  return out;
}

// Social links as people actually type them into token metadata: full URLs, bare domains, @handles.
export function socialUrl(kind, v) {
  if (typeof v !== "string") return null;
  v = v.trim();
  if (!v || v.length > 300 || /^(javascript|data|vbscript):/i.test(v)) return null;
  if (kind === "twitter") {
    const h = v.match(/^@?([A-Za-z0-9_]{1,15})$/);
    if (h) return `https://x.com/${h[1]}`;
    if (/^(www\.)?(x|twitter)\.com\//i.test(v)) v = "https://" + v;
    return /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/\S+$/i.test(v) ? v.replace(/^http:/, "https:") : null;
  }
  if (kind === "telegram") {
    const h = v.match(/^@?([A-Za-z0-9_]{4,32})$/);
    if (h) return `https://t.me/${h[1]}`;
    if (/^(www\.)?(t\.me|telegram\.me)\//i.test(v)) v = "https://" + v;
    return /^https?:\/\/(www\.)?(t\.me|telegram\.me)\/\S+$/i.test(v) ? v.replace(/^http:/, "https:") : null;
  }
  if (!/^https?:\/\//i.test(v)) { if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return null; v = "https://" + v; }
  try { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.href : null; } catch (_) { return null; }
}

// On-chain token metadata layouts: Metaplex metadata accounts and the Token-2022 metadata extension.
export const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const clean = s => s.replace(/\0/g, "").trim();
function borshStr(bytes, o) {
  if (o + 4 > bytes.length) return null;
  const n = bytes[o] | bytes[o + 1] << 8 | bytes[o + 2] << 16 | bytes[o + 3] << 24;
  if (n < 0 || n > 1000 || o + 4 + n > bytes.length) return null;
  return [clean(new TextDecoder().decode(bytes.subarray(o + 4, o + 4 + n))), o + 4 + n];
}
export function decodeMetaplex(bytes) {
  if (!bytes || bytes.length < 70 || bytes[0] !== 4) return null; // key 4 = MetadataV1
  const a = borshStr(bytes, 65), b = a && borshStr(bytes, a[1]), c = b && borshStr(bytes, b[1]);
  return c ? { name: a[0], symbol: b[0], uri: c[0] } : null;
}
export function decodeToken2022Meta(bytes) {
  if (!bytes || bytes.length < 170 || bytes[165] !== 1) return null; // account type 1 = Mint
  for (let o = 166; o + 4 <= bytes.length;) {
    const type = bytes[o] | bytes[o + 1] << 8, len = bytes[o + 2] | bytes[o + 3] << 8;
    if (type === 0 && len === 0) break;
    if (type === 19) { // TokenMetadata: update authority, mint, name, symbol, uri
      const a = borshStr(bytes, o + 4 + 64), b = a && borshStr(bytes, a[1]), c = b && borshStr(bytes, b[1]);
      return c ? { name: a[0], symbol: b[0], uri: c[0] } : null;
    }
    o += 4 + len;
  }
  return null;
}

// A 5×5 mirrored pixel avatar derived from the mint, as an SVG data URI. Shown at once while the real
// image loads, and kept if none does, so no token is ever a blank square.
const AVATAR = ["#FF5A24", "#4FD18B", "#F2C14E", "#7FB2FF", "#C792EA", "#EEEFEE"];
export function identicon(seed = "") {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const fg = AVATAR[h % AVATAR.length];
  let cells = "";
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    if (h & 1) for (const xx of x === 2 ? [2] : [x, 4 - x]) cells += `<rect x='${1 + xx * 2}' y='${1 + y * 2}' width='2' height='2'/>`;
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' shape-rendering='crispEdges'><rect width='12' height='12' fill='#24272B'/><g fill='${fg}'>${cells}</g></svg>`)}`;
}
