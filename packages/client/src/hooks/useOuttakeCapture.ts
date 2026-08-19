import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Chapter, OuttakeRow, ProjectWithChapters } from "@smudge/shared";
import { stripImageNodes, truncateUnits, LABEL_MAX_UNITS } from "@smudge/shared";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { api } from "../api/client";
import { mapApiError, applyMappedError } from "../errors";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { makeStaleProjectGuard } from "./staleProjectGuard";
import type { StaleProjectRef, StaleProjectSlugRef } from "./staleProjectGuard";
import { STRINGS } from "../strings";

// Outtake-capture seam of EditorPage (F-04, architecture report 2026-08-11):
// the toolbar's "copy the selection into the outtakes drawer" flow, extracted
// from the page body so it follows the same controller-hook shape as the
// snapshot and find-and-replace clusters instead of being the one feature that
// skipped it.
//
// This hook is deliberately named for the ONE flow it owns, not for outtakes
// generally. One outtake-shaped thing stays in EditorPage on purpose and is
// commented there:
//
//   * handleInsertOuttake — shares guardInsertAtCursor with handleInsertImage.
//     That pairing is a reviewed fix (I2/S3/S4, commit 714a9af3) for two insert
//     paths whose guard sets had drifted apart twice; splitting it here would
//     undo it.
//
// WHY THIS ONE NEEDS NO BUSY/LOCK DEPS, and why its sibling will. Capture never
// writes editor content — it reads state.selection and POSTs a copy — so
// save-pipeline invariants 1-4 do not apply and no mutation/editorMachine
// handle is threaded in. Verified rather than asserted: the extracted closure
// touches neither, and reaches toolbarEditor only through `.state`, never
// `.chain()`. Roadmap Phase 4c.2a ("cut selection to outtakes", destructive)
// is the opposite case — it removes text from the chapter, so it DOES touch
// the save-pipeline invariants and will need the busy/lock primitives EditorPage
// owns. Do not assume it can simply be added alongside this handler.
export interface OuttakeCaptureDeps {
  toolbarEditor: TipTapEditor | null;
  project: ProjectWithChapters | null;
  activeChapter: Chapter | null;
  projectRef: StaleProjectRef;
  projectSlugRef: StaleProjectSlugRef;
  // Both are read only to pick the success announcement's wording — the
  // capture itself does not care whether the drawer is showing.
  panelOpen: boolean;
  activeTabId: string;
  setActionError: Dispatch<SetStateAction<string | null>>;
  setActionInfo: Dispatch<SetStateAction<string | null>>;
}

// The outtake label schema rejects (does not truncate) above the label cap.
// The capture auto-label is machine-derived from a chapter title that is itself
// capped at the same length, so "From " + title can overshoot and
// deterministically 400 the POST. Truncate the title portion to fit, without
// leaving a dangling high surrogate.
//
// I4 (dedup review 2026-07-26): the cap is imported rather than re-typed. The
// old local copy said "keep in sync with CreateOuttakeSchema.label's post-pipe
// max" — a comment is not a mechanism, and this is precisely the number that
// must not drift, since lowering the schema's cap alone would make every
// outtake capture deterministically 400: the failure this helper exists to
// prevent.
function buildOuttakeLabel(title: string): string {
  const prefix = STRINGS.outtakes.fromChapterPrefix;
  const budget = LABEL_MAX_UNITS - prefix.length;
  return prefix + truncateUnits(title, budget);
}

