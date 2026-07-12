---
date: 2026-07-12
phase: "Phase 4c.1: Inline Notes"
model: claude-opus-4-8
design_file: docs/plans/2026-07-12-notes-design.md
plan_file: docs/plans/2026-07-12-notes-plan.md
pushback:
  total: 10
  critical: 0
  important: 5
  minor: 5
alignment:
  total: 2
  critical: 0
  important: 0
  minor: 2
---

# Phase 4c.1: Inline Notes — Decision Log

**Scope note:** Roadmap Phase 4c (Notes, Tags & Outtakes) bundled three
independent features and was split per CLAUDE.md §Pull Request Scope into
4c.0 (Reference Panel Multi-Tab Refactor), 4c.1 (Inline Notes), 4c.2 (Outtakes),
4c.3 (Tags). This run brainstormed and planned **4c.1 Inline Notes**; 4c.0 is
spec'd as a prerequisite appendix in the design and ships as its own PR first.
Pushback ran in **two rounds** (the user requested a second pass on the revised
design); both are recorded below.

## Pushback Findings

### [1] Project-wide replace-all strips notes
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The design assumed the worst case of a Phase-4b project-wide
  replace landing in a noted range was "the note detaching," and deferred the
  real behavior to plan-time. I initially claimed replace-all would silently
  strip every note in affected chapters. Reading `replaceInDoc`
  (`tiptap-text.ts`) contradicted this: it is mark-aware, carrying marks
  per-offset and reattaching them to replacement text.
- **Resolution:** dismissed-invalid — the concern was a false positive; the code
  preserves notes across partial replace. Design updated to state the verified
  behavior + a characterization test.

### [2] Notes panel had no live-data path
- **Severity:** Important
- **Category:** Omission
- **Summary:** The design said the panel "walks the open chapter's editor JSON"
  and live-updates, but the TipTap editor instance is encapsulated in
  `Editor.tsx` and only exposed to `EditorPage` via a narrow handle — there was
  no specified way for the panel to observe the live, unsaved doc.
- **Resolution:** fixed-in-design — lift a minimal note-list via `Editor.tsx`'s
  existing `onUpdate` through the Editor→EditorPage seam; the panel is a dumb
  renderer over that array.

### [3] Note popover a11y pattern left undecided
- **Severity:** Important
- **Category:** Ambiguity
- **Summary:** The design hedged "reuse `useDialogLifecycle` if it renders as a
  `<dialog>`, else a hand-built focus trap" — two very different implementations
  behind one word, against a mandatory a11y constraint.
- **Resolution:** fixed-in-design — the note editor is a modal `<dialog>` via
  `useDialogLifecycle`, reusing the existing five-dialog pattern; the inline
  selection-anchored popover was explicitly rejected.

### [4] Note mark `id` attribute unnecessary + paste collision
- **Severity:** Minor
- **Category:** Other (simplification/correctness)
- **Summary:** The mark carried `id` + `text`, but scroll-to and panel
  disambiguation both work off document position; `id` was dead weight and
  introduced a copy/paste collision (a pasted copy duplicates the id).
- **Resolution:** fixed-in-design — dropped `id`; identity is document position,
  which the live re-derive (Issue 2) makes reliable.

### [5] `stripNoteMarks` must honor the depth guard
- **Severity:** Minor
- **Category:** Omission
- **Summary:** The new strip helper walks the TipTap tree and must respect
  `MAX_TIPTAP_DEPTH` per the Phase 4b.13 depth-guard contract, which the design
  only implied.
- **Resolution:** fixed-in-design — made explicit in the design + test list.

### [A] Note add/edit/delete are unguarded editor-mutating entry points
- **Severity:** Important
- **Category:** Omission
- **Summary:** (Round 2) Add/edit/delete-note mutate editor content, so per
  CLAUDE.md F-1 / §Save-pipeline invariants each must be guarded on the editor's
  operational state (`locked`/`busy`) and enumerated in
  `editorEntryPointSurface.test.ts`. The design named only the panel wiring as
  tripping the surface test, not the note actions themselves.
- **Resolution:** fixed-in-design — the three note actions are guarded
  (no-op while locked/busy), listed in the surface test, and persist via normal
  autosave (no `useEditorMutation`, since there is no server round-trip).

### [B] Modal dialog steals the editor selection
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** (Round 2) The Issue-3 modal-dialog choice created a new problem:
  opening a modal moves focus out of the editor and loses the ProseMirror
  selection, so a naive Save would apply the mark to an empty/wrong range.
- **Resolution:** fixed-in-design — capture the target `{from,to}` (add) or the
  note's mark range (edit/delete) before `showModal()`; Save applies to the
  captured range, with a test.

### [C] Adjacent identical-text notes merge
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** (Round 2) A consequence of dropping `id`: ProseMirror merges
  adjacent text nodes with equal marks, so two separate notes with identical
  text on adjacent ranges collapse into one.
- **Resolution:** fixed-in-design — documented as accepted (even desirable)
  behavior for "note to self"; non-adjacent identical notes are unaffected.

### [D] Note text must not inflate word count
- **Severity:** Minor
- **Category:** Omission
- **Summary:** (Round 2) Word-count integrity is a core promise; the design
  should state (and pin) that note text — living in a mark attribute, not a text
  node — is excluded from `countWords`.
- **Resolution:** fixed-in-design — stated + a test that a chapter's word count
  is identical with and without notes.

### [E] `stripNoteMarks` composition with export image sanitization
- **Severity:** Minor
- **Category:** Omission
- **Summary:** (Round 2) The export path already runs image-src sanitization
  before `generateHTML`; adding `stripNoteMarks` there is a second pre-render
  transform. They touch disjoint node/mark types, so order is irrelevant — worth
  stating so nobody assumes a conflict.
- **Resolution:** fixed-in-design — noted as order-independent composition.

## Alignment Findings

### [1] No task styles `.note-highlight`
- **Severity:** Minor
- **Category:** missing-coverage
- **Summary:** The mark renders `class="note-highlight"` (Task 3) but no task
  added the CSS giving it the warm-palette background, so the Visual-treatment
  requirement (a highlight distinct from selection and from find-replace match
  highlighting) was unimplemented — the highlight would be invisible.
- **Resolution:** fixed-in-plan — added a Task 3 step adding the
  `.note-highlight` style (accent tint + underline, checked distinct from the
  find-replace highlight) with an assertion.

### [2] Aria-live announcement path unspecified
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** Task 12 announced note events "via the aria-live region" and the
  design assumed an "existing" region, but neither confirmed the save-status
  polite region is reachable from the add-note handler or wired it — a silent
  no-op risk against a mandatory a11y constraint.
- **Resolution:** fixed-in-plan — Task 12 now verifies/reaches the existing
  polite live region (or adds a dedicated one) and asserts the added/overlap
  announcements in tests.

## Summary

- **Pushback raised 10 issues** (across two rounds): 9 resulted in design
  changes, 1 dismissed as invalid (the "replace-all strips notes" claim, which
  reading `replaceInDoc` disproved). The second round was especially productive
  — it caught that note actions are guarded editor-mutating entry points (F-1)
  and that the chosen modal dialog steals the editor selection, both of which
  would have surfaced as implementation-time bugs.
- **Alignment raised 2 issues**, both minor missing-coverage/design-gaps in the
  a11y/visual requirements (highlight CSS, live-region wiring); both fixed in the
  plan.
- **Status:** design and plan aligned; ready for implementation (after 4c.0).
