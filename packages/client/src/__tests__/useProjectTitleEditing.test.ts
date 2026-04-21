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

    it("navigates to new slug when slug changes after rename", async () => {
      const project = buildProject();
      const handleUpdateProjectTitle = vi.fn(async () => "renamed");
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
      act(() => result.current.setProjectTitleDraft("Renamed"));
      await act(async () => {
        await result.current.saveProjectTitle();
      });

      expect(navigate).toHaveBeenCalledWith("/projects/renamed", { replace: true });
    });

    it("exits edit mode silently when Escape was pressed before save", async () => {
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
      act(() => result.current.setProjectTitleDraft("Edited"));
      act(() => result.current.cancelEditingProjectTitle());
      await act(async () => {
        await result.current.saveProjectTitle();
      });

      expect(handleUpdateProjectTitle).not.toHaveBeenCalled();
      expect(result.current.editingProjectTitle).toBe(false);
    });

    it("cancels edit mode when project changes mid-edit", async () => {
      const project1 = buildProject({ id: "p1", title: "Alpha" });
      const project2 = buildProject({ id: "p2", title: "Beta" });
      const handleUpdateProjectTitle = vi.fn(async () => "project");
      const setProjectTitleError = vi.fn();
      const navigate = vi.fn();
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result, rerender } = renderHook(
        ({ p }: { p: typeof project1 }) =>
          useProjectTitleEditing(
            p,
            "alpha",
            handleUpdateProjectTitle,
            setProjectTitleError,
            navigate,
            isActionBusy,
            isEditorLocked,
          ),
        { initialProps: { p: project1 } },
      );

      act(() => result.current.startEditingProjectTitle());
      expect(result.current.editingProjectTitle).toBe(true);

      rerender({ p: project2 });
      expect(result.current.editingProjectTitle).toBe(false);
    });

    it("keeps edit mode open when handleUpdateProjectTitle returns undefined", async () => {
      const project = buildProject();
      const handleUpdateProjectTitle = vi.fn(async () => undefined);
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

      expect(result.current.editingProjectTitle).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
