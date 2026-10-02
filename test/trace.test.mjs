import test from "node:test";
import assert from "node:assert/strict";
import { trace, collect, analyze, rpcClient, activityHours, isAddress, readTx } from "../trace.js";
import { createWorld } from "./mockchain.mjs";

test("traces the links a wallet tracker would draw", async () => {
  const w = createWorld();
  const r = await trace(w.W, { url: "mock", fetch: w.fetch });
  assert.equal(r.funding.address, w.F);
  assert.equal(r.funding.lamports, 2.5e9);
  assert.deepEqual(new Set(r.siblings), new Set(w.S));
  assert.ok(r.exchanges.some(e => e.name === "Binance 2" && e.direction === "withdrawal" && !e.via), "direct withdrawal");
  assert.ok(r.exchanges.some(e => e.name === "Binance 2" && e.via === w.D), "deposit through a sweep address");
  assert.equal(r.linked[0].address, w.L);
  assert.ok(!r.linked.some(l => l.address === w.D), "deposit address is not a personal wallet");
  assert.equal(r.poison[0].from, w.P);
  assert.equal(r.poison[0].mimics, w.L);
  assert.equal(r.trades, 40);
  assert.equal(r.hours.offset, -5);
  assert.match(r.hours.zone, /UTC−5 .*Americas/);
  assert.ok(r.score >= 75, `score ${r.score}`);
  assert.equal(r.grade, "Exposed");
  assert.ok(r.findings.some(f => f.k === "Balance" && /42\.14 SOL \+ 17 tokens/.test(f.v)));
  assert.equal(r.findings[0].sev, "high");
  const kinds = r.graph.nodes.map(n => n.kind);
  for (const k of ["you", "exchange", "deposit", "funder", "siblings", "linked"]) assert.ok(kinds.includes(k), k);
  for (const e of r.graph.edges) for (const id of [e.a, e.b]) assert.ok(r.graph.nodes.some(n => n.id === id), `edge end ${id}`);
});

test("does not claim a funder when the start of history was not reached", async () => {
  const w = createWorld();
  const raw = await collect(w.W, { rpc: rpcClient("mock", { fetch: w.fetch }), maxPages: 1, pageSize: 10 });
  assert.equal(raw.reachedStart, false);
  const r = analyze(w.W, raw.txs, raw);
  assert.equal(r.funding, null);
  assert.match(r.findings.find(f => f.k === "Funded by").v, /Not reached/);
});

test("a fresh wallet with no history scores low", async () => {
  const w = createWorld();
  const fresh = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
  const r = await trace(fresh, { url: "mock", fetch: w.fetch });
  assert.equal(r.score, 0);
  assert.equal(r.grade, "Low");
  assert.equal(r.graph.nodes.length, 1);
});

test("rejects things that are not addresses", async () => {
  assert.equal(isAddress("hello"), false);
  assert.equal(isAddress("0x52908400098527886E0F7030069857D2E4169EE7"), false);
  assert.equal(isAddress("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"), true);
  await assert.rejects(trace("nope", { url: "mock", fetch: async () => { throw new Error("should not fetch"); } }), /isn't a Solana address/);
});

test("rpc client retries rate limits, then gives a readable error", async () => {
  let n = 0;
  const flaky = async () => (++n < 3 ? { ok: false, status: 429 } : { ok: true, status: 200, json: async () => ({ result: 5 }) });
  assert.equal(await rpcClient("x", { fetch: flaky, backoff: 1 }).call("getSlot", []), 5);
  const dead = async () => ({ ok: false, status: 429 });
  await assert.rejects(rpcClient("x", { fetch: dead, backoff: 1, retries: 2 }).call("getSlot", []), /rate limiting/);
});

test("no time zone from thin or round-the-clock activity", () => {
  const few = Array.from({ length: 10 }, (_, i) => ({ time: i * 3600 }));
  assert.equal(activityHours(few).zone, null);
  const allDay = Array.from({ length: 240 }, (_, i) => ({ time: i * 3600 }));
  assert.equal(activityHours(allDay).zone, null);
});

test("legacy string account keys are read", () => {
  const tx = { blockTime: 1, transaction: { signatures: ["s"], message: { accountKeys: ["A", "B"], instructions: [{ program: "system", programId: "11111111111111111111111111111111", parsed: { type: "transfer", info: { source: "B", destination: "A", lamports: 5 } } }] } }, meta: {} };
  const r = readTx(tx, "A");
  assert.deepEqual(r.sol, [{ from: "B", to: "A", lamports: 5 }]);
  assert.equal(r.ownerSigned, false);
});
