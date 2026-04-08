export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(tz: string): string {
  if (isValidTimezone(tz)) return tz;
  console.warn(`Invalid timezone "${tz}", falling back to UTC`);
  return "UTC";
}
