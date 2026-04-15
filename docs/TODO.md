# NOW!!!

- Projects can have multiple authors. Smudge might want a "default" author.

- Need to show size of each project in MB.

- Absolutely separate files from the database. If we have to reset the
  database for some horrible reason, we don't want their data killed! It
  should work more like a regular application: double click on a .smg file to
  open and add (if it's not already added). Or have a file menu to open, too
  (along with "recently opened behavior"). But then, how we do handle if it's
  an older version of the file than what we have metadata for? We need some
  kind of custom format. Checksums? If it's older, offer to create a new
  version?

    I'm creating a new text editor, with the long-term plan to ship it as an
    Electron application. However, I think I've very poorly designed the autosave
    feature.

    We want to be able to have files with .smg extensions that we can double-click
    to open the app (though not now). Instead, we want regular file menu, with
    "open recent" and standard handling. However, a future feature means we should
    be able to handle lots of files in a single project.  For example, I might be
    writing a book and have lots of pdfs/word documents included that are part of
    my research (such as studies). This means that a single .smg file seems odd.
    Help me braintstorm how to think about this.

- Rethink word counts.

    Recent sessions
    Today, 11:26 – 11:26 · < 1 min · +1,770 net words · Preface, A Pattern Older
    Than England, The Sheep Are Eating Your Job

  For the above, all I did was look at the chapters. I didn't change anything.


- Looks like lots of our files don't have great documentation (or any).
- The file format must be decoupled from our code so that future database
  changes or wipes don't actually destroy their current version, though
  history might be an issue.
- Editing: we need much richer editing tools, like you'd expect to see in
  Word. Have a simple subset, but use setting to enable more. Also, move
  "settings" under "trash" to top bar.
  Also, export formats need to handle those new tools?
- Docx export: blockquote non-paragraph children (headings, lists) lose
  indentation and italic styling. Content is preserved but visually appears
  outside the blockquote. Requires passing blockquote context through the
  recursive paragraph builder.
- If they run `make clean`, how can we restore? This seems very bad.

# Bugs

- When changing chapter status and I'm in the dashboard, the chapter status
  isn't changed there.
- I can't style the chapter titles.
- Better styling on main page. Simple is good? Need sorting, filtering.
- ProjectSettingsDialog `saveField` has no concurrency guard — rapid changes
  to the same field (e.g. deadline) can cause out-of-order writes that corrupt
  the confirmed-values ref, leading to incorrect reverts on subsequent failures.
- Server global error handler (`app.ts`) returns `err.message` verbatim for
  status < 500. Acceptable for single-user, but would leak implementation
  details if the app becomes multi-user.

# Tech Debt

- EditorPage empty-chapters view and main editor view duplicate ~80-100 lines
  of JSX (header, sidebar, error banner, trash, dialogs, live regions). Extract
  shared chrome into a layout wrapper to reduce divergence risk.
- `useChapterTitleEditing` and `useProjectTitleEditing` `saveTitle`/
  `saveProjectTitle` capture state from closures rather than refs. The stale
  comparison could be wrong if the title was updated from another source.
  Mitigated by single-user context but worth cleaning up.

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
- i18n. Also, epub format metadata is currently hard-coded to "en".
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
