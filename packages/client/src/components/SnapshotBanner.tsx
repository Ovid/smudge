import { useState } from "react";
import { STRINGS } from "../strings";
import { ConfirmDialog } from "./ConfirmDialog";

interface SnapshotBannerProps {
  label: string | null;
  date: string;
  onRestore: () => void;
  onBack: () => void;
  // When false, the Restore button is disabled (but still visible so the
  // user sees which snapshot they were looking at). Gated on the editor-
  // lock banner in EditorPage: if a prior restore's 2xx-BAD_JSON /
  // unknown-outcome already raised the "refresh the page" lock, a second
  // click would re-enter restoreSnapshot and almost certainly issue a
  // double-restore against a snapshot the server already committed (C1).
  canRestore?: boolean;
  // S3: When false, the Back-to-editing button is disabled. Mirrors
  // canRestore: when the lock banner is up (possibly-committed restore),
  // clicking Back would drop into a locked editor still showing pre-
  // restore content while the banner warns that "typing would overwrite."
  // Keeping the snapshot view up until the user refreshes preserves the
  // unambiguous "refresh the page" path.
  canBack?: boolean;
}

const S = STRINGS.snapshots;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SnapshotBanner({
  label,
  date,
  onRestore,
  onBack,
  canRestore = true,
  canBack = true,
}: SnapshotBannerProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const displayLabel = label ?? S.untitled;
  const displayDate = formatDate(date);

  return (
    <>
      {/*
        role="region" on the outer container; the live-region role moves
        onto the <p> so screen readers announce only the banner text on
        update — not the restore/back buttons that live alongside it.
      */}
      <div
        role="region"
        aria-label={S.viewingRegionLabel}
        className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between"
      >
        <p role="status" className="text-sm text-amber-900 font-sans">
          {S.viewingBanner(displayLabel, displayDate)}
        </p>
        <div className="flex items-center gap-3">
          {/*
            When disabled, the title attribute is unreliable: most browsers
            suppress tooltips on `disabled` elements and most assistive
            technologies do not announce title text. Instead, expose the
            reason via aria-describedby pointing at a visible inline hint
            next to the button so sighted users see why the action is
            unavailable, AND use aria-disabled (NOT the native `disabled`
            attribute) so the button remains focusable and screen
            readers reach the description. Native `disabled` removes the
            button from the tab order on most browsers, which prevents
            assistive tech from ever hearing the aria-describedby target.
            The editor-locked banner above already explains the global
            state, but the local hint removes any ambiguity at the point
            of action.
          */}
          {!canRestore && (
            <span
              id="snapshot-restore-disabled-reason"
              className="text-xs text-amber-800 font-sans"
            >
              {S.restoreUnavailableWhileLocked}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              // Guard clicks while aria-disabled — the `disabled` attribute
              // was removed to keep the button focusable for screen
              // readers, so pointer-events still reach onClick.
              if (!canRestore) return;
              setConfirmOpen(true);
            }}
            aria-disabled={!canRestore}
            aria-describedby={canRestore ? undefined : "snapshot-restore-disabled-reason"}
            className={`text-sm font-medium text-accent hover:text-accent-hover rounded px-3 py-1 border border-accent/40 hover:bg-accent/10 transition-colors font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring${
              !canRestore
                ? " opacity-50 cursor-not-allowed hover:bg-transparent hover:text-accent"
                : ""
            }`}
          >
            {S.restoreButton}
          </button>
          <button
            type="button"
            onClick={() => {
              // S3: aria-disabled leaves pointer events intact; gate clicks
              // here. Same discipline as the Restore button above.
              if (!canBack) return;
              onBack();
            }}
            aria-disabled={!canBack}
            aria-describedby={canBack ? undefined : "snapshot-restore-disabled-reason"}
            className={`text-sm text-text-secondary hover:text-text-primary transition-colors font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-3 py-1${
              !canBack
                ? " opacity-50 cursor-not-allowed hover:bg-transparent hover:text-text-secondary"
                : ""
            }`}
          >
            {S.backToEditing}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title={S.restoreButton}
          body={S.restoreConfirm}
          confirmLabel={S.restoreButton}
          cancelLabel={STRINGS.delete.cancelButton}
          onConfirm={() => {
            setConfirmOpen(false);
            // Explicit void: the prop is typed () => void but callers
            // pass async handlers whose rejections are handled inside
            // their own try/finally. Keeping the discard explicit
            // documents the fire-and-forget intent and signals to
            // linters/reviewers that we haven't accidentally dropped
            // an unhandled rejection.
            void onRestore();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
