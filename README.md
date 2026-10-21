# AIIMS Office Model

Interactive 3D walkthrough of AIIMS Group HQ, built with Three.js (r0.160 from cdn.jsdelivr.net).
Live on Vercel: `/` is the walkthrough, `/landing-page` is the branded tour page that embeds it.

## How it is built

`index.html` is **generated**. Do not hand-edit it. Edit the sources, then run:

```bash
python3 assemble.py        # sources -> index.html
```

Only if the architecture or the fit-out zones change:

```bash
python3 build.py           # data/geometry.json -> data/model_data.json  (needs numpy)
python3 assemble.py
```

Commit `index.html` together with the source change; Vercel serves the repo as a static site (no build step).

## Files

| File | What it is |
| --- | --- |
| `v2_script.js` | All viewer code: renderer, materials, every room's furniture, walk/orbit controls, click-to-jump, Kynan, barista mode, photoreal rendering block, hamburger menu, deep links |
| `v2_html.txt` | Page markup (stage overlays, menu with Spaces / View / Layers / About tabs) |
| `v2_css.txt` | Page styles (the menu block is styled after the aiims.group header menu) |
| `assemble.py` | Inlines the sources + data into `index.html` |
| `build.py` | Builds `data/model_data.json` (walls, glazing, doors, joinery) from `data/geometry.json` |
| `data/geometry.json` | Calibrated architectural reconstruction (Review 01) |
| `data/model_data.json` | Compact geometry consumed by the viewer |
| `data/kynan_mesh.json`, `data/kynan_tex.txt` | Kynan figure mesh and texture (data URI) |
| `data/men_datauri.txt` | Texture data URI used by the viewer |
| `small_empty_room_3.hdr` | Poly Haven HDRI (CC0), embedded for image-based lighting |
| `landing-page.html`, `vercel.json` | Landing page at `/landing-page` (embeds `/` in an iframe) |

## Conventions

- Plan coordinates are metres: `P(x, y, z)` maps to three.js `(x, z, -y)`. `y = 0` is the street frontage; the facade steps back to `y ≈ 1.55` east of `x ≈ 9.5`.
- Upper floor level: `UFZ = 4.45`.
- Spaces are listed in `v2_html.txt` (`data-view="sp-…"`) and positioned in `v2_script.js` (search `'sp-lounge':`).
- Deep links: `/#sp-kitchen` opens a space; the landing page can `postMessage({ aiimsView: 'sp-kitchen' })`, and the viewer replies `{ aiimsReady: true }`.
- Test hooks: `window.__setView(v)`, `window.__renderOnce(n)`, `window.__paused = true` (set before load) for headless screenshots.
