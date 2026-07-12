# Inline Notes (Phase 4c.1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a writer attach a private plain-text note to a selected text range; noted text is highlighted while editing, listed in a Notes panel tab, and invisible in preview and every export.

**Architecture:** A note is a TipTap custom `note` mark (attribute: `text`) living inside the chapter's TipTap JSON — no DB table, no route, no ProjectStore change. A pure `stripNoteMarks(doc)` helper removes the mark before `generateHTML()` in both preview and export so notes never leak. Note add/edit/delete are guarded editor-mutating entry points that persist via normal autosave; the note editor is a modal `<dialog>` via `useDialogLifecycle`; the Notes panel renders a minimal note-list lifted out of `Editor.tsx`'s `onUpdate`.

**Tech Stack:** TypeScript, React 18, TipTap v2 (`@tiptap/core` `Mark.create`), Vitest, Playwright + aXe.

**Design:** `docs/plans/2026-07-12-notes-design.md`

**PREREQUISITE — must be merged before starting:** Phase **4c.0** (Reference Panel Multi-Tab Refactor). This plan assumes `ReferencePanel` already accepts a `tabs: { id, label, panel }[]` + `activeTabId` + `onSelectTab` API and `useReferencePanelState` persists the active tab. Do **not** implement the panel refactor here.

**Repo constraints (CLAUDE.md):** TDD red-green-refactor every task; coverage floors 95% stmt / 85% branch / 90% fn / 95% line; zero-warning test output (client console spies only via `expectConsole()`); all UI strings in `strings.ts` (ESLint-enforced); HTTP status/error-code allowlist unchanged (this phase adds none); one feature per PR.

---

## Task 1: `stripNoteMarks` pure helper (shared)

Removes every `note` mark from a TipTap doc, preserving text; honors `MAX_TIPTAP_DEPTH`. Pure JSON walk, zero TipTap import → lives in the shared barrel.

**Files:**
- Create: `packages/shared/src/tiptap-notes.ts`
- Create: `packages/shared/src/__tests__/tiptap-notes.test.ts`
- Modify: `packages/shared/src/index.ts` (export `stripNoteMarks`, `extractNotes`)

**Step 1 — Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { stripNoteMarks } from "../tiptap-notes";

describe("stripNoteMarks", () => {
  it("removes note marks but keeps the text", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "Marcus drew his sword",
          marks: [{ type: "note", attrs: { text: "check the weapon" } }],
        }],
      }],
    };
    const out = stripNoteMarks(doc);
    expect(out.content[0].content[0].marks).toBeUndefined();
    expect(out.content[0].content[0].text).toBe("Marcus drew his sword");
  });

  it("keeps other marks on the same text node", () => {
    const doc = { type: "doc", content: [{ type: "text", text: "x",
      marks: [{ type: "bold" }, { type: "note", attrs: { text: "n" } }] }] };
    expect(stripNoteMarks(doc).content[0].marks).toEqual([{ type: "bold" }]);
  });

  it("does not mutate the input", () => {
    const doc = { type: "doc", content: [{ type: "text", text: "x",
      marks: [{ type: "note", attrs: { text: "n" } }] }] };
    stripNoteMarks(doc);
    expect(doc.content[0].marks).toHaveLength(1);
  });

  it("bails safely on an over-deep doc (no throw)", () => {
    let node: any = { type: "text", text: "deep" };
    for (let i = 0; i < 200; i++) node = { type: "x", content: [node] };
    expect(() => stripNoteMarks({ type: "doc", content: [node] })).not.toThrow();
  });
});
```

**Step 2 — Run it, verify it fails:** `npm test -w packages/shared -- tiptap-notes` → FAIL ("stripNoteMarks is not a function").

**Step 3 — Implement:**

```ts
import { MAX_TIPTAP_DEPTH } from "./tiptap-safety";

interface Node { type: string; text?: string; marks?: { type: string }[]; content?: Node[]; }

/** Remove every `note` mark, preserving text. Returns a new doc (input untouched).
 *  Depth-capped at MAX_TIPTAP_DEPTH per the Phase 4b.13 depth-guard contract. */
export function stripNoteMarks<T>(doc: T): T {
  return walk(doc as unknown as Node, 0) as unknown as T;
}

