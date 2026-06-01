import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInlineTitleEditing } from "../hooks/useInlineTitleEditing";

const noBusy = () => false;
const notLocked = () => false;
const gates = { isActionBusy: noBusy, isEditorLocked: notLocked };

describe("useInlineTitleEditing", () => {
  it("start() enters edit mode, seeds the draft, and clears the error", () => {
    const clearError = vi.fn();
    const onSave = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useInlineTitleEditing<true>("e1", "Title", onSave, gates, { clearError }),
    );

    act(() => result.current.start());

    expect(result.current.editing).toBe(true);
    expect(result.current.draft).toBe("Title");
    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it("start() is a no-op when currentId is undefined", () => {
    const onSave = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useInlineTitleEditing<true>(undefined, undefined, onSave, gates),
    );

    act(() => result.current.start());

    expect(result.current.editing).toBe(false);
  });

  it("save() commits and runs onAfterSave on success, then exits", async () => {
    const onSave = vi.fn(async () => "result-value");
    const onAfterSave = vi.fn();
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates, { onAfterSave }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalledWith("e1", "New");
    expect(onAfterSave).toHaveBeenCalledWith("result-value");
    expect(result.current.editing).toBe(false);
  });

  it("save() skips onSave and onAfterSave when the draft is unchanged", async () => {
    const onSave = vi.fn(async () => "x");
    const onAfterSave = vi.fn();
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Same", onSave, gates, { onAfterSave }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("Same"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(onAfterSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it("save() keeps edit mode open when onSave returns undefined (failure)", async () => {
    const onSave = vi.fn(async () => undefined);
    const onAfterSave = vi.fn();
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates, { onAfterSave }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalled();
    expect(onAfterSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
  });

  it("save() bails and keeps edit mode open when driftCheck returns true", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates, { driftCheck: () => true }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
  });

  it("save() bails when isActionBusy is true", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, {
        isActionBusy: () => true,
        isEditorLocked: notLocked,
      }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
  });

  it("save() bails when isEditorLocked is true", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, {
        isActionBusy: noBusy,
        isEditorLocked: () => true,
      }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
  });

  it("save() exits silently when cancel() set the escape sentinel", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    act(() => result.current.cancel());
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it("save() exits without committing when the draft is whitespace-only", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("   "));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it("save() ignores re-entry while a save is already in flight", async () => {
    let resolve: ((v: string) => void) | undefined;
    const onSave = vi.fn(() => new Promise<string>((r) => {
      resolve = r;
    }));
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    let first!: Promise<void>;
    act(() => {
      first = result.current.save();
    });
    // Second call while the first is pending must be ignored.
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalledTimes(1);

    resolve?.("done");
    await act(async () => {
      await first;
    });
  });

  it("cancels edit mode when currentId changes", () => {
    const onSave = vi.fn(async () => "x");
    const { result, rerender } = renderHook(
      ({ id, title }: { id: string; title: string }) =>
        useInlineTitleEditing<string>(id, title, onSave, gates),
      { initialProps: { id: "e1", title: "One" } },
    );

    act(() => result.current.start());
    expect(result.current.editing).toBe(true);

    rerender({ id: "e2", title: "Two" });
    expect(result.current.editing).toBe(false);
  });

  it("resets the in-flight latch on currentId change so a new save proceeds (normalization)", async () => {
    let resolveFirst: ((v: string) => void) | undefined;
    let calls = 0;
    const onSave = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<string>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve("ok");
    });
    const { result, rerender } = renderHook(
      ({ id, title }: { id: string; title: string }) =>
        useInlineTitleEditing<string>(id, title, onSave, gates),
      { initialProps: { id: "e1", title: "One" } },
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("One edited"));
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = result.current.save();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    // Entity changes while the first save is still pending (latch held).
    rerender({ id: "e2", title: "Two" });

    // A fresh edit+save on the new entity must proceed despite the pending save.
    act(() => result.current.start());
    act(() => result.current.setDraft("Two edited"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("e2", "Two edited");

    resolveFirst?.("late");
    await act(async () => {
      await firstSave;
    });
  });

  it("calls clearError on currentId change (normalization)", () => {
    const clearError = vi.fn();
    const onSave = vi.fn(async () => "x");
    const { result, rerender } = renderHook(
      ({ id, title }: { id: string; title: string }) =>
        useInlineTitleEditing<string>(id, title, onSave, gates, { clearError }),
      { initialProps: { id: "e1", title: "One" } },
    );

    act(() => result.current.start());
    clearError.mockClear();

    rerender({ id: "e2", title: "Two" });
    expect(clearError).toHaveBeenCalledTimes(1);
  });
});
