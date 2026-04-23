import { api } from "../api/client";

export async function detectAndSetTimezone(): Promise<void> {
  // First-launch timezone detection is intentionally SILENT — the UI surfaces
  // nothing to avoid blocking app startup if the user is offline or the
  // settings endpoint is momentarily unavailable.
  try {
    const settings = await api.settings.get();
    if (!settings.timezone) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        await api.settings.update([{ key: "timezone", value: tz }]);
      } catch {
        // Silent — see comment above.
      }
    }
  } catch {
    // Silent — see comment above.
  }
}
