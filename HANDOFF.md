# Ghostprint: handoff prompt for the next session

Paste everything below the line into the new session.

---

You're picking up a prototype I started in another session. Read this whole brief before touching anything.

## What this is
**Ghostprint** is a landing page plus a working tool that strips location, device, time and serial metadata from photos, entirely in the browser. I asked for "a site like https://nullmask.io but with a different utility, along the same visual guidelines." "Ghostprint" is a working name. Nobody has checked whether the name or a domain is free.

## Where the code is
- `index.html` is the entire site: one self-contained file with no build step. Its CSS and JS are inline, and fonts load from Google Fonts (Sora, JetBrains Mono).
- If `index.html` isn't in the repo, recover it from the published artifact **https://claude.ai/artifact/DuMz2azcGjuQLJqruzgPqe**. Read it with the Artifact tool (`action: "read"`). That artifact is the page body without a doctype wrapper. The local `index.html` is the same content wrapped in `<!doctype html><html><head>` (charset, viewport, description meta) `<body>`.
- When republishing to that artifact, publish the unwrapped body version (the Artifact tool adds its own skeleton) and keep the `downloads` capability, which the save button uses.
- Local preview at the time of handoff was `python -m http.server 5178 --directory ghostprint`.

## What I learned from nullmask.io (the style reference)
- Built with SvelteKit, with GSAP and ScrollTrigger for motion.
- Its isometric illustrations are **Figma SVG exports**, not generated code. Fingerprints: ids like `filter0_i_3094_4332`, `BackgroundImageFix`, `bgblur_*_clip_path`, and text converted to outlines. GSAP tweens their fills between grey `#D9D9D9` and lime `#CDEF33`. Scroll steps through the phone screens.
- The one procedural piece is the "Next wave in" countdown canvas. It draws digits to a hidden canvas, samples them onto a hex grid of dots, and particles fly to their slots. On a digit change, dots scatter with "heat" (they flash lime and cool down).
- Style: light-grey page, near-black `#202221` panels, one neon accent, Poppins, a pixel/stencil wordmark, rounded cards with 1px dark borders, halftone dot textures, isometric line art with thick black base edges and tube-like cables.

## How Ghostprint follows that style, but as its own brand
- **Tokens** (in `:root`): ground `#D6D8D9`, paper `#EEEFEE`, ink `#1D1F22`, infrared accent `#FF5A24`. Sora for display, JetBrains Mono for labels and data. It is deliberately single-theme (no dark mode).
- **All artwork is generated in code** (unlike nullmask):
  - An `iso(ox, oy, scale)` toolkit: `box`, `cyl`, `poly`, `line`, plus plane matrices `topM(z)`, `leftM(y)` and `rightM(x)` for drawing 2D decals onto iso faces. Strokes use `vector-effect: non-scaling-stroke`.
  - The hero machine: base platform with a black underside, glass chamber, floating photo card with an "EXIF" badge, a scan plane sweeping up and down, a cap with chasing LEDs, metadata tags rising out of the port, cables with flowing dashes, an intake tray, and a "META→0" shredder bin with falling bytes. Its animation callbacks are registered in an `anim[]` array.
  - Four leak-card icons: GPS map with pin, camera, clock, serial tag.
  - Pixel art from bitmap strings: the ghost logo, a 5×7 font for the "GHOSTPRINT" wordmark (which assembles from scattered pixels on load), and 8×8 feature glyphs.
- **The scrubber card** (`#scrub`) is a dot-matrix canvas instrument modeled on the nullmask countdown. The photo is sampled onto a hex dot grid, with brightness driving dot size. Each metadata group shows as an orbiting swarm of square accent "bytes" with a label. "Scrub" runs a **time-based** sweep (1.2 s): dots heat up, swarms burst in step with the sweep, and the field rows strike through.
  - The sweep is time-based on purpose. A frame-count version stalled when `requestAnimationFrame` was throttled. Keep it that way.
