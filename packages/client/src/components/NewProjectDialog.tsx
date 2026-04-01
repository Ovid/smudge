import { useEffect, useRef, useState } from "react";
import type { ProjectModeType as ProjectMode } from "@smudge/shared";
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
      className="rounded-xl border border-border/60 bg-bg-primary p-8 shadow-xl backdrop:bg-black/30 max-w-md w-full"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold text-text-primary">{STRINGS.project.createNew}</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-text-secondary">{STRINGS.project.titlePlaceholder}</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
            className="rounded-lg border border-border bg-bg-input px-4 py-2.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-transparent"
          />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm text-text-secondary">{STRINGS.project.modeLabel}</legend>
          <div className="flex gap-6 mt-1">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value="fiction"
                checked={mode === "fiction"}
                onChange={() => setMode("fiction")}
                className="accent-accent"
              />
              <span className="text-text-primary text-sm">{STRINGS.project.fiction}</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value="nonfiction"
                checked={mode === "nonfiction"}
                onChange={() => setMode("nonfiction")}
                className="accent-accent"
              />
              <span className="text-text-primary text-sm">{STRINGS.project.nonfiction}</span>
            </label>
          </div>
        </fieldset>

        <div className="flex justify-end gap-3 mt-3">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg px-5 py-2.5 text-sm text-text-secondary hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {STRINGS.project.cancelButton}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm"
          >
            {STRINGS.project.createButton}
          </button>
        </div>
      </form>
    </dialog>
  );
}
