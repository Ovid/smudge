import { api } from "../api/client";

export async function detectAndSetTimezone(): Promise<void> {
  try {
    const settings = await api.settings.get();
    if (!settings.timezone) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api.settings.update([{ key: "timezone", value: tz }]);
    }
  } catch {
    // Best-effort — don't block app startup
  }
}