export function useOuttakeCapture(deps: OuttakeCaptureDeps) {
  const {
    toolbarEditor,
    project,
    activeChapter,
    projectRef,
    projectSlugRef,
    panelOpen,
    activeTabId,
    setActionError,
    setActionInfo,
  } = deps;

  // Phase 4c.2 (Outtakes). The row the toolbar capture just POSTed. The panel
  // prepends it optimistically (I1) rather than reloading — a reload could be
  // staled by a concurrent card delete/rename, silently dropping the capture.
  const [capturedOuttake, setCapturedOuttake] = useState<OuttakeRow | null>(null);
  // S1: a 2xx BAD_JSON capture leaves no row to hand the panel, but the server
  // most likely committed it. Bumping this is the only way an open panel learns
  // to refetch — and without it a re-capture mints a duplicate of a row the
  // writer cannot see.
  const [outtakesExternalRefreshKey, setOuttakesExternalRefreshKey] = useState(0);

  // Dedicated abortable op for the capture POST — never reuse a content-
  // mutation op (this flow touches no editor content).
  const captureOp = useAbortableAsyncOperation();
  // I4: re-entrancy latch. It was introduced mirroring the panel's own
  // `creating` flag; that flag went with the blank-note compose form
  // (2026-08-18), so this is now the ONLY re-entrancy latch on the ONLY producer
  // of outtakes. Letting a second click run captureOp.run() again would abort
  // the first POST's controller — but that POST may already have reached the
  // server, leaving a committed row that never reaches setCapturedOuttake and
  // (since the prepend is now the only thing that surfaces a capture) never
  // appears at all.
  // Aborting a POST that may have committed is the wrong cancellation
  // semantic; abort-on-unmount still comes free from the hook. Note this is NOT
  // covered by the F-8 duplicate-upload trade-off, whose premise is that the
  // only retry path is manual.
  const captureInFlightRef = useRef(false);

  // Send the current selection to outtakes (non-destructive copy). Reads the
  // selection, strips images, POSTs a new outtake, then hands the created row
  // to the panel to prepend (S14: the refresh nonce this comment used to
  // describe was replaced by that prepend mid-implementation; the nonce that
  // remains — outtakesExternalRefreshKey — fires only on the possibly-committed
  // failure arm). It never writes editor content, so save-pipeline invariants
  // 1-4 do NOT apply and NO busy/lock guard is needed. It is not unguarded,
  // though: a re-entrancy latch (captureInFlightRef), a collapsed-caret refusal
  // and an image-only refusal all gate it — see the surface test's annotation.
  // A toolbar click is safe on a blurred editor because ProseMirror keeps
  // state.selection.
  const handleSendSelectionToOuttakes = useCallback(async () => {
    if (!toolbarEditor || !project) return;
    if (captureInFlightRef.current) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    const { from, to } = toolbarEditor.state.selection;
    // I5: the toolbar button is always enabled, so a collapsed caret is the
    // everyday way to reach this — a silent no-op reads as a broken button.
    if (from === to) {
      setActionInfo(STRINGS.outtakes.selectionRequired);
      return;
    }
    // I2 (agentic-review 2026-08-04): selection.content(), NOT doc.slice(from,
    // to). The latter defaults includeParents = false and cuts at
    // $from.sharedDepth(to), so a selection inside ONE paragraph — the feature's
    // most natural gesture — captured the paragraph's INLINE content and
    // persisted {type:"doc",content:[{type:"text",…}]}, which fails the doc
    // node's `block+` expression. Nothing downstream rejected it (TipTapDocSchema
    // types content as z.array(z.record()), the JSON walkers tolerate it,
    // insertContent accepts an inline fragment) so the rows just accumulated in a
    // HARD-delete table. Pinned against a real schema in outtakeCaptureSlice.test.ts.
    const slice = toolbarEditor.state.selection.content();
    const content = stripImageNodes({ type: "doc", content: slice.content.toJSON() ?? [] });
    // An image-only selection strips to an empty doc — POSTing it would create a
    // blank outtake card. from !== to passed the guard above, so the user DID
    // select something; say what happened to it rather than no-op silently (I5).
    if (!Array.isArray(content.content) || content.content.length === 0) {
      setActionInfo(STRINGS.outtakes.selectionHasNoText);
      return;
    }
    const label = buildOuttakeLabel(activeChapter?.title ?? "");
    // I1 (review 2026-07-26): captureOp aborts on unmount and on a newer
    // capture — never on project navigation, and EditorPage stays mounted
    // across /projects/:slug changes. Without this, an A→B switch mid-POST
    // paints project A's failure banner over project B (nothing clears
    // actionError on project change) and hands A's row to a panel showing B.
    // Built at entry, before the await, exactly as the nine sibling sites do.
    const isStaleProject = makeStaleProjectGuard(projectRef, projectSlugRef);
    captureInFlightRef.current = true;
    const { promise, signal } = captureOp.run((s) =>
      api.outtakes.create(project.id, { content, label }, s),
    );
    try {
      const row = await promise;
      if (signal.aborted || isStaleProject()) return;
      // Hand the created row to the panel to prepend (I1). A new object
      // identity each time drives the panel's prepend effect. The panel
      // independently refuses a row whose project_id is not its own — belt and
      // braces, since this guard cannot see the pre-load window's far side.
      setCapturedOuttake(row);
      // S3: the prepend is the only feedback a capture produces, and its sole
      // consumer is the panel — which is closed by default, and whose toolbar
      // button lives outside it. Announce into the live region the four refusal
      // arms above already use, so the success case is not the silent one.
      setActionInfo(
        panelOpen && activeTabId === "outtakes"
          ? STRINGS.outtakes.captured
          : STRINGS.outtakes.capturedHidden,
      );
    } catch (err) {
      if (signal.aborted || isStaleProject()) return;
      applyMappedError(mapApiError(err, "outtake.create"), {
        // S1: no STOP — the ambiguity copy still belongs on the banner. The
        // refetch is what makes a committed-but-unreturned row visible, exactly
        // as notePossiblyCommitted does for the three write paths the panel
        // owns itself.
        onCommitted: () => setOuttakesExternalRefreshKey((k) => k + 1),
        onMessage: setActionError,
      });
    } finally {
      captureInFlightRef.current = false;
    }
  }, [
    toolbarEditor,
    project,
    activeChapter,
    captureOp,
    setActionError,
    setActionInfo,
    projectRef,
    projectSlugRef,
    panelOpen,
    activeTabId,
  ]);

  return { capturedOuttake, outtakesExternalRefreshKey, handleSendSelectionToOuttakes };
}
