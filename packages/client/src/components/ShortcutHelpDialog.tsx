import { useEffect, useRef } from "react";
import { STRINGS } from "../strings";

interface ShortcutHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={STRINGS.shortcuts.dialogTitle}
      className="z-50 rounded-xl bg-bg-primary p-8 shadow-xl max-w-sm w-full border border-border/60 backdrop:bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClose={onClose}
    >
      <h3 className="text-lg font-semibold text-text-primary mb-5">
        {STRINGS.shortcuts.dialogTitle}
      </h3>
      <dl className="flex flex-col gap-2.5 text-sm">
        <div className="flex justify-between items-center">
          <dt className="text-text-secondary">{STRINGS.shortcuts.togglePreview}</dt>
          <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
            {STRINGS.shortcuts.keyTogglePreview}
          </dd>
        </div>
        <div className="flex justify-between items-center">
          <dt className="text-text-secondary">{STRINGS.shortcuts.newChapter}</dt>
          <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
            {STRINGS.shortcuts.keyNewChapter}
          </dd>
        </div>
        <div className="flex justify-between items-center">
          <dt className="text-text-secondary">{STRINGS.shortcuts.toggleSidebar}</dt>
          <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
            {STRINGS.shortcuts.keyToggleSidebar}
          </dd>
        </div>
        <div className="flex justify-between items-center">
          <dt className="text-text-secondary">{STRINGS.shortcuts.prevChapter}</dt>
          <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
            {STRINGS.shortcuts.keyPrevChapter}
          </dd>
        </div>
        <div className="flex justify-between items-center">
          <dt className="text-text-secondary">{STRINGS.shortcuts.nextChapter}</dt>
          <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
            {STRINGS.shortcuts.keyNextChapter}
          </dd>
        </div>
        <div className="flex justify-between items-center">
          <dt className="text-text-secondary">{STRINGS.shortcuts.announceWordCount}</dt>
          <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
            {STRINGS.shortcuts.keyAnnounceWordCount}
          </dd>
        </div>
        <div className="flex justify-between items-center">
          <dt className="text-text-secondary">{STRINGS.shortcuts.showShortcuts}</dt>
          <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
            {STRINGS.shortcuts.keyShowShortcuts}
          </dd>
        </div>
      </dl>
    </dialog>
  );
}
