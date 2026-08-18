import { useReducer, useRef, useCallback, useMemo, type Dispatch } from "react";

/**
 * The editor's operational state. Owned by one machine (Phase 4b.5) so the
 * lock banner and the TipTap `editable` flag can never drift apart by hand.
 * See the design doc's Decided Q3 for why two transitions stay
 * synchronous-imperative in `useEditorMutation` rather than effect-driven.
 *
 * There is deliberately NO busy field here (F-08). Mutation-busy is owned by
 * `inFlightRef` in `useEditorMutation` — what `mutation.isBusy()` returns and
 * what every production gate reads. A reducer field cannot replace it: the
 * re-entrancy latch must be readable synchronously BEFORE the first await,
 * and reducer state is only visible after React commits. This machine once
 * carried a mirror of it that no consumer read and that the committed path
 * left stale; two same-named `isBusy()` probes on sibling objects is a
 * foot-gun, so the wrong one was removed rather than documented. If a
 * render-time busy indicator is ever wanted (a `disabled` prop rather than a
 * callback check), add the field back then — not before.
 */
export type EditorMutationState = {
  /**
   * Intent. Two routes into TipTap: a sync-effect in EditorPage pushes it into
   * a MOUNTED editor (re-enable), and `Editor`'s `editable` prop applies it at
   * construction so a mount under a lock comes up read-only (F-36).
   */
  editable: boolean;
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
      return { ...state, editable: false };
    case "MUTATION_SETTLED_OK":
      // Happy/flush/mutate terminal: re-enable ONLY when not locked, preserving
      // today's `!reloadFailed && !lockedByCaller` guard — a successful run
      // cannot re-enable typing under a persistent banner.
      return { ...state, editable: state.lock === null };

    // The next three arms produce the SAME state and that is deliberate — do
    // not merge them (F-08). They are three distinct facts about the world
    // ("a newer request superseded this one", "fresh server content is on
    // screen", "the editor remounted onto a different chapter"), dispatched
    // from four different sites, and a future field would have to re-split
    // them. Until `busy` was removed, that field was what told them apart.
    case "MUTATION_SETTLED_SUPERSEDED":
      // Benign supersession: clear a stale (prior-chapter) lock and re-enable,
      // mirroring today's reloadSuperseded bypass.
      return { editable: true, lock: null };
    case "RELOADED":
      // Fresh server content is on screen.
      return { editable: true, lock: null };
    case "EDITOR_REMOUNTED":
      // Chapter switch or post-reload remount: the prior lock no longer
      // applies. Since F-36 the mount inherits this `editable` through
      // `Editor`'s prop rather than defaulting to true, so returning
      // editable:true here is what makes the fresh editor writable. Mirrors
      // today's [activeChapter?.id, chapterReloadKey] clear-effect.
      return { editable: true, lock: null };

    case "COMMITTED_UNRELOADED":
      // Server committed, display unconfirmed: stay read-only, raise the banner.
      return { editable: false, lock: { message: event.message } };
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

export type UseEditorMutationMachineReturn = {
  state: EditorMutationState;
  dispatch: Dispatch<EditorMutationEvent>;
  /** Synchronous probe (render-mirrored ref). `lock !== null`. */
  isLocked: () => boolean;
};

export function useEditorMutationMachine(): UseEditorMutationMachineReturn {
  const [state, dispatch] = useReducer(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);

  // Mirror state to a ref DURING render (house style — matches
  // editorLockedMessageRef / useProjectEditor) so synchronous gates read the
  // current value without waiting for an effect commit.
  const stateRef = useRef(state);
  // eslint-disable-next-line react-hooks/refs
  stateRef.current = state;

  const isLocked = useCallback(() => stateRef.current.lock !== null, []);

  return useMemo(() => ({ state, dispatch, isLocked }), [state, isLocked]);
}
