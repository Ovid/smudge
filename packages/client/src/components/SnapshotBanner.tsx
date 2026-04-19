import { useState } from "react";
import { STRINGS } from "../strings";
import { ConfirmDialog } from "./ConfirmDialog";

interface SnapshotBannerProps {
  label: string | null;
  date: string;
  onRestore: () => void;
  onBack: () => void;
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

export function SnapshotBanner({ label, date, onRestore, onBack }: SnapshotBannerProps) {
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
            className="text-sm font-medium text-accent hover:text-accent-hover rounded px-3 py-1 border border-accent/40 hover:bg-accent/10 transition-colors font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
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
            onRestore();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
