import test from "node:test";
import assert from "node:assert/strict";
import web3 from "@solana/web3.js";
import { decodeCurve, curveProgress, bondingCurveAddress, findTradeEvent, tradesFromLogs, tradesFromTx, eventPriceSol, INITIAL_REAL_TOKEN_RESERVES, TRADE_EVENT } from "../pump.js";

const le = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
export function curveBytes({ vTok, vSol, realTok, realSol = 0n, supply = 1_000_000_000_000_000n, complete = false }) {
  return new Uint8Array(Buffer.concat([Buffer.from("17b7f83760d8ac60", "hex"), le(vTok), le(vSol), le(realTok), le(realSol), le(supply), Buffer.from([complete ? 1 : 0]), Buffer.alloc(32)]));
}
export function tradeBytes({ mint, user, sol, tok, isBuy, ts = 1_790_000_000, vSol = 40_000_000_000n, vTok = 800_000_000_000_000n }, prefix = Buffer.alloc(0)) {
  return new Uint8Array(Buffer.concat([prefix, Buffer.from(TRADE_EVENT), new web3.PublicKey(mint).toBuffer(), le(sol), le(tok), Buffer.from([isBuy ? 1 : 0]), new web3.PublicKey(user).toBuffer(), le(ts), le(vSol), le(vTok), le(1), le(2), Buffer.alloc(40)]));
}

test("bonding curve: fresh, mid-way and complete", () => {
  const fresh = decodeCurve(curveBytes({ vTok: 1_073_000_000_000_000n, vSol: 30_000_000_000n, realTok: INITIAL_REAL_TOKEN_RESERVES }));
  assert.equal(fresh.progress, 0);
  assert.ok(Math.abs(fresh.mcapSol - 27.96) < 0.01, `mcap ${fresh.mcapSol}`);
  const mid = decodeCurve(curveBytes({ vTok: 600_000_000_000_000n, vSol: 53_650_000_000n, realTok: 396_550_000_000_000n }));
  assert.equal(mid.progress, 50);
  const done = decodeCurve(curveBytes({ vTok: 279_900_000_000_000n, vSol: 115_000_000_000n, realTok: 0n, complete: true }));
  assert.equal(done.progress, 100);
  assert.equal(done.complete, true);
  assert.equal(decodeCurve(new Uint8Array(10)), null);
  assert.equal(curveProgress({ complete: false, realTokenReserves: INITIAL_REAL_TOKEN_RESERVES * 2n }), 0);
});

test("bonding curve address is the pump program PDA", () => {
  const mint = web3.Keypair.generate().publicKey.toBase58();
  const [expected] = web3.PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new web3.PublicKey(mint).toBuffer()], new web3.PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"));
  assert.equal(bondingCurveAddress(web3, mint), expected.toBase58());
});

test("trade events decode from logs and from emit_cpi inner instruction data", () => {
  const mint = web3.Keypair.generate().publicKey.toBase58(), user = web3.Keypair.generate().publicKey.toBase58();
  const raw = tradeBytes({ mint, user, sol: 1_500_000_000n, tok: 42_000_000_000n, isBuy: true });
  const ev = findTradeEvent(raw);
  assert.equal(ev.mint, mint); assert.equal(ev.user, user); assert.equal(ev.solAmount, 1_500_000_000n); assert.equal(ev.tokenAmount, 42_000_000_000n); assert.equal(ev.isBuy, true); assert.equal(ev.timestamp, 1_790_000_000);
  assert.ok(Math.abs(eventPriceSol(ev) - 5e-8) < 1e-15, `price ${eventPriceSol(ev)}`);
  const logs = ["Program log: Instruction: Buy", `Program data: ${Buffer.from(raw).toString("base64")}`, "Program data: AAAA"];
  assert.equal(tradesFromLogs(logs).length, 1);
  const tagged = tradeBytes({ mint, user, sol: 1n, tok: 2n, isBuy: false }, Buffer.from("e445a52e51cb9a1d", "hex"));
  const tx = { meta: { innerInstructions: [{ instructions: [{ data: "x" }, { data: "tagged" }] }], logMessages: [] } };
  const got = tradesFromTx(tx, d => d === "tagged" ? tagged : new Uint8Array(4));
  assert.equal(got.length, 1); assert.equal(got[0].isBuy, false);
  assert.equal(findTradeEvent(new Uint8Array(200)), null);
});
