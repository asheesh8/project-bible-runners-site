# Project Bible Runners — Facebook landing page

A fast, conversion-focused landing page built as the destination for Facebook ad
traffic. It remains a dependency-free static site: two HTML variants, shared CSS,
and an optimized WebP image bundle.

Built to the `CLAUDE.md` doctrine: earthy palette, editorial serif (Fraunces) + clean
sans (Hanken Grotesk), Matthew 24:14 + the 42% hook in the hero, the $7 → $500 → $4,400
giving ladder, and the VillageServer story as the differentiator. All copy and stats are
real (pulled from the deck + project brief) — no placeholder text.

## Preview locally
```
cd landing
python -m http.server 5577
# open http://localhost:5577
```

Vercel serves this directory as the site root through `../vercel.json`. Pushing the
connected production branch deploys the HTML, CSS, and images as one immutable release,
without depending on a temporary local server or tunnel.

## What's here
- `index.html` — primary Field Journal direction
- `index-b.html` — Ember alternate, kept structurally in sync
- `css/base.css` — shared editorial spacing, typography, layout, and media system
- `css/theme-ember.css` — Ember palette/type overrides
- `img/*.webp` — optimized field and hardware photography

The hero is a real high-priority `<img>` rather than a JavaScript-created background,
so it remains visible if scripting is unavailable. Below-the-fold images use lazy
loading, asynchronous decoding, and intrinsic dimensions. A tiny inline SVG wave gives
the hero an organic transition without adding a network request or scroll handler.

## Wired and ready, but needs real values before launch
1. **Donate links** — every "Give" button currently points to `https://www.projectbiblerunners.com`.
   Swap these for the real Stripe / donation-processor URLs (or per-tier checkout links).
2. **Conversion tracking** — buttons already fire `data-track` events
   (`donation_started`, `trip_inquiry`). Paste the **Meta Pixel** and **GA4** snippets into
   `<head>` and the existing click handler will report `fbq` / `gtag` events automatically.
3. **OG image** — set an absolute URL for `og:image` once hosted, so the Facebook ad link
   preview shows the hero.

## Asset note (flagged per the brief)
The client deck is strong on **tech/hardware** photos (solar suitcase, the kit in a case,
Raspberry Pi, satellite dish, Gawahi TV broadcast) but **thin on human field photos** —
really just one usable wide village shot. To make the donor pages sing we need Jess's
high-res field photo library (already an open question in the project brief). Source
images are kept in `../assets/raw/` for reuse.

## Performance
Field-route doctrine respected: WebP only, lazy-loaded below-the-fold images, a
preloaded semantic hero and restrained count-up + reveal animations that honor
`prefers-reduced-motion`. No heavy 3D/motion libraries on this page.
