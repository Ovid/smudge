- Need to look at agentic code simplification in the agentic review?

- How to prevent fan out on receiving a code review?

- If something is out of scope, can it be added as "next phase in roadmap"?

- Need a deep dive into how we save documents to ensure that it's working as
  intended.

- This is a single user app. Coauthors want to collaborate. How can we do
  this? Can we import an .smg file? That seems problematic because I might
  have updated my version and I can't cleanly apply diffs.
- Subtitles needed (BCG -> AI Is not the problem)
- Projects can have multiple authors. Smudge might want a "default" author.

- Need to resize images in editor, left align, right align, captions, etc.
  Maybe part of wider "formatting" spec?
- Need to check to see if we mark chapters as "dirty" so that we only save
  dirty and not all (or is this really a problem?)

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

## Deferred from unified-error-mapper code review (2026-04-24)

Suggestion-level findings that are not blocking. Enumerated here so they
are not lost and can be picked up as small independent PRs.

- `packages/client/src/api/client.ts:70-79` — `extractExtras`'s
  `out[k] = rest[k]` is reparentable via the `__proto__` setter (scope-
  local, not global pollution). Use `Object.create(null)` or skip
  `__proto__` / `constructor` keys.
- `packages/client/src/api/client.ts:68` — `MAX_EXTRAS_KEYS = 16`
  truncates only top-level keys; nested arrays/strings are unbounded
  (DoS-theoretical on `chapters` join).
- `packages/client/src/api/client.ts:68` — `MAX_EXTRAS_KEYS` truncation
  is order-sensitive; a padded envelope could drop `chapters` silently
  with no warning.
- `packages/client/src/errors/scopes.ts` `image.delete` `extrasFrom` is
  all-or-nothing (one malformed chapter drops the full list);
  consider returning the validated subset.
- `packages/client/src/errors/scopes.ts` `trash.restoreChapter` missing
  `RESTORE_READ_FAILURE` byCode → generic copy when the row was
  actually restored.
- `packages/client/src/errors/apiErrorMapper.ts:28-52` — reserved
  synthetic codes `ABORTED`/`NETWORK`/`BAD_JSON` could collide with a
  future server code; reserve with a prefix or require status
  discriminant.
- `packages/client/src/pages/EditorPage.tsx:~1465` — settings-update
  follow-up GET uses `project.load` scope copy ("Failed to load the
  project") — wrong attribution.
- `packages/client/src/pages/EditorPage.tsx:~1441-1452` —
  `handleProjectSettingsUpdate` post-await merge could stomp a
  concurrent same-project field write; narrow window.
- `packages/client/src/hooks/useTrashManager.ts:25, 53` and
  `packages/client/src/components/ProjectSettingsDialog.tsx:146, 224`
  — use `console.error` vs the `console.warn` convention used
  elsewhere; test-noise risk per CLAUDE.md §Testing Philosophy.
- `packages/client/src/hooks/useProjectEditor.ts:~639-650` —
  `handleReorderChapters` possiblyCommitted branch does not fire a
  project refresh (unlike sibling `handleCreateChapter` /
  `handleUpdateProjectTitle`).
- `packages/client/src/hooks/useProjectEditor.ts` — `handleStatusChange`
  catch: on ABORTED follow-on the reload `projects.get` can still fire
  under edge cases; tighten with an `isAborted` early-return on any
  second-await path.
- `packages/client/src/hooks/useProjectEditor.ts` — `handleRenameChapter`
  has the same abort gap as the I11 handleStatusChange fix (lower
  impact — blur-triggered). Add a renameAbortRef mirroring
  statusChangeAbortRef.
- `packages/client/src/hooks/useTimezoneDetection.ts:3-20` —
  `detectAndSetTimezone` races against an explicit timezone choice in
  the settings dialog; bounded to app-boot window.
- `packages/client/src/components/ProjectSettingsDialog.tsx:~129-183`
  — `saveField` lacks abort/seq; sibling `handleTimezoneChange` in
  the same file has both.
- `packages/client/src/components/SnapshotPanel.tsx:~292` and
  `packages/client/src/components/ImageGallery.tsx:~212` — on ABORTED
  the delete confirm dialog state is not reset; latent.
- `packages/client/src/hooks/useProjectEditor.ts` — `console.warn(..., err)`
  logs the full ApiRequestError with server message; console is one
  click from the user.

- EditorPage empty-chapters view and main editor view duplicate ~80-100 lines
  of JSX (header, sidebar, error banner, trash, dialogs, live regions). Extract
  shared chrome into a layout wrapper to reduce divergence risk.
- `useChapterTitleEditing` and `useProjectTitleEditing` `saveTitle`/
  `saveProjectTitle` capture state from closures rather than refs. The stale
  comparison could be wrong if the title was updated from another source.
  Mitigated by single-user context but worth cleaning up.

## DEP0040 suppression in Makefile (2026-04-24)

The Makefile sets `NODE_OPTIONS=--disable-warning=DEP0040` to silence the
Node 22 built-in `punycode` runtime deprecation. Two transitive deps still
use `require("punycode")`:

- `jsdom → whatwg-url → tr46`
- `eslint → ajv@6 → uri-js`

Remove the `NODE_OPTIONS` line from the Makefile (and this entry) when
both `tr46` and `uri-js` ship releases that use the userland `punycode/`
specifier. Check periodically with `npm ls punycode --all`.

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
