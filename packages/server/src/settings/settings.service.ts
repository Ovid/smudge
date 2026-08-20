import { getProjectStore } from "../stores/project-store.injectable";
import { isValidTimezone } from "../timezone";

const SETTING_VALIDATORS: Record<string, (value: string) => boolean> = {
  timezone: isValidTimezone,
};

export async function getAll(): Promise<Record<string, string>> {
  const store = getProjectStore();
  const rows = await store.listSettings();
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function update(
  settings: Array<{ key: string; value: string }>,
): Promise<{ errors: Record<string, string> } | null> {
  // Null-prototype: `key` comes straight off the request body, and
  // `errors["__proto__"] = msg` on a plain object literal is a SILENT no-op —
  // the rejection would vanish and the request would fall through to the
  // upsert below with 204 (OOSS1).
  const errors: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const { key, value } of settings) {
    // Own-property check for the same reason apiErrorMapper.ts:120-132 uses
    // one on `err.code`: `key` is client-supplied and constrained only to a
    // non-empty string, so a bare index walks Object.prototype. "toString"
    // and "constructor" resolved to inherited functions truthy enough to
    // pass both checks and COMMIT a junk row at 204; "hasOwnProperty",
    // "valueOf" and "isPrototypeOf" threw a TypeError the global handler
    // clamped to 500 for a well-formed client body (OOSS1).
    const validator = Object.hasOwn(SETTING_VALIDATORS, key) ? SETTING_VALIDATORS[key] : undefined;
    if (!validator) {
      errors[key] = `Unknown setting: ${key}`;
    } else if (!validator(value)) {
      errors[key] = `Invalid value for ${key}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const store = getProjectStore();
  await store.transaction(async (txStore) => {
    for (const { key, value } of settings) {
      await txStore.upsertSetting(key, value);
    }
  });

  return null;
}
