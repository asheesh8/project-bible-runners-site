# Project Bible Runners — Campaign Landing Page

A high-conversion landing page for **Project Bible Runners** and the **VillageServer Initiative** — the destination for Facebook ad traffic.

> *"…and this gospel of the kingdom will be proclaimed throughout the whole world as a testimony to all nations, and then the end will come."* — Matthew 24:14

**42% of the world has never heard that Jesus loves them.** This page turns that statistic into action: $7 places a native-language Bible in waiting hands, and $500 builds an entire village its own solar-powered, offline Bible library.

---

## What's here

| File | Purpose |
|---|---|
| `landing/index.html` | **Primary landing page** — "Field Journal" design direction (Fraunces serif + Hanken Grotesk) |
| `landing/index-b.html` | Alternate **"Ember"** design direction (Bricolage Grotesque) — same content, kept in sync |
| `landing/css/base.css` | Shared design system + layout |
| `landing/css/theme-ember.css` | Theme overrides for the Ember variant |
| `landing/img/` | Optimized WebP imagery (real field photos + the VillageServer hardware kit) |

All photography is **real** — sourced from the client's existing site and presentation deck, then optimized to responsive WebP.

## Run locally

```bash
cd landing
python -m http.server 5577
# open http://localhost:5577/index.html   (Ember: /index-b.html)
```

No build step — it's intentionally dependency-free static HTML/CSS/JS so it loads fast for both audiences (US donors **and** field users on 2G).

## Deploy

The repository is connected to Vercel. The root `vercel.json` publishes `landing/` as the static output directory, so every push to the connected production branch deploys the page and its image bundle together.

```bash
node --test tests/site-contract.test.mjs
git push origin main
```

The contract test checks the Vercel output directory, both page variants, local asset paths, hero-image priority, inline JavaScript syntax, the organic hero transition, and removal of temporary prototype UI before deployment.

## Design & performance doctrine

- **Dual-audience:** rich for donors, lightweight for field users on slow connections.
- **Editorial nonprofit palette** (forest, olive, ochre, warm ivory) — no generic nonprofit blue.
- **Mobile-first**, accessible (reduced-motion respected, alt text, AA contrast).
- **Resilient media:** the hero is a semantic, preloaded WebP; lower-page images lazy-load with intrinsic dimensions and layout-safe failure states.
- **Organic composition:** a lightweight inline SVG wave blends the photo-led hero into the open editorial body.
- The `$7` give CTA appears in the nav, hero, and footer of every page.

## Conversion tracking

CTAs carry `data-track` events (`donation_started`, `trip_inquiry`) wired to fire **Meta Pixel** + **GA4** when those snippets are added — see the inline `<script>` at the bottom of `index.html`.

## Donation tiers

| Tier | Amount | Funds |
|---|---|---|
| Give a Bible | $7 | 1 native-language Bible, hand-delivered |
| Bible Bundle | $35 | 5 Bibles |
| Church Pack | $70 | 10 Bibles |
| VillageServer Kit | $500 | Solar Raspberry Pi offline Bible library for 1 village |
| Satellite Run | $1,250 | Full satellite-capture kit for a field team |
| Sponsor a Run | $4,400+ | Fund a 10-day Bible Run — 800+ Bibles delivered |

## Roadmap

This static page is the fast first deliverable. The full build (per the project spec) is a Next.js + Tailwind site on Vercel with Stripe donations, a Supabase-backed impact globe, and an admin dashboard.

---

*Built by ArkiTech-Sol.*
