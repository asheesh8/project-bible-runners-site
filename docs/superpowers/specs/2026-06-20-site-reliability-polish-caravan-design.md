# Site Reliability, Polish, and Caravan Design

## Scope

Polish the complete static landing-page codebase, keeping the primary Field Journal page and the Ember alternate page in sync. The live Vercel deployment must serve the `landing/` directory directly, all image references must remain portable, and both pages must receive the same responsive layout and scroll-progress behavior.

## Deployment and image reliability

- Add root-level Vercel configuration that publishes `landing/` as the static output directory.
- Use explicit `./img/...` and `./css/...` document-relative URLs so local preview and Vercel resolve the same assets.
- Replace the JavaScript-created hero background with a real, preloadable `<img>` using `fetchpriority="high"`, intrinsic dimensions, and a CSS fallback color. The hero must remain visible if JavaScript is disabled or a transition handler fails.
- Keep below-the-fold images lazy-loaded and add asynchronous decoding plus intrinsic dimensions to reduce layout shift.
- Add an error state that removes the broken media element cleanly while preserving readable captions and section layout.

## Typography and spacing

- Introduce shared spacing, measure, and type tokens in `base.css`.
- Reduce the default body size slightly, tighten heading tracking and line height, constrain long paragraphs, and create more consistent vertical rhythm between eyebrows, headings, copy, controls, and media.
- Replace one-off inline spacing and font rules with named utility/component classes.
- Preserve the existing earthy Field Journal palette and the Ember theme overrides; this is polish rather than a visual rebrand.
- Improve mobile spacing, CTA sizing, card density, and sticky navigation offsets.

## Desert-caravan scroll progress

- Add a slim decorative strip immediately beneath the sticky navigation.
- Use one inline SVG for dune contours and one inline SVG group for three camel silhouettes. The artwork uses simple paths, stays crisp at every density, and adds no asset request.
- Drive the caravan's horizontal position from normalized document scroll progress using a requestAnimationFrame-throttled listener.
- Expose scroll progress through an accessible `role="progressbar"` wrapper with updated `aria-valuenow`; the decorative SVG itself remains hidden from assistive technology.
- Clamp movement inside safe left/right margins, adapt the strip height on phones, and disable decorative bobbing under `prefers-reduced-motion` while retaining position feedback.

## Validation

- Add a dependency-free Node test that verifies Vercel output configuration, portable asset paths, required image attributes, synchronized caravan markup, and progress-script hooks in both HTML variants.
- Verify every referenced local image and stylesheet exists.
- Run both pages from `landing/` in the local static server, inspect desktop and mobile viewports, scroll through the page, confirm caravan movement, and check console/network errors.
- Confirm the full repository diff contains no unrelated changes, then commit and push `main` so the connected Vercel project deploys it.

