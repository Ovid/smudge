import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectTitleEditing } from "../hooks/useProjectTitleEditing";
import type { ProjectWithChapters } from "@smudge/shared";

function buildProject(overrides: Partial<ProjectWithChapters> = {}): ProjectWithChapters {
  return {
    id: "p1",
    title: "Project",
    slug: "project",
    mode: "fiction",
    target_word_count: null,
    target_deadline: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    chapters: [],
    ...overrides,
  } as ProjectWithChapters;
}

describe("useProjectTitleEditing", () => {
  describe("saveProjectTitle gates", () => {
    it("refuses save when isActionBusy returns true (I4)", async () => {
      const project = buildProject();
      const handleUpdateProjectTitle = vi.fn(async () => "new-slug");
      const setProjectTitleError = vi.fn();
      const navigate = vi.fn();
      const isActionBusy = vi.fn(() => true);
      const isEditorLocked = vi.fn(() => false);

      const { result } = renderHook(() =>
        useProjectTitleEditing(
          project,
          "project",
          handleUpdateProjectTitle,
          setProjectTitleError,
          navigate,
          isActionBusy,
          isEditorLocked,
        ),
      );

      act(() => result.current.startEditingProjectTitle());
      act(() => result.current.setProjectTitleDraft("New Title"));
      await act(async () => {
        await result.current.saveProjectTitle();
      });

      expect(handleUpdateProjectTitle).not.toHaveBeenCalled();
      expect(result.current.editingProjectTitle).toBe(true);
    });

    it("refuses save when isEditorLocked returns true (I2)", async () => {
      const project = buildProject();
      const handleUpdateProjectTitle = vi.fn(async () => "new-slug");
      const setProjectTitleError = vi.fn();
      const navigate = vi.fn();
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => true);

      const { result } = renderHook(() =>
        useProjectTitleEditing(
          project,
          "project",
          handleUpdateProjectTitle,
          setProjectTitleError,
          navigate,
          isActionBusy,
          isEditorLocked,
        ),
      );

      act(() => result.current.startEditingProjectTitle());
      act(() => result.current.setProjectTitleDraft("New Title"));
      await act(async () => {
        await result.current.saveProjectTitle();
      });

      expect(handleUpdateProjectTitle).not.toHaveBeenCalled();
      expect(result.current.editingProjectTitle).toBe(true);
    });

    it("proceeds and exits edit mode on success", async () => {
      const project = buildProject();
      const handleUpdateProjectTitle = vi.fn(async () => "project");
      const setProjectTitleError = vi.fn();
      const navigate = vi.fn();
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result } = renderHook(() =>
        useProjectTitleEditing(
          project,
          "project",
          handleUpdateProjectTitle,
          setProjectTitleError,
          navigate,
          isActionBusy,
          isEditorLocked,
        ),
      );

      act(() => result.current.startEditingProjectTitle());
      act(() => result.current.setProjectTitleDraft("New Title"));
      await act(async () => {
        await result.current.saveProjectTitle();
      });

      expect(handleUpdateProjectTitle).toHaveBeenCalledWith("New Title");
      expect(result.current.editingProjectTitle).toBe(false);
    });
  });
});
