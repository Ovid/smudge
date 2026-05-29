import { useEffect, useState, useCallback, useRef } from "react";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { countWords } from "@smudge/shared";
import { api } from "../api/client";
import { getCachedContent, setCachedContent, clearCachedContent } from "./useContentCache";
import { useAbortableSequence } from "./useAbortableSequence";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { sleep } from "../utils/abortable";
import { STRINGS } from "../strings";
import {
  mapApiError,
  mapApiErrorMessage,
  applyMappedError,
  isApiError,
  isAborted,
  isClientError,
  clientWarn,
} from "../errors";
import { useChapterCrud } from "./useChapterCrud";
import { useChapterMetadata } from "./useChapterMetadata";
import type { SaveStatus } from "./useProjectEditor.types";

// SaveStatus and ReloadOutcome moved to ./useProjectEditor.types (F-2
// decomposition, 2026-05-29) so the chapter-CRUD / chapter-metadata sub-hooks
// can reference them without an import cycle back through this module. They
// are re-exported here so existing consumers (EditorFooter, useEditorMutation)
// keep importing them from the same path.
export type { SaveStatus, ReloadOutcome } from "./useProjectEditor.types";

// Save-retry exponential backoff schedule (ms). Exposed so the test
// helper `flushSaveRetries` can iterate the same schedule the hook
// uses — a hand-mirrored copy in the test helper would silently drift
// if this array changes.
export const SAVE_BACKOFF_MS = [2000, 4000, 8000] as const;

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
  // S11 (4b.3c.3): fires when handleCreateChapter's POST hits a 404,
  // i.e. the project was deleted between sidebar render and the POST
  // landing. EditorPage wires this to navigate("/"); the hook itself
  // stays router-agnostic (no useNavigate import). Hook consumers that
  // can't navigate (tests, storybook) may omit it — falls back to the
  // pre-fix onError banner.
  onProjectNotFound?: () => void;
}

