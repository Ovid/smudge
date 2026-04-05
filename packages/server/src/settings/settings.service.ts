import { getDb } from "../db/connection";
import * as SettingsRepo from "./settings.repository";
import { isValidTimezone } from "../timezone";

const SETTING_VALIDATORS: Record<string, (value: string) => boolean> = {
  timezone: isValidTimezone,
};

export async function getAll(): Promise<Record<string, string>> {
  const db = getDb();
  const rows = await SettingsRepo.listAll(db);
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

  const db = getDb();
  await db.transaction(async (trx) => {
    for (const { key, value } of settings) {
      await SettingsRepo.upsert(trx, key, value);
    }
  });

  return null;
}
