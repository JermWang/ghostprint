// Docs page: pixel glyphs, isometric icons and diagrams, and a contents list that follows the reader.
import { renderPixels, renderIcons } from "./art.js";
import { renderDiagrams } from "./diagrams.js";
import { TREASURY, FEE_BPS, GHOST_MAX_SOL } from "./config.js";

renderPixels(document);
renderIcons(document);
renderDiagrams(document);
// diagrams wider than a phone scroll sideways; start them centred
document.querySelectorAll(".fig .art").forEach(a => { if (a.scrollWidth > a.clientWidth) a.scrollLeft = (a.scrollWidth - a.clientWidth) / 2; });

// live values from config.js, so the docs never drift from what the terminal does
document.querySelectorAll("[data-cfg]").forEach(n => {
  const v = { treasury: TREASURY, fee: `${FEE_BPS / 100}%`, ghostMax: `${GHOST_MAX_SOL} SOL` }[n.dataset.cfg];
  if (v) n.textContent = v;
});
const tl = document.getElementById("treasury-link");
if (tl) tl.href = `https://solscan.io/account/${TREASURY}`;

// highlight the section being read
const links = new Map([...document.querySelectorAll(".toc a")].map(a => [a.getAttribute("href").slice(1), a]));
const io = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) {
    links.forEach(a => a.removeAttribute("aria-current"));
    const a = links.get(e.target.id);
    if (a) { a.setAttribute("aria-current", "true"); const bar = a.closest(".toc"); if (bar && bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" }); }
  }
}, { rootMargin: "-20% 0px -70% 0px" });
document.querySelectorAll("article section[id]").forEach(s => io.observe(s));
