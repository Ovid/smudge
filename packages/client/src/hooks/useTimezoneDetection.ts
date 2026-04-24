import { api } from "../api/client";

export async function detectAndSetTimezone(signal?: AbortSignal): Promise<void> {
  // First-launch timezone detection is intentionally SILENT — the UI surfaces
  // nothing to avoid blocking app startup if the user is offline or the
  // settings endpoint is momentarily unavailable.
  //
  // I5 (review 2026-04-24): accept a cancellation signal so an App
  // unmount (in tests and tab/window teardown during startup) can cut
  // the GET/PATCH short. The caller in App.tsx aborts the signal only
  // on unmount, so this does NOT close the theoretical race with a
  // user-initiated timezone save from ProjectSettingsDialog — a
  // second-reviewer correction to this comment's earlier claim. That
  // race remains open; the single-user threat model and the very
  // narrow timing window (detection completes in tens of ms on a warm
  // connection) make it low-risk, and wiring a shared abort across
  // App → EditorPage → ProjectSettingsDialog is deferred.
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
