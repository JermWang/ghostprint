import test from "node:test";
import assert from "node:assert/strict";
import web3 from "@solana/web3.js";
import { toRaw, fromRaw, feeOnBuy, feeOnSell, buildSwapTx, prepareSwap, jupiter, SOL_MINT } from "../swap.js";
import { quoteFor, instructionsFor, handleJupiter } from "./jupmock.mjs";

const TREASURY = "DGorZp9ari8RGGdiQbXCsQ62HDmkxSL66xxQcYvWfWMP";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

// Decode the compiled transaction back into readable instructions.
function readable(tx) {
  const keys = tx.message.staticAccountKeys.map(k => k.toBase58());
  return tx.message.compiledInstructions.map(ci => {
    const program = keys[ci.programIdIndex], data = Buffer.from(ci.data);
    if (program === "11111111111111111111111111111111" && data.readUInt32LE(0) === 2)
      return { kind: "transfer", from: keys[ci.accountKeyIndexes[0]], to: keys[ci.accountKeyIndexes[1]], lamports: data.readBigUInt64LE(4) };
    return { kind: program.startsWith("Memo") ? data.toString() : "compute" };
  });
}

test("decimal amounts convert without floating point", () => {
  assert.equal(toRaw("1.5", 9), 1_500_000_000n);
  assert.equal(toRaw("0.000000001", 9), 1n);
  assert.equal(toRaw("0.0000000019", 9), 1n);
  assert.equal(toRaw("12", 0), 12n);
  assert.equal(toRaw("abc", 9), null);
  assert.equal(toRaw("", 9), null);
  assert.equal(fromRaw(1_500_000_000n, 9), "1.5");
  assert.equal(fromRaw(123456789n, 5, 2), "1234.56");
});

test("fee math: buys take it off the input, sells off the guaranteed minimum", () => {
  assert.deepEqual(feeOnBuy(1_000_000_000n, 50), { fee: 5_000_000n, swapAmount: 995_000_000n });
  assert.equal(feeOnSell({ otherAmountThreshold: "2000000000" }, 50), 10_000_000n);
  assert.deepEqual(feeOnBuy(199n, 50), { fee: 0n, swapAmount: 199n });
});

test("buy transaction pays the treasury before the swap", () => {
  const user = web3.Keypair.generate().publicKey.toBase58();
  const tx = buildSwapTx(web3, { parts: instructionsFor(user), user, treasury: TREASURY, fee: 5_000_000n, side: "buy", blockhash: web3.Keypair.generate().publicKey.toBase58() });
  const steps = readable(tx);
  assert.deepEqual(steps.map(s => s.kind), ["compute", "setup", "transfer", "swap", "cleanup"]);
  assert.deepEqual(steps[2], { kind: "transfer", from: user, to: TREASURY, lamports: 5_000_000n });
  assert.equal(tx.message.staticAccountKeys[0].toBase58(), user, "user pays network fees");
});

test("sell transaction pays the treasury after the SOL is unwrapped", () => {
  const user = web3.Keypair.generate().publicKey.toBase58();
  const tx = buildSwapTx(web3, { parts: instructionsFor(user), user, treasury: TREASURY, fee: 7n, side: "sell", blockhash: web3.Keypair.generate().publicKey.toBase58() });
  assert.deepEqual(readable(tx).map(s => s.kind), ["compute", "setup", "swap", "cleanup", "transfer"]);
});

test("no fee, no transfer", () => {
  const user = web3.Keypair.generate().publicKey.toBase58();
  const tx = buildSwapTx(web3, { parts: instructionsFor(user), user, treasury: TREASURY, fee: 0n, side: "buy", blockhash: web3.Keypair.generate().publicKey.toBase58() });
  assert.ok(!readable(tx).some(s => s.kind === "transfer"));
});

const fakeFetch = async (url, init = {}) => ({ ok: true, status: 200, json: async () => handleJupiter(url, init.body ? JSON.parse(init.body) : null) });
const connection = { getLatestBlockhash: async () => ({ blockhash: web3.Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }), getAddressLookupTable: async () => ({ value: null }) };

test("prepareSwap quotes the post-fee amount on buys", async () => {
  const kp = web3.Keypair.generate(), user = kp.publicKey.toBase58();
  const r = await prepareSwap({ web3, jup: jupiter({ fetch: fakeFetch }), connection, side: "buy", mint: MINT, amountRaw: 1_000_000_000n, user, treasury: TREASURY, feeBps: 50, slippageBps: 300, priorityMaxLamports: 1e6 });
  assert.equal(r.quote.inAmount, "995000000");
  assert.equal(r.quote.inputMint, SOL_MINT);
  assert.equal(r.fee, 5_000_000n);
  r.tx.sign([kp]);
  assert.equal(readable(web3.VersionedTransaction.deserialize(r.tx.serialize())).find(s => s.kind === "transfer").lamports, 5_000_000n);
});

test("prepareSwap charges sells on the guaranteed minimum", async () => {
  const user = web3.Keypair.generate().publicKey.toBase58();
  const r = await prepareSwap({ web3, jup: jupiter({ fetch: fakeFetch }), connection, side: "sell", mint: MINT, amountRaw: 2_000_000_000_000n, user, treasury: TREASURY, feeBps: 50, slippageBps: 300, priorityMaxLamports: 1e6 });
  const q = quoteFor({ inputMint: MINT, outputMint: SOL_MINT, amount: 2_000_000_000_000n, slippageBps: 300 });
  assert.equal(r.fee, BigInt(q.otherAmountThreshold) * 50n / 10000n);
});

test("Jupiter errors become readable messages", async () => {
  const limited = jupiter({ fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  await assert.rejects(limited.quote({ inputMint: SOL_MINT, outputMint: MINT, amount: 1n, slippageBps: 1 }), /rate limiting/);
  const noRoute = jupiter({ fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: "Could not find any route", errorCode: "COULD_NOT_FIND_ANY_ROUTE" }) }) });
  await assert.rejects(noRoute.quote({ inputMint: SOL_MINT, outputMint: MINT, amount: 1n, slippageBps: 1 }), /No route/);
  let sent;
  const keyed = jupiter({ apiKey: "k", fetch: async (u, init) => { sent = init; return { ok: true, status: 200, json: async () => ([]) }; } });
  await keyed.search("bonk");
  assert.equal(sent.headers["x-api-key"], "k");
});
