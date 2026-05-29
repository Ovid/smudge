
/**
 * The editor's operational state. Owned by one machine (Phase 4b.5) so the
 * lock banner, the TipTap `editable` flag, and mutation-busy can never drift
 * apart by hand. See the design doc's Decided Q3 for why two transitions stay
 * synchronous-imperative in `useEditorMutation` rather than effect-driven.
 */
export type EditorMutationState = {
  /** Intent; a sync-effect in EditorPage pushes this into TipTap (re-enable). */
  editable: boolean;
  /** Mutation-busy (canonical/testable). The synchronous re-entrancy latch is
   * a retained `inFlightRef` in useEditorMutation, kept in lockstep with this. */
  busy: boolean;
  /** Persistent read-only lock banner; null = unlocked. */
  lock: { message: string } | null;
};

export type EditorMutationEvent =
  | { type: "MUTATION_STARTED" }
  | { type: "MUTATION_SETTLED_OK" }
  | { type: "MUTATION_SETTLED_SUPERSEDED" }
  | { type: "RELOADED" }
  | { type: "COMMITTED_UNRELOADED"; message: string }
  | { type: "EDITOR_REMOUNTED" }
  | { type: "UNLOCK" };

export const INITIAL_EDITOR_MUTATION_STATE: EditorMutationState = {
  editable: true,
  busy: false,
  lock: null,
};

export function editorMutationReducer(
  state: EditorMutationState,
  event: EditorMutationEvent,
): EditorMutationState {
  switch (event.type) {
    case "MUTATION_STARTED":
      // Lock-down intent. The hook also calls safeSetEditable(false)
      // synchronously (Decided Q3) so input is blocked before the first await.
      return { ...state, busy: true, editable: false };
    case "MUTATION_SETTLED_OK":
      // Happy/flush/mutate terminal: re-enable ONLY when not locked, preserving
      // today's `!reloadFailed && !lockedByCaller` guard — a successful run
      // cannot re-enable typing under a persistent banner.
      return { ...state, busy: false, editable: state.lock === null };
    case "MUTATION_SETTLED_SUPERSEDED":
      // Benign supersession: clear a stale (prior-chapter) lock and re-enable,
      // mirroring today's reloadSuperseded bypass.
      return { editable: true, busy: false, lock: null };
    case "RELOADED":
      // Fresh server content is on screen.
      return { editable: true, busy: false, lock: null };
    case "COMMITTED_UNRELOADED":
      // Server committed, display unconfirmed: stay read-only, raise the banner.
      return { editable: false, busy: false, lock: { message: event.message } };
    case "EDITOR_REMOUNTED":
      // Chapter switch or post-reload remount: the prior lock no longer applies
      // and TipTap mounts editable=true. Busy is untouched (a mutation may be
      // mid-flight across the remount). Mirrors today's
      // [activeChapter?.id, chapterReloadKey] clear-effect.
      return { ...state, editable: true, lock: null };
    case "UNLOCK":
      // Reserved: no production dispatcher today (the lock banner is
      // non-dismissible; only EDITOR_REMOUNTED clears it in production). Kept
      // for a future dismissible-lock path and exercised by the reducer unit
      // test so the machine vocabulary stays complete without a coverage gap.
      return { ...state, lock: null };
    default: {
      const _exhaustive: never = event;
      return state;
    }
  }
}
