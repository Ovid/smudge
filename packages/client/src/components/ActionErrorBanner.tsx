import { STRINGS } from "../strings";

interface ActionErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

export function ActionErrorBanner({ error, onDismiss }: ActionErrorBannerProps) {
  return (
    <div
      role="alert"
      className="px-6 py-2 bg-status-error/8 text-status-error text-sm flex items-center justify-between border-b border-status-error/15"
    >
      <span>{error}</span>
      <button
        onClick={onDismiss}
        className="text-status-error hover:text-text-primary text-xs ml-4 focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
        aria-label={STRINGS.a11y.dismissError}
      >
        ✕
      </button>
    </div>
  );
}
