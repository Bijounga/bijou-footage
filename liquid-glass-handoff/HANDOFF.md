# Liquid Glass theme: handoff for adding it to another app

You (the AI reading this) are adding an Apple-style **Liquid Glass** theme to one of the user's apps. It was built and tuned with the user in **Bijou Footage v0.15.11** (Electron + React), over five rejected rounds. Everything you need is in this folder. **Read the "What the user rejected" section before you write any code.** It will save you those same rounds.

## What's in this folder

| File | What it is |
|---|---|
| `liquid-glass.css` | The whole theme as portable CSS: tokens, light/dark, glass panes, rim, buttons, segmented control, rows, fields, menus. Scoped to `[data-lg]` on `<html>`. |
| `liquid-glass-refraction.js` | Optional edge refraction: big panels bend the picture at their rim like a lens. Chromium only (Electron/Chrome/Edge). |
| `backgrounds/` | 12 wallpapers at 2560×1440 WebP: 8 photos (Lake Tahoe ×4, Yosemite, Yosemite fog, Big Sur, wave) and 4 abstracts (Tide, Bloom, Pearl, Aurora). |
| `fonts/` | Inter (variable, optical sizing) + OFL licence. |
| `gen-abstract.cjs` | The generator for the abstract wallpapers (`npm i sharp`, then `node gen-abstract.cjs ./backgrounds/`). Edit the colour stops to make new ones. |
| `CREDITS.txt` | Photo credits (all CC0) and the font licence. Ship it with the backgrounds. |
| `demo.html` | A standalone page showing every piece. Open it in Chrome/Edge to see the target look. |

## The design in one paragraph

Glass panes float over a **real photo or a structured abstract** (never a flat colour). At the **Clear** end of the slider, the panes are almost empty: about 6% white and 3px blur, so you clearly see the picture through them. Text stays readable because **the picture behind the pane is brightened and lowered in contrast (light theme) or dimmed (dark theme)** through `backdrop-filter`, **not by adding milky white**. Sliding toward **Frosted** raises the blur to 40px and the fill to about 60%, and fades the brighten/dim back to normal. Every pane has a **thick, lit edge**: a crisp 1px gradient rim that is bright at the top-left and bottom-right and fades between, plus inner "lips" and a soft inner glow. It also has a deep soft drop shadow, so the panes float. Big panes can **bend the picture at their rim** (SVG displacement refraction). Colour is used only for meaning: system blue (`#007aff` light / `#0a84ff` dark) marks selected and primary. Menus and dialogs keep a **fixed** frost, because they open over content.

## How to integrate

1. **Copy** `liquid-glass.css`, `fonts/` and `backgrounds/` into the app's assets. Keep the relative paths (`./fonts/…`, `./backgrounds/…`) or fix them up for the bundler.
2. **Find the app's theme system first.** Most of the user's apps already have themes (CSS variables plus a `data-theme` attribute, a theme list, and a settings picker). Add Liquid Glass as a theme there, with **Light** and **Dark** variations, instead of bolting on a separate mechanism. Two ways to do it:
   - **Class route:** add the `.lg-*` classes onto the app's existing elements: `.lg-wall` on the root, `.lg-panel` on sidebars and cards, `.lg-thick` on dense content areas, `.lg-float` on menus and modals, and `.lg-btn`, `.lg-seg`, `.lg-row`, `.lg-field` on controls.
   - **Selector route (usually better in an existing app):** copy the rule bodies from `liquid-glass.css` onto the app's own selectors under `[data-theme='liquidGlass']`. The tokens (`--lg-*`) are the stable part; the class names are just one way to apply them.
   - Also map the app's own colour tokens (ink, dim ink, panel colours, accent) to the `--lg-ink*` and `--lg-blue` values so untouched parts of the UI still match.
3. **Turn it on:** `<html data-lg>` for light, `<html data-lg data-lg-variant="dark">` for dark. Or use the app's own theme attribute if you took the selector route.
4. **Add a Frost slider** to the theme's settings, labelled **Clear ↔ Frosted**, range 0–100, default 60, saved in the app's settings:
   ```js
   document.documentElement.style.setProperty('--lg-frost', String(value))
   ```
5. **Add a background picker** with the 12 wallpapers as thumbnails. Put the photos first, then the abstracts. Save the choice:
   ```js
   document.documentElement.style.setProperty('--lg-wallpaper', `url(${importedUrl})`)
   ```
   If a saved background id no longer exists, fall back to the first one (Emerald Bay, `glass-tahoe-day`).
