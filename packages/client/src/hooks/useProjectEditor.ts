import { useEffect, useState, useCallback, useRef } from "react";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { countWords } from "@smudge/shared";
import { api } from "../api/client";
import { getCachedContent, setCachedContent, clearCachedContent } from "./useContentCache";
import { useAbortableSequence } from "./useAbortableSequence";
import { STRINGS } from "../strings";
import { mapApiError, isApiError, isAborted, isClientError } from "../errors";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

// Discriminated return from reloadActiveChapter so callers can distinguish
// "fresh server state is now on screen" from "the user switched chapters
// (or the call was gated out) before the reload ran" from "the GET errored".
// Conflating the latter two as a single false return made the
// useEditorMutation hook raise a spurious persistent lock banner on a
// chapter the mutation didn't touch (I5).
export type ReloadOutcome = "reloaded" | "superseded" | "failed";

export interface UseProjectEditorOptions {
  // I2 + I4 (review 2026-04-24): fires when the hook detects a
  // server/client state divergence the user must manually refresh to
  // recover from (terminal save code, or rename-committed followed by
  // a slug-lost recovery GET 404). EditorPage pairs this with
  // applyReloadFailedLock to honour CLAUDE.md save-pipeline invariant
  // #2 (setEditable(false) + editorLockedMessage set together) and the
  // lock banner implicitly disables auto-save via handleSaveLockGated.
  // Hook consumers that don't own an editor (tests, storybook) may
  // omit it.
  onRequestEditorLock?: (message: string) => void;
}

