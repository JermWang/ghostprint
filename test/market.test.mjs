import test from "node:test";
import assert from "node:assert/strict";
import { createBoard, fromPumpPortal, fromJupiter, walletSwaps, pnl, isPumpMint } from "../market.js";

test("board sorts tokens into New Pairs, Final Stretch and Migrated", () => {
  const b = createBoard({ finalStretch: 60 });
  const now = Date.now();
  b.upsert({ mint: "Anewpump", symbol: "NEW", createdAt: now - 1000, pump: true, progress: 5 });
  b.upsert({ mint: "Bolderpump", symbol: "OLD", createdAt: now - 5000, pump: true, progress: 10 });
  b.upsert({ mint: "Cfinalpump", symbol: "FIN", createdAt: now - 9000, pump: true, progress: 82 });
  b.upsert({ mint: "Dfinal2pump", symbol: "FN2", createdAt: now - 9000, pump: true, progress: 95 });
  b.upsert({ mint: "Edonepump", symbol: "DONE", createdAt: now - 9000, pump: true, progress: 99 });
  b.migrate("Edonepump");
  const c = b.columns();
  assert.deepEqual(c.new.map(t => t.symbol), ["NEW", "OLD"]);
  assert.deepEqual(c.final.map(t => t.symbol), ["FN2", "FIN"]);
  assert.deepEqual(c.migrated.map(t => t.symbol), ["DONE"]);
  assert.deepEqual(b.curveTargets(), ["Dfinal2pump", "Cfinalpump", "Bolderpump", "Anewpump"]);
});

test("board merges updates, filters and expires", () => {
  const b = createBoard();
  b.upsert({ mint: "Xpump", symbol: "X", createdAt: Date.now(), pump: true, mcapUsd: 5000 });
  b.upsert({ mint: "Xpump", progress: 30, mcapUsd: undefined, twitter: "https://x.com/x" });
  const t = b.tokens.get("Xpump");
  assert.equal(t.symbol, "X"); assert.equal(t.progress, 30); assert.equal(t.mcapUsd, 5000);
  assert.equal(b.columns({ minMcap: 10000 }).new.length, 0);
  assert.equal(b.columns({ q: "x", socials: true }).new.length, 1);
  b.upsert({ mint: "Old", createdAt: Date.now() - 7 * 3600_000 });
  assert.equal(b.columns().new.length, 1);
  b.upsert({ mint: "C", complete: true });
  assert.equal(b.column(b.tokens.get("C")), "migrated");
});

test("PumpPortal and Jupiter records map onto the board", () => {
  const p = fromPumpPortal({ mint: "Mpump", name: "Moon", symbol: "MOON", traderPublicKey: "Dev", marketCapSol: 30, solAmount: 1, uri: "https://ipfs.io/ipfs/x", pool: "pump" }, 150);
  assert.equal(p.mcapUsd, 4500); assert.equal(p.pump, true); assert.equal(p.creator, "Dev");
  const j = fromJupiter({ id: "Jmint", name: "J", symbol: "J", icon: "https://i", mcap: 1e6, holderCount: 321, launchpad: "pump.fun", graduatedPool: "Pool", graduatedAt: "2026-10-01T00:00:00Z", firstPool: { createdAt: "2026-09-30T00:00:00Z" }, audit: { topHoldersPercentage: 22.5, mintAuthorityDisabled: true }, stats24h: { buyVolume: 10, sellVolume: 5 } });
  assert.equal(j.pump, true); assert.equal(j.holders, 321); assert.equal(j.volume24h, 15); assert.equal(j.topHoldersPct, 22.5);
  assert.equal(j.graduatedAt, Date.parse("2026-10-01T00:00:00Z"));
  assert.ok(isPumpMint("abcpump")); assert.ok(!isPumpMint("abc"));
});

test("wallet tracker reads a swap: token in, SOL out", () => {
  const W = "Wallet1111111111111111111111111111111111111", MINT = "Mint11111111111111111111111111111111111111";
  const tx = { blockTime: 100, transaction: { signatures: ["sig"], message: { accountKeys: [{ pubkey: W, signer: true }, { pubkey: "Pool" }, { pubkey: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" }], instructions: [{ programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", data: "x", accounts: [] }] } },
    meta: { preBalances: [3e9, 0, 1], postBalances: [2.5e9, 0, 1], preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint: MINT, owner: W, uiTokenAmount: { uiAmount: 1234, decimals: 6 } }] } };
  assert.deepEqual(walletSwaps(tx, W), [{ sig: "sig", time: 100, wallet: W, mint: MINT, side: "buy", tokens: 1234, sol: 0.5 }]);
  assert.deepEqual(walletSwaps(tx, "Someone"), []);
});

test("PnL: average cost, realized and unrealized", () => {
  const rows = pnl([
    { mint: "A", symbol: "A", side: "buy", sol: 1, tokens: 1000 },
    { mint: "A", side: "buy", sol: 3, tokens: 1000 },
    { mint: "A", side: "sell", sol: 3, tokens: 1000 }
  ], { A: 0.004 });
  const a = rows[0];
  assert.equal(a.avg, 0.002); assert.equal(a.holding, 1000); assert.equal(a.realized, 1);
  assert.equal(a.value, 4); assert.equal(a.unrealized, 2); assert.equal(a.total, 3); assert.equal(a.pct, 75);
  assert.equal(pnl([{ mint: "B", side: "buy", sol: 1, tokens: 10 }])[0].unrealized, null);
});

test("on-chain history merges into the trade log without duplicates", async () => {
  const { mergeHistory } = await import("../market.js");
  const log = [{ sig: "a", mint: "M", time: 5000, side: "buy", sol: 1, tokens: 10 }];
  const merged = mergeHistory(log, [{ sig: "a", mint: "M", time: 5, side: "buy", sol: 1, tokens: 10 }, { sig: "b", mint: "M", time: 9, side: "sell", sol: 2, tokens: 10 }], () => "SYM");
  assert.equal(merged.length, 2); assert.equal(merged[0].sig, "b"); assert.equal(merged[0].time, 9000); assert.equal(merged[0].from, "chain"); assert.equal(merged[0].symbol, "SYM");
});
