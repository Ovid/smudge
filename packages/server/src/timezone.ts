export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(tz: string): string {
  return isValidTimezone(tz) ? tz : "UTC";
}
