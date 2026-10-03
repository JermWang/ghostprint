import test from "node:test";
import assert from "node:assert/strict";
import web3 from "@solana/web3.js";
import { ipfsPath, imageSources, socialUrl, decodeMetaplex, decodeToken2022Meta, METAPLEX, GATEWAYS, identicon } from "../media.js";
import { onchainMeta } from "../feeds.js";

const CIDV0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const CIDV1 = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const MINT = "So11111111111111111111111111111111111111112";

test("ipfsPath: every way IPFS links show up in token metadata", () => {
  assert.equal(ipfsPath(`ipfs://${CIDV0}`), CIDV0);
  assert.equal(ipfsPath(`ipfs://ipfs/${CIDV0}/logo.png`), `${CIDV0}/logo.png`);
  assert.equal(ipfsPath(`https://ipfs.io/ipfs/${CIDV1}`), CIDV1);
  assert.equal(ipfsPath(`https://pump.mypinata.cloud/ipfs/${CIDV1}?img-width=128`), CIDV1);
  assert.equal(ipfsPath(`https://${CIDV1}.ipfs.dweb.link/`), CIDV1);
  assert.equal(ipfsPath("https://arweave.net/abc"), null);
  assert.equal(ipfsPath("https://ipfs.io/ipfs/notacid"), null);
  assert.equal(ipfsPath(`https://ipfs.io/ipfs/${CIDV0}/<script>`), null);
});

test("imageSources: proxy first, then the original, then other gateways, then DexScreener", () => {
  const list = imageSources(`https://ipfs.io/ipfs/${CIDV0}`, { mint: MINT, proxy: "https://p.test" });
  assert.equal(list[0], `https://p.test/ipfs/${CIDV0}`);
  assert.equal(list[1], `https://ipfs.io/ipfs/${CIDV0}`);
  assert.deepEqual(list.slice(1, 1 + GATEWAYS.length), GATEWAYS.map(g => g + CIDV0)); // the original is ipfs.io, so no duplicate
  assert.equal(list.at(-1), `https://dd.dexscreener.com/ds-data/tokens/solana/${MINT}.png`);
  assert.deepEqual(imageSources("https://cdn.test/a.png"), ["https://cdn.test/a.png"]);
  assert.deepEqual(imageSources("http://insecure.test/a.png"), []);
  assert.deepEqual(imageSources(undefined, { mint: MINT }), [`https://dd.dexscreener.com/ds-data/tokens/solana/${MINT}.png`]);
  assert.ok(imageSources(`ipfs://${CIDV0}`).every(u => u.startsWith("https://")));
});

test("socialUrl: handles, bare domains and full links become safe https links", () => {
  assert.equal(socialUrl("twitter", "@ghostprint"), "https://x.com/ghostprint");
  assert.equal(socialUrl("twitter", "x.com/ghostprint/status/1"), "https://x.com/ghostprint/status/1");
  assert.equal(socialUrl("twitter", "http://twitter.com/abc"), "https://twitter.com/abc");
  assert.equal(socialUrl("twitter", "https://evil.test/x.com"), null);
  assert.equal(socialUrl("telegram", "t.me/ghostchat"), "https://t.me/ghostchat");
  assert.equal(socialUrl("telegram", "@ghostchat"), "https://t.me/ghostchat");
  assert.equal(socialUrl("website", "ghostprint.app"), "https://ghostprint.app/");
  assert.equal(socialUrl("website", "javascript:alert(1)"), null);
  assert.equal(socialUrl("website", "not a site"), null);
  assert.equal(socialUrl("website", ""), null);
});

const str = s => { const b = Buffer.from(s); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };
const padded = (s, len) => str(s + "\0".repeat(len - s.length));
function metaplexBytes(name, symbol, uri) {
  return new Uint8Array(Buffer.concat([Buffer.from([4]), Buffer.alloc(32, 1), Buffer.alloc(32, 2), padded(name, 32), padded(symbol, 10), padded(uri, 200), Buffer.alloc(40)]));
}
function token2022Bytes(name, symbol, uri) {
  const base = Buffer.alloc(166); base[165] = 1;
  const ptr = Buffer.alloc(4 + 64); ptr.writeUInt16LE(18, 0); ptr.writeUInt16LE(64, 2); // metadata pointer extension, skipped
  const val = Buffer.concat([Buffer.alloc(64, 3), str(name), str(symbol), str(uri), Buffer.alloc(4)]);
  const hdr = Buffer.alloc(4); hdr.writeUInt16LE(19, 0); hdr.writeUInt16LE(val.length, 2);
  return new Uint8Array(Buffer.concat([base, ptr, hdr, val]));
}

test("decodeMetaplex and decodeToken2022Meta read name, symbol and uri", () => {
  assert.deepEqual(decodeMetaplex(metaplexBytes("Ghost Coin", "GHOST", "https://ipfs.io/ipfs/x")), { name: "Ghost Coin", symbol: "GHOST", uri: "https://ipfs.io/ipfs/x" });
  assert.equal(decodeMetaplex(new Uint8Array(10)), null);
  assert.deepEqual(decodeToken2022Meta(token2022Bytes("Pump V2", "PV2", "ipfs://abc")), { name: "Pump V2", symbol: "PV2", uri: "ipfs://abc" });
  assert.equal(decodeToken2022Meta(new Uint8Array(200)), null);
});

test("onchainMeta: Metaplex first, Token-2022 extension for the rest, nothing for unknowns", async () => {
  const a = web3.Keypair.generate().publicKey.toBase58(), b = web3.Keypair.generate().publicKey.toBase58(), c = web3.Keypair.generate().publicKey.toBase58();
  const prog = new web3.PublicKey(METAPLEX), pda = m => web3.PublicKey.findProgramAddressSync([Buffer.from("metadata"), prog.toBuffer(), new web3.PublicKey(m).toBuffer()], prog)[0].toBase58();
  const accounts = new Map([
    [pda(a), { data: Buffer.from(metaplexBytes("Alpha", "ALPHA", "https://m.test/a.json")), owner: prog }],
    [b, { data: Buffer.from(token2022Bytes("Beta", "BETA", "https://m.test/b.json")), owner: new web3.PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") }]
  ]);
  let calls = 0;
  const connection = { getMultipleAccountsInfo: async keys => { calls++; return keys.map(k => accounts.get(k.toBase58()) || null); } };
  const out = await onchainMeta({ connection, web3, mints: [a, b, c] });
  assert.equal(out.get(a).symbol, "ALPHA");
  assert.equal(out.get(b).uri, "https://m.test/b.json");
  assert.equal(out.has(c), false);
  assert.equal(calls, 2);
});

test("identicon: stable per mint, different across mints, always a data URI", () => {
  const a = identicon(MINT), b = identicon(MINT), c = identicon("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^data:image\/svg\+xml,/);
});
