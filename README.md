# CHAIWALA

A cinematic, single-page landing experience for a chai brand, built around a real-time Three.js world — a scroll-driven camera journey, a procedural kulhad with tea-surface and steam shaders, instanced spices, and live 3D portholes inside the product cards. Motion is orchestrated with GSAP/ScrollTrigger and Lenis smooth scroll; a polish layer adds parallax, glassmorphism, gradient/glow accents, and scroll-linked 3D depth.

No build step and no CDN — all libraries are vendored in `vendor/`, so the site runs offline.

## Live

https://bruce12-glitch.github.io/chaiwala/

## Tech
- **Three.js** — 3D world, custom shaders, portholes
- **GSAP + ScrollTrigger** — scroll animation and reveals
- **Lenis** — smooth scroll
- **Vanilla JS** (ES modules)

## Live Server

The site uses ES modules and an import map, so it must be served over HTTP — opening `index.html` directly via `file://` will not work.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.
