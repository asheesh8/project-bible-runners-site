# CFSA Reference Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle both landing-page variants around the supplied CFSA nonprofit reference while removing the camel progress concept entirely.

**Architecture:** Preserve the existing static HTML/CSS/JavaScript and content order. Shared structural changes live in both HTML files, the reference-derived visual system lives in `base.css`, and `theme-ember.css` supplies only palette/type overrides.

**Tech Stack:** Static HTML5, CSS custom properties, inline SVG wave divider, browser JavaScript, Node built-in tests

---

### Task 1: Remove the journey system

**Files:**
- Modify: `tests/site-contract.test.mjs`
- Modify: `landing/index.html`
- Modify: `landing/index-b.html`
- Modify: `landing/css/base.css`
- Modify: `landing/css/theme-ember.css`

- [ ] Replace journey-presence assertions with assertions that reject `journeyProgress`, `journey-dunes`, `caravan`, `updateJourneyProgress`, and journey-specific CSS.
- [ ] Run `node --test tests/site-contract.test.mjs` and confirm failure because the current journey system is still present.
- [ ] Remove the full journey block, scroll script, shared journey styles, and Ember journey overrides.
- [ ] Re-run the tests and confirm the removal assertions pass.

### Task 2: Build the reference-derived hero

**Files:**
- Modify: `tests/site-contract.test.mjs`
- Modify: `landing/index.html`
- Modify: `landing/index-b.html`
- Modify: `landing/css/base.css`
- Modify: `landing/css/theme-ember.css`

- [ ] Add failing assertions for the `hero-wave` divider and the shared `--leaf`, `--ochre`, and `--radius-ui` tokens.
- [ ] Run the tests and confirm the new design contract fails.
- [ ] Add synchronized wave markup to both heroes and convert navigation, type scale, overlay, and CTA styling to the reference-derived system.
- [ ] Re-run the tests and confirm the hero contract passes.

### Task 3: Restyle the body as an editorial nonprofit page

**Files:**
- Modify: `landing/css/base.css`
- Modify: `landing/css/theme-ember.css`

- [ ] Restyle stats as an open ivory proof row, convert VillageServer to a light editorial collage, reduce repetitive card chrome, and use olive/ochre callout surfaces.
- [ ] Tighten the reach collage, giving ladder, quote, final CTA, footer, and mobile breakpoints without changing visible copy or section order.
- [ ] Run the static test suite and `git diff --check`.

### Task 4: Rendered fidelity and responsive QA

**Files:**
- No committed screenshots.

- [ ] Run the site locally on port 5577.
- [ ] Verify the primary page at 1280×720 and 390×844 with no overflow, missing images, or console errors.
- [ ] Verify the Ember variant at desktop width and exercise the “See how it works” anchor.
- [ ] Compare the implementation against the saved Dribbble reference across at least eight concrete design points and repair remaining mismatches.
- [ ] Run all 13+ static checks on the final tree and commit the redesign.