function walk(node: Node, depth: number): Node {
  if (depth > MAX_TIPTAP_DEPTH) return node;
  const next: Node = { ...node };
  if (node.marks) {
    const kept = node.marks.filter((m) => m.type !== "note");
    if (kept.length) next.marks = kept;
    else delete next.marks;
  }
  if (node.content) next.content = node.content.map((c) => walk(c, depth + 1));
  return next;
}
```

**Step 4 — Run, verify pass.** **Step 5 — Commit:** `git add -A && git commit -m "feat(4c.1): stripNoteMarks shared helper"`

---

## Task 2: `extractNotes` pure helper (shared)

Given a TipTap doc, return the ordered list of notes with their character offsets — the data the panel renders and the lift feeds. Offsets are computed over the same flat text model the rest of the app uses.

**Files:** same `tiptap-notes.ts` / test / barrel.

**Step 1 — Failing test** (append to `tiptap-notes.test.ts`):

```ts
import { extractNotes } from "../tiptap-notes";

it("extracts notes in document order with text + excerpt", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "Hello " },
    { type: "text", text: "world", marks: [{ type: "note", attrs: { text: "greeting" } }] },
  ] }] };
  expect(extractNotes(doc)).toEqual([{ note: "greeting", excerpt: "world" }]);
});

it("returns [] when there are no notes", () => {
  expect(extractNotes({ type: "doc", content: [] })).toEqual([]);
});
```

> **Note on identity:** the panel and the lift key notes by **document position**, not id (design Issue 4). The client-side lift (Task 10) attaches ProseMirror `{from,to}` positions; this pure helper returns only the display fields (`note`, `excerpt`) so it stays JSON-model-only and testable without an editor. Positions are added in Task 10.

**Step 2–5:** implement a depth-guarded walk collecting `note` marks (text node's note attr → `{ note, excerpt: node.text }`), run, commit `feat(4c.1): extractNotes shared helper`.

---

## Task 3: `note` TipTap mark (shared, editor-extensions subpath)

The custom mark. Imports `@tiptap/core` → lives with the extensions (subpath), **not** the barrel.

**Files:**
- Create: `packages/shared/src/noteMark.ts`
- Create: `packages/shared/src/__tests__/noteMark.test.ts`
- Modify: `packages/shared/src/editorExtensions.ts` (append `NoteMark`)

**Step 1 — Failing test:**

```ts
import { describe, it, expect } from "vitest";
import { generateHTML } from "@tiptap/html";
import { editorExtensions } from "../editorExtensions";

it("renders a note-bearing range as a highlight span (editor/HTML path)", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "hi", marks: [{ type: "note", attrs: { text: "n" } }] }] }] };
  const html = generateHTML(doc, editorExtensions);
  expect(html).toContain("note-highlight");
});
```

**Step 3 — Implement `noteMark.ts`:**

```ts
import { Mark, mergeAttributes } from "@tiptap/core";

/** Editor-only annotation mark. The `text` attribute holds a plain-text note.
 *  Stripped before preview/export via stripNoteMarks (see design). No `id`:
 *  identity is document position. */
