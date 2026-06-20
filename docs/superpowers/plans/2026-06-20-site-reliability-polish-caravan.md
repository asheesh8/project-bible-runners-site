# Site Reliability, Polish, and Caravan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both landing-page variants reliable on Vercel, visually tighter, and responsive to scroll with a lightweight SVG camel-caravan progress strip.

**Architecture:** Keep the existing dependency-free HTML/CSS/JavaScript architecture. A root Vercel configuration publishes `landing/`; a shared stylesheet owns all visual tokens and caravan presentation; duplicated page markup stays intentionally synchronized; a small Node test validates static contracts without adding packages.

**Tech Stack:** Static HTML5, CSS custom properties, inline SVG, browser JavaScript, Node's built-in test runner, Vercel static hosting

---

### Task 1: Lock the static deployment and asset contract

**Files:**
- Create: `vercel.json`
- Create: `tests/site-contract.test.mjs`
- Modify: `landing/index.html`
- Modify: `landing/index-b.html`

- [ ] Write tests asserting `outputDirectory` is `landing`, both documents use `./`-relative runtime assets, hero media is a real high-priority image, and all referenced local files exist.
- [ ] Run `node --test tests/site-contract.test.mjs` and confirm the new assertions fail because configuration and media markup are absent.
- [ ] Add `vercel.json`, replace the hero background loader with semantic image markup, and normalize runtime paths.
- [ ] Re-run the test and confirm the deployment/image assertions pass.

### Task 2: Add the reactive SVG journey strip

**Files:**
- Modify: `tests/site-contract.test.mjs`
- Modify: `landing/index.html`
- Modify: `landing/index-b.html`
- Modify: `landing/css/base.css`

- [ ] Add failing assertions for synchronized progressbar markup, camel/dune SVG hooks, and the scroll-progress update function.
- [ ] Run the focused test and confirm it fails for missing journey markup.
- [ ] Add the shared inline SVG strip and requestAnimationFrame-throttled scroll handler to both pages.
- [ ] Add responsive strip styling, progress movement, and reduced-motion behavior to `base.css`.
- [ ] Re-run tests and confirm all journey assertions pass.

### Task 3: Tighten the shared design system

**Files:**
- Modify: `tests/site-contract.test.mjs`
- Modify: `landing/index.html`
- Modify: `landing/index-b.html`
- Modify: `landing/css/base.css`
- Modify: `landing/css/theme-ember.css`

- [ ] Add failing assertions that prohibit the known one-off inline spacing rules and require shared type/spacing tokens.
- [ ] Run the test and confirm it fails on the existing inline rules.
- [ ] Introduce section-spacing, content-measure, and typography tokens; tighten desktop and mobile rhythm; convert inline formatting into named classes.
- [ ] Keep Ember overrides compatible with the shared token system.
- [ ] Re-run the complete test suite.

### Task 4: Render and interaction verification

**Files:**
- No committed files; screenshots stay outside the repository.

- [ ] Start `python -m http.server 5577` from `landing/`.
- [ ] Open `/index.html` and `/index-b.html` through the in-app browser at desktop width and verify title, meaningful DOM, no framework overlay, image/network health, and console health.
- [ ] Capture desktop evidence, scroll to at least 50%, verify `aria-valuenow` and caravan position update, and inspect the end state.
- [ ] Repeat the primary page at a mobile viewport and verify no overflow, sticky-navigation collision, or CTA obstruction.
- [ ] Compare the two variants for structural synchronization and record any intentional theme-only differences.

### Task 5: Final verification and delivery

**Files:**
- Modify: `README.md`
- Modify: `landing/README.md`

- [ ] Document Vercel deployment, the semantic hero-image strategy, and the scroll-progress strip.
- [ ] Run `node --test tests/site-contract.test.mjs` and require zero failures.
- [ ] Check `git diff --check`, `git status --short`, and review the complete diff.
- [ ] Commit the implementation and push `main` to trigger the connected Vercel deployment.

