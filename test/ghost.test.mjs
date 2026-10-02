import test from "node:test";
import assert from "node:assert/strict";
import web3 from "@solana/web3.js";
import { deriveGhost, seedFingerprint, oneclick, routeQuote, checkQuote, fundingTx, exitTx, exitAmount, waitForRoute, solAssetId, SOL_ASSET, GHOST_MESSAGE } from "../ghost.js";
import { createOneClick } from "./oneclickmock.mjs";
import { createRequire } from "node:module";
const { ed25519 } = createRequire(import.meta.url)("@noble/curves/ed25519");
const signWith = (msg, kp) => ed25519.sign(msg, kp.secretKey.slice(0, 32));

const TREASURY = "DGorZp9ari8RGGdiQbXCsQ62HDmkxSL66xxQcYvWfWMP";
const main = web3.Keypair.generate();
const sig = signWith(new TextEncoder().encode(GHOST_MESSAGE), main);

test("ghost wallets are deterministic per signature and index, and unrelated to the main key", async () => {
  const a0 = await deriveGhost(web3, sig, 0), a0b = await deriveGhost(web3, sig, 0), a1 = await deriveGhost(web3, sig, 1);
  assert.equal(a0.publicKey.toBase58(), a0b.publicKey.toBase58());
  assert.notEqual(a0.publicKey.toBase58(), a1.publicKey.toBase58());
  assert.notEqual(a0.publicKey.toBase58(), main.publicKey.toBase58());
  const other = signWith(new TextEncoder().encode(GHOST_MESSAGE), web3.Keypair.generate());
  assert.notEqual((await deriveGhost(web3, other, 0)).publicKey.toBase58(), a0.publicKey.toBase58());
  assert.equal((await seedFingerprint(sig)).length, 16);
});

test("finds native SOL in the 1Click token list", () => {
  assert.equal(solAssetId([{ assetId: "x", blockchain: "sol", symbol: "SOL", contractAddress: "So111" }, { assetId: "nep141:sol.omft.near", blockchain: "sol", symbol: "SOL" }]), "nep141:sol.omft.near");
  assert.equal(solAssetId(null), SOL_ASSET);
});

test("route quote asks for Confidential Intents and pays exactly the ghost", async () => {
  const m = createOneClick();
  const ghost = (await deriveGhost(web3, sig, 0)).publicKey.toBase58();
  const r = await routeQuote({ oc: oneclick({ fetch: m.fetch }), amount: 995_000_000n, from: main.publicKey.toBase58(), to: ghost });
  assert.equal(r.confidential, true);
  const sent = m.quotes[0];
  assert.equal(sent.confidentiality, "basic");
  assert.equal(sent.recipient, ghost);
  assert.equal(sent.refundTo, main.publicKey.toBase58());
  assert.equal(sent.originAsset, SOL_ASSET);
  assert.equal(sent.destinationAsset, SOL_ASSET);
  assert.equal(sent.amount, "995000000");
  assert.equal(sent.dry, false);
  assert.equal(sent.recipientType, "DESTINATION_CHAIN");
});

test("falls back to standard intents when the confidential rail refuses, and says so", async () => {
  const m = createOneClick({ confidential: false });
  const r = await routeQuote({ oc: oneclick({ fetch: m.fetch }), amount: 1000n, from: main.publicKey.toBase58(), to: web3.Keypair.generate().publicKey.toBase58() });
  assert.equal(r.confidential, false);
  assert.equal(m.quotes.length, 2);
  assert.equal(m.quotes[1].confidentiality, undefined);
});

