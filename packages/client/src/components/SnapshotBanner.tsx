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
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canRestore}
            aria-disabled={!canRestore}
            title={canRestore ? undefined : S.restoreUnavailableWhileLocked}
            className="text-sm font-medium text-accent hover:text-accent-hover rounded px-3 py-1 border border-accent/40 hover:bg-accent/10 transition-colors font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-accent"
          >
            {S.restoreButton}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-3 py-1"
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
