import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";

// Shared types for useProjectEditor and the chapter-CRUD / chapter-metadata
// sub-hooks it composes (F-2 decomposition, 2026-05-29). Kept in a leaf
// module that imports nothing from the hooks so the sub-hooks can reference
// SaveStatus/ReloadOutcome without an import cycle back through
// useProjectEditor (which imports the sub-hooks). useProjectEditor
// re-exports SaveStatus and ReloadOutcome so existing consumers
// (EditorFooter, useEditorMutation) keep importing them from the same path.

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

// Discriminated return from reloadActiveChapter so callers can distinguish
// "fresh server state is now on screen" from "the user switched chapters
// (or the call was gated out) before the reload ran" from "the GET errored".
// Conflating the latter two as a single false return made the
// useEditorMutation hook raise a spurious persistent lock banner on a
// chapter the mutation didn't touch (I5).
export type ReloadOutcome = "reloaded" | "superseded" | "failed";

// Shared primitives the parent (useProjectEditor) owns and threads into the
// chapter-CRUD sub-hook. The save pipeline, project/chapter state, and the
// confirmed-status cache all live in the parent because the save pipeline and
// loadProject also read/write them; the sub-hook receives them so the
// chapter-CRUD handlers stay byte-for-byte equivalent to their pre-split
// behaviour. Each member is individually stable across renders (useState
// setters, useRef objects, and useCallback results), so the handlers' own
// useCallback dependency arrays can list them and stay memoized.
export interface ChapterCrudDeps {
  setProject: Dispatch<SetStateAction<ProjectWithChapters | null>>;
  setActiveChapter: Dispatch<SetStateAction<Chapter | null>>;
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  setSaveErrorMessage: Dispatch<SetStateAction<string | null>>;
  setCacheWarning: Dispatch<SetStateAction<boolean>>;
  setChapterWordCount: Dispatch<SetStateAction<number>>;
  setChapterReloadKey: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  activeChapterRef: MutableRefObject<Chapter | null>;
  projectRef: MutableRefObject<ProjectWithChapters | null>;
  projectSlugRef: MutableRefObject<string | undefined>;
  confirmedStatusRef: MutableRefObject<Record<string, string | undefined>>;
  onProjectNotFoundRef: MutableRefObject<(() => void) | undefined>;
  // Cancels any in-flight save (sequence + controller + backoff sleep) — owned
  // by the parent save pipeline; every chapter-state transition routes save
  // cancellation through this one helper.
  cancelInFlightSave: () => void;
  // Re-seeds the confirmed-status cache from a fresh server snapshot — shared
  // with the parent's loadProject seed and the public reseed exposed to
  // useTrashManager.
  replaceConfirmedStatusesFromProject: (refreshed: ProjectWithChapters) => void;
}

// Shared primitives the parent threads into the chapter-metadata sub-hook
// (title / status / rename). Narrower than ChapterCrudDeps: these handlers do
// not touch the save pipeline, the cache-warning flag, or the reload key.
export interface ChapterMetadataDeps {
  setProject: Dispatch<SetStateAction<ProjectWithChapters | null>>;
  setActiveChapter: Dispatch<SetStateAction<Chapter | null>>;
  setProjectTitleError: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  activeChapterRef: MutableRefObject<Chapter | null>;
  projectRef: MutableRefObject<ProjectWithChapters | null>;
  projectSlugRef: MutableRefObject<string | undefined>;
  confirmedStatusRef: MutableRefObject<Record<string, string | undefined>>;
  onRequestEditorLockRef: MutableRefObject<((message: string) => void) | undefined>;
}