export function useProjectEditor(slug: string | undefined, options?: UseProjectEditorOptions) {
  const onRequestEditorLockRef = useRef(options?.onRequestEditorLock);
  onRequestEditorLockRef.current = options?.onRequestEditorLock;
  const [project, setProject] = useState<ProjectWithChapters | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [chapterReloadKey, setChapterReloadKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [projectTitleError, setProjectTitleError] = useState<string | null>(null);
  const [chapterWordCount, setChapterWordCount] = useState(0);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [cacheWarning, setCacheWarning] = useState(false);
  const activeChapterRef = useRef<Chapter | null>(null);
  activeChapterRef.current = activeChapter;
  // Tracks the most recent content per chapter id (updated by handleContentChange).
  // Retries inside handleSave re-read from this ref so a backoff that resumes
  // after the user has kept typing posts the new content rather than silently
  // discarding it when clearCachedContent runs on success.
  const latestContentRef = useRef<{ id: string; content: Record<string, unknown> } | null>(null);
  const projectSlugRef = useRef(slug);
  // I1 (review 2026-04-21): the ref must reflect the CURRENT URL slug so
  // that handlers firing during an inter-project loading window
  // (handleCreateChapter, handleReorderChapters, handleUpdateProjectTitle)
  // don't mutate the previous project. Before this fix, the ref was only
  // written from project.slug after loadProject resolved, so any click
  // landing in the gap would POST /projects/<old-slug>/... against the
  // project the user had just navigated away from.
  //
  // Precedence:
  //   1. When the `slug` argument changes (URL-driven navigation, back/
  //      forward, react-router navigate), sync the ref to the new URL
  //      slug immediately. Detected via a prev-slug sentinel so the
  //      sync runs exactly once per slug transition.
  //   2. `handleUpdateProjectTitle` writes the ref directly on rename
  //      success — we must not clobber that write on the next render
  //      before the URL has caught up with navigate(). The prev-slug
  //      sentinel guards against that: slug hasn't changed, so we
  //      don't touch the ref.
  const prevSlugArgRef = useRef(slug);
  if (prevSlugArgRef.current !== slug) {
    prevSlugArgRef.current = slug;
    // S3 (review 2026-04-21): sync the ref in lock-step with
    // prevSlugArgRef, including the defined→undefined transition.
    // Previously the ref was rewritten only when the new slug was
    // defined, leaving it pointing at the prior project after the
    // URL cleared — a late handler click landing in that window
    // would POST against the old project.
    projectSlugRef.current = slug;
  }
  const selectChapterSeq = useAbortableSequence();
  const saveSeq = useAbortableSequence();
  const saveAbortRef = useRef<AbortController | null>(null);
  // Active retry backoff, if any: the timer id and a resolver so
  // cancelPendingSaves can both clear the pending timer AND unblock the
  // awaited sleep — otherwise the loop would hang forever (clearing only
  // the timer without resolving the promise would leave the await pending
  // forever and the seq check unreachable).
  const saveBackoffRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
  } | null>(null);
  const statusChangeSeq = useAbortableSequence();
  // I11: rapid status clicks (A→B→C) used to issue overlapping PATCHes
  // with no server-side ordering guarantee. statusChangeSeq only
  // discarded response *processing*; both requests still reached the
  // server and the persisted row could settle on A or B while the UI
  // shows C. Mirror saveAbortRef: abort any prior in-flight PATCH
  // before issuing a new one, and thread the signal into
  // api.chapters.update so the abort actually severs the request.
  const statusChangeAbortRef = useRef<AbortController | null>(null);
  // I1 (review 2026-04-24): rapid title edits used to fire overlapping
  // PATCHes. The S7 drift guard discarded the stale response but the
  // SECOND PATCH had already reached the server — SQLite's writer-lock
  // ordering determined which title won, not the client's last-typed
  // value. Mirror statusChangeAbortRef: abort any prior in-flight
  // rename before issuing a new one, and thread the signal into
  // api.projects.update so the network request is actually severed.
  const titleChangeAbortRef = useRef<AbortController | null>(null);
  // C5 (review 2026-04-24): rapid drag-drop reorders used to issue
  // overlapping PUTs to /chapters/order with no client-side ordering
  // guard — the persisted order was whichever PUT SQLite's writer lock
  // serialized last, not the user's last drop. Mirror
  // statusChangeAbortRef: abort the prior in-flight PUT before issuing
  // a new one, and thread the signal into api.projects.reorderChapters
  // so the older request is actually severed.
  const reorderAbortRef = useRef<AbortController | null>(null);
  // I7 (review 2026-04-24): rename and delete-chapter siblings went
  // without AbortControllers. Rapid renames raced at the server with
  // no ordering guard; a delete that the user moved past kept running
  // setState paths on stale chapter ids. Mirror title/status abort
  // refs: the rename path aborts on supersede, the delete path aborts
  // on unmount.
  const renameChapterAbortRef = useRef<AbortController | null>(null);
  const deleteChapterAbortRef = useRef<AbortController | null>(null);
  // I21 (review 2026-04-24): per-chapter cache of the last server-
  // confirmed status. Rapid X→A→B clicks used to capture
  // `previousStatus = A` for B because A's optimistic setProject had
  // landed; if B's PATCH failed AND the fallback GET silent-catch
  // also failed, the revert restored A — a status the server never
  // persisted. Tracking confirmed commits separately lets the revert
  // target the actual server-side value. Parallels
  // confirmedTimezoneRef / confirmedFieldsRef in ProjectSettingsDialog.
  const confirmedStatusRef = useRef<Record<string, string | undefined>>({});
  // I22 (review 2026-04-24): recovery GETs fired by BAD_JSON catches
  // in handleCreateChapter / handleUpdateProjectTitle / handleStatusChange
  // need an AbortController so unmount drops the in-flight recovery.
  // C1 (review 2026-04-25): each handler owns its own ref. Earlier we
  // tried a single shared ref ("only the latest matters" — superseded
  // recoveries from the SAME handler are fine to abort), but a status
  // revert that fires while a create-recovery GET is in flight would
  // abort the create's controller. The create's recovery body wraps
  // the GET in `try { ... } catch {}`, so the cross-handler abort
  // was silently swallowed and the new chapter never landed in the
  // sidebar. Per-handler refs scope the "latest wins" rule to its own
  // handler and leave siblings untouched.
  const createRecoveryAbortRef = useRef<AbortController | null>(null);
  const statusRecoveryAbortRef = useRef<AbortController | null>(null);
  const titleRecoveryAbortRef = useRef<AbortController | null>(null);

  // Shared cancel-in-flight-save helper. Aborts the save sequence (so the
  // retry loop short-circuits on its next iteration via token.isStale()),
  // aborts the fetch, and unblocks any backoff sleep. handleSelectChapter,
  // handleDeleteChapter, cancelPendingSaves, and unmount cleanup all go
  // through this — before S3, the select/delete paths omitted the
  // backoff-unblock step, leaving the retry loop asleep for up to 8s
  // after a chapter switch/delete.
  const cancelInFlightSave = useCallback(() => {
    saveSeq.abort();
    if (saveAbortRef.current) {
      saveAbortRef.current.abort();
      saveAbortRef.current = null;
    }
    if (saveBackoffRef.current) {
      clearTimeout(saveBackoffRef.current.timer);
      saveBackoffRef.current.resolve();
      saveBackoffRef.current = null;
    }
  }, [saveSeq]);

  // Unmount cleanup: the retry loop inside handleSave runs outside React's
  // render phase, so without this teardown an in-flight save-backoff sleep
  // would wake after EditorPage unmounted, call api.chapters.update, and
  // schedule state writes on a gone component (and in dev it would log the
  // "state update on unmounted component" warning). cancelInFlightSave
  // covers the side-effect-free portion of cancelPendingSaves (no setState
  // on unmount). The select-chapter side is handled implicitly: each
  // useAbortableSequence() instance auto-aborts its counter on unmount,
  // so a late-resolving chapter GET becomes a stale token and its
  // post-await setState is short-circuited by token.isStale().
  useEffect(() => {
    return () => {
      cancelInFlightSave();
      // I1: abort field PATCHes on unmount so a late-resolving rename
      // can't fire setState on a torn-down hook.
      titleChangeAbortRef.current?.abort();
      statusChangeAbortRef.current?.abort();
      reorderAbortRef.current?.abort();
      renameChapterAbortRef.current?.abort();
      deleteChapterAbortRef.current?.abort();
      createRecoveryAbortRef.current?.abort();
      statusRecoveryAbortRef.current?.abort();
      titleRecoveryAbortRef.current?.abort();
    };
  }, [cancelInFlightSave]);

  useEffect(() => {
    let cancelled = false;
    // I7 (review 2026-04-25): reset the confirmed-status cache at the
    // start of every loadProject. The hook persists across slug changes
    // (refs survive), so on a failed loadProject (network, 5xx) the
    // ref retained the previous project's status table and a status
    // revert on the new (partially-rendered) project would read against
    // the wrong baseline. Resetting up-front guarantees the cache only
    // ever holds the current project's state — the success branch
    // re-seeds from the fresh server snapshot below, and a failure
    // leaves the cache empty (correct: there's no project to revert).
    confirmedStatusRef.current = {};

    async function loadProject() {
      if (!slug) return;
      try {
        const data = await api.projects.get(slug);
        if (cancelled) return;
        setProject(data);
        // I21: seed the confirmed-status cache from the authoritative
        // server response. Every chapter's status here is server-truth
        // at load time; subsequent revert paths read from this ref so
        // they don't stomp to an optimistic value.
        confirmedStatusRef.current = Object.fromEntries(data.chapters.map((c) => [c.id, c.status]));
        // If the cached activeChapter belongs to a different project (e.g.
        // in-place slug change that isn't a rename), the `!activeChapterRef`
        // guard would skip loading the new project's first chapter, and the
        // editor would render project A's content under project B's shell.
        // Project rename preserves chapter ids so the cached chapter still
        // belongs to the project — only reset when the id is no longer in
        // the newly-loaded chapter set.
        const currentChapterId = activeChapterRef.current?.id;
        const stillInProject =
          currentChapterId !== undefined && data.chapters.some((c) => c.id === currentChapterId);
        if (!stillInProject) {
          setActiveChapter(null);
          activeChapterRef.current = null;
          setChapterWordCount(0);
        }
        const firstChapter = data.chapters[0];
        if (firstChapter && !activeChapterRef.current) {
          const chapter = await api.chapters.get(firstChapter.id);
          if (cancelled) return;
          const cached = getCachedContent(chapter.id);
          const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
          setActiveChapter(effectiveChapter);
          setChapterWordCount(countWords(effectiveChapter.content));
        }
      } catch (err) {
        // Copilot review 2026-04-24 (wider occurrence of HomePage race):
        // gate console.warn on `cancelled` so a late rejection on
        // unmount/slug-change does not leak noise into test output.
        if (cancelled) return;
        console.warn("Failed to load project:", err);
        const { message } = mapApiError(err, "project.load");
        if (message) setError(message);
      }
    }

    loadProject();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleSave = useCallback(
    async (content: Record<string, unknown>, chapterId?: string): Promise<boolean> => {
      // chapterId is passed explicitly by the Editor so that unmount cleanup
      // after a chapter switch targets the OLD chapter — activeChapterRef has
      // already advanced to the new one by the time cleanup fires.
      const savingChapterId = chapterId ?? activeChapterRef.current?.id;
      if (!savingChapterId) return false;
      // Seed the latest-content ref so the first attempt posts the caller's content.
      // Subsequent keystrokes during backoff replace this via handleContentChange.
      latestContentRef.current = { id: savingChapterId, content };
      const token = saveSeq.start();
      // AbortController lets cancelPendingSaves actually abort an in-flight
      // PATCH — without this, a retry could land on the server after a
      // subsequent snapshot restore and overwrite it.
      // Also: abort any prior in-flight save before issuing a new one. Debounce
      // and onBlur can fire overlapping saves; without this, two PATCHes can
      // commit out-of-order, regressing persisted content to the older version.
      saveAbortRef.current?.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      const BACKOFF_MS = [2000, 4000, 8000];
      const MAX_RETRIES = BACKOFF_MS.length;

      setSaveStatus("saving");
      setSaveErrorMessage(null);
      let rejected4xx: { message: string; code?: string } | null = null;
      // I4 (Phase 4b.3a regression guard): capture the most recent
      // non-aborted error so retry-exhaustion can route its banner copy
      // through the unified mapper. Pre-fix, the post-loop fallback used
      // the literal STRINGS.editor.saveFailed, bypassing chapter.save's
      // network: mapping and surfacing "Save failed. Try again." even
      // for NETWORK retry exhaustion. CLAUDE.md invariant: all
      // user-visible API error messages flow through mapApiError.
      let lastErr: unknown = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (token.isStale()) return false; // chapter changed, abort retries
        // Re-read latest content each attempt so backoff retries post keystrokes
        // that arrived after the initial call.
        const latest = latestContentRef.current;
        const postedContent = latest && latest.id === savingChapterId ? latest.content : content;
        try {
          const updated = await api.chapters.update(
            savingChapterId,
            { content: postedContent },
            controller.signal,
          );
          if (token.isStale()) return false; // chapter changed during request
          // Keep activeChapter in sync so that re-mounting the editor
          // (e.g. after toggling Preview → Editor) uses the latest content.
          if (activeChapterRef.current?.id === savingChapterId) {
            setActiveChapter((prev) =>
              prev ? { ...prev, content: postedContent, word_count: updated.word_count } : prev,
            );
          }
          setProject((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              chapters: prev.chapters.map((c) =>
                c.id === savingChapterId
                  ? { ...c, word_count: updated.word_count, content: postedContent }
                  : c,
              ),
            };
          });
          // Only clear the localStorage cache if no newer content has arrived
          // since we started this attempt. Otherwise the pending typing would
          // be dropped.
          const stillLatest =
            latestContentRef.current?.id === savingChapterId &&
            latestContentRef.current.content === postedContent;
          if (stillLatest) {
            clearCachedContent(savingChapterId);
            setCacheWarning(false);
          }
          if (activeChapterRef.current?.id === savingChapterId) {
            setSaveStatus(stillLatest ? "saved" : "unsaved");
          }
          if (saveAbortRef.current === controller) saveAbortRef.current = null;
          return true;
        } catch (err) {
          // Aborted: cancelPendingSaves intentionally cancelled this save
          // (e.g. before a snapshot restore). Exit cleanly without flagging
          // an error to the user.
          if (isAborted(err)) {
            return false;
          }
          // Track the most recent non-aborted error so the post-loop
          // fallback (used when NETWORK / bare-5xx retries exhaust) can
          // route through mapApiError(err, "chapter.save"). 4xx and
          // terminal-code branches below still break early via
          // rejected4xx, which takes precedence over this lastErr.
          lastErr = err;
          // I5: a 2xx BAD_JSON or a 5xx whose code identifies a specific
          // committed/terminal server state must not retry:
          //   - 2xx BAD_JSON: server likely committed the PATCH but the
          //     response body was unreadable. Retrying would either
          //     commit-again the same content (wasteful, possibly
          //     racing a concurrent keystroke) or land while the user
          //     is reading the warning banner.
          //   - 5xx UPDATE_READ_FAILURE: the server updated the row but
          //     could not re-read it — the save committed; same UX as
          //     2xx BAD_JSON.
          //   - 5xx CORRUPT_CONTENT: the existing row is corrupt;
          //     retrying will not fix it.
          // Everything else under 500 (bare 500, transient NETWORK, etc.)
          // still retries with backoff.
          if (
            isApiError(err) &&
            (err.code === "BAD_JSON" ||
              err.code === "UPDATE_READ_FAILURE" ||
              err.code === "CORRUPT_CONTENT")
          ) {
            console.warn("Save failed with terminal code:", err.code);
            // mapApiError returns message: null only for ABORTED, which
            // has already been filtered above — the three codes here all
            // route to scope.committed / byCode matches, all non-null.
            const { message } = mapApiError(err, "chapter.save");
            rejected4xx = { message: message as string, code: err.code };
            break;
          }
          if (isClientError(err)) {
            console.warn("Save failed with 4xx:", err);
            // I4 (2026-04-23 review): route through the unified mapper
            // so chapter.save scope is the single source of truth. Raw
            // err.message is never forwarded (CLAUDE.md invariant); the
            // scope's byStatus[413] / byCode[VALIDATION_ERROR] / fallback
            // produce the same strings.ts copy the inline mapSaveError
            // duplicated. err.code is preserved separately for the
            // cache-clear decision below. ABORTED is filtered above so
            // mapped.message is guaranteed non-null in this branch.
            const { message } = mapApiError(err, "chapter.save");
            rejected4xx = { message: message as string, code: err.code };
            break;
          }
          if (attempt < MAX_RETRIES) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                // Only null the shared ref if it still points to OUR handle.
                // If a concurrent save or cancellation has replaced it with
                // a newer timer/resolve pair, clearing would drop the
                // newer attempt's ability to be unblocked by
                // cancelInFlightSave (S4).
                if (saveBackoffRef.current?.timer === timer) {
                  saveBackoffRef.current = null;
                }
                resolve();
              }, BACKOFF_MS[attempt]);
              saveBackoffRef.current = { timer, resolve };
            });
            // If cancelInFlightSave cleared the timer and resolved early,
            // the seq check at the top of the next loop iteration exits
            // cleanly.
          }
        }
      }
      if (saveAbortRef.current === controller) saveAbortRef.current = null;
      // Only wipe the local draft when the server's intent is unambiguous:
      // VALIDATION_ERROR means the payload is malformed and will be
      // rejected on every retry, so the cache would otherwise feed an
      // infinite error loop. Everything else (413 PAYLOAD_TOO_LARGE, bare
      // 4xx without a known code) is preserved — invariant #3 says the
      // cache is the last line of defense against data loss, and 413 in
      // particular is rejected at the Express body-size guard BEFORE the
      // chapter handler runs, so the server never held the typed content
      // in the first place. Also guard by seq: if the user switched
      // chapters between the rejected PATCH being sent and its 4xx
      // landing, a different path (handleSelectChapter) now owns this
      // chapter's cache and we must not stomp on it (I2).
      if (rejected4xx && rejected4xx.code === "VALIDATION_ERROR" && !token.isStale()) {
        clearCachedContent(savingChapterId);
        if (latestContentRef.current?.id === savingChapterId) {
          latestContentRef.current = null;
        }
      }
      // Gate on BOTH activeChapter id and token freshness (S5): on an
      // A→B→A round-trip while an older save's 4xx is landing, the id
      // check alone is true (user is back on A) but the save's token is
      // stale. Without the isStale() guard the cancelled save's error
      // state bleeds into A's fresh session. Parallels the cache-clear
      // guard immediately above.
      if (activeChapterRef.current?.id === savingChapterId && !token.isStale()) {
        setSaveStatus("error");
        // I4 (Phase 4b.3a regression guard): route post-retry-exhaustion
        // copy through mapApiError so chapter.save's network: mapping
        // (STRINGS.editor.saveFailedNetwork) wins over the generic
        // saveFailed fallback when the cause was a NETWORK error. The
        // ?? STRINGS.editor.saveFailed defends against ABORTED-only
        // (mapApiError returns message: null) — defense-in-depth, since
        // ABORTED is filtered above and never captured into lastErr.
        // S1 (review 2026-04-26): in practice the post-loop block is
        // unreachable with lastErr === null. The seq-check exits inside
        // the loop via `return false`, success returns true, and every
        // catch branch writes lastErr before deciding whether to break
        // or continue. The `lastErr ?` guard below is paranoid defense —
        // future code that adds a non-throwing exit path would otherwise
        // hand mapApiError(null) and get the scope fallback (correct,
        // but undocumented). S6 (review 2026-04-26): collapse via ??
        // chain so fallbackMessage isn't computed when rejected4xx is
        // already set.
        setSaveErrorMessage(
          rejected4xx?.message ??
            (lastErr
              ? (mapApiError(lastErr, "chapter.save").message ?? STRINGS.editor.saveFailed)
              : STRINGS.editor.saveFailed),
        );
        // I2 (review 2026-04-24): terminal committed/unrecoverable
        // codes must also lock the editor — CLAUDE.md save-pipeline
        // invariant #2 pairs setEditable(false) with editorLockedMessage.
        // EditorPage subscribes via onRequestEditorLock so the
        // invariant-pair helper (applyReloadFailedLock) fires alongside
        // the banner. Bare 4xx (VALIDATION_ERROR, 413) are recoverable
        // and keep the editor writable.
        // I2 (review 2026-04-26): NOT_FOUND is also a terminal condition —
        // the chapter is gone server-side (purge, hard-delete, or another
        // tab). Without the lock, the user keeps typing into content the
        // server has rejected and every debounced auto-save 404s in a
        // loop. The chapter.save byStatus[404] mapping already surfaces
        // the saveFailedChapterGone banner; this completes the invariant
        // pair.
        if (
          rejected4xx &&
          (rejected4xx.code === "BAD_JSON" ||
            rejected4xx.code === "UPDATE_READ_FAILURE" ||
            rejected4xx.code === "CORRUPT_CONTENT" ||
            rejected4xx.code === "NOT_FOUND")
        ) {
          onRequestEditorLockRef.current?.(rejected4xx.message);
        }
      }
      return false;
    },
    [saveSeq],
  );

  const handleContentChange = useCallback((content: Record<string, unknown>) => {
    setChapterWordCount(countWords(content));
    // Don't overwrite "error" — the persistent save failure indicator must stay visible
    // until a new save attempt succeeds (the debounced save will retry automatically).
    setSaveStatus((prev) => (prev === "error" ? "error" : "unsaved"));
    if (activeChapterRef.current) {
      latestContentRef.current = { id: activeChapterRef.current.id, content };
      const cached = setCachedContent(activeChapterRef.current.id, content);
      setCacheWarning(!cached);
    }
  }, []);

  const handleCreateChapter = useCallback(
    async (onError?: (message: string) => void) => {
      const slug = projectSlugRef.current;
      const projectId = projectRef.current?.id;
      if (!slug || !projectId) return;
      // S6 (review 2026-04-21) + C1 (review 2026-04-24): the post-await
      // drift guard below combines two checks.
      //   1. Project id captured at POST time vs projectRef.current?.id
      //      at response time. The id is stable across rename and
      //      changes only on cross-project navigation AFTER the new
      //      project finishes loading. This distinguishes rename
      //      (keep) from completed cross-project nav (discard).
      //   2. Slug two-part compare (projectSlugRef vs captured slug
      //      AND vs projectRef.slug). The id check can't see the
      //      window between a URL slug prop change and loadProject
      //      completing — projectRef still holds the old project's
      //      id, so id equality passes. The slug compare catches
      //      that window because projectSlugRef has already advanced
      //      to the new URL slug while projectRef.slug still holds
      //      the old one.
      // Both checks are needed: (1) covers post-load cross-nav, (2)
      // covers pre-load cross-nav, neither covers what the other does.
      // Full cancel of any in-flight save: abort the save sequence, abort
      // the fetch, and unblock any backoff sleep (S1). A bare seq-abort
      // without the controller abort + backoff clear would short-circuit
      // the retry loop's isStale() check but leave the AbortController
      // live and the backoff timer scheduled — the timer would wake up
      // seconds later, do nothing useful (guarded by isStale), but hold a
      // reference to the old chapter id until it fired. Matches the
      // discipline of handleSelectChapter / handleDeleteChapter.
      cancelInFlightSave();
      // Also cancel any in-flight chapter GET (reloadActiveChapter or
      // handleSelectChapter). Without this abort, a pending reload's
      // setActiveChapter landing after the POST would overwrite the
      // newly-created chapter with the old one, and subsequent keystrokes
      // would PATCH the stale chapter id (I4).
      selectChapterSeq.abort();
      setSaveStatus("idle");
      setSaveErrorMessage(null);
      setCacheWarning(false);
      try {
        const newChapter = await api.chapters.create(slug);
        // C2 + C1: discard the response if the user navigated to a
        // different project mid-POST. Without this, `setActiveChapter`
        // and the `setProject` merge would write Project A's new
        // chapter into Project B's state, producing a phantom chapter
        // in the sidebar and pointing subsequent edits at the wrong
        // project's chapter id.
        if (projectRef.current?.id !== projectId) return;
        if (projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug)
          return;
        setActiveChapter(newChapter);
        setChapterWordCount(0);
        setProject((prev) => (prev ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev));
        // C2 (review 2026-04-25): seed the confirmed-status cache for the
        // newly-inserted row. Without this, a later status PATCH on this
        // chapter that fails (PATCH + recovery GET both failing) reads
        // previousStatus = undefined and silently skips the local-revert
        // fallback at line "if (!reverted && previousStatus !== undefined)",
        // leaving the optimistic status on screen even though the server
        // never accepted it. Mirrors loadProject's seed.
        confirmedStatusRef.current[newChapter.id] = newChapter.status;
      } catch (err) {
        console.warn("Failed to create chapter:", err);
        if (projectRef.current?.id !== projectId) return;
        if (projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug)
          return;
        // I4: route through the onError callback (same pattern as
        // handleRenameChapter / handleStatusChange / handleDeleteChapter)
        // so a recoverable failure surfaces as a dismissible banner
        // rather than the full-screen error overlay, which would tear
        // down the editor session and leave the user with only a
        // "back to projects" link.
        const { message, possiblyCommitted } = mapApiError(err, "chapter.create");
        if (!message) return;
        // C1: chapter.create is non-idempotent — the server assigns a new
        // row per POST. On an ambiguous-commit outcome (2xx BAD_JSON ⇒
        // possiblyCommitted) or the explicit READ_AFTER_CREATE_FAILURE
        // code, the row may already exist on the server and retrying
        // would create a duplicate. Fetch the project fresh so the new
        // chapter appears in the sidebar without another POST; surface
        // the committed-specific copy so the user knows not to click
        // Add chapter again.
        //
        // S8 (review 2026-04-24): `possiblyCommitted` now covers both
        // 2xx BAD_JSON and the explicit READ_AFTER_CREATE_FAILURE code
        // (via scope.committedCodes). The former inline `err.code ===
        // "READ_AFTER_CREATE_FAILURE"` check lived here to work around
        // that gap; removing it keeps the recovery logic in the scope
        // registry where future committed-intent codes can be added
        // without touching this call site.
        if (possiblyCommitted) {
          // I7: snapshot pre-POST chapter ids so we can identify the
          // server-created row in the refreshed list. The happy path
          // calls setActiveChapter(newChapter); the recovery path must
          // match that intent or the user sees the new chapter appear
          // in the sidebar but stays on the previously-active chapter,
          // contradicting the committed-banner UX.
          const previousChapterIds = new Set(projectRef.current?.chapters.map((c) => c.id) ?? []);
          createRecoveryAbortRef.current?.abort();
          const recoveryController = new AbortController();
          createRecoveryAbortRef.current = recoveryController;
          try {
            const refreshed = await api.projects.get(slug, recoveryController.signal);
            if (recoveryController.signal.aborted) return;
            // Merge only if the user is still on the same project (by
            // id — stable across rename, changes on cross-project
            // navigation). The prior slug-OR check let a stale
            // recovery response merge into a different project's
            // state after the user navigated away AND the new project
            // finished loading (the two refs then realign to the new
            // slug, making the OR evaluate true).
            if (projectRef.current?.id === projectId) {
              setProject(refreshed);
              // C2 (review 2026-04-25): re-seed the confirmed-status cache
              // from the refreshed project. The recovery branch is a fresh
              // server snapshot, so it carries the authoritative status
              // for every chapter — same discipline as loadProject's seed.
              // Without this, the newly-created chapter (and any other row
              // whose status changed server-side between initial load and
              // recovery) has no cache entry, and a later revert silently
              // skips.
              confirmedStatusRef.current = Object.fromEntries(
                refreshed.chapters.map((c) => [c.id, c.status]),
              );
              const added = refreshed.chapters.filter((c) => !previousChapterIds.has(c.id));
              if (added.length > 0) {
                // Pick the highest sort_order: the server appends new
                // chapters to the end. If somehow more than one row
                // appeared (unexpected), the most-recently-appended
                // one is still the best candidate for the user's
                // intended click.
                const newest = added.reduce((a, b) => (a.sort_order > b.sort_order ? a : b));
                setActiveChapter(newest);
                setChapterWordCount(countWords(newest.content));
              }
            }
          } catch {
            // Refresh is best-effort; the error copy instructs the user
            // to refresh the page manually if this also failed.
          }
        }
        if (onError) {
          onError(message);
        } else {
          setError(message);
        }
      }
    },
    [cancelInFlightSave, selectChapterSeq],
  );

  const handleSelectChapter = useCallback(
    async (chapterId: string) => {
      if (activeChapterRef.current && chapterId === activeChapterRef.current.id) return;
      // Seq bump + abort + backoff-unblock. Before S3 this path only bumped
      // the seq and aborted — if a retry was asleep in backoff, it would
      // sit for up to 8s before the next iteration's seq check fired.
      cancelInFlightSave();
      setSaveStatus("idle");
      // Mirror handleCreateChapter: the previous chapter's persistent save
      // failure message must not follow the user into the newly-selected
      // chapter. The status reset alone hides the footer indicator, but
      // saveErrorMessage is a separate state and would otherwise linger.
      setSaveErrorMessage(null);
      setCacheWarning(false);
      const token = selectChapterSeq.start();
      try {
        const chapter = await api.chapters.get(chapterId);
        if (token.isStale()) return; // superseded by a newer selection
        const cached = getCachedContent(chapterId);
        const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
        setActiveChapter(effectiveChapter);
        setChapterWordCount(countWords(effectiveChapter.content));
      } catch (err) {
        console.warn("Failed to load chapter:", err);
        if (token.isStale()) return;
        const { message } = mapApiError(err, "chapter.load");
        if (message) setError(message);
      }
    },
    [cancelInFlightSave, selectChapterSeq],
  );

  const reloadActiveChapter = useCallback(
    async (
      onError?: (message: string) => void,
      expectedChapterId?: string,
    ): Promise<ReloadOutcome> => {
      const current = activeChapterRef.current;
      // No active chapter to reload — treat as superseded so callers don't
      // raise a lock banner. "failed" is reserved for a fetch that actually
      // errored; this path is the "nothing to refresh" case and the editor
      // state is already consistent.
      if (!current) return "superseded";
      // If the caller passed an expected chapter id and the active chapter
      // no longer matches, the user switched between the directive that
      // requested the reload and this call. Skip the reload entirely —
      // blindly clearing the new chapter's cache and fetching its server
      // copy would wipe the user's in-progress draft of an unrelated
      // chapter (I2). Return "superseded" so useEditorMutation knows the
      // skip is intentional (not a failure warranting a lock banner) but
      // also does NOT mark the lock-override "reloadSucceeded" flag — the
      // now-active chapter's server state was NOT refreshed.
      if (expectedChapterId !== undefined && current.id !== expectedChapterId) {
        return "superseded";
      }
      // I7 (review 2026-04-21): a bare saveSeq.abort() short-circuits
      // the retry loop but leaves the in-flight AbortController and any
      // pending backoff timer dangling. The sole current caller
      // (useEditorMutation) already runs cancelPendingSaves() before
      // reloadActiveChapter, but a future direct caller would inherit a
      // resource leak. Use cancelInFlightSave for parity with
      // handleSelectChapter / handleCreateChapter / handleDeleteChapter —
      // all chapter-state transitions consolidate save cancellation
      // through the same helper.
      cancelInFlightSave();
      setSaveStatus("idle");
      setCacheWarning(false);
      const token = selectChapterSeq.start();
      try {
        const chapter = await api.chapters.get(current.id);
        if (token.isStale()) return "superseded";
        // Clear cache AFTER the server GET succeeds (invariant 3). Before
        // I3, this ran pre-GET — a failed GET would have already erased the
        // draft cache that could serve recovery, weakening defense-in-depth.
        clearCachedContent(current.id);
        setActiveChapter(chapter);
        setChapterWordCount(countWords(chapter.content));
        // Bump reload key so the Editor remounts with fresh server content
        setChapterReloadKey((k) => k + 1);
        return "reloaded";
      } catch (err) {
        console.warn("Failed to reload chapter:", err);
        // Token stale during the GET → user navigated away. A newer
        // select owns state now; "superseded" is correct and must not
        // route to the lock banner (I5).
        if (token.isStale()) return "superseded";
        // If an onError callback is provided, route the failure there so
        // callers (e.g. post-replace reload) can surface a non-fatal banner
        // without flipping EditorPage into the full-screen error branch.
        // Falling back to setError preserves the legacy behavior when no
        // callback is supplied (e.g. snapshot restore reload).
        const { message } = mapApiError(err, "chapter.load");
        if (!message) return "failed";
        if (onError) {
          onError(message);
        } else {
          setError(message);
        }
        return "failed";
      }
    },
    [cancelInFlightSave, selectChapterSeq],
  );

  const projectRef = useRef(project);
  projectRef.current = project;

  const handleDeleteChapter = useCallback(
    async (chapter: Chapter, onError?: (message: string) => void): Promise<boolean> => {
      // Sequence abort + controller abort + backoff-unblock. Before S3
      // this path omitted the backoff-unblock, so a retry asleep in
      // backoff could wake up after the chapter was gone. The isStale()
      // check still short-circuits the resume, but the wakeup wasted a
      // setTimeout slot and held a reference to the deleted chapter id
      // until the timer fired.
      cancelInFlightSave();
      // Also cancel any in-flight chapter GET (matches handleCreateChapter
      // discipline): a GET resolving during the delete POST can land
      // setActiveChapter on the chapter the user is deleting, flashing
      // the wrong chapter as active before the delete effect settles.
      selectChapterSeq.abort();
      // Mirror handleSelectChapter: the deleted chapter's save-status must
      // not leak into the empty-state or next-selected chapter. Without
      // this, deleting mid-save leaves the footer stuck on "Saving…" until
      // a new save cycle completes.
      setSaveStatus("idle");
      setSaveErrorMessage(null);
      setCacheWarning(false);
      // I7: abort any prior in-flight delete before issuing a new one
      // and cover this controller in the unmount cleanup so the browser
      // drops the DELETE rather than running it for a torn-down caller.
      deleteChapterAbortRef.current?.abort();
      const controller = new AbortController();
      deleteChapterAbortRef.current = controller;
      try {
        await api.chapters.delete(chapter.id, controller.signal);
        if (controller.signal.aborted) return false;
        if (deleteChapterAbortRef.current === controller) deleteChapterAbortRef.current = null;
        clearCachedContent(chapter.id);
        // Compute remaining from the ref (current state), not the stale closure
        const remaining = projectRef.current?.chapters.filter((c) => c.id !== chapter.id) ?? [];
        setProject((prev) => {
          if (!prev) return prev;
          return { ...prev, chapters: prev.chapters.filter((c) => c.id !== chapter.id) };
        });

        // If deleting the active chapter, switch to the first remaining
        if (activeChapterRef.current?.id === chapter.id) {
          const first = remaining[0];
          if (first) {
            // Capture-and-compare the select token across the secondary
            // GET (I5). Without this guard, a rapid click-then-click
            // during delete (user selects another chapter after the
            // delete POST resolves but before this GET does) would let
            // the stale "next chapter after delete" fetch pin the
            // sidebar over the user's explicit selection.
            const token = selectChapterSeq.start();
            try {
              // I7: thread the delete controller through the follow-up
              // GET so an unmount aborts both the DELETE-step and the
              // post-delete active-chapter fetch together.
              const ch = await api.chapters.get(first.id, controller.signal);
              if (token.isStale()) return true;
              setActiveChapter(ch);
              setChapterWordCount(countWords(ch.content));
            } catch (err) {
              // Secondary fetch failed — fall through to the empty state
              // rather than setting activeChapter to the list-level row
              // (which has content=null). Surface the failure via the
              // onError callback and a console.warn so the user and the
              // dev console both learn something went wrong (I3); before
              // I3 the catch was silent and the user saw "Add chapter"
              // as if the project had no chapters left.
              console.warn("Failed to load chapter after delete:", err);
              if (token.isStale()) return true;
              const { message } = mapApiError(err, "chapter.load");
              if (message) onError?.(message);
              setActiveChapter(null);
              setChapterWordCount(0);
            }
          } else {
            setActiveChapter(null);
            setChapterWordCount(0);
          }
        }
        return true;
      } catch (err) {
        if (deleteChapterAbortRef.current === controller) deleteChapterAbortRef.current = null;
        // I7: ABORTED means unmount or a newer delete superseded this
        // one; stay silent so we don't fire a banner on a torn-down
        // caller (happens in practice in tests too).
        if (controller.signal.aborted) return false;
        console.warn("Failed to delete chapter:", err);
        const { message } = mapApiError(err, "chapter.delete");
        if (message) onError?.(message);
        return false;
      }
    },
    [cancelInFlightSave, selectChapterSeq],
  );

  const handleReorderChapters = useCallback(
    async (orderedIds: string[], onError?: (message: string) => void) => {
      const slug = projectSlugRef.current;
      const projectId = projectRef.current?.id;
      if (!slug || !projectId) return;
      // C5 (review 2026-04-24): abort any prior in-flight reorder
      // before issuing a new one so overlapping drag-drops cannot
      // commit out of drop order. The signal is threaded through the
      // transport so the browser actually drops the stale request.
      reorderAbortRef.current?.abort();
      const controller = new AbortController();
      reorderAbortRef.current = controller;
      // S6 (review 2026-04-21) + C1 (review 2026-04-24): drift guard —
      // see handleCreateChapter for full rationale.
      try {
        await api.projects.reorderChapters(slug, orderedIds, controller.signal);
        if (reorderAbortRef.current === controller) reorderAbortRef.current = null;
        // C2 + C1: discard if the user navigated away mid-PUT. Without
        // this, the reorder would apply Project A's ordered ids to
        // Project B's chapters array — the filter by id then drops
        // everything (ids don't match), leaving Project B with an
        // empty chapters list until refresh.
        if (projectRef.current?.id !== projectId) return;
        if (projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug)
          return;
        setProject((prev) => {
          if (!prev) return prev;
          const reordered = orderedIds
            .map((id, index) => {
              const ch = prev.chapters.find((c) => c.id === id);
              return ch ? { ...ch, sort_order: index } : undefined;
            })
            .filter(Boolean) as Chapter[];
          return { ...prev, chapters: reordered };
        });
      } catch (err) {
        if (reorderAbortRef.current === controller) reorderAbortRef.current = null;
        // C5: ABORTED means a newer reorder superseded this one and is
        // driving its own PATCH. Reverting here would stomp the live
        // call; stay silent and let the newer reorder land.
        if (controller.signal.aborted) return;
        console.warn("Failed to reorder chapters:", err);
        if (projectRef.current?.id !== projectId) return;
        if (projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug)
          return;
        // I4: route through the onError callback rather than setError so
        // a 400 on id-list mismatch (recoverable per CLAUDE.md) surfaces
        // as a dismissible banner instead of tearing down the editor.
        const { message, possiblyCommitted } = mapApiError(err, "chapter.reorder");
        // I6 (2026-04-23): 2xx BAD_JSON means the server committed the
        // reorder but the body was unreadable. Before this fix the
        // catch touched no state, so the drag-and-drop visually snapped
        // back to the pre-drag order while the server held the new
        // order — a user retry would re-apply the same order
        // idempotently but confusingly. Apply the requested order to
        // client state on possiblyCommitted so the UI matches the
        // committed server state, and surface the committed copy so
        // the user knows the response was ambiguous.
        if (possiblyCommitted) {
          setProject((prev) => {
            if (!prev) return prev;
            const reordered = orderedIds
              .map((id, index) => {
                const ch = prev.chapters.find((c) => c.id === id);
                return ch ? { ...ch, sort_order: index } : undefined;
              })
              .filter(Boolean) as Chapter[];
            return { ...prev, chapters: reordered };
          });
        }
        if (!message) return;
        if (onError) {
          onError(message);
        } else {
          setError(message);
        }
      }
    },
    [],
  );

  const handleUpdateProjectTitle = useCallback(
    async (title: string): Promise<string | undefined> => {
      const slug = projectSlugRef.current;
      const projectId = projectRef.current?.id;
      if (!slug || !projectId) return undefined;
      // S6 (review 2026-04-21) + C1 (review 2026-04-24): drift guard —
      // see handleCreateChapter for full rationale.
      setProjectTitleError(null);
      // I1: abort any prior in-flight title PATCH before issuing a new
      // one so overlapping renames can't commit out of typing order.
      titleChangeAbortRef.current?.abort();
      const controller = new AbortController();
      titleChangeAbortRef.current = controller;
      try {
        const updated = await api.projects.update(slug, { title }, controller.signal);
        if (controller.signal.aborted) return undefined;
        // C3 defense-in-depth: if the user navigated mid-PATCH, discard
        // the response. The primary C3 guard lives in useProjectTitleEditing
        // (refuses saveProjectTitle when project.slug !== slug), but this
        // extra check keeps handleUpdateProjectTitle independently safe for
        // any future direct caller.
        if (projectRef.current?.id !== projectId) return undefined;
        if (projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug)
          return undefined;
        projectSlugRef.current = updated.slug;
        setProject((prev) => (prev ? { ...prev, title: updated.title, slug: updated.slug } : prev));
        return updated.slug;
      } catch (err) {
        if (controller.signal.aborted) return undefined; // superseded by a newer rename
        console.warn("Failed to update project title:", err);
        // Don't call setError — that triggers the full-page error overlay.
        // Returning undefined keeps the title edit mode open so the user can retry.
        const { message, possiblyCommitted } = mapApiError(err, "project.updateTitle");
        // I3: slug desync recovery. On 2xx BAD_JSON the server may have
        // committed the rename (new slug) but we can't read the new one
        // from the unreadable body. Subsequent save/create/reorder POSTs
        // against projectSlugRef.current would 404 against a dead slug —
        // cascading silent failures until the user refreshes. Attempt a
        // project refresh under the current (old) slug; if the slug did
        // not change (cosmetic rename, same-slug result) this recovers
        // in place. If the slug did change the GET 404s; the committed
        // copy alone tells the user to refresh the page.
        if (possiblyCommitted) {
          titleRecoveryAbortRef.current?.abort();
          const recoveryController = new AbortController();
          titleRecoveryAbortRef.current = recoveryController;
          try {
            const refreshed = await api.projects.get(slug, recoveryController.signal);
            if (recoveryController.signal.aborted) return undefined;
            // Merge only if still on the same project (id stable across
            // rename, changes on cross-project navigation).
            if (projectRef.current?.id === projectId) {
              setProject(refreshed);
              projectSlugRef.current = refreshed.slug;
            }
          } catch (recoveryErr) {
            // I4 (review 2026-04-24): a 404 here means the server moved
            // the project to a new slug but the unreadable body kept us
            // from learning it. projectSlugRef still points at the dead
            // slug; every subsequent save/create/reorder POSTs against
            // it and 404s in a cascade. Fire onRequestEditorLock so the
            // editor locks and auto-save short-circuits via
            // handleSaveLockGated — the banner instructs the user to
            // refresh. Network/other errors fall through to the generic
            // committed banner below (auto-save still works because the
            // slug didn't move; next attempt will succeed or surface its
            // own error).
            if (isApiError(recoveryErr) && recoveryErr.status === 404) {
              onRequestEditorLockRef.current?.(STRINGS.error.updateTitleProjectSlugLost);
            }
          }
        }
        if (message) setProjectTitleError(message);
        return undefined;
      }
    },
    [],
  );

  const handleStatusChange = useCallback(
    async (chapterId: string, status: string, onError?: (message: string) => void) => {
      const token = statusChangeSeq.start();
      // I11: abort the prior in-flight PATCH before issuing a new one so
      // overlapping status clicks cannot land out-of-order at the server.
      statusChangeAbortRef.current?.abort();
      const controller = new AbortController();
      statusChangeAbortRef.current = controller;
      // I21 (review 2026-04-24): read previousStatus from the confirmed
      // cache, not projectRef. A rapid X→A→B click sequence would
      // otherwise capture `previousStatus = A` for B (A's optimistic
      // setProject has landed but A's PATCH has not confirmed) — a
      // later B-failure revert would restore A, a status the server
      // never saw. The confirmed ref only advances after a successful
      // PATCH, so it holds the authoritative value.
      const previousStatus = confirmedStatusRef.current[chapterId];

      // Optimistic update
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, status } : c)),
        };
      });
      // Guard all setActiveChapter updaters with ID check to prevent applying
      // status to the wrong chapter if the user rapidly switches chapters.
      setActiveChapter((prev) => (prev?.id === chapterId ? { ...prev, status } : prev));
      try {
        await api.chapters.update(chapterId, { status }, controller.signal);
        if (statusChangeAbortRef.current === controller) statusChangeAbortRef.current = null;
        // I21: advance the confirmed cache only on server-confirmed
        // success so the next call's previousStatus reads the right
        // value.
        confirmedStatusRef.current[chapterId] = status;
      } catch (err) {
        if (statusChangeAbortRef.current === controller) statusChangeAbortRef.current = null;
        if (token.isStale()) return; // newer call owns state
        const { message, possiblyCommitted } = mapApiError(err, "chapter.updateStatus");
        // I11 (follow-on from the new AbortController): an ABORTED
        // error means a later click cancelled this PATCH mid-flight —
        // the newer click already owns the optimistic state and is
        // driving its own PATCH. Reverting here would stomp the live
        // call. Mirror saveAbortRef's ABORTED short-circuit.
        if (message === null) return;
        // I6 (2026-04-23): 2xx BAD_JSON means the server committed the
        // new status but the response body was unreadable. A revert
        // here either silently no-ops (the reload GET returns the new
        // status the user just set) or fights the committed server
        // state (local revert). Keep the optimistic update — the
        // committed copy below tells the user the response was
        // ambiguous, and the next chapter load will reconcile state.
        if (possiblyCommitted) {
          // I21: the server likely committed the new status despite
          // the unreadable body. Advance the confirmed cache so a
          // later status change captures this value, not the previous
          // one, as the baseline.
          confirmedStatusRef.current[chapterId] = status;
          if (message) onError?.(message);
          return;
        }
        // Revert by reloading from server, falling back to local revert
        let reverted = false;
        const slug = projectSlugRef.current;
        if (slug) {
          statusRecoveryAbortRef.current?.abort();
          const recoveryController = new AbortController();
          statusRecoveryAbortRef.current = recoveryController;
          try {
            const data = await api.projects.get(slug, recoveryController.signal);
            if (recoveryController.signal.aborted) return;
            // Re-check the token after the second await (I2). The
            // earlier guard covers only the api.chapters.update await; a
            // rapid A→B (fails) then B→C click where the failure lands
            // mid-api.projects.get would otherwise stomp C's optimistic
            // update back to A's server-side status, losing the user's
            // intent silently. Recovery would require another click.
            if (token.isStale()) return;
            const revertedChapter = data.chapters.find((c) => c.id === chapterId);
            if (revertedChapter) {
              // I21: advance confirmed cache to the server's truth so
              // subsequent calls don't capture a stale baseline.
              confirmedStatusRef.current[chapterId] = revertedChapter.status;
              // Surgically revert only the status field to avoid overwriting
              // concurrent optimistic updates (reorder, rename, create).
              setProject((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  chapters: prev.chapters.map((c) =>
                    c.id === chapterId ? { ...c, status: revertedChapter.status } : c,
                  ),
                };
              });
              setActiveChapter((prev) =>
                prev?.id === chapterId ? { ...prev, status: revertedChapter.status } : prev,
              );
              reverted = true;
            }
          } catch {
            // Reload failed — fall through to local revert
          }
        }
        // Guard the local-revert fallback too: the catch above could be
        // reached with the token already stale, in which case restoring
        // previousStatus would clobber the newer call's optimistic update.
        if (token.isStale()) return;
        if (!reverted && previousStatus !== undefined) {
          setProject((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              chapters: prev.chapters.map((c) =>
                c.id === chapterId ? { ...c, status: previousStatus } : c,
              ),
            };
          });
          setActiveChapter((prev) =>
            prev?.id === chapterId ? { ...prev, status: previousStatus } : prev,
          );
        }
        // Status change failures are non-fatal — the revert already restored consistent state.
        // Call the optional onError callback for the caller to display (e.g., as a dismissible banner),
        // rather than setError which triggers the full-page error overlay.
        if (message) onError?.(message);
      }
    },
    [statusChangeSeq],
  );

  const handleRenameChapter = useCallback(
    async (chapterId: string, title: string, onError?: (message: string) => void) => {
      // I7: abort any prior in-flight rename before issuing a new one
      // so overlapping renames cannot commit out of typing order at the
      // server (same rationale as title/status abort refs).
      renameChapterAbortRef.current?.abort();
      const controller = new AbortController();
      renameChapterAbortRef.current = controller;
      try {
        await api.chapters.update(chapterId, { title }, controller.signal);
        if (controller.signal.aborted) return;
        if (renameChapterAbortRef.current === controller) renameChapterAbortRef.current = null;
        if (activeChapterRef.current?.id === chapterId) {
          // Only update the title — don't overwrite content with stale server data.
          // The editor holds the current truth (same principle as handleSave).
          // Guard with ID check to prevent applying title to wrong chapter on rapid switch.
          setActiveChapter((prev) => (prev?.id === chapterId ? { ...prev, title } : prev));
        }
        setProject((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, title } : c)),
          };
        });
      } catch (err) {
        if (renameChapterAbortRef.current === controller) renameChapterAbortRef.current = null;
        // I7: ABORTED means a newer rename superseded this one; stay
        // silent so the newer call's state update is not contradicted
        // by a stale error banner.
        if (controller.signal.aborted) return;
        console.warn("Failed to rename chapter:", err);
        // Don't call setError — that triggers the full-page error overlay.
        // Rename failures are non-fatal; surface via the optional callback
        // so callers can display inline (same pattern as handleStatusChange).
        const { message } = mapApiError(err, "chapter.rename");
        if (message) onError?.(message);
      }
    },
    [],
  );

  return {
    project,
    error,
    projectTitleError,
    setProjectTitleError,
    setProject,
    activeChapter,
    chapterReloadKey,
    saveStatus,
    saveErrorMessage,
    cacheWarning,
    chapterWordCount,
    handleSave,
    handleContentChange,
    handleCreateChapter,
    handleSelectChapter,
    reloadActiveChapter,
    handleDeleteChapter,
    handleReorderChapters,
    handleUpdateProjectTitle,
    handleRenameChapter,
    handleStatusChange,
    // C2 (review 2026-04-25): sibling hooks (useTrashManager) that
    // insert rows into project state must seed the confirmed-status
    // cache so a later status PATCH on those rows can fall back to a
    // baseline if both the PATCH and the recovery GET fail. Exposed as
    // a function rather than the ref itself so call sites cannot mutate
    // the cache to arbitrary values — only seed (id, status) pairs.
    seedConfirmedStatus: (id: string, status: string) => {
      confirmedStatusRef.current[id] = status;
    },
    // Getter for reading the current active chapter from inside async
    // callbacks whose closure would otherwise see a stale value.
    getActiveChapter: () => activeChapterRef.current,
    // Cancel any in-flight save retries. Used before entering snapshot
    // view mode so a retry from earlier typing cannot write to the server
    // while the editor is supposed to be read-only.
    cancelPendingSaves: () => {
      cancelInFlightSave();
      // Reset status to idle so the header doesn't stay on "Saving…".
      // The aborted save's own status-write is guarded by the chapter/seq
      // check and short-circuits, so without this reset the UI would
      // remain stuck until another save cycle completes.
      setSaveStatus((prev) => (prev === "saving" ? "idle" : prev));
      setSaveErrorMessage(null);
    },
  };
}

// Explicit return-type alias for cross-file consumers (useEditorMutation).
// Extracting it here lets callers `import type { UseProjectEditorReturn }`
// and `Pick<UseProjectEditorReturn, "cancelPendingSaves" | …>` without
// referencing `ReturnType<typeof useProjectEditor>` from a type-only
// import — the typeof form compiles under verbatimModuleSyntax, but an
// explicit alias is plainly a type and survives any future config change.
export type UseProjectEditorReturn = ReturnType<typeof useProjectEditor>;