export const NoteMark = Mark.create({
  name: "note",
  inclusive: false, // typing at a note's boundary does not extend it
  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-note") ?? "",
        renderHTML: (attrs) => (attrs.text ? { "data-note": attrs.text } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-note]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "note-highlight" }), 0];
  },
});
```

Append to `editorExtensions.ts` array: `NoteMark,` (import at top). Verify `npm test -w packages/shared` stays green (existing extension-parity/consumers unaffected). **Commit:** `feat(4c.1): note TipTap mark`.

**Step 6 — Style the highlight (alignment Gap 1).** The mark only emits a class; add the actual style so noted text is visibly (and accessibly) marked.

- Modify the client editor CSS (the same layer/file that styles other editor content — grep for existing `.ProseMirror` / prose rules, e.g. `packages/client/src/index.css` or the Tailwind layer).
- Add a rule using a warm-palette accent tint that is **visibly distinct** from both the browser text-selection color and the find-replace match highlight (grep the find-replace highlight class first and pick a different hue/treatment — e.g. a soft ochre underline+tint vs. find-replace's block highlight):

```css
.note-highlight {
  background-color: rgb(107 71 32 / 0.12); /* accent #6B4720 @ ~12% — soft, distinct from selection */
  border-bottom: 2px solid rgb(107 71 32 / 0.45);
}
```

- Add/extend a test (or a Playwright assertion in Task 14) that a noted range carries the `note-highlight` class and that the rule exists. Color is not the sole cue — the panel + dialog carry the note textually (design). **Commit:** `feat(4c.1): note highlight style`.

---

## Task 4: `replaceInDoc` preserves the note mark (shared, verification)

No implementation — pins the verified Issue-1 behavior so a future `tiptap-text.ts` change can't silently regress it.

**Files:** Modify `packages/shared/src/__tests__/tiptap-text.test.ts`.

**Step 1 — Test:** build a doc where "Marcus drew his sword" carries a `note` mark; run the module's `replaceInDoc` replacing "Marcus"→"Lucius" (match the existing tests' call shape in that file); assert the result text is "Lucius drew his sword" **and** the run still carries a `note` mark. Run → PASS (behavior already exists; this is a characterization test). **Commit:** `test(4c.1): pin note-mark survival across replaceInDoc`.

---

## Task 5: Strip notes in the server export path

**Files:**
- Modify: `packages/server/src/export/export.renderers.ts` (`chapterContentToHtml`, ~line 57)
- Modify: `packages/server/src/__tests__/export.*.test.ts` (nearest existing export renderer test)
- **Check:** grep the export dir for any docx/epub/pdf renderer that converts chapter JSON **without** going through `chapterContentToHtml` (`grep -rn "generateHTML\|editorExtensions" packages/server/src/export`). If one exists, strip there too.

**Step 1 — Failing test:** render a chapter whose content has a `note` mark (text "SECRET") through `renderHtml`/`renderMarkdown`/`renderPlainText`; assert output contains neither `"SECRET"` nor `"note-highlight"`.

**Step 3 — Implement:** at the top of `chapterContentToHtml`:

```ts
import { stripNoteMarks } from "@smudge/shared";
// ...
export function chapterContentToHtml(content: Record<string, unknown> | null): string {
  if (!content) return "";
  const clean = stripNoteMarks(content); // editor-only marks never reach output
  try {
    return stripDisallowedImages(generateHTML(clean, editorExtensions));
  } catch (err) { /* unchanged */ }
}
```

Order-independent with the existing `stripDisallowedImages` (disjoint concerns — design Issue E). **Commit:** `feat(4c.1): strip note marks from all exports`.

---

## Task 6: Strip notes in client preview

**Files:**
- Modify: `packages/client/src/components/PreviewMode.tsx` (`renderChapterHtml`, ~line 35)
- Modify: `packages/client/src/components/__tests__/PreviewMode.test.tsx` (or create)

**Step 1 — Failing test:** render `<PreviewMode>` with a chapter carrying a note (text "SECRET"); assert the rendered DOM contains neither "SECRET" nor an element with class `note-highlight`. (Use `expectConsole` if any warning is expected; none should be.)

**Step 3 — Implement:**

```ts
import { stripNoteMarks } from "@smudge/shared";
// ...
function renderChapterHtml(content: Record<string, unknown> | null): string | null {
  if (!content) return null;
  try {
    return generateHTML(stripNoteMarks(content) as Parameters<typeof generateHTML>[0], editorExtensions);
  } catch { return null; }
}
```

**Commit:** `feat(4c.1): strip note marks from preview`.

---

## Task 7: Note strings

**Files:** Modify `packages/client/src/strings.ts`.

Add a `notes` group (match the file's nested-object style):

```ts
notes: {
  addLabel: "Add note",          // toolbar button aria-label + text
  dialogTitle: "Note",
  placeholder: "Note to self…",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  panelTabLabel: "Notes",
  empty: "No notes in this chapter.",
  overlapWarning: "Selection overlaps an existing note.",
  added: "Note added.",          // aria-live announcement
},
```

No test of its own; consumed by later tasks. **Commit:** `feat(4c.1): note UI strings`.

---

## Task 8: Note commands + range helpers (client)

Pure-ish editor operations, guarded by the caller (Task 9/11). Kept in one module so the dialog, toolbar, shortcut, and panel all share them.

**Files:**
- Create: `packages/client/src/editor/noteCommands.ts`
- Create: `packages/client/src/editor/__tests__/noteCommands.test.ts`

Functions (all take the TipTap `Editor`):
- `setNote(editor, range: {from,to}, text: string)` → `editor.chain().setTextSelection(range).setMark("note", { text }).run()`
- `updateNote(editor, range, text)` → same as setNote over the captured range (setMark replaces attrs).
- `removeNote(editor, range)` → `editor.chain().setTextSelection(range).unsetMark("note").run()`
- `noteRangeAt(editor, pos): {from,to} | null` — scan `editor.state.doc` for the contiguous `note`-marked range covering `pos`.
- `selectionOverlapState(editor): "none" | "single" | "multi-or-partial"` — classify the current selection vs. existing notes (drives the add-vs-edit-vs-warn decision, design "Overlap").

**Step 1 — Failing tests:** build an editor with the `editorExtensions` over a known doc (use `@tiptap/core` `Editor` headless in jsdom, as the codebase does elsewhere — mirror `useSnapshotController`/existing editor tests for setup). Assert: `setNote` marks the range; `noteRangeAt` returns the full contiguous range; `removeNote` clears it; `selectionOverlapState` returns `"single"` when the selection sits inside one note. **Implement, run, commit:** `feat(4c.1): note editor commands + range helpers`.

---

## Task 9: NoteDialog component (client)

Modal `<dialog>` via `useDialogLifecycle`, mirroring `ConfirmDialog`.

**Files:**
- Create: `packages/client/src/components/NoteDialog.tsx`
- Create: `packages/client/src/components/__tests__/NoteDialog.test.tsx`

Props: `{ open, initialText, onSave(text), onDelete?, onClose }`. A `<textarea>` (initial-focused via `initialFocusRef`), Save, Cancel, and Delete (shown only when editing an existing note). Empty-on-save → call `onDelete ?? onSave("")` semantics: **saving empty deletes** (design). All labels from `STRINGS.notes`. `role`/`aria-label` in JSX (hook owns lifecycle only). Use `blockEscapePropagation: true` (shields the find-replace Escape listener, per `ConfirmDialog` precedent).

**Step 1 — Failing tests:** renders with initial text; typing + Save calls `onSave` with the new text; Save with empty calls delete semantics; Escape/backdrop calls `onClose`; focus lands in the textarea on open. **Implement, run, commit:** `feat(4c.1): NoteDialog`.

---

## Task 10: Lift the note-list out of the editor (client)

Thread a minimal, position-tagged note-list from `Editor.tsx`'s `onUpdate` up to `EditorPage`, so the panel can render live.

**Files:**
- Modify: `packages/client/src/components/Editor.tsx` (`onUpdate`, ~line 260; add an `onNotesChange?: (notes: NoteListItem[]) => void` prop)
- Create: `packages/client/src/editor/collectNotes.ts` (+ test) — `collectNotes(editor): NoteListItem[]` where `NoteListItem = { from: number; to: number; note: string; excerpt: string }`, built via `editor.state.doc.descendants` collecting `note`-marked ranges in document order.
- Modify: `packages/client/src/pages/EditorPage.tsx` (hold `notes` state; pass `onNotesChange` down to the editor and `notes` down to the panel)

**Step 1 — Failing test:** `collectNotes` over an editor with two noted ranges returns two items in document order with correct `from/to/excerpt`. Also assert `Editor` calls `onNotesChange` on content change (extend an existing `Editor` test).

**Step 3 — Implement:** in `onUpdate`, after existing logic, call `onNotesChange?.(collectNotes(ed))`. Also emit once on create/mount so the initial list is populated. In `EditorPage`, `const [notes, setNotes] = useState<NoteListItem[]>([])`; pass `onNotesChange={setNotes}`.

> This adds one derived value threaded through `EditorPage` (accepted F-1 pattern). It is **not** a mutating entry point (read-only lift) so it does not need a busy/lock guard — but the panel's click handlers in Task 11 **do**.

**Commit:** `feat(4c.1): lift live note-list from the editor`.

---

## Task 11: Notes panel tab (client)

Register a "Notes" tab (via the 4c.0 tab API) that renders `notes` and wires click → scroll + open dialog.

**Files:**
- Create: `packages/client/src/components/NotesPanel.tsx` (+ test)
- Modify: `packages/client/src/components/EditorMainContent.tsx` (add the Notes tab to the `ReferencePanel` `tabs` array alongside Images)
- Modify: `packages/client/src/pages/EditorPage.tsx` (own the "open note dialog for range" handler; guard it)

`NotesPanel` props: `{ notes, onOpenNote(item) }`. Renders `STRINGS.notes.empty` when empty; else a keyboard-navigable list (each row a `<button>`: excerpt + note). Clicking a row calls `onOpenNote(item)`.

`onOpenNote` (in `EditorPage`) — a **guarded editor-mutating entry point** (it leads to edit/delete): **no-op while the editor is `locked` or `busy`**; otherwise scroll the editor to `item.from` (`editor.commands.setTextSelection(item)` + `scrollIntoView`) and open `NoteDialog` seeded from `item`. Save → `updateNote(editor, capturedRange, text)`; empty/Delete → `removeNote(editor, capturedRange)`. **Capture `item.{from,to}` before opening the dialog** (design Issue B).

**Step 1 — Failing tests:** empty state renders `STRINGS.notes.empty`; two notes render two buttons in order; clicking a row calls `onOpenNote` with that item; `onOpenNote` is a no-op when `locked`/`busy` (assert no dialog opens / no editor mutation). **Implement, run, commit:** `feat(4c.1): Notes panel tab`.

---

## Task 12: Add-note toolbar button + Ctrl/Cmd+Alt+M (client)

The entry point for **creating** a note.

**Files:**
- Modify: `packages/client/src/components/EditorToolbar.tsx` (add an "Add note" button; disabled when selection is empty)
- Modify: `packages/client/src/hooks/useKeyboardShortcuts.ts` (add `ctrl && e.altKey && e.code === "KeyM"`)
- Modify: `packages/client/src/pages/EditorPage.tsx` (the `handleAddNote` entry point + wiring)

`handleAddNote` — a **guarded editor-mutating entry point**:
1. No-op while `locked`/`busy`.
2. Compute `selectionOverlapState(editor)`. If `"multi-or-partial"` → announce `STRINGS.notes.overlapWarning` via the aria-live region, stop. If `"single"` → open the dialog to **edit** the existing note (`noteRangeAt`). If `"none"` with a non-empty selection → **capture** `{from,to}` and open `NoteDialog` empty; Save → `setNote(editor, capturedRange, text)`; announce `STRINGS.notes.added`.
3. Empty selection → button disabled / shortcut no-op.

**Aria-live wiring (alignment Gap 2).** Before wiring the announcements, locate the existing polite live region used for save status (`grep -rn 'aria-live' packages/client/src`). If it is reachable from `EditorPage` (it is owned there or via a passed setter), route `STRINGS.notes.added` and `STRINGS.notes.overlapWarning` through it. If it is **not** cleanly reachable, add a small dedicated `<div aria-live="polite" className="sr-only">` owned by `EditorPage` and push announcements to it. Do not assume the region exists — verify.

**Step 1 — Failing tests:** button disabled with no selection; with a selection, click opens the dialog and Save applies a note over the captured range even after focus left the editor (Issue B); Ctrl+Alt+M mirrors the button; overlap `multi-or-partial` announces `STRINGS.notes.overlapWarning` **and** creates nothing; a successful add announces `STRINGS.notes.added` into the live region (assert the region's text content); `locked`/`busy` → no-op. **Implement, run, commit:** `feat(4c.1): add-note button + shortcut + live-region announcements`.

---

## Task 13: Entry-point surface test + word-count guard

**Files:**
- Modify: `packages/client/src/__tests__/editorEntryPointSurface.test.ts` (update the snapshot to include the new entry points: the toolbar add-note prop, `EditorHeader`/`EditorMainContent`/`EditorDialogs` prop deltas, and the `Ctrl+Alt+M` key — consciously recording each as content-path/guarded per §Save-pipeline invariants)
- Modify/Create: a `packages/client` test asserting **word count is identical with and without notes** (design Issue D) — feed `countWords` a doc with and without a `note` mark, expect equal counts.

Run the full client suite; the surface test should now be green with the new points recorded. **Commit:** `test(4c.1): record note entry points + word-count invariance`.

---

## Task 14: E2E + aXe (Playwright)

**Files:** Create `e2e/notes.spec.ts`.

Cover: (1) select text → Ctrl+Alt+M → type → Save → noted text shows the highlight; (2) the Notes tab lists the note and clicking it re-opens it; (3) switch to Preview → the note text and highlight are absent; (4) aXe scan of the editor with the NoteDialog open and of the Notes tab → no violations. Follow the repo's e2e isolation (Phase 4b.6 env) and the `ovid-uat`/existing spec patterns. **Commit:** `test(4c.1): e2e + a11y for inline notes`.

---

## Task 15: CLAUDE.md invariant

**Files:** Modify `CLAUDE.md` (§Key Architecture Decisions).

Add:

> **Editor-only marks are stripped before preview/export.** The `note` mark (Phase 4c.1) is visible only while editing; `stripNoteMarks()` in `shared` removes it before `generateHTML()` in both preview (`PreviewMode`) and export (`chapterContentToHtml`), so neither the `note-highlight` nor the attribute-held note text reaches output. Note add/edit/delete are guarded editor-mutating entry points (no-op while `locked`/`busy`) that persist via normal autosave. Future editor-only marks (e.g. Phase 4c.3 tags) follow the same strip-before-render pattern.

**Commit:** `docs(4c.1): document editor-only-mark strip invariant`.

---

## Final verification (before opening the PR)

- `make all` (lint + format + typecheck + coverage + e2e) is green.
- Coverage did not drop below the floors; new modules are meaningfully covered.
- Zero warnings in test output.
- Manual smoke (`make dev`): add a note, edit it from the panel, delete by emptying it, confirm it's gone from Preview and from an HTML export.
- PR description references **Phase 4c.1** and notes the 4c.0 dependency.
