# Phase 4c.1 — Inline Notes (Design)

**Date:** 2026-07-12
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4c.1 (split from Phase 4c: Notes, Tags & Outtakes)
**Depends on:** MVP (TipTap editor), Phase 4a (reference panel), **Phase 4c.0** (reference-panel multi-tab refactor — prerequisite, shipped separately)

---

## Scope note: Phase 4c is split

Phase 4c in the roadmap bundled three independent features (Notes, Outtakes,
Tags). Per CLAUDE.md §Pull Request Scope (one-feature rule), it is split into
four separately-shipped sub-phases:

- **4c.0 — Reference Panel Multi-Tab Refactor** (prerequisite, pure refactor)
- **4c.1 — Inline Notes** (this document)
- **4c.2 — Scratchpad / Outtakes** (future)
- **4c.3 — Tags & Cross-References** (future)

This document designs **4c.1 only**. 4c.0 is spec'd at the end because 4c.1
depends on it, but 4c.0 gets its own plan/PR.

---

## Goal

Give the writer a private annotation layer: select manuscript text, attach a
plain-text "note to self." Noted text is subtly highlighted **while editing**;
a Notes tab in the reference panel lists the current chapter's notes and
scrolls to them. Notes are **invisible in preview and every export format**.

The intent is "margin scribble," not formal annotation — the design keeps it
that small on purpose.

---

## Storage model — a TipTap custom mark, no database

A new `note` **mark** is added to the shared `editorExtensions` array
(`packages/shared/src/editorExtensions.ts`). It is the first custom mark in the
codebase (only a plugin-style `Extension` — `imagePasteExtension` — exists
today; there is no `Mark.create` precedent).

**Mark attributes:**

- `id` — a stable identifier, used for panel→document scroll-to and to
  disambiguate two notes with identical noted text.
- `text` — the note's plain-text content (multi-line allowed).

**Why a mark, not a table.** Because the note lives inside the chapter's TipTap
JSON, it rides along for free:

- **Snapshotted** with the chapter (Phase 4b) — no separate snapshot path.
- **Moves and stretches** as the writer edits the noted text.
- **Deleted automatically** when all the noted text is deleted.
- No `outtakes`-style table, no `GET /notes` endpoint, no ProjectStore
  three-edit tax, no migration.

This is the YAGNI-correct choice for single-user, single-process Smudge. A
side-table keyed by mark id would add orphan-cleanup resync logic for zero
benefit here.

**One note per range.** The `text` attribute holds a single note, so a
character carries at most one `note` mark. See "Overlap" below.

### Note content is plain text

A note is a single plain-text string, not a nested rich-text document. This
matches the "margin scribble" intent and lets the note be one string attribute
— trivially snapshotted, stripped, and (later) searched. Rich notes would force
either serializing a JSON doc into the attribute or a side table; both are
heavier and against the stated intent. Deferred as YAGNI.

### Overlap: one note per range; adding on top edits

- Selection with **no** existing note → create a note.
- Selection sitting within/over **exactly one** existing note → "Add Note"
  opens **that** note for editing (no second note is created).
- Selection spanning **two** different notes, or only **partially** covering
  one → show a gentle "selection overlaps an existing note" message and do
  nothing.

True stacked/overlapping notes are explicitly **not** supported — they are not
representable with a single text-carrying mark without multiple mark types or a
side table, and are over-engineered for "note to self."

---

## Invisibility in preview and export

**The contract:** notes are visible only while editing.

Both preview (`packages/client/src/components/PreviewMode.tsx`) and export
(`packages/server/src/export/export.renderers.ts`) render chapter JSON through
the **same** shared `editorExtensions` array. If the `note` mark rendered a
highlight, it would leak into both. It must not — and the note *text* (which
lives in the mark attribute) must never reach output.

**Mechanism — strip before render.** A small pure helper in `shared`:

```ts
stripNoteMarks(doc: TipTapDoc): TipTapDoc   // removes every `note` mark, keeps the text
```

- **Editor** uses `editorExtensions` as-is → the `note` mark's `renderHTML`
  adds a `note-highlight` class, so noted text is highlighted while writing.
- **Preview and export** call `stripNoteMarks(content)` **before**
  `generateHTML(...)`. The mark is gone → no highlight, and the note `text`
  (attribute-only) is structurally incapable of appearing in output.

One helper, called at two sites, closes the whole leak surface. Deliberately
explicit over clever: the note text cannot appear because we delete the mark
carrying it before HTML generation, and there is exactly one function to test.

### Find-and-replace interaction (Phase 4b)

Project-wide replace rewrites text runs server-side (`tiptap-text.ts`). The
`note` mark already passes validation (`TipTapDocSchema` does not whitelist
mark types).

**Invariant:** a replace landing inside a noted range must **not crash** and
must **not silently corrupt** the document. Worst acceptable outcome is the note
detaching. The plan carries an explicit test (replace text within a noted range
→ doc still valid, note preserved or cleanly dropped). Exact preservation
behavior is confirmed against `tiptap-text.ts` at plan-writing time, not guessed
here.

---

## Interaction model

**Adding a note.**

- Select text → an "Add Note" affordance: an editor toolbar button **and** a
  keyboard shortcut **Ctrl/Cmd+Alt+M** (mirrors Google Docs "insert comment";
  fallback Ctrl+Shift+M if Alt proves flaky cross-browser). Both free of
  existing bindings (Ctrl+/, Ctrl+S, Ctrl+H, Ctrl+Shift+N/W/P/\\, Ctrl+.,
  Ctrl+Shift+Up/Down).
