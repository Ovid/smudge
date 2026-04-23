import { api } from "../api/client";
import { mapApiError } from "../errors";

export async function detectAndSetTimezone(): Promise<void> {
  // Two failure modes, both routed through the unified mapper for scope
  // parity (`settings.get` and `settings.update`). First-launch timezone
  // detection is intentionally SILENT — the UI surfaces nothing to avoid
  // blocking app startup if the user is offline or the settings endpoint
  // is momentarily unavailable. `mapApiError` is still invoked so the
  // scope resolution path is exercised (and future byCode/byStatus
  // overrides will flow naturally); the message is deliberately discarded.
  try {
    const settings = await api.settings.get();
    if (!settings.timezone) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        await api.settings.update([{ key: "timezone", value: tz }]);
      } catch (err) {
        mapApiError(err, "settings.update");
        // Silent — see comment above.
      }
    }
  } catch (err) {
    mapApiError(err, "settings.get");
    // Silent — see comment above.
  }
}
