import type { Knex } from "knex";
import type { SettingRow } from "./settings.types";

export async function listAll(trx: Knex.Transaction | Knex): Promise<SettingRow[]> {
  return trx("settings").select("key", "value");
}

export async function findByKey(
  trx: Knex.Transaction | Knex,
  key: string,
): Promise<SettingRow | undefined> {
  return trx("settings").where({ key }).first();
}

export async function upsert(
  trx: Knex.Transaction | Knex,
  key: string,
  value: string,
): Promise<void> {
  await trx.raw(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