- Opens a small **popover** anchored to the selection: plain-text `<textarea>`
  + Save/Cancel. Saving empty = no note (or delete existing).

**Viewing / editing / deleting.**

- Noted text carries a subtle highlight. Click it (or a panel row) → the same
  popover opens showing the note, with Edit and Delete.
- Delete removes the `note` mark, restoring plain text.

**Notes panel tab** (in the reference panel, post-4c.0).

- A "Notes" tab walks the **open chapter's editor JSON** for `note` marks and
  lists them **in document order** — each row: noted-text excerpt + note.
- Clicking a row scrolls the editor to that mark and opens its popover.
- **Live-updates** as the writer adds/edits/deletes — no server round-trip, no
  cache staleness (data source is the in-memory editor doc).

**Notes panel scope: current chapter only, client-side.** No
`GET /api/projects/{id}/notes` endpoint in v1. The panel reads the open
chapter's JSON. A manuscript-wide "all my notes" punch-list is a clean future
enhancement (it would need the server endpoint) but is not built now — the
roadmap only asked for current-chapter, and this keeps 4c.1 client-only.

---

## Visual treatment

A single soft background highlight from the warm palette (ochre/amber tint,
distinct from text selection and from find-replace match highlighting) — **not**
user-configurable in v1 (the roadmap's "configurable" is deferred YAGNI).

Color is **never the sole cue**: the panel tab and popover carry the note
textually, satisfying WCAG "color not sole information carrier."

---

## Accessibility (WCAG 2.1 AA — mandatory)

- The popover is keyboard-operable with managed focus — reuse
  `useDialogLifecycle` if it renders as a `<dialog>`, else an explicit focus
  trap + Escape-to-close.
- The "Add Note" button carries an `aria-label` from `strings.ts`.
- The Notes panel list is fully keyboard-navigable — every note reachable
  without a pointer.
- Adding a note announces via the existing `aria-live` region.
- All UI strings live in `packages/client/src/strings.ts` (Phase 4b.4 ESLint
  rule).

---

## Edge cases

- **Delete-through:** deleting all noted text deletes the note; partial deletion
  shrinks the range, note survives.
- **Copy/paste:** noted text pasted elsewhere carries the mark (note travels
  with its text); pasting into a noted range keeps the surrounding note.
- **Empty note:** saving an empty popover deletes the note rather than storing a
  blank annotation.
- **Snapshot restore:** restoring an old snapshot restores whatever notes
  existed then (automatic — notes are in the JSON).

---

## Testing (TDD, red-green-refactor)

**shared**
- `stripNoteMarks`: removes marks, preserves text, handles nested marks and the
  depth cap.
- `note` mark `renderHTML`/`parseHTML` round-trip.

**client**
- Note mark applies / edits / deletes.
- Popover focus management + keyboard operation.
- Notes panel lists in document order; scroll-to-note works; live-updates.
- **Preview shows no highlight and no note text.**

**server**
- Export renderers (HTML / Markdown / plaintext / PDF / docx / EPUB) emit
  neither highlight nor note text.
- Phase-4b **replace-within-a-noted-range** invariant test.

**e2e + aXe**
- Add-note flow via keyboard.
- aXe scan of the popover and the Notes tab.

Coverage floors (95% stmt / 85% branch / 90% fn / 95% line) apply; zero-warning
test output via `expectConsole()`.

---

## CLAUDE.md updates (deliverable of this phase)

Add a short §Key Architecture Decisions note documenting the invariant:

> **Editor-only marks are stripped before preview/export.** The `note` mark
> (Phase 4c.1) is visible only while editing; `stripNoteMarks()` in `shared`
> removes it before `generateHTML()` in both preview and export, so neither the
> highlight nor the attribute-held note text reaches output. Future
> editor-only marks (e.g. Phase 4c.3 tags) follow the same strip-before-render
> pattern.

(Finalized in the §7 CLAUDE.md review during the /roadmap run.)

---

## PR shape

- **Zero migrations, zero new routes, zero ProjectStore changes.**
- Touches: `shared` (mark definition + `stripNoteMarks`), `client` (mark UI,
  popover, Notes panel tab, preview stripping, strings, shortcut), `server`
  (export renderer stripping).
- Ships **after** 4c.0.

---

## Appendix — 4c.0 Reference Panel Multi-Tab Refactor (prerequisite spec)

Shipped as its own design/plan/PR. Spec'd here because 4c.1 depends on it.

**Today:** `ReferencePanel.tsx` hard-codes a single "Images" tab button
(`aria-selected` always true) and renders `children` into one tabpanel.
`useReferencePanelState.ts` persists only width + open/closed.

**Change (pure refactor, no behavior change):**

- `ReferencePanel` accepts a `tabs: { id, label, panel }[]` array plus an
  `activeTabId` and an `onSelectTab` callback; renders a real `role="tablist"`
  with one button per tab and shows the active tab's panel.
- `useReferencePanelState` gains active-tab persistence
  (`smudge:ref-panel-active-tab`, default `"images"`).
- **Images remains the only tab.** Existing behavior and tests are unchanged and
  serve as the regression net. No new user-visible behavior until 4c.1 adds a
  second tab.
