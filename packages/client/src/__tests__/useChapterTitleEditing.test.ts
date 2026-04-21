import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChapterTitleEditing } from "../hooks/useChapterTitleEditing";
import type { Chapter } from "@smudge/shared";

function buildChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "c1",
    project_id: "p1",
    title: "Chapter One",
    content: { type: "doc", content: [] },
    sort_order: 0,
    word_count: 0,
    status: "draft",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  } as Chapter;
}

describe("useChapterTitleEditing", () => {
  describe("saveTitle gates", () => {
    it("refuses save when isActionBusy returns true (I1)", async () => {
      const chapter = buildChapter();
      const handleRenameChapter = vi.fn(async () => undefined);
      const isActionBusy = vi.fn(() => true);
      const isEditorLocked = vi.fn(() => false);

      const { result } = renderHook(() =>
        useChapterTitleEditing(chapter, handleRenameChapter, isActionBusy, isEditorLocked),
      );

      act(() => result.current.startEditingTitle());
      act(() => result.current.setTitleDraft("New Title"));
      await act(async () => {
        await result.current.saveTitle();
      });

      expect(handleRenameChapter).not.toHaveBeenCalled();
      // Edit mode must stay open so draft survives retry
      expect(result.current.editingTitle).toBe(true);
    });

    it("refuses save when isEditorLocked returns true (I2)", async () => {
      const chapter = buildChapter();
      const handleRenameChapter = vi.fn(async () => undefined);
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => true);

      const { result } = renderHook(() =>
        useChapterTitleEditing(chapter, handleRenameChapter, isActionBusy, isEditorLocked),
      );

      act(() => result.current.startEditingTitle());
      act(() => result.current.setTitleDraft("New Title"));
      await act(async () => {
        await result.current.saveTitle();
      });

      expect(handleRenameChapter).not.toHaveBeenCalled();
      expect(result.current.editingTitle).toBe(true);
    });

    it("proceeds when neither busy nor locked", async () => {
      const chapter = buildChapter();
      const handleRenameChapter = vi.fn(async () => undefined);
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result } = renderHook(() =>
        useChapterTitleEditing(chapter, handleRenameChapter, isActionBusy, isEditorLocked),
      );

      act(() => result.current.startEditingTitle());
      act(() => result.current.setTitleDraft("New Title"));
      await act(async () => {
        await result.current.saveTitle();
      });

      expect(handleRenameChapter).toHaveBeenCalledWith("c1", "New Title", expect.any(Function));
      expect(result.current.editingTitle).toBe(false);
    });

    it("keeps edit mode open when handleRenameChapter reports error via callback", async () => {
      const chapter = buildChapter();
      const handleRenameChapter = vi.fn(
        async (_id: string, _title: string, onError?: (m: string) => void) => {
          onError?.("nope");
        },
      );
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result } = renderHook(() =>
        useChapterTitleEditing(chapter, handleRenameChapter, isActionBusy, isEditorLocked),
      );

      act(() => result.current.startEditingTitle());
      act(() => result.current.setTitleDraft("New Title"));
      await act(async () => {
        await result.current.saveTitle();
      });

      expect(result.current.editingTitle).toBe(true);
      expect(result.current.titleError).toBe("nope");
    });

    it("no-ops when draft matches existing title (no mutation fired)", async () => {
      const chapter = buildChapter({ title: "Same" });
      const handleRenameChapter = vi.fn(async () => undefined);
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result } = renderHook(() =>
        useChapterTitleEditing(chapter, handleRenameChapter, isActionBusy, isEditorLocked),
      );

      act(() => result.current.startEditingTitle());
      act(() => result.current.setTitleDraft("Same"));
      await act(async () => {
        await result.current.saveTitle();
      });

      expect(handleRenameChapter).not.toHaveBeenCalled();
      expect(result.current.editingTitle).toBe(false);
    });

    it("exits edit mode silently when Escape was pressed before save", async () => {
      const chapter = buildChapter();
      const handleRenameChapter = vi.fn(async () => undefined);
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result } = renderHook(() =>
        useChapterTitleEditing(chapter, handleRenameChapter, isActionBusy, isEditorLocked),
      );

      act(() => result.current.startEditingTitle());
      act(() => result.current.setTitleDraft("Edited"));
      // cancelEditingTitle sets escapePressedRef — the next save must bail
      // without invoking handleRenameChapter.
      act(() => result.current.cancelEditingTitle());
      await act(async () => {
        await result.current.saveTitle();
      });

      expect(handleRenameChapter).not.toHaveBeenCalled();
      expect(result.current.editingTitle).toBe(false);
    });

    it("cancels edit mode when active chapter changes mid-edit", async () => {
      const chapter1 = buildChapter({ id: "c1", title: "One" });
      const chapter2 = buildChapter({ id: "c2", title: "Two" });
      const handleRenameChapter = vi.fn(async () => undefined);
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result, rerender } = renderHook(
        ({ ch }: { ch: typeof chapter1 }) =>
          useChapterTitleEditing(ch, handleRenameChapter, isActionBusy, isEditorLocked),
        { initialProps: { ch: chapter1 } },
      );

      act(() => result.current.startEditingTitle());
      expect(result.current.editingTitle).toBe(true);

      // Simulate navigating to a different chapter
      rerender({ ch: chapter2 });
      expect(result.current.editingTitle).toBe(false);
    });
  });
});
