/**
 * I2 (agentic-review 2026-08-04): pins the ProseMirror semantic the outtake
 * capture path rests on.
 *
 * `handleSendSelectionToOuttakes` wraps the captured slice in `{type:"doc"}` and
 * POSTs it. `doc.slice(from, to)` defaults `includeParents = false` and cuts at
 * `$from.sharedDepth(to)` — for two endpoints inside ONE paragraph that depth IS
 * the paragraph, so the slice is the paragraph's INLINE content and the wrapper
 * is `{type:"doc",content:[{type:"text",…}]}`, which fails the doc node's
 * `block+` content expression. `Selection.content()` passes `includeParents =
 * true` and is always block-level.
 *
 * That mattered because nothing downstream catches it: `TipTapDocSchema` types
 * `content` as `z.array(z.record(z.unknown()))`, `countWords`/`toPlainText`/
 * `stripImageNodes` are hand-rolled JSON walkers that tolerate it, and
 * `insertContent` accepts an inline fragment. The rows just accumulate — in a
 * HARD-delete table (outtakes carry no `deleted_at`) that CLAUDE.md §Data Model
 * explicitly anticipates a future renderer for. The first such consumer throws,
 * and the fix at that point is a data migration over the writer's real DB.
 *
 * The unit suite mocks the editor, so only a real schema can hold this line.
 */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "prosemirror-state";
import { editorExtensions } from "@smudge/shared/editor-extensions";

const schema = getSchema(editorExtensions);

/** A one-paragraph doc plus a selection over `quick` — both endpoints inside it. */
function sameParagraphSelection(): EditorState {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "the quick brown fox" }] }],
  });
  const state = EditorState.create({ schema, doc });
  const from = doc.resolve(5).pos;
  const to = doc.resolve(10).pos;
  return state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)));
}

/** Wrap a slice's JSON the way handleSendSelectionToOuttakes does. */
function asOuttakeDoc(content: unknown): Record<string, unknown> {
  return { type: "doc", content: (content as unknown[]) ?? [] };
}

describe("outtake capture: the selection must be captured block-level", () => {
  it("selection.content() yields a structurally valid TipTap doc", () => {
    const state = sameParagraphSelection();
    const captured = asOuttakeDoc(state.selection.content().content.toJSON());

    expect(captured.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "quick" }] },
    ]);
    // The assertion that matters: ProseMirror itself accepts the persisted shape.
    expect(() => schema.nodeFromJSON(captured).check()).not.toThrow();
  });

  it("doc.slice(from, to) does NOT — it returns inline content for the same selection", () => {
    const state = sameParagraphSelection();
    const { from, to } = state.selection;
    const captured = asOuttakeDoc(state.doc.slice(from, to).content.toJSON());

    expect(captured.content).toEqual([{ type: "text", text: "quick" }]);
    expect(() => schema.nodeFromJSON(captured).check()).toThrow(/Invalid content for node doc/);
  });
});
