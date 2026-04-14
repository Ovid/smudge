# Dependency Licenses

All direct dependencies used by Smudge are compatible with commercial
use. This document catalogs every license in the project and explains
any that need special attention.

Last audited: 2026-04-14

---

## Summary

| License | Count | Commercial use | Ships in production |
|---------|-------|----------------|---------------------|
| MIT | ~46 | Yes, unrestricted | Most dependencies |
| Apache-2.0 | 3 | Yes, unrestricted | Yes (DOMPurify in client; others dev-only) |
| SIL OFL 1.1 | 2 | Yes, bundling permitted | Yes (fonts) |
| MPL-2.0 | 1 | Yes, with file-level copyleft | No (dev only) |

**All dependencies are safe for commercial use.** No GPL, AGPL, SSPL,
or other strong-copyleft licenses are present.

---

## Production dependencies by workspace

### packages/shared

| Package | License | Notes |
|---------|---------|-------|
| zod | MIT | |

### packages/server

| Package | License | Notes |
|---------|---------|-------|
| better-sqlite3 | MIT | |
| express | MIT | |
| helmet | MIT | |
| knex | MIT | |
| @tiptap/core | MIT | TipTap editor core (server-side HTML generation) |
| @tiptap/extension-heading | MIT | Heading extension for generateHTML() |
| @tiptap/html | MIT | Server-side HTML generation from TipTap JSON |
| @tiptap/pm | MIT | ProseMirror peer dependency for TipTap |
| @tiptap/starter-kit | MIT | Standard extension bundle for generateHTML() |
| pino | MIT | Structured logging |
| turndown | MIT | HTML-to-Markdown conversion for export |
| uuid | MIT | |

### packages/client

| Package | License | Notes |
|---------|---------|-------|
| @dnd-kit/core | MIT | |
| @dnd-kit/modifiers | MIT | |
| @dnd-kit/sortable | MIT | |
| @dnd-kit/utilities | MIT | |
| @fontsource/cormorant-garamond | OFL-1.1 | See [Fonts](#fonts) |
| @fontsource-variable/dm-sans | OFL-1.1 | See [Fonts](#fonts) |
| @tiptap/extension-heading | MIT | |
| @tiptap/extension-placeholder | MIT | |
| @tiptap/html | MIT | |
| @tiptap/pm | MIT | |
| @tiptap/react | MIT | |
| @tiptap/starter-kit | MIT | |
| dompurify | MPL-2.0 OR Apache-2.0 | We elect **Apache-2.0**. See [DOMPurify](#dompurify) |
| react | MIT | |
| react-dom | MIT | |
| react-router-dom | MIT | |

---

## Dev-only dependencies (not shipped to users)

All dev dependencies are MIT or Apache-2.0, with one exception:

| Package | License | Notes |
|---------|---------|-------|
| @axe-core/playwright | MPL-2.0 | Dev-only (a11y testing). See [axe-core](#axe-core) |
| @playwright/test | Apache-2.0 | |
| typescript | Apache-2.0 | |
| eslint, prettier, vitest, vite, tailwindcss, jsdom, etc. | MIT | |
| pino-pretty | MIT | Dev-only (structured log formatting) |
| @testing-library/\*, @types/\*, @vitejs/\* | MIT | |

---

## Licenses requiring attention

### Fonts

Both bundled typefaces use the **SIL Open Font License 1.1**:

- **Cormorant Garamond** — Copyright 2015 The Cormorant Project Authors
  (github.com/CatharsisFonts/Cormorant). Used for manuscript text
  (editor, chapter titles, project titles, preview, logo).

- **DM Sans** — Copyright 2014 The DM Sans Project Authors
  (github.com/googlefonts/dm-fonts). Used for UI chrome (navigation,
  buttons, labels, dialogs, status indicators).

The OFL explicitly permits:
- Bundling and embedding with software (condition 2)
- Commercial use, provided fonts are not sold standalone
- No copyleft on the application itself

The npm packages include the required LICENSE files. No further action
needed.

### DOMPurify

dompurify is dual-licensed under **MPL-2.0 OR Apache-2.0**. We elect
the **Apache-2.0** license, which is a permissive license with no
copyleft requirements. Apache-2.0 permits commercial use, modification,
and distribution, requiring only preservation of copyright notices and
the license text (included in the npm package).

### axe-core

@axe-core/playwright is licensed under **MPL-2.0** (Mozilla Public
License 2.0). MPL-2.0 is a weak copyleft — modifications to
MPL-licensed source files must be shared under MPL, but it does not
affect surrounding code. This is a **dev-only** dependency used for
automated accessibility testing. It is never bundled into the
production build and has no impact on Smudge's licensing.

---

## License types explained

**MIT** — Permissive. Do anything, keep the copyright notice. No
restrictions on commercial use.

**Apache-2.0** — Permissive. Similar to MIT but includes an explicit
patent grant. No restrictions on commercial use.

**SIL OFL 1.1** — Permissive for font software. Free to bundle with
applications. Cannot sell the fonts by themselves.

**MPL-2.0** — Weak copyleft. Changes to MPL-licensed files must stay
MPL, but the rest of your code is unaffected. Compatible with
commercial use.

---

## How to re-audit

Run `npx license-checker --direct --summary` or manually check
`node_modules/{package}/package.json` for the `license` field for each
direct dependency listed in the workspace package.json files.
