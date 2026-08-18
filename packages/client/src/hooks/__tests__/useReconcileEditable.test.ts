import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReducer, useRef, type MutableRefObject } from "react";
import { useReconcileEditable } from "../useReconcileEditable";
import {
  editorMutationReducer,
  INITIAL_EDITOR_MUTATION_STATE,
  type EditorMutationEvent,
} from "../useEditorMutationMachine";
import type { EditorHandle } from "../../components/Editor";

/**
 * Drive the real reducer through the real hook against a stub editor handle,
 * so the test pins the reconcile CONTRACT (every dispatch re-applies intent)
 * rather than React's dependency-array semantics.
 */
function renderReconcile() {
  const setEditable = vi.fn();
  let dispatch: (e: EditorMutationEvent) => void = () => {};
  let editorRef!: MutableRefObject<EditorHandle | null>;

  const view = renderHook(() => {
    const [state, d] = useReducer(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);
    dispatch = d;
    editorRef = useRef<EditorHandle | null>({ setEditable } as unknown as EditorHandle);
    useReconcileEditable(editorRef, state, "ch-1", 0);
    return state;
  });

  return { view, setEditable, dispatch: (e: EditorMutationEvent) => act(() => dispatch(e)) };
}

describe("useReconcileEditable", () => {
  it("re-applies editable intent on a dispatch that does not change the boolean", () => {
    // S2 (agentic review 2026-08-18). The drift case reassertEditorEditable()
    // exists for: useEditorMutation calls safeSetEditable(false) against a
    // freshly-remounted editor WITHOUT dispatching, so TipTap reads read-only
    // while the machine still reads editable:true. The consumer then dispatches
    // MUTATION_SETTLED_SUPERSEDED to re-enable — but that event's reducer arm
    // returns the SAME editable:true, so an effect keyed on the boolean never
    // re-runs and TipTap is never re-enabled. Keying on the state OBJECT (a new
    // object per dispatch, by construction of every reducer arm) is what makes
    // the re-assert reach TipTap.
    const { setEditable, dispatch } = renderReconcile();

    // Mount reconcile: initial state is editable:true.
    expect(setEditable).toHaveBeenLastCalledWith(true);
    setEditable.mockClear();

    // Simulate the out-of-band lock-down useEditorMutation performs against a
    // remounted editor with no machine dispatch: TipTap is now read-only while
    // the machine still says editable:true.
    setEditable(false);
    setEditable.mockClear();

    // The re-assert. Same boolean, new state object.
    dispatch({ type: "MUTATION_SETTLED_SUPERSEDED" });

    expect(setEditable).toHaveBeenCalledWith(true);
  });

  it("pushes a lock-down and the subsequent re-enable through in order", () => {
    const { setEditable, dispatch } = renderReconcile();
    setEditable.mockClear();

    dispatch({ type: "MUTATION_STARTED" });
    expect(setEditable).toHaveBeenLastCalledWith(false);

    dispatch({ type: "MUTATION_SETTLED_OK" });
    expect(setEditable).toHaveBeenLastCalledWith(true);
  });

  it("does not throw when no editor is mounted", () => {
    const setEditable = vi.fn();
    let dispatch: (e: EditorMutationEvent) => void = () => {};
    renderHook(() => {
      const [state, d] = useReducer(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);
      dispatch = d;
      const editorRef = useRef<EditorHandle | null>(null);
      useReconcileEditable(editorRef, state, undefined, 0);
      return state;
    });
    expect(() => act(() => dispatch({ type: "MUTATION_STARTED" }))).not.toThrow();
    expect(setEditable).not.toHaveBeenCalled();
  });
});
