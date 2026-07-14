# Landing hero — the bell-toller (v2, 2026-07-14)

Part of the cross-repo "GG design" pass. The gh-pages landing now has an
**original gothic "bell-toller"** (inline SVG, no game IP) cresting above the
hero's code-editor window — the herald of broken builds, since fahh's whole
product is a sound that plays when your code errors:

- Hooded figure with flickering rose eyes under a breathing **blood moon**.
- A **tolling bell** (rocking on its yoke) with expanding sound-wave strokes.
- Rotating ward-ring, floating ✕ / ! / ♪ motes.
- Positioned to peek over the editor mock (55% opacity, z-index 0); all copy,
  CTAs and the editor untouched. Dims to 16% ≤900px. Reduced-motion safe.

**Verification (headless Chromium, `file://`):** toller renders, 0 px
horizontal overflow, 0 console errors; screenshot reviewed.
