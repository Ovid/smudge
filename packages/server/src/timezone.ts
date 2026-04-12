/** en-CA locale produces YYYY-MM-DD format by default, useful for timezone validation */
const VALIDATION_LOCALE = "en-CA";

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(VALIDATION_LOCALE, { timeZone: tz });
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
