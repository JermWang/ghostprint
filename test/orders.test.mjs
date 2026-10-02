import test from "node:test";
import assert from "node:assert/strict";
import web3 from "@solana/web3.js";
import { triggerApi, limitAmounts, signAndExecute, describeOrder, evaluateRule, newRule, ruleTarget } from "../orders.js";
import { jupiter, SOL_MINT } from "../swap.js";

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

test("limit amounts: buy and sell at a USD price, exact for large supplies", () => {
  // token at $0.0001, SOL at $100 → 1e-6 SOL per token
  const buy = limitAmounts({ side: "buy", mint: MINT, amountRaw: 1_000_000_000n, priceUsd: 0.0001, solUsd: 100, decimals: 6 });
  assert.equal(buy.inputMint, SOL_MINT); assert.equal(buy.outputMint, MINT);
  assert.equal(buy.making, 1_000_000_000n); assert.equal(buy.taking, 1_000_000_000_000n); // 1 SOL buys 1M tokens (6 dp)
  const sell = limitAmounts({ side: "sell", mint: MINT, amountRaw: 500_000_000_000n, priceUsd: 0.0002, solUsd: 100, decimals: 6 });
  assert.equal(sell.inputMint, MINT); assert.equal(sell.taking, 1_000_000_000n); // 500k tokens at 2e-6 SOL = 1 SOL
  const huge = limitAmounts({ side: "sell", mint: MINT, amountRaw: 900_000_000_000_000_000n, priceUsd: 1e-9, solUsd: 150, decimals: 9 });
  assert.equal(huge.taking, 6_000_000n); // 9e8 tokens × 6.67e-12 SOL = 0.006 SOL
  assert.throws(() => limitAmounts({ side: "buy", mint: MINT, amountRaw: 1n, priceUsd: 0, solUsd: 1, decimals: 6 }), /target price/);
});

test("trigger client sends the documented Trigger v1 requests", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => ({ requestId: "r1", transaction: "", order: "O1" }) }; };
  const api = triggerApi(jupiter({ fetch }));
  await api.create({ inputMint: SOL_MINT, outputMint: MINT, maker: "M", making: 5n, taking: 7n, slippageBps: 50 });
  assert.match(calls[0].url, /\/trigger\/v1\/createOrder$/);
  assert.deepEqual(calls[0].body, { inputMint: SOL_MINT, outputMint: MINT, maker: "M", payer: "M", params: { makingAmount: "5", takingAmount: "7", slippageBps: "50" }, computeUnitPrice: "auto", wrapAndUnwrapSol: true });
  await api.cancel("M", "O1");
  assert.deepEqual(calls[1].body, { maker: "M", order: "O1", computeUnitPrice: "auto" });
  await api.list("M");
  assert.match(calls[2].url, /getTriggerOrders\?user=M&orderStatus=active&page=1&includeFailedTx=false$/);
});

test("signAndExecute signs Jupiter's transaction and submits it base64", async () => {
  const kp = web3.Keypair.generate();
  const msg = new web3.TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: web3.Keypair.generate().publicKey.toBase58(), instructions: [web3.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 })] }).compileToV0Message();
  const unsigned = Buffer.from(new web3.VersionedTransaction(msg).serialize()).toString("base64");
  let sent;
  const api = { execute: async (signedTransaction, requestId) => { sent = { signedTransaction, requestId }; return { status: "Success", signature: "SIG", order: "O" }; } };
  const r = await signAndExecute({ web3, api, res: { transaction: unsigned, requestId: "R" }, sign: async tx => { tx.sign([kp]); return tx; } });
  assert.deepEqual(r, { signature: "SIG", order: "O" });
  const back = web3.VersionedTransaction.deserialize(Buffer.from(sent.signedTransaction, "base64"));
  assert.ok(back.signatures[0].some(b => b !== 0)); assert.equal(sent.requestId, "R");
  await assert.rejects(signAndExecute({ web3, api: { execute: async () => ({ status: "Failed", error: "boom" }) }, res: { transaction: unsigned, requestId: "R" }, sign: async tx => tx }), /boom/);
});

test("describe a Trigger order", () => {
  const d = describeOrder({ orderKey: "K", inputMint: SOL_MINT, outputMint: MINT, makingAmount: "1", takingAmount: "1000000", remainingMakingAmount: "0.25", status: "Open" }, 100);
  assert.equal(d.side, "buy"); assert.equal(d.mint, MINT); assert.ok(Math.abs(d.priceUsd - 0.0001) < 1e-15); assert.equal(d.filledPct, 75);
});

test("autopilot rules: take-profit, stop-loss and trailing stop", () => {
  const tp = newRule({ wallet: "W", mint: MINT, symbol: "B", kind: "tp", pct: 50, entryUsd: 1 });
  assert.equal(evaluateRule(tp, 1.49).fire, false); assert.equal(evaluateRule(tp, 1.5).fire, true);
  const sl = newRule({ wallet: "W", mint: MINT, symbol: "B", kind: "sl", pct: 20, entryUsd: 1 });
  assert.equal(evaluateRule(sl, 0.81).fire, false); assert.equal(evaluateRule(sl, 0.8).fire, true);
  const tr = newRule({ wallet: "W", mint: MINT, symbol: "B", kind: "trail", pct: 10, entryUsd: 1 });
  let r = evaluateRule(tr, 2); assert.equal(r.fire, false); tr.peakUsd = r.peakUsd;
  assert.equal(ruleTarget(tr), 1.8);
  assert.equal(evaluateRule(tr, 1.85).fire, false); assert.equal(evaluateRule(tr, 1.79).fire, true);
  assert.equal(evaluateRule({ ...sl, status: "done" }, 0.1).fire, false);
  assert.throws(() => newRule({ wallet: "W", mint: MINT, kind: "sl", pct: 120, entryUsd: 1 }), /percentage/);
  assert.throws(() => newRule({ wallet: "W", mint: MINT, kind: "tp", pct: 10, entryUsd: 0 }), /No price/);
});
