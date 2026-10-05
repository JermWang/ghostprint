// Profile picture (?k=pfp, 1000x1000) and header banner (?k=banner, 1500x500), drawn with the site's art.
import { C, svgEl, pixelSVG, wordRows, fit } from "../../../art.js";
import { voxelGhost } from "./voxel.js";
import { ghostRoute } from "../../../diagrams.js";

const k = new URLSearchParams(location.search).get("k") || "pfp", root = document.getElementById("c");

if (k === "pfp") {
  Object.assign(root.style, { width: "1000px", height: "1000px", background: C.ACCENT });
  root.innerHTML = '<div class="dots" style="opacity:.55;-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 30%,#000 75%);mask-image:radial-gradient(circle at 50% 50%,transparent 30%,#000 75%)"></div>';
  const svg = svgEl("0 0 10 10", "Ghostprint"); root.appendChild(svg);
  Object.assign(svg.style, { position: "absolute", left: "190px", top: "170px", width: "620px", height: "640px" });
  voxelGhost(svg, { u: 10 });
  fit(svg, { pad: 2, dots: false });
} else {
  Object.assign(root.style, { width: "1500px", height: "500px", background: "radial-gradient(circle at 72% 50%,#EEEFEE,#D6D8D9 60%)" });
  root.innerHTML = '<div class="dots" style="-webkit-mask-image:linear-gradient(90deg,transparent 25%,#000 60%);mask-image:linear-gradient(90deg,transparent 25%,#000 60%)"></div>';
  // left third stays quiet: the profile picture sits over the bottom-left corner
  const copy = document.createElement("div"); copy.className = "copy"; root.appendChild(copy);
  Object.assign(copy.style, { left: "470px", top: "120px" });
  const word = pixelSVG(wordRows("GHOSTPRINT")); word.style.height = "46px"; word.style.color = C.INK; copy.appendChild(word);
  copy.insertAdjacentHTML("beforeend", "<h1>Trade Solana.<br>Leave fewer tracks.</h1><p><b>Ghost mode</b> · Pulse · Sniper · PnL</p>");
  const svg = svgEl("0 0 10 10", "Ghost route"); root.appendChild(svg);
  Object.assign(svg.style, { position: "absolute", left: "930px", top: "40px", width: "540px", height: "420px" });
  ghostRoute(svg);
}
window.__ready = true;
