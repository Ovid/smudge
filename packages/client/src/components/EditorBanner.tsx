import type { ReactNode } from "react";
import { STRINGS } from "../strings";

type BannerTone = "error" | "info";

// F-18: the editor's three banners (lock, action error, action info) shared one
// layout skeleton in three places — two of them byte-identical. This owns it.
//
// Tone drives the palette AND the live-region semantics together, deliberately:
// they are not independent axes. An error banner is an assertive role="alert";
// an info notice is a polite role="status". Letting a caller pass them
// separately is how a dismissible notice ends up announced as an alert. The
// dismiss control's accessible name is derived here for the same reason.
//
// Class strings are whole literals rather than assembled fragments so Tailwind's
// scanner still sees them.
const TONES = {
  error: {
    role: "alert",
    ariaLive: undefined,
    container: "bg-status-error/8 text-status-error border-status-error/15",
    dismissColor: "text-status-error",
    dismissLabel: STRINGS.a11y.dismissError,
  },
  info: {
    role: "status",
    ariaLive: "polite",
    container: "bg-accent/10 text-accent border-accent/20",
    dismissColor: "text-accent",
    dismissLabel: STRINGS.a11y.dismissInfo,
  },
} as const;

interface EditorBannerProps {
  tone: BannerTone;
  message: string;
  /** Renders the ✕ dismiss control. Omit for a banner the user cannot dismiss. */
  onDismiss?: () => void;
  /** A trailing control instead of a dismiss (the lock banner's Refresh). */
  children?: ReactNode;
}

export function EditorBanner({ tone, message, onDismiss, children }: EditorBannerProps) {
  const t = TONES[tone];
  return (
    <div
      role={t.role}
      aria-live={t.ariaLive}
      className={`px-6 py-2 text-sm flex items-center justify-between border-b ${t.container}`}
    >
      <span>{message}</span>
      {children}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className={`${t.dismissColor} hover:text-text-primary text-xs ml-4 focus:outline-none focus:ring-2 focus:ring-focus-ring rounded`}
          aria-label={t.dismissLabel}
        >
          ✕
        </button>
      )}
    </div>
  );
}
