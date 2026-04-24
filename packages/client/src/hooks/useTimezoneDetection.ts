import { api } from "../api/client";

export async function detectAndSetTimezone(signal?: AbortSignal): Promise<void> {
  // First-launch timezone detection is intentionally SILENT — the UI surfaces
  // nothing to avoid blocking app startup if the user is offline or the
  // settings endpoint is momentarily unavailable.
  //
  // I5 (review 2026-04-24): accept a cancellation signal so an App-
  // unmount in tests (or a rapid user-initiated timezone PATCH from
  // ProjectSettingsDialog on first launch) can cut the GET/PATCH
  // short. Without this, a user who opens Settings during detection
  // and picks a real timezone can have the startup PATCH land AFTER
  // their choice and silently overwrite it.
  try {
    const settings = await api.settings.get(signal);
    if (signal?.aborted) return;
    if (!settings.timezone) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        await api.settings.update([{ key: "timezone", value: tz }], signal);
      } catch {
        // Silent — see comment above.
      }
    }
  } catch {
    // Silent — see comment above.
  }
}
