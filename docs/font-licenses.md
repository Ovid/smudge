# Font Licenses

Smudge bundles two typefaces, both self-hosted via `@fontsource` npm
packages so the app works fully offline.

## Cormorant Garamond (serif — manuscript text)

- **Use:** Editor content, chapter titles, project titles, preview mode, logo
- **License:** SIL Open Font License 1.1
- **Copyright:** 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant)
- **Package:** `@fontsource/cormorant-garamond`
- **OFL permits:** Use, bundling, embedding, redistribution with software
- **OFL restriction:** Font files cannot be sold by themselves

## DM Sans (sans-serif — UI chrome)

- **Use:** Navigation, buttons, labels, dialogs, status indicators
- **License:** SIL Open Font License 1.1
- **Copyright:** 2014 The DM Sans Project Authors (github.com/googlefonts/dm-fonts)
- **Package:** `@fontsource-variable/dm-sans`
- **OFL permits:** Use, bundling, embedding, redistribution with software
- **OFL restriction:** Font files cannot be sold by themselves

## SIL Open Font License 1.1 — key terms

The full license text is included in each npm package's `LICENSE` file.
Summary of what the OFL allows for our use case:

1. **Bundling with software** — explicitly permitted (OFL condition 2)
2. **Commercial use** — permitted, as long as fonts aren't sold standalone
3. **No attribution required in UI** — copyright notice must be included
   in the distributed font files (the npm packages already contain this)
4. **No copyleft on the app** — "The requirement for fonts to remain
   under this license does not apply to any document created using the
   Font Software" (OFL preamble)

No additional action is required beyond keeping the font packages
(which include their LICENSE files) in the dependency tree.
