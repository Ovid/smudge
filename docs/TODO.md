# NOW!!!

- Absolutely separate files from the database. If we have to reset the
  database for some horrible reason, we don't want their data killed! It
  should work more like a regular application: double click on a .smg file to
  open and add (if it's not already added). Or have a file menu to open, too
  (along with "recently opened behavior"). But then, how we do handle if it's
  an older version of the file than what we have metadata for? We need some
  kind of custom format. Checksums? If it's older, offer to create a new
  version?
- Looks like lots of our files don't have great documentation (or any).
- The file format must be decoupled from our code so that future database
  changes or wipes don't actually destroy their current version, though
  history might be an issue.
- If they run `make clean`, how can we restore? This seems very bad.

# Bugs

- When changing chapter status and I'm in the dashboard, the chapter status
  isn't changed there.
- I can't style the chapter titles.
- Better styling on main page. Simple is good? Need sorting, filtering.

# Features

- Need an "outline" mode that pre-populate chapters titles and outlines.
- Validate the toolbar and what we really need there. It's too barebones right
  now. How to handle different fonts cleanly?
- CI currently runs E2E tests against Chromium only, and `playwright.config.ts`
  is configured to match. Since Smudge is targeting Electron (which bundles
  Chromium), multi-browser testing has limited value — Firefox and WebKit
  rendering differences won't affect the shipped app. If we ever add a
  web-hosted version or want to validate cross-browser HTML export rendering,
  revisit this by adding Firefox/WebKit to the Playwright `projects` array and
  installing all browsers in the CI E2E job
  (`npx playwright install --with-deps` instead of just `chromium`).
- Headings listed as H1, H2, H3
- BE ULTRA-PARANOID ABOUT DATA LOSS. Brainstorm on ways to make this
  super robust. Have "snapshots" which go back X amount of time.

- Export entire database to reimport in another instance?
- Save files in .smg format? (Is that extension taken?) if we try to load an
  .smg file, we need handle if we face data loss.
- Research page width and what formatting features writers really need. Maybe
  have a "simple" mode and an "advanced" mode? Or just make it simple and add
  features as needed.
- Need help page. Not until close to done. CLAUDE.md instructions to ensure
  it's updated after every public-facing change.
- Logo should link to github repo. Eventually, to a website.
- i18n
- Import from Word, Google Docs, etc.
- Screenplay support? Final Draft support? Fountain support?
- Shareable README
- Red line for spelling errors needs to be more visible.
- Can we do grammar checks?
- Search by regex? Is there a way that non-technical users can use regex?
  Search should be "this chapter" or "all chapters"?

# Explore

- Plaiwright — like Playwright, but it's a test that Claude can run and
  examine screenshots for issues. Brainstorm this. jsonl log for what each
  screenshot represents? Clean up after? Artifacts in .gitignore. Kiro/Claude
  skill? Run as data-driven loop? AI feeds in data, plaiwright validates, and
  then it runs. AIAT (vs. UAT)
