# CFSA Reference Redesign

## Approved reference

Adapt the visual language of the supplied Dribbble shot, “Nonprofit Website Design — Carolina Farm Stewardship Association,” to Project Bible Runners. The reference is an inspiration system rather than a literal clone: its farm brand, copy, logo, and imagery are not transferred.

## Visual system

- Place navigation directly over the hero photograph with light typography and compact olive/amber actions.
- Use a dark, cinematic hero treatment with an editorial serif headline, a narrower readable text measure, and a restrained CTA cluster.
- Replace the caravan/progress banner completely. Remove its HTML, SVG, CSS, JavaScript, accessibility attributes, and tests.
- Add a simple organic wave at the hero-to-content transition, echoing the reference’s paper-cut edge without introducing a new external asset.
- Shift the page body toward open ivory space, olive accents, ochre callouts, dark forest typography, thin borders, and soft asymmetric imagery.
- Use editorial collage principles in the VillageServer and reach sections: varied image proportions, offset caption/callout surfaces, and less uniform card chrome.
- Keep the existing Bible Runners photography, copy, navigation labels, giving tiers, content order, conversion events, and Vercel image reliability work.

## Responsive behavior

- Desktop retains overlaid navigation and a large photographic first viewport.
- Mobile keeps the brand legible over a darker hero, hides secondary navigation, stacks imagery without overflow, and preserves the bottom give bar.
- Both `index.html` and `index-b.html` remain structurally synchronized. The Ember file keeps a darker palette variation but follows the same layout.

## Validation

- Static tests must prove the journey system is absent from both pages and that the new hero wave and reference-derived tokens are present.
- Browser QA must check desktop and 390px mobile viewports, both page variants, image loading, console health, content hierarchy, CTA navigation, and horizontal overflow.
- Fidelity comparison will focus on overlaid navigation, hero scale, serif hierarchy, organic transition, open body rhythm, collage/callout treatment, palette, and restrained button geometry.