export function useProjectEditor(slug: string | undefined, options?: UseProjectEditorOptions) {
  // F-2 decomposition (2026-05-29): the sync-on-render ref-mirror writes below
  // are an intentional, long-standing pattern (a ref kept in lock-step with a
  // prop/state value so async callbacks read the live value, never a stale
  // closure). They were previously unflagged because the 1722-line body —
  // chiefly the giant handleSave retry loop — pushed the hook past the React
  // Compiler's analysis bailout threshold (see the prior projectRef note,
  // since relocated). Extracting the handlers brought the file back under
  // analysis, so react-hooks/refs now sees these writes. The inline disables
  // mirror the same pattern's handling in useTrashManager.ts.
  const onRequestEditorLockRef = useRef(options?.onRequestEditorLock);
  // eslint-disable-next-line react-hooks/refs
  onRequestEditorLockRef.current = options?.onRequestEditorLock;
  const onProjectNotFoundRef = useRef(options?.onProjectNotFound);
  // eslint-disable-next-line react-hooks/refs
  onProjectNotFoundRef.current = options?.onProjectNotFound;
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
  // eslint-disable-next-line react-hooks/refs
  activeChapterRef.current = activeChapter;
  // Sync-on-render mirror of `project` so the chapter-CRUD / chapter-metadata
  // handlers (now in sub-hooks) can read the current project from inside async
  // callbacks without a stale closure, and so the drift guards can compare the
  // project id captured at request time against the live one. Declared up here
  // with the other sync-on-render refs (F-2 decomposition, 2026-05-29): before
  // the split it lived lower in the body and was forward-referenced by the
  // handlers, which tripped the React Compiler's immutability analysis; the
  // early declaration removes that forward reference.
  const projectRef = useRef(project);
  // eslint-disable-next-line react-hooks/refs
  projectRef.current = project;
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
  // eslint-disable-next-line react-hooks/refs
  if (prevSlugArgRef.current !== slug) {
    // eslint-disable-next-line react-hooks/refs
    prevSlugArgRef.current = slug;
    // S3 (review 2026-04-21): sync the ref in lock-step with
    // prevSlugArgRef, including the defined→undefined transition.
    // Previously the ref was rewritten only when the new slug was
    // defined, leaving it pointing at the prior project after the
    // URL cleared — a late handler click landing in that window
    // would POST against the old project.
    // eslint-disable-next-line react-hooks/refs
    projectSlugRef.current = slug;
  }
  const saveSeq = useAbortableSequence();
  // S-2 (Phase 4b.3b): the save loop's network controller + backoff
  // teardown live behind useAbortableAsyncOperation. One saveOp.run()
  // wraps the entire retry-with-backoff cycle: api.chapters.update and
  // sleep(ms, signal) both receive the per-call signal, so abort()
  // severs the in-flight PATCH AND unblocks the sleep in one call.
  // Pre-migration this was a hand-rolled `useRef<AbortController>` plus
  // a `saveBackoffRef` carrying `{ timer, resolve }` for the awaitable
  // backoff — both have been deleted, the sleep helper subsumes the
  // backoff-teardown bookkeeping. saveSeq still arbitrates response
  // staleness via token.isStale(); the two hooks are orthogonal and
  // both apply to every save.
  const saveOp = useAbortableAsyncOperation();
  // C-6 (Phase 4b.3b): loadProject routes both its api.projects.get and
  // its api.chapters.get through this single hook so one unmount aborts
  // both. Replaces the pre-migration `let cancelled = false` flag — the
  // hook's auto-abort-on-unmount semantics now provide the same
  // "discard late-resolving response" guarantee, and threading the
  // per-call signal through the transport additionally severs the
  // network request rather than just gating the post-await setState.
  const loadProjectOp = useAbortableAsyncOperation();
  // I21 (review 2026-04-24): per-chapter cache of the last server-
  // confirmed status. Rapid X→A→B clicks used to capture
  // `previousStatus = A` for B because A's optimistic setProject had
  // landed; if B's PATCH failed AND the fallback GET silent-catch
  // also failed, the revert restored A — a status the server never
  // persisted. Tracking confirmed commits separately lets the revert
  // target the actual server-side value. Parallels
  // confirmedTimezoneRef / confirmedFieldsRef in ProjectSettingsDialog.
  const confirmedStatusRef = useRef<Record<string, string | undefined>>({});
  // S1 (review 2026-05-27): one helper for the bulk reseed shape. The
  // three pre-existing call sites (loadProject success, handleCreateChapter
  // committed-recovery, and the public replaceConfirmedStatusesFromProject
  // exposed to useTrashManager) all wrote the identical
  // `Object.fromEntries(refreshed.chapters.map(...))` body inline. The
  // ref is stable, so empty deps is correct.
  const replaceConfirmedStatusesFromProject = useCallback((refreshed: ProjectWithChapters) => {
    confirmedStatusRef.current = Object.fromEntries(
      refreshed.chapters.map((c) => [c.id, c.status]),
    );
  }, []);
  // OOSS3 (review 2026-05-27 round 3): memoize seedConfirmedStatus
  // so useTrashManager's seedConfirmedStatusRef effect (which lists it
  // as a dep) doesn't re-run on every parent render. The new sibling
  // replaceConfirmedStatusesFromProject above IS memoized; the
  // asymmetry was visible after the I4 (4b.3c.3) change. Ref is
  // stable, so empty deps is correct.
  const seedConfirmedStatus = useCallback((id: string, status: string) => {
    confirmedStatusRef.current[id] = status;
  }, []);
  // F-2 decomposition (2026-05-29): the per-handler recovery AbortControllers
  // (createRecoveryAbortRef, statusRecoveryAbortRef, titleRecoveryAbortRef)
  // and their unmount cleanup now live inside the sub-hooks that own them —
  // createRecoveryAbortRef in useChapterCrud, the status/title ones in
  // useChapterMetadata — alongside the handlers whose catch branches fire
  // them. The per-handler-ref rationale (C1, review 2026-04-25) and the
  // hand-rolled-not-via-the-op-hook decision (Phase 4b.3b row C-5) are
  // documented there.

  // Shared cancel-in-flight-save helper. Aborts the save sequence (so the
  // retry loop short-circuits on its next iteration via token.isStale())
  // AND aborts the saveOp controller, which both severs the in-flight
  // PATCH and rejects the backoff sleep awaiting that signal — a single
  // abort() call replaces the pre-migration trio (saveSeq.abort +
  // saveAbortRef.current.abort + saveBackoffRef.current.resolve).
  // handleSelectChapter, handleDeleteChapter, cancelPendingSaves, and
  // unmount cleanup all go through this — before S3 the select/delete
  // paths omitted the backoff-unblock step, leaving the retry loop
  // asleep for up to 8s after a chapter switch/delete; routing through
  // saveOp.abort() makes that class of bug structurally impossible.
  //
  // S8 (review 2026-05-25): the two calls are NOT redundant — they
  // gate different things and dropping either re-opens a real race.
  //   - saveSeq.abort() invalidates outstanding tokens. The retry loop
  //     reads token.isStale() at the top of each iteration AND after
  //     the PATCH resolves; a stale token short-circuits without
  //     calling setSaveStatus/setProject, even if the PATCH has
  //     already succeeded. Without this, a successful resolve from a
  //     superseded save would still write through to React state.
  //   - saveOp.abort() severs the in-flight network call AND rejects
  //     the backoff sleep awaiting the same signal. Without this, the
  //     PATCH continues to completion on the server (wasted work) and
  //     a backoff sleep would hold the loop asleep for the rest of
  //     the 2/4/8s window before its next iteration's seq-check could
  //     fire — that's the 8-second-stale-PATCH bug S3 fixed.
  // A future refactor that drops either is a regression — keep both.
  const cancelInFlightSave = useCallback(() => {
    saveSeq.abort();
    saveOp.abort();
  }, [saveSeq, saveOp]);

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
      // The per-handler recovery-controller aborts that used to live here
      // moved with their refs into useChapterCrud / useChapterMetadata, each
      // of which registers its own unmount cleanup. (S-7: deleteChapterOp
      // auto-aborts on unmount via its op hook; no manual entry needed.)
    };
  }, [cancelInFlightSave]);

  useEffect(() => {
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

    const { promise } = loadProjectOp.run(async (s) => {
      if (!slug) return;
      try {
        const data = await api.projects.get(slug, s);
        if (s.aborted) return;
        setProject(data);
        // I21: seed the confirmed-status cache from the authoritative
        // server response. Every chapter's status here is server-truth
        // at load time; subsequent revert paths read from this ref so
        // they don't stomp to an optimistic value.
        replaceConfirmedStatusesFromProject(data);
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
          const chapter = await api.chapters.get(firstChapter.id, s);
          if (s.aborted) return;
          const cached = getCachedContent(chapter.id);
          const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
          setActiveChapter(effectiveChapter);
          setChapterWordCount(countWords(effectiveChapter.content));
        }
      } catch (err) {
        // Copilot review 2026-04-24 (wider occurrence of HomePage race):
        // gate console.warn on s.aborted so a late rejection on
        // unmount/slug-change does not leak noise into test output.
        // (Replaces the pre-migration `cancelled` gate; C-6 Phase 4b.3b.)
        if (s.aborted) return;
        const mapped = mapApiError(err, "project.load");
        if (mapped.message !== null) clientWarn("Failed to load project:", err);
        applyMappedError(mapped, { onMessage: setError });
      }
    });
    void promise;
  }, [slug, loadProjectOp, replaceConfirmedStatusesFromProject]);

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
      const MAX_RETRIES = SAVE_BACKOFF_MS.length;

      setSaveStatus("saving");
      setSaveErrorMessage(null);
      // Captures the error that terminates the retry loop (any of: 2xx
      // BAD_JSON, 5xx UPDATE_READ_FAILURE / CORRUPT_CONTENT, any 4xx,
      // bare-status 404 from an envelope-stripped proxy response). Every
      // write is paired with `break` — once set, no further attempts run.
      // Drives three downstream decisions: post-loop banner copy
      // (line ~465), VALIDATION_ERROR cache wipe (~433), and editor
      // lock predicate (~494). Historical name `rejected4xx` predated
      // the BAD_JSON / UPDATE_READ_FAILURE / CORRUPT_CONTENT and
      // status===404 branches — kept the variable single-purpose but
      // no longer 4xx-only.
      // S1 (agentic-review 2026-05-26): `terminal` and `possiblyCommitted`
      // mirror the matching MappedError flags so the post-loop lock-banner
      // can route through `terminal || possiblyCommitted` instead of
      // hand-coding the code/status list. Adding a new terminal condition
      // (code OR status) is now a one-line scope edit.
      type TerminalSaveError = {
        message: string;
        code?: string;
        status: number;
        terminal: boolean;
        possiblyCommitted: boolean;
      };
      // S-2 (Phase 4b.3b): the retry-with-backoff loop returns a
      // discriminated outcome so the post-loop block can drive banner /
      // lock decisions without mutating outer-scope state from inside
      // the saveOp.run() closure. A previous draft used a `{ value }`
      // box to pass state out, which (a) the React Compiler flagged as
      // a possible mutability hazard and (b) obscured the closure's
      // contract. Returning an object is clearer: the closure either
      // committed ("ok"), exited because of cancellation ("aborted",
      // including supersede and bare AbortError from sleep/fetch), or
      // exhausted retries with an error to surface ("exhausted").
      type SaveLoopOutcome =
        | { kind: "ok" }
        | { kind: "aborted" }
        | { kind: "exhausted"; terminal: TerminalSaveError | null; lastErr: unknown };

      // S-2 (Phase 4b.3b): the entire retry-with-backoff cycle is one
      // saveOp.run() invocation. Calling run() aborts any prior in-flight
      // save (debounce + onBlur overlap), allocates a fresh controller,
      // and hands its signal to api.chapters.update AND sleep — so a
      // single saveOp.abort() (via cancelInFlightSave) severs the
      // PATCH and rejects the backoff sleep in one call.
      const { promise: saveRunPromise } = saveOp.run<SaveLoopOutcome>(async (s) => {
        let terminal: TerminalSaveError | null = null;
        // I4 (Phase 4b.3a regression guard): capture the most recent
        // non-aborted error so retry-exhaustion can route its banner copy
        // through the unified mapper. Pre-fix, the post-loop fallback used
        // the literal STRINGS.editor.saveFailed, bypassing chapter.save's
        // network: mapping and surfacing "Save failed. Try again." even
        // for NETWORK retry exhaustion. CLAUDE.md invariant: all
        // user-visible API error messages flow through mapApiError.
        let lastErr: unknown = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (token.isStale()) return { kind: "aborted" }; // chapter changed
          if (s.aborted) return { kind: "aborted" }; // cancelInFlightSave
          // Re-read latest content each attempt so backoff retries post keystrokes
          // that arrived after the initial call.
          const latest = latestContentRef.current;
          const postedContent = latest && latest.id === savingChapterId ? latest.content : content;
          try {
            const updated = await api.chapters.update(
              savingChapterId,
              { content: postedContent },
              s,
            );
            if (token.isStale()) return { kind: "aborted" };
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
            return { kind: "ok" };
          } catch (err) {
            // Aborted: cancelPendingSaves intentionally cancelled this save
            // (e.g. before a snapshot restore). Exit cleanly without flagging
            // an error to the user.
            if (isAborted(err)) {
              return { kind: "aborted" };
            }
            // Track the most recent non-aborted error so the post-loop
            // fallback (used when NETWORK / bare-5xx retries exhaust) can
            // route through mapApiError(err, "chapter.save"). 4xx and
            // terminal-code branches below still break early via
            // terminalSaveError, which takes precedence over this lastErr.
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
            const mapped = mapApiError(err, "chapter.save");
            // S3/S7 (4b.3c.1) + S1 (2026-05-26 review): the OR is the
            // documented bridge between three scope-driven flags that all
            // mean "save loop must break and lock the editor":
            //   - mapped.terminal: scopes.ts terminalCodes (5xx UPDATE_READ_FAILURE /
            //     CORRUPT_CONTENT — the byCode-match branch sets terminal=true)
            //     OR terminalStatuses (404 — the byStatus-match branch sets
            //     terminal=true after S1 added the byStatus axis to the scope
            //     contract).
            //   - mapped.possiblyCommitted: 2xx BAD_JSON (scope.committed routes
            //     through the BAD_JSON early-return branch, which sets
            //     possiblyCommitted=true). UPDATE_READ_FAILURE additionally has a
            //     committedCodes entry so its mapped output sets both flags; the
            //     OR is idempotent on that case.
            if (isApiError(err) && (mapped.terminal || mapped.possiblyCommitted)) {
              clientWarn("Save failed terminally:", err);
              terminal = {
                message: mapped.message as string,
                code: err.code,
                status: err.status,
                terminal: mapped.terminal,
                possiblyCommitted: mapped.possiblyCommitted,
              };
              break;
            }
            if (isClientError(err)) {
              clientWarn("Save failed with 4xx:", err);
              // I4 (2026-04-23 review): route through the unified mapper
              // so chapter.save scope is the single source of truth. Raw
              // err.message is never forwarded (CLAUDE.md invariant); the
              // scope's byStatus[413] / byCode[VALIDATION_ERROR] / fallback
              // produce the same strings.ts copy the inline mapSaveError
              // duplicated. err.code is preserved separately for the
              // cache-clear decision below. ABORTED is filtered above so
              // mapped.message is guaranteed non-null in this branch.
              // 4b.3c.1: reuse `mapped` computed above — one mapApiError
              // call per catch iteration rather than two.
              // S1 (2026-05-26): copy mapped flags too — keeps the
              // TerminalSaveError shape uniform across both break sites.
              // For bare 4xx (no terminalCodes / terminalStatuses match),
              // both flags are false and the lock-banner branch below
              // skips locking, exactly mirroring pre-S1 behaviour.
              terminal = {
                message: mapped.message as string,
                code: err.code,
                status: err.status,
                terminal: mapped.terminal,
                possiblyCommitted: mapped.possiblyCommitted,
              };
              break;
            }
            if (attempt < MAX_RETRIES) {
              // S-2 (Phase 4b.3b): sleep(ms, signal) replaces the
              // hand-rolled setTimeout/resolver dance that used to live
              // in saveBackoffRef. The signal is the per-call saveOp
              // signal — if cancelInFlightSave fires while we're
              // asleep, sleep rejects with a DOMException AbortError
              // and we exit cleanly (caught by isAborted below; the
              // predicate matches DOMException AbortError in addition
              // to ApiRequestError{ABORTED}). The seq-check at the top
              // of the next iteration would short-circuit anyway, but
              // the abortable sleep means we don't wait out the rest
              // of the backoff window first.
              //
              // The `?? 0` guards a theoretical out-of-range index —
              // `attempt < MAX_RETRIES === SAVE_BACKOFF_MS.length`
              // makes this branch unreachable with an undefined
              // backoff slot, but noUncheckedIndexedAccess otherwise
              // flags the read. Falling back to 0ms in that
              // unreachable path is a safe degenerate (next iteration
              // immediately gates on token.isStale()/s.aborted).
              const backoffMs = SAVE_BACKOFF_MS[attempt] ?? 0;
              try {
                await sleep(backoffMs, s);
              } catch (sleepErr) {
                if (isAborted(sleepErr)) return { kind: "aborted" };
                // I1 (review 2026-05-25): the sleep helper only rejects
                // on abort today; any other throw is a true programming
                // error (e.g. a future refactor that throws synchronously
                // before scheduling the timer) and must surface so the
                // bug is visible instead of being swallowed as "aborted".
                throw sleepErr;
              }
            }
          }
        }
        // Retries exhausted without success / break — surface the
        // captured terminal/lastErr to the post-loop block.
        return { kind: "exhausted", terminal, lastErr };
      });
      const outcome = await saveRunPromise;
      if (outcome.kind === "ok") return true;
      if (outcome.kind === "aborted") return false;
      // outcome.kind === "exhausted" — drive the post-loop banner/lock.
      const terminalSaveError = outcome.terminal;
      const lastErr = outcome.lastErr;
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
      if (terminalSaveError && terminalSaveError.code === "VALIDATION_ERROR" && !token.isStale()) {
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
        // chain so fallbackMessage isn't computed when terminalSaveError
        // is already set.
        setSaveErrorMessage(
          terminalSaveError?.message ??
            (lastErr
              ? mapApiErrorMessage(lastErr, "chapter.save", STRINGS.editor.saveFailed)
              : STRINGS.editor.saveFailed),
        );
        // I2 (review 2026-04-24): terminal committed/unrecoverable
        // codes must also lock the editor — CLAUDE.md save-pipeline
        // invariant #2 pairs setEditable(false) with editorLockedMessage.
        // EditorPage subscribes via onRequestEditorLock so the
        // invariant-pair helper (applyReloadFailedLock) fires alongside
        // the banner. Bare 4xx (VALIDATION_ERROR, 413) are recoverable
        // and keep the editor writable.
        //
        // S1 (agentic-review 2026-05-26): the lock predicate is now
        // `terminal || possiblyCommitted`, both captured from the
        // MappedError at the in-loop break sites. The scope is the
        // single source of truth: chapter.save.terminalCodes lists
        // UPDATE_READ_FAILURE + CORRUPT_CONTENT (5xx terminal codes),
        // chapter.save.terminalStatuses lists 404 (covers both coded
        // NOT_FOUND and bare-status 404 from envelope-stripping proxies
        // per S3 review 2026-04-26), and chapter.save.committed flips
        // possiblyCommitted on 2xx BAD_JSON. Adding a fourth terminal
        // code or status is now genuinely a one-line scope edit — the
        // hand-coded list this branch used to carry (status === 404 ||
        // code === "BAD_JSON" || code === "UPDATE_READ_FAILURE" ||
        // code === "CORRUPT_CONTENT") is gone.
        if (
          terminalSaveError &&
          (terminalSaveError.terminal || terminalSaveError.possiblyCommitted)
        ) {
          onRequestEditorLockRef.current?.(terminalSaveError.message);
        }
      }
      return false;
    },
    [saveSeq, saveOp],
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

  // F-2 decomposition (2026-05-29): the chapter-CRUD and chapter-metadata
  // handlers now live in dedicated sub-hooks. useProjectEditor owns the save
  // pipeline, project/chapter state, the shared sync-on-render refs, the
  // confirmed-status cache, and loadProject; it threads those shared
  // primitives into the sub-hooks and re-exposes their handlers unchanged on
  // the public return object, so every consumer (EditorPage, useTrashManager,
  // tests) sees the identical surface.
  const {
    handleCreateChapter,
    handleSelectChapter,
    reloadActiveChapter,
    handleDeleteChapter,
    handleReorderChapters,
  } = useChapterCrud({
    setProject,
    setActiveChapter,
    setSaveStatus,
    setSaveErrorMessage,
    setCacheWarning,
    setChapterWordCount,
    setChapterReloadKey,
    setError,
    activeChapterRef,
    projectRef,
    projectSlugRef,
    confirmedStatusRef,
    onProjectNotFoundRef,
    cancelInFlightSave,
    replaceConfirmedStatusesFromProject,
  });

  const { handleUpdateProjectTitle, handleStatusChange, handleRenameChapter } = useChapterMetadata({
    setProject,
    setActiveChapter,
    setProjectTitleError,
    setError,
    activeChapterRef,
    projectRef,
    projectSlugRef,
    confirmedStatusRef,
    onRequestEditorLockRef,
  });

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
    // OOSS3 (round 3): see the memoized definition above.
    seedConfirmedStatus,
    // I4 (4b.3c.3): bulk reseed for the trash-restore committed-
    // recovery branch. After a 200 BAD_JSON / RESTORE_READ_FAILURE on
    // restore, the trash hook does a follow-up GET to repopulate
    // server-truth state; the entire chapter status table needs to be
    // replaced from that snapshot so a later PATCH on any chapter (not
    // just the restored row) can fall back to a real baseline. Shares
    // the internal helper used by loadProject and handleCreateChapter
    // recovery (S1 dedup, review 2026-05-27).
    replaceConfirmedStatusesFromProject,
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