6. **Refraction (optional, Chromium only):** add `.lg-refract` to 2–4 large panels (sidebar, inspector), then:
   ```js
   import { startRefraction, stopRefraction } from './liquid-glass-refraction.js'
   if (themeIsLiquidGlass) startRefraction(); else stopRefraction()
   ```
   It does nothing in Safari or Firefox. Don't put it on small elements.
7. **Video, canvas or editor surfaces stay opaque.** In Bijou Footage the video area stays black, and the timeline and player frame use `.lg-thick`. Never put a dense working surface on clear glass.

## What the user rejected (don't repeat these)

1. **Colourful, tinted glass** ("doesn't hit the same, make it more professional"). Keep the glass neutral white (light) or smoke (dark), and keep colour for meaning only.
2. **Windows acrylic / see-through to the desktop.** The window stayed black on the user's machine and couldn't be checked. Don't use Electron `backgroundMaterial: 'acrylic'` or transparent windows. Use a picture inside the app.
3. **Mirroring the user's desktop wallpaper** inside the app ("still doesn't work, also doesn't look good"). Use the bundled pictures.
4. **Grain or noise texture** on the glass ("it's so grainy… make it sleek and professional"). Use none at all, even at 15%.
5. **A milky Clear end** ("clear doesn't look like liquid glass"). The early version kept 30–46% white at Clear, so over a flat background it read as grey plastic. Clear must be truly see-through. Get readability from the backdrop brightness/contrast trick.
6. **Flat or soft colour-field backgrounds.** Glass over a flat colour looks like plastic. Use only photos or abstracts with real shapes, light and shadow (see `gen-abstract.cjs`).

What the user liked: real photos (Tahoe, Yosemite, Big Sur), the abstract silk bands, the thick lit rim, a smooth, sleek finish, and Apple's macOS/iOS 26 look as the reference.

## Pitfalls that cost time

- **Layered backgrounds:** in `background: a, b, c`, only the **last** layer may be a plain colour. Write earlier solid layers as `linear-gradient(c, c)`, or the whole declaration is silently dropped.
- **`backdrop-filter: url(#x) blur(…)`** is Chromium-only, and in other engines it voids the whole declaration. Only set it after the JS has added `data-lg-refract`, which the JS only does in Chromium.
- **Specificity:** if the app already sets `backdrop-filter` on a panel with a stronger selector, the refraction rule loses. In Bijou Footage the fix was to set the refraction through the same CSS variable the panel rule already reads, rather than a competing `backdrop-filter` rule.
- **Rounded panels:** children with their own background (header strips, ruler corners, sidebars inside a panel) poke out square at the corners. Give them `border-top-left-radius: calc(var(--lg-radius) - 1px)` and so on. Don't use `overflow: hidden` on panels that contain popovers: `backdrop-filter` makes the panel the containing block for `position: fixed` children, so they would be clipped.
- **Light themes with hard-coded dark colours:** look for leftovers like `#22252e` for a "playing" or "selected" row. They show up as near-black blocks on light glass. Make them `color-mix(in srgb, var(--lg-blue) 12%, <panel>)`.
- **Contrast checks** that only blend element backgrounds will give wrong answers here, because the backdrop brightness/contrast isn't in the DOM. Judge from screenshots over both the brightest and darkest parts of each photo.
- **Performance:** in Bijou Footage, with 3 videos playing at 2.5×, frames averaged 6.4 ms (p95 10.4 ms) with full glass and refraction on. It's cheap, but don't stack many nested blurred layers.

## How to verify (before telling the user it's done)

Take screenshots of the app's own page (not an OS screen capture) and check each of these:
- Light at Clear (0), at 60, and at Frosted (100), over **Emerald Bay** (bright) and over a **dark** photo (Tahoe dusk or Yosemite fog).
- Dark at Clear and at Frosted over **Tahoe sunset** and **Aurora**.
- The settings panel showing the theme, the Light/Dark variation, the Frost slider and the background picker.
- Zoom into a panel edge: the 1px bright rim is visible, there are no square corners poking out, and (in Chromium) the picture visibly bends along the rim.
- No grain anywhere. Text and small labels are readable at Clear over the darkest area of each photo.

The user's release rule: **never commit, tag or push until the user says "ship it."** Leave a dev build running for them to try first.
