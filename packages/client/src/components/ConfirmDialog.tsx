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
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
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
      open
      aria-label={title}
      aria-describedby="confirm-dialog-body"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 m-0 p-0 w-full h-full border-none bg-transparent"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="rounded bg-bg-primary p-6 shadow-lg max-w-sm w-full mx-auto mt-[20vh]">
        <p className="text-text-primary font-medium mb-2">{title}</p>
        <p id="confirm-dialog-body" className="text-text-secondary text-sm mb-4">
          {body}
        </p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded px-4 py-2 text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-status-error px-4 py-2 text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
