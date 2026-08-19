import type { ReactElement } from "react";
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

// S5 (review 2026-08-19): exactly one of `onDismiss` / `children` is required.
// The deleted ActionErrorBanner declared its `onDismiss` REQUIRED, so an action
// error the user could not clear did not compile. Consolidation made the prop
// optional and put the lock banner — which legitimately omits it, supplying a
// Refresh control as children instead — two lines above the action-error call
// site in an identical shape, so dropping it there became a plausible
// mechanical edit that would leave a role="alert" with no control at all.
// The union restores the compile-time floor without outlawing the lock banner.
type EditorBannerProps = {
  tone: BannerTone;
  message: string;
} & (
  | {
      /** Renders the ✕ dismiss control. */
      onDismiss: () => void;
      children?: never;
    }
  | {
      onDismiss?: never;
      /**
       * A trailing control instead of a dismiss (the lock banner's Refresh).
       *
       * `ReactElement`, not `ReactNode` (S1, review round 3, 2026-08-19):
       * `ReactNode` admits `null` / `undefined` / `false`, so the union enforced
       * only that the PROP was passed — `{cond && <button/>}` type-checks and
       * renders an assertive `role="alert"` with no control at all whenever
       * `cond` is false, which is the state this union exists to outlaw. A
       * genuinely conditional banner should be conditional at the `<EditorBanner>`
       * element, not inside its children.
       */
      children: ReactElement;
    }
);

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
