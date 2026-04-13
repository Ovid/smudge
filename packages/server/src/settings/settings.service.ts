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
  const errors: Record<string, string> = {};
  for (const { key, value } of settings) {
    const validator = SETTING_VALIDATORS[key];
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
