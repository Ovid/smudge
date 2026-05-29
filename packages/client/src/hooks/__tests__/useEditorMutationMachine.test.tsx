import { describe, it, expect } from "vitest";
import {
  editorMutationReducer,
  INITIAL_EDITOR_MUTATION_STATE,
  type EditorMutationState,
} from "../useEditorMutationMachine";

const LOCKED: EditorMutationState = {
  editable: false,
  busy: false,
  lock: { message: "refresh the page" },
};

describe("editorMutationReducer", () => {
  it("starts editable, not busy, unlocked", () => {
    expect(INITIAL_EDITOR_MUTATION_STATE).toEqual({ editable: true, busy: false, lock: null });
  });

  it("MUTATION_STARTED: busy true, editable false, lock unchanged", () => {
    expect(
      editorMutationReducer(INITIAL_EDITOR_MUTATION_STATE, { type: "MUTATION_STARTED" }),
    ).toEqual({ editable: false, busy: true, lock: null });
    // lock unchanged when a prior lock exists
    expect(editorMutationReducer(LOCKED, { type: "MUTATION_STARTED" })).toEqual({
      editable: false,
      busy: true,
      lock: { message: "refresh the page" },
    });
  });

  it("MUTATION_SETTLED_OK: re-enables only when unlocked", () => {
    const busy: EditorMutationState = { editable: false, busy: true, lock: null };
    expect(editorMutationReducer(busy, { type: "MUTATION_SETTLED_OK" })).toEqual({
      editable: true,
      busy: false,
      lock: null,
    });
    // a persistent lock keeps the editor read-only after a successful run
    const busyLocked: EditorMutationState = { ...LOCKED, busy: true };
    expect(editorMutationReducer(busyLocked, { type: "MUTATION_SETTLED_OK" })).toEqual({
      editable: false,
      busy: false,
      lock: { message: "refresh the page" },
    });
  });

  it("MUTATION_SETTLED_SUPERSEDED: clears a stale prior lock, re-enables", () => {
    const busyLocked: EditorMutationState = { ...LOCKED, busy: true };
    expect(editorMutationReducer(busyLocked, { type: "MUTATION_SETTLED_SUPERSEDED" })).toEqual({
      editable: true,
      busy: false,
      lock: null,
    });
  });

  it("RELOADED: fresh content on screen — editable, unlocked", () => {
    const busyLocked: EditorMutationState = { ...LOCKED, busy: true };
    expect(editorMutationReducer(busyLocked, { type: "RELOADED" })).toEqual({
      editable: true,
      busy: false,
      lock: null,
    });
  });

  it("COMMITTED_UNRELOADED: read-only + banner, busy cleared", () => {
    const busy: EditorMutationState = { editable: false, busy: true, lock: null };
    expect(
      editorMutationReducer(busy, { type: "COMMITTED_UNRELOADED", message: "committed; refresh" }),
    ).toEqual({ editable: false, busy: false, lock: { message: "committed; refresh" } });
  });

  it("EDITOR_REMOUNTED: clears lock, re-enables, busy untouched", () => {
    const busyLocked: EditorMutationState = { ...LOCKED, busy: true };
    expect(editorMutationReducer(busyLocked, { type: "EDITOR_REMOUNTED" })).toEqual({
      editable: true,
      busy: true, // untouched
      lock: null,
    });
  });

  it("UNLOCK: clears lock only", () => {
    expect(editorMutationReducer(LOCKED, { type: "UNLOCK" })).toEqual({
      editable: false,
      busy: false,
      lock: null,
    });
  });

  it("is a pure function (does not mutate input)", () => {
    const frozen = Object.freeze({ ...INITIAL_EDITOR_MUTATION_STATE });
    expect(() => editorMutationReducer(frozen, { type: "MUTATION_STARTED" })).not.toThrow();
  });
});
