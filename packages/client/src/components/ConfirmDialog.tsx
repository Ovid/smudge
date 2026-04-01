import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-label={title}
      aria-describedby="confirm-dialog-body"
      className="fixed inset-0 z-50 flex items-center justify-center bg-transparent m-0 p-0 w-full h-full border-none backdrop:bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="rounded-xl bg-bg-primary p-8 shadow-xl max-w-sm w-full mx-auto mt-[20vh] border border-border/60">
        <p className="text-text-primary font-serif font-semibold text-lg mb-2">{title}</p>
        <p id="confirm-dialog-body" className="text-text-secondary text-sm mb-6 leading-relaxed">
          {body}
        </p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-lg px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-status-error px-5 py-2.5 text-sm font-medium text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