test("refuses tampered quotes", async () => {
  const to = web3.Keypair.generate().publicKey.toBase58(), from = main.publicKey.toBase58();
  for (const [tamper, why] of [
    [r => { r.quoteRequest.recipient = web3.Keypair.generate().publicKey.toBase58(); }, /different wallet/],
    [r => { r.quote.amountIn = "1"; }, /amount changed/],
    [r => { r.quote.depositAddress = "0xdeadbeef"; }, /deposit address/],
    [r => { r.quote.depositAddress = to; }, /your own wallets/],
    [r => { r.quoteRequest.destinationAsset = "nep141:usdc"; }, /different assets/]
  ]) {
    const m = createOneClick({ tamper });
    await assert.rejects(routeQuote({ oc: oneclick({ fetch: m.fetch }), amount: 1000n, from, to }), why);
  }
});

test("funding transaction pays the deposit address and the treasury fee", () => {
  const dep = web3.Keypair.generate().publicKey.toBase58();
  const tx = fundingTx(web3, { from: main.publicKey.toBase58(), depositAddress: dep, amount: 995n, fee: 5n, treasury: TREASURY, blockhash: web3.Keypair.generate().publicKey.toBase58() });
  const keys = tx.message.staticAccountKeys.map(k => k.toBase58());
  const xfers = tx.message.compiledInstructions.map(ci => ({ to: keys[ci.accountKeyIndexes[1]], lamports: Buffer.from(ci.data).readBigUInt64LE(4) }));
  assert.deepEqual(xfers, [{ to: dep, lamports: 995n }, { to: TREASURY, lamports: 5n }]);
});

test("exit closes token accounts, sends everything left, and is signed by the ghost", async () => {
  const ghost = await deriveGhost(web3, sig, 3), dep = web3.Keypair.generate().publicKey.toBase58();
  const close = [{ address: web3.Keypair.generate().publicKey.toBase58(), programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", lamports: 2_039_280 }];
  const amount = exitAmount(10_000_000n, close);
  assert.equal(amount, 10_000_000n + 2_039_280n - 5000n);
  const tx = exitTx(web3, { ghost, depositAddress: dep, amount, closeAccounts: close, blockhash: web3.Keypair.generate().publicKey.toBase58() });
  const keys = tx.message.staticAccountKeys.map(k => k.toBase58());
  const [closeIx, sendIx] = tx.message.compiledInstructions;
  assert.equal(keys[closeIx.programIdIndex], "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  assert.deepEqual([...closeIx.data], [9]);
  assert.equal(keys[sendIx.accountKeyIndexes[1]], dep);
  assert.equal(Buffer.from(sendIx.data).readBigUInt64LE(4), amount);
  assert.ok(ed25519.verify(tx.signatures[0], tx.message.serialize(), ghost.publicKey.toBytes()));
  assert.equal(exitAmount(3000n), 0n);
});

test("waits through NEAR Intents statuses to SUCCESS", async () => {
  const m = createOneClick({ pollsUntilDone: 3 }), oc = oneclick({ fetch: m.fetch });
  const r = await routeQuote({ oc, amount: 1000n, from: main.publicKey.toBase58(), to: web3.Keypair.generate().publicKey.toBase58() });
  const seen = [];
  const st = await waitForRoute(oc, r.quote.depositAddress, { interval: 1, onStatus: s => seen.push(s) });
  assert.equal(st.status, "SUCCESS");
  assert.deepEqual(seen, ["PENDING_DEPOSIT", "PROCESSING", "SUCCESS"]);
});

test("refunds and failures stop the wait with a clear message", async () => {
  for (const [status, re] of [["REFUNDED", /refunded/], ["FAILED", /failed/]]) {
    const oc = { status: async () => ({ status }) };
    await assert.rejects(waitForRoute(oc, "x", { interval: 1 }), re);
  }
  let t = 0;
  await assert.rejects(waitForRoute({ status: async () => ({ status: "PROCESSING" }) }, "x", { interval: 1, timeoutMs: 5, now: () => (t += 3) }), /longer than expected/);
});

test("1Click client sends the JWT when configured", async () => {
  let h;
  await oneclick({ jwt: "abc", fetch: async (u, init) => { h = init.headers; return { ok: true, status: 200, json: async () => [] }; } }).tokens();
  assert.equal(h.authorization, "Bearer abc");
});
