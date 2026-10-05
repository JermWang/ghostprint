// Injected into the terminal before it loads (see record.mjs). Two things, neither of which touches the app's code:
//  1. A demo wallet: a real ed25519 keypair from a fixed seed that answers connect and signTransaction like a wallet
//     extension. It holds nothing on-chain; record.mjs answers its balance and catches everything it sends.
//  2. A visible mouse pointer that follows the real (CDP-dispatched) mouse events, so hovers and clicks show.
(() => {
  const SEED = __SEED__, NAME = __NAME__, sleep = ms => new Promise(r => setTimeout(r, ms));
  let kp = null;
  const key = () => kp || (kp = window.solanaWeb3.Keypair.fromSeed(Uint8Array.from(SEED)));
  const listeners = {};
  const wallet = {
    isPhantom: NAME === "Phantom", isSolflare: NAME === "Solflare", isBackpack: NAME === "Backpack",
    publicKey: null, isConnected: false,
    async connect(opts) {
      if (opts && opts.onlyIfTrusted) throw new Error("not trusted");
      await sleep(650);
      this.publicKey = key().publicKey; this.isConnected = true;
      return { publicKey: this.publicKey };
    },
    async disconnect() { this.publicKey = null; this.isConnected = false; },
    // the beat where a person reads the wallet prompt and approves
    async signTransaction(tx) { await sleep(window.__approveMs ?? 1300); tx.sign([key()]); return tx; },
    async signAllTransactions(txs) { await sleep(window.__approveMs ?? 1300); txs.forEach(t => t.sign([key()])); return txs; },
    // the Ghostprint message that derives the instant and ghost wallets: a real ed25519 signature (WebCrypto)
    async signMessage(msg) {
      await sleep(window.__approveMs ?? 1300);
      const pkcs8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...SEED]);
      const k = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
      return { signature: new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, k, msg)), publicKey: key().publicKey };
    },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); }, off() {}
  };
  if (NAME === "Phantom") window.phantom = { solana: wallet };
  else if (NAME === "Solflare") window.solflare = wallet;
  else if (NAME === "Backpack") window.backpack = wallet;
  else window.solana = wallet;

  // ---------- pointer ----------
  const ARROW = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2.5v18.2l4.6-4.4 2.9 6.8 3.2-1.4-2.9-6.7h6.4z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const HAND = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M9.2 3.2c.9 0 1.6.7 1.6 1.6v6.1l.5-.1c.2-.8.9-1.3 1.7-1.2.7.1 1.2.6 1.3 1.3l.4-.1c.3-.7 1-1.1 1.8-1 .7.1 1.2.7 1.3 1.4l.3-.1c.4-.5 1-.7 1.7-.5.7.2 1.1.9 1.1 1.6v5.3c0 3.3-2.7 6-6 6h-1.4c-1.9 0-3.6-.9-4.7-2.4l-4-5.5c-.5-.7-.4-1.7.3-2.2.7-.5 1.6-.4 2.2.2l1 1.1V4.8c0-.9.7-1.6 1.6-1.6z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const BEAM = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M9 3.5h2.4c.8 0 1.6.4 1.6 1.2 0-.8.8-1.2 1.6-1.2H17M9 22.5h2.4c.8 0 1.6-.4 1.6-1.2 0 .8.8 1.2 1.6 1.2H17M13 4.7v16.6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="M9 3.5h2.4c.8 0 1.6.4 1.6 1.2 0-.8.8-1.2 1.6-1.2H17M9 22.5h2.4c.8 0 1.6-.4 1.6-1.2 0 .8.8 1.2 1.6 1.2H17M13 4.7v16.6" fill="none" stroke="#111" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const HOT = { arrow: [3, 2.5], hand: [9, 3.2], beam: [13, 13] };
  let ptr, kind = "", x = -40, y = -40;
  function mount() {
    ptr = document.createElement("div");
    ptr.setAttribute("popover", "manual");
    ptr.style.cssText = "position:fixed;inset:auto;left:0;top:0;margin:0;padding:0;border:0;background:none;overflow:visible;pointer-events:none;width:26px;height:26px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45));transition:scale .08s ease;transform-origin:0 0";
    document.body.append(ptr);
    ptr.showPopover();
    // a modal dialog joins the top layer above the pointer; re-showing the pointer puts it back on top
    new MutationObserver(() => { ptr.hidePopover(); ptr.showPopover(); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    set("arrow"); place();
  }
  function set(k) { if (k === kind) return; kind = k; ptr.innerHTML = k === "hand" ? HAND : k === "beam" ? BEAM : ARROW; place(); }
  function place() { if (!ptr) return; const [hx, hy] = HOT[kind] || HOT.arrow; ptr.style.transform = `translate(${x - hx}px,${y - hy}px)`; }
  addEventListener("mousemove", e => {
    x = e.clientX; y = e.clientY;
    if (!ptr) return;
    const el = document.elementFromPoint(x, y), c = el ? getComputedStyle(el).cursor : "auto";
    set(c === "pointer" ? "hand" : c === "text" || (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && c === "auto") ? "beam" : "arrow");
    place();
  }, true);
  addEventListener("mousedown", () => { if (ptr) ptr.style.scale = ".88"; }, true);
  addEventListener("mouseup", () => { if (ptr) ptr.style.scale = "1"; }, true);
  if (document.body) mount(); else addEventListener("DOMContentLoaded", mount);
})();
