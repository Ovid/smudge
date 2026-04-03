import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { STRINGS } from "../strings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [timezone, setTimezone] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          // happy-dom does not support showModal
        }
      }
      let cancelled = false;
      api.settings
        .get()
        .then((settings) => {
          if (!cancelled) setTimezone(settings.timezone || "UTC");
        })
        .catch(() => {
          if (!cancelled) setTimezone("UTC");
        });
      return () => {
        cancelled = true;
      };
    } else {
      try {
        dialog.close();
      } catch {
        // happy-dom does not support close
      }
    }
  }, [open]);

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    try {
      if (timezone) {
        await api.settings.update([{ key: "timezone", value: timezone }]);
      }
      setSaveError(null);
      onClose();
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSaveError(STRINGS.settings.saveError);
    }
  };

  const timezones = (() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  })();

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      open
      className="rounded-xl bg-bg-primary p-6 shadow-lg backdrop:bg-black/50 max-w-md w-full"
    >
      <h2 className="text-lg font-semibold text-text-primary mb-4 font-sans">
        {STRINGS.settings.heading}
      </h2>
      {timezone === null ? null : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <label
            className="block text-sm font-medium text-text-secondary mb-1 font-sans"
            htmlFor="settings-timezone"
          >
            {STRINGS.settings.timezoneLabel}
          </label>
          <select
            id="settings-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          {saveError && (
            <p className="mt-2 text-sm text-status-error" role="alert">
              {saveError}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-bg-secondary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              {STRINGS.settings.cancel}
            </button>
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              {STRINGS.settings.save}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
