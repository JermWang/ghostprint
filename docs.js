// Docs page: pixel glyphs, isometric icons and diagrams, and a contents list that follows the reader.
import { renderPixels, renderIcons } from "./art.js";
import { renderDiagrams } from "./diagrams.js";
import { FEE_BPS, GHOST_MAX_SOL } from "./config.js";

renderPixels(document);
renderIcons(document);
renderDiagrams(document);
// diagrams wider than a phone scroll sideways; start them centred
document.querySelectorAll(".fig .art").forEach(a => { if (a.scrollWidth > a.clientWidth) a.scrollLeft = (a.scrollWidth - a.clientWidth) / 2; });

// label each cell of a wide table with its column header, for the stacked phone layout
document.querySelectorAll(".tbl table").forEach(t => {
  const th = [...t.querySelectorAll("thead th")].map(h => h.textContent.trim());
  t.classList.toggle("stack", th.length > 2);
  t.querySelectorAll("tbody tr").forEach(r => [...r.cells].forEach((c, i) => { if (th[i]) c.dataset.th = th[i]; }));
});

// live values from config.js, so the docs never drift from what the terminal does
document.querySelectorAll("[data-cfg]").forEach(n => {
  const v = { fee: `${FEE_BPS / 100}%`, ghostMax: `${GHOST_MAX_SOL} SOL` }[n.dataset.cfg];
  if (v) n.textContent = v;
});

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
