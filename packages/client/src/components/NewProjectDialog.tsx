import { useEffect, useRef, useState } from "react";
import type { ProjectMode } from "@smudge/shared";
import { STRINGS } from "../strings";

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, mode: ProjectMode) => void;
}

export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<ProjectMode>("fiction");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim()) {
      onCreate(title.trim(), mode);
      setTitle("");
      setMode("fiction");
    }
  }

  function handleCancel() {
    setTitle("");
    setMode("fiction");
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-lg border border-border bg-bg-primary p-6 shadow-lg backdrop:bg-black/40 max-w-md w-full"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-text-primary">
          {STRINGS.project.createNew}
        </h2>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">{STRINGS.project.titlePlaceholder}</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
            className="rounded border border-border bg-bg-input px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm text-text-secondary">{STRINGS.project.modeLabel}</legend>
          <div className="flex gap-4 mt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value="fiction"
                checked={mode === "fiction"}
                onChange={() => setMode("fiction")}
                className="accent-accent"
              />
              <span className="text-text-primary">{STRINGS.project.fiction}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value="nonfiction"
                checked={mode === "nonfiction"}
                onChange={() => setMode("nonfiction")}
                className="accent-accent"
              />
              <span className="text-text-primary">{STRINGS.project.nonfiction}</span>
            </label>
          </div>
        </fieldset>

        <div className="flex justify-end gap-3 mt-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded px-4 py-2 text-text-secondary hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {STRINGS.project.cancelButton}
          </button>
          <button
            type="submit"
            className="rounded bg-accent px-4 py-2 text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {STRINGS.project.createButton}
          </button>
        </div>
      </form>
    </dialog>
  );
}
