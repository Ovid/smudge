import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import * as SettingsRepo from "../settings/settings.repository";

const t = setupTestDb();

describe("settings repository", () => {
  it("listAll() returns empty array initially", async () => {
    const settings = await SettingsRepo.listAll(t.db);
    expect(settings).toEqual([]);
  });

  it("upsert() inserts a new setting", async () => {
    await SettingsRepo.upsert(t.db, "theme", "dark");
    const row = await SettingsRepo.findByKey(t.db, "theme");
    expect(row).toBeDefined();
    expect(row!.key).toBe("theme");
    expect(row!.value).toBe("dark");
  });

  it("upsert() updates an existing setting", async () => {
    await SettingsRepo.upsert(t.db, "theme", "dark");
    await SettingsRepo.upsert(t.db, "theme", "light");
    const row = await SettingsRepo.findByKey(t.db, "theme");
    expect(row!.value).toBe("light");
  });

  it("upsert() handles multiple keys independently", async () => {
    await SettingsRepo.upsert(t.db, "key1", "val1");
    await SettingsRepo.upsert(t.db, "key2", "val2");
    const all = await SettingsRepo.listAll(t.db);
    expect(all).toHaveLength(2);
  });

  it("findByKey() returns undefined for missing key", async () => {
    const row = await SettingsRepo.findByKey(t.db, "nonexistent");
    expect(row).toBeUndefined();
  });

  it("findByKey() returns the correct row", async () => {
    await SettingsRepo.upsert(t.db, "font_size", "16");
    const row = await SettingsRepo.findByKey(t.db, "font_size");
    expect(row).toEqual({ key: "font_size", value: "16" });
  });

  it("listAll() returns all inserted settings", async () => {
    await SettingsRepo.upsert(t.db, "a", "1");
    await SettingsRepo.upsert(t.db, "b", "2");
    await SettingsRepo.upsert(t.db, "c", "3");
    const all = await SettingsRepo.listAll(t.db);
    expect(all).toHaveLength(3);
    const keys = all.map((r) => r.key).sort();
    expect(keys).toEqual(["a", "b", "c"]);
  });
});