- **Page sections:** nav pill → hero (headline, scrubber card, "0 bytes uploaded" pill, iso machine) → "One photo. Four ways to find you." leak cards → dark band "Your camera roll keeps a diary. >>> Ghostprint tears out the pages." with 4 features → "How it works" 3 steps plus a **file anatomy strip**. The strip shows the file's segments before and after (APP1 Exif, XMP, ICC, DQT·SOF·DHT, SOS image data) at log-scaled widths and updates for the loaded file.

## How the tool works (all client-side)
- **`parseBuffer(buf)`** detects the format and records segments with keep/drop flags.
  - **JPEG:** walks markers; drops APP1 (Exif/XMP), APP3–13, APP15 and COM; keeps APP0, APP2 ICC, APP14 Adobe and the table segments.
  - **PNG:** drops `tEXt iTXt zTXt eXIf tIME`.
  - **WebP:** drops the `EXIF` and `XMP ` chunks.
  - **`readTIFF`** decodes IFD0, the Exif IFD and the GPS IFD: GPS lat/lon (DMS → decimal), altitude, facing, DateTimeOriginal plus offset, make/model, lens, body and lens serials, owner, ImageUniqueID, artist, copyright, software, and MakerNote size.
  - **`readXMP`** counts properties and pulls City/Country, `dc:creator` and CreatorTool.
- **`buildClean`** does a lossless byte-level strip (`stripLossless`). For WebP it also clears the VP8X EXIF/XMP flags and rewrites the RIFF size. It confirms the result decodes with `createImageBitmap`. A JPEG with orientation ≠ 1, or a failed decode, is re-encoded through a canvas at 0.92 quality instead. Either way it re-parses the output and reports any fields left over.
- **Saving:** inside a claude.ai artifact it uses `await window.claude.use("downloads")` then `.save({filename, data: blob})`. Opened as a plain local file, it falls back to an `<a download>` link.
- Values from files are written with `textContent` only, never `innerHTML`. Keep it that way.

## What's verified and what isn't
- **Verified:** the script parses (`node --check`). A generated JPEG with GPS/Make/Model/Software Exif was detected as 3 fields (GPS 51.50725° N, 0.12767° W). The scrub completed with a lossless strip of 202 B, and the re-check found 0 fields. The example scrub flow works visually.
- **Not yet verified:**
  - Real phone photos, especially iPhone JPEGs that have an orientation tag.
  - PNG text chunks, the WebP strip path, XMP-heavy files from Lightroom or Photoshop, and IPTC.
  - Phone-width layout (about 375 px).
  - The published artifact in a signed-in browser.
- **Testing gotcha:** the Claude desktop app's browser pane throttles `requestAnimationFrame` to about 2 fps during script-only steps, so animations look stuck there. Take a screenshot to force painting before judging.

## Known issues / TODO, roughly in priority order
1. ~~**Honesty bug:** re-encode dropped the ICC profile.~~ Fixed: `reencode` decodes with `colorSpaceConversion: "none"`, swaps the canvas encoder's own sRGB APP2 tag for the original ICC segments, and is verified in headless Chromium (rotated JPEG with GPS and ICC → one original ICC, 0 fields left, correct dimensions).
2. Test with real files (see above) and fix any parser edge cases.
3. Check the mobile layout. Hero tags can still crowd on narrow screens, and the scrubber's swarm labels are small.
4. Nice-to-haves in the nullmask spirit: scroll-driven moments (GSAP ScrollTrigger, e.g. the anatomy strip animating segments out as you scroll), batch mode for multiple photos, HEIC support (needs a WASM decoder; currently it shows a "set Camera → Most Compatible" message).
5. If this becomes a real site: decide on a framework (nullmask uses SvelteKit), name and domain, and deploy target.

## About me / how I like to work
- I'm iterating fast on a prototype. Keep updates short, show me the page, and ask before outward-facing actions such as pushing to new remotes, deploying or buying domains.
- My GitHub account is **JermWang**.
