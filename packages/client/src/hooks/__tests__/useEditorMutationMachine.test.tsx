import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  editorMutationReducer,
  INITIAL_EDITOR_MUTATION_STATE,
  type EditorMutationState,
} from "../useEditorMutationMachine";
import { useEditorMutationMachine } from "../useEditorMutationMachine";

const LOCKED: EditorMutationState = {
  editable: false,
  lock: { message: "refresh the page" },
};

/** Mid-mutation: locked down, no banner. Was `{editable:false, busy:true}` before
 * F-08 removed the busy mirror; `editable:false` is what the lock-down means. */
const MID_MUTATION: EditorMutationState = { editable: false, lock: null };

describe("editorMutationReducer", () => {
  it("starts editable and unlocked", () => {
    expect(INITIAL_EDITOR_MUTATION_STATE).toEqual({ editable: true, lock: null });
  });

  it("MUTATION_STARTED: editable false, lock unchanged", () => {
    expect(
      editorMutationReducer(INITIAL_EDITOR_MUTATION_STATE, { type: "MUTATION_STARTED" }),
    ).toEqual({ editable: false, lock: null });
    // lock unchanged when a prior lock exists
    expect(editorMutationReducer(LOCKED, { type: "MUTATION_STARTED" })).toEqual({
      editable: false,
      lock: { message: "refresh the page" },
    });
  });

  it("MUTATION_SETTLED_OK: re-enables only when unlocked", () => {
    expect(editorMutationReducer(MID_MUTATION, { type: "MUTATION_SETTLED_OK" })).toEqual({
      editable: true,
      lock: null,
    });
    // a persistent lock keeps the editor read-only after a successful run
    expect(editorMutationReducer(LOCKED, { type: "MUTATION_SETTLED_OK" })).toEqual({
      editable: false,
      lock: { message: "refresh the page" },
    });
  });

  it("MUTATION_SETTLED_SUPERSEDED: clears a stale prior lock, re-enables", () => {
    expect(editorMutationReducer(LOCKED, { type: "MUTATION_SETTLED_SUPERSEDED" })).toEqual({
      editable: true,
      lock: null,
    });
  });

  it("RELOADED: fresh content on screen — editable, unlocked", () => {
    expect(editorMutationReducer(LOCKED, { type: "RELOADED" })).toEqual({
      editable: true,
      lock: null,
    });
  });

  it("COMMITTED_UNRELOADED: read-only + banner", () => {
    expect(
      editorMutationReducer(MID_MUTATION, {
        type: "COMMITTED_UNRELOADED",
        message: "committed; refresh",
      }),
    ).toEqual({ editable: false, lock: { message: "committed; refresh" } });
  });

  it("EDITOR_REMOUNTED: clears lock, re-enables", () => {
    expect(editorMutationReducer(LOCKED, { type: "EDITOR_REMOUNTED" })).toEqual({
      editable: true,
      lock: null,
    });
  });

  // F-08: these three events deliberately share one resulting state. Pinned so
  // that a future author who "simplifies" them into one event has to delete an
  // explicit test rather than silently collapse the machine's vocabulary.
  it("SUPERSEDED, RELOADED and EDITOR_REMOUNTED agree — deliberately, not by accident", () => {
    const results = (["MUTATION_SETTLED_SUPERSEDED", "RELOADED", "EDITOR_REMOUNTED"] as const).map(
      (type) => editorMutationReducer(LOCKED, { type }),
    );
    expect(results).toEqual([
      { editable: true, lock: null },
      { editable: true, lock: null },
      { editable: true, lock: null },
    ]);
  });

  it("UNLOCK: clears lock only", () => {
    expect(editorMutationReducer(LOCKED, { type: "UNLOCK" })).toEqual({
      editable: false,
      lock: null,
    });
  });

  it("is a pure function (does not mutate input)", () => {
    const frozen = Object.freeze({ ...INITIAL_EDITOR_MUTATION_STATE });
    expect(() => editorMutationReducer(frozen, { type: "MUTATION_STARTED" })).not.toThrow();
  });
});

describe("useEditorMutationMachine", () => {
  it("exposes state + synchronous probes backed by a render-mirrored ref", () => {
    const { result } = renderHook(() => useEditorMutationMachine());
    expect(result.current.state).toEqual(INITIAL_EDITOR_MUTATION_STATE);
    expect(result.current.isLocked()).toBe(false);

    act(() => result.current.dispatch({ type: "COMMITTED_UNRELOADED", message: "x" }));
    expect(result.current.state.lock).toEqual({ message: "x" });
    // synchronous probe reflects the committed render
    expect(result.current.isLocked()).toBe(true);
  });

  // F-08: isLocked() is the ONLY probe. A machine.isBusy() used to sit beside it,
  // mirroring a field nothing read, one autocomplete away from mutation.isBusy()
  // — the authoritative latch in useEditorMutation. Re-adding a same-named probe
  // here recreates that foot-gun.
  it("exposes exactly one synchronous probe", () => {
    const { result } = renderHook(() => useEditorMutationMachine());
    expect(Object.keys(result.current).sort()).toEqual(["dispatch", "isLocked", "state"]);
  });
});
