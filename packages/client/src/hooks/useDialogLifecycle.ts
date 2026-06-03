import { useCallback, useEffect, useRef } from "react";

interface UseDialogLifecycleOptions {
  /** Whether the dialog should currently be shown. */
  open: boolean;
  /** Called when the dialog requests to close (Escape, backdrop). */
  onClose: () => void;
  /** Optional element to focus after showModal() on the open transition. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * When true, the Escape listener is registered in the capture phase and calls
   * stopImmediatePropagation() so other document-level keydown listeners (e.g.
   * the FindReplacePanel's) do not also fire. Used by ConfirmDialog.
   */
  blockEscapePropagation?: boolean;
}

interface DialogLifecycle {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onBackdropClick: (e: React.MouseEvent) => void;
}

/**
 * Single owner of native <dialog> lifecycle: show/close sync, focus-on-open,
 * Escape-to-close, and an opt-in backdrop-click handler. See
 * docs/plans/2026-06-03-dialog-lifecycle-hook-design.md.
 */
export function useDialogLifecycle({
  open,
  onClose,
  initialFocusRef,
  blockEscapePropagation = false,
}: UseDialogLifecycleOptions): DialogLifecycle {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevOpenRef = useRef(false);

  // Keep the latest onClose in a ref so the Escape effect does not re-subscribe
  // every render when the caller passes an inline closure. Mirror DURING render
  // (house style — matches useEditorMutationMachine's stateRef) so the keydown
  // handler reads the current callback without waiting for an effect commit.
  const onCloseRef = useRef(onClose);
  // eslint-disable-next-line react-hooks/refs
  onCloseRef.current = onClose;

  // Show/close sync + focus on the false->true transition.
  useEffect(() => {
    const dialog = dialogRef.current;
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!dialog) return;
    if (open && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Environments without full <dialog> support (jsdom test env).
      }
      if (!wasOpen) initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      try {
        dialog.close();
      } catch {
        // Environments without full <dialog> support (jsdom test env).
      }
    }
  }, [open, initialFocusRef]);

  // Escape-to-close. preventDefault() matches the existing ConfirmDialog/
  // ExportDialog implementations and suppresses default Escape side-effects; it
  // does NOT cancel the native dialog close — React drives the close.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (blockEscapePropagation) e.stopImmediatePropagation();
      onCloseRef.current();
    }
    document.addEventListener("keydown", handleKeyDown, blockEscapePropagation);
    return () => document.removeEventListener("keydown", handleKeyDown, blockEscapePropagation);
  }, [open, blockEscapePropagation]);

  const onBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCloseRef.current();
  }, []);

  return { dialogRef, onBackdropClick };
}
