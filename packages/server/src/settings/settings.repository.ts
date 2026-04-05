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
  const existing = await trx("settings").where({ key }).first();
  if (existing) {
    await trx("settings").where({ key }).update({ value });
  } else {
    await trx("settings").insert({ key, value });
  }
}
