# Ghostprint

Strip GPS, device, time and serial metadata from photos, entirely in your browser. Nothing is uploaded.

This is a prototype. The whole site is one self-contained `index.html`, and every illustration (the isometric machine, the card icons, the pixel wordmark and the dot-matrix scrubber) is drawn in code.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 5178
```

## What it does

- Reads JPEG, PNG and WebP files locally and decodes Exif (GPS, camera, lens, timestamps, serials), XMP, IPTC and PNG text chunks.
- Writes a clean copy by cutting the metadata blocks out of the file. The image data is copied byte for byte. A photo that depends on its rotation tag is re-encoded instead, so it doesn't come out sideways.
- Re-checks the clean copy before you save it.

See `HANDOFF.md` for implementation notes and the to-do list.
