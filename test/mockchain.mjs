// An in-memory Solana chain that answers the RPC calls trace.js makes, in jsonParsed shape.
import { base58Encode, KNOWN } from "../trace.js";

const SYS = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const WSOL = "So11111111111111111111111111111111111111112";
const BINANCE = Object.keys(KNOWN)[0];

export function createWorld(seed = 7) {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const bytes = n => Uint8Array.from({ length: n }, () => (rand() * 256) | 0);
  const addr = () => base58Encode(bytes(32));
  const sigOf = () => base58Encode(bytes(64));

  const txs = new Map(), byAddr = new Map(), balances = new Map(), tokens = new Map();
  const index = (sig, keys) => { for (const k of new Set(keys)) { if (!byAddr.has(k)) byAddr.set(k, []); byAddr.get(k).push(sig); } };
  const put = (time, keys, instructions, meta) => {
    const sig = sigOf();
    txs.set(sig, {
      blockTime: time, slot: time,
      transaction: { signatures: [sig], message: { accountKeys: keys, instructions } },
      meta: { err: null, preBalances: keys.map(() => 0), postBalances: keys.map(() => 0), innerInstructions: [], preTokenBalances: [], postTokenBalances: [], ...meta }
    });
    index(sig, keys.map(k => k.pubkey));
    return sig;
  };
  const k = (pubkey, signer = false) => ({ pubkey, signer, writable: true, source: "transaction" });

  function solTransfer(from, to, lamports, time) {
    return put(time, [k(from, true), k(to), k(SYS)], [{ program: "system", programId: SYS, parsed: { type: "transfer", info: { source: from, destination: to, lamports } } }],
      { preBalances: [lamports * 2, 0, 1], postBalances: [lamports, lamports, 1] });
  }
  function tokenTransfer(from, to, mint, amount, time) {
    const a = addr(), b = addr();
    const bal = (i, owner, ui) => ({ accountIndex: i, mint, owner, uiTokenAmount: { uiAmount: ui, decimals: 6, amount: String(ui * 1e6) } });
    return put(time, [k(from, true), k(a), k(b), k(TOKEN)],
      [{ program: "spl-token", programId: TOKEN, parsed: { type: "transferChecked", info: { source: a, destination: b, mint, authority: from, tokenAmount: { uiAmount: amount, decimals: 6 } } } }],
      { preTokenBalances: [bal(1, from, amount), bal(2, to, 0)], postTokenBalances: [bal(1, from, 0), bal(2, to, amount)] });
  }
  function swap(owner, mint, side, time) {
    const ata = addr(), pool = addr();
    const before = side === "buy" ? 0 : 1000, after = side === "buy" ? 1000 : 0;
    const bal = (ui) => ({ accountIndex: 1, mint, owner, uiTokenAmount: { uiAmount: ui, decimals: 6, amount: String(ui * 1e6) } });
    return put(time, [k(owner, true), k(ata), k(pool), k(PUMP)], [{ programId: PUMP, accounts: [owner, ata, pool], data: "3Bxs4h24hBtQy9rw" }],
      { preTokenBalances: [bal(before)], postTokenBalances: [bal(after)],
        innerInstructions: [{ index: 0, instructions: [{ program: "system", programId: SYS, parsed: { type: "transfer", info: { source: owner, destination: pool, lamports: 1e8 } } }] }] });
  }

  const T0 = Date.UTC(2026, 3, 1) / 1000, DAY = 86400, H = 3600;
  const W = addr(), F = addr(), L = addr(), D = addr(), S = [addr(), addr(), addr()];
  // a lookalike of L: same first and last four characters
  let P; do { const x = addr(); P = L.slice(0, 4) + x.slice(4, -4) + L.slice(-4); } while (P === L);
  const mints = Array.from({ length: 12 }, addr);

  solTransfer(F, W, 2.5e9, T0 + 15 * H);                         // first funding
  S.forEach((x, i) => solTransfer(F, x, 1.5e9, T0 + 16 * H + i)); // siblings
  solTransfer(BINANCE, W, 10e9, T0 + 2 * DAY + 18 * H);           // exchange withdrawal
  for (let i = 0; i < 3; i++) solTransfer(W, L, 1e9, T0 + (3 + i) * DAY + 20 * H);
  solTransfer(L, W, 0.5e9, T0 + 7 * DAY + 21 * H);
  tokenTransfer(W, L, mints[0], 500, T0 + 8 * DAY + 22 * H);
  solTransfer(W, D, 3e9, T0 + 9 * DAY + 16 * H);                 // deposit address...
  solTransfer(D, BINANCE, 3e9, T0 + 9 * DAY + 16 * H + 600);      // ...sweeps to Binance
  solTransfer(P, W, 1000, T0 + 9 * DAY + 23 * H);                // poisoning dust
  // 40 swaps, all between 13:00 and 04:59 UTC: someone asleep 05:00–12:00 UTC (UTC−5)
  const awake = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4];
  for (let i = 0; i < 40; i++) swap(W, mints[i % 12], i % 3 ? "buy" : "sell", T0 + (10 + (i >> 2)) * DAY + awake[(i * 7) % awake.length] * H + i * 60);

  balances.set(W, 42.137e9); balances.set(F, 0.2e9); balances.set(L, 3e9); balances.set(D, 0); balances.set(BINANCE, 1.7e15);
  tokens.set(W, 17);

  function handle(method, params) {
    switch (method) {
      case "getSignaturesForAddress": {
        const [a, opt = {}] = params;
        const list = (byAddr.get(a) || []).map(sig => ({ signature: sig, blockTime: txs.get(sig).blockTime, err: null, slot: txs.get(sig).slot }))
          .sort((x, y) => y.blockTime - x.blockTime || (x.signature < y.signature ? -1 : 1));
        let start = 0;
        if (opt.before) start = list.findIndex(x => x.signature === opt.before) + 1;
        return list.slice(start, start + (opt.limit || 1000));
      }
      case "getTransaction": return txs.get(params[0]) || null;
      case "getBalance": return { context: { slot: 1 }, value: balances.get(params[0]) || 0 };
      case "getTokenAccountsByOwner": {
        const n = params[1].programId === TOKEN ? tokens.get(params[0]) || 0 : 0;
        return { context: { slot: 1 }, value: Array.from({ length: n }, () => ({ pubkey: addr(), account: { data: { parsed: { info: { tokenAmount: { amount: "5" } } } } } })) };
      }
      default: throw new Error("unmocked " + method);
    }
  }
  const calls = [];
  async function fetch(url, init) {
    const body = JSON.parse(init.body);
    calls.push(body.method);
    let result, error;
    try { result = handle(body.method, body.params); } catch (e) { error = { code: -32601, message: e.message }; }
    return { ok: true, status: 200, json: async () => error ? { jsonrpc: "2.0", id: body.id, error } : { jsonrpc: "2.0", id: body.id, result } };
  }
  return { W, F, L, D, P, S, BINANCE, handle, fetch, calls, sigCount: a => (byAddr.get(a) || []).length };
}
