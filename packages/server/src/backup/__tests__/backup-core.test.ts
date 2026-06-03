import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { isoStampLocal, buildBackupName, runBackup, ZipSlipError, validateEntryPaths, readCentralDirectorySizes, checkDeclaredSizes, DecompressionBombError, DEFAULT_BOMB_LIMITS } from "../backup-core";

describe("isoStampLocal", () => {
  it("formats local time as YYYY-MM-DD-HHmmss with hyphens only", () => {
    const d = new Date(2026, 4, 26, 14, 32, 11); // local 2026-05-26 14:32:11
    expect(isoStampLocal(d)).toBe("2026-05-26-143211");
  });
});

describe("buildBackupName", () => {
  it("uses smudge- for manual and smudge-auto- for auto", () => {
    expect(buildBackupName("2026-05-26-143211", "manual")).toBe("smudge-2026-05-26-143211.zip");
    expect(buildBackupName("2026-05-26-143211", "auto")).toBe("smudge-auto-2026-05-26-143211.zip");
  });
});

async function makeFixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "smudge-bk-"));
  const dbPath = join(dataDir, "smudge.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
  db.close();
  await mkdir(join(dataDir, "images", "proj-1"), { recursive: true });
  await writeFile(join(dataDir, "images", "proj-1", "a.png"), Buffer.from([1, 2, 3]));
  return { dataDir, dbPath };
}

it("runBackup writes a zip with smudge.db + nested images/", async () => {
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  const { outFile } = await runBackup({
    dataDir, dbPath, backupsDir, mode: "manual",
    now: () => new Date(2026, 4, 26, 14, 32, 11),
  });
  expect(outFile).toBe(join(backupsDir, "smudge-2026-05-26-143211.zip"));

  const zip = await JSZip.loadAsync(await readFile(outFile));
  expect(zip.file("smudge.db")).toBeTruthy();
  expect(zip.file("images/proj-1/a.png")).toBeTruthy();
  // DB snapshot is a valid SQLite file with the row intact
  const dbBytes = await zip.file("smudge.db")!.async("nodebuffer");
  const tmp = join(dataDir, "roundtrip.db");
  await writeFile(tmp, dbBytes);
  const db = new Database(tmp, { readonly: true });
  expect(db.prepare("SELECT v FROM t").get()).toEqual({ v: "hello" });
  db.close();
  // staging file is cleaned up
  expect((await readdir(dataDir)).some((f) => f.endsWith(".backup-staging.db"))).toBe(false);

  await rm(dataDir, { recursive: true, force: true });
});

describe("validateEntryPaths", () => {
  const root = "/tmp/target";
  it("accepts in-tree entries", () => {
    expect(() => validateEntryPaths(["smudge.db", "images/p/a.png"], root)).not.toThrow();
  });
  it.each([
    ["../../etc/passwd"],
    ["/etc/passwd"],
    ["a/../../etc/passwd"],
    ["images/../../escape"],
    ["foo bar"],
  ])("rejects %s and names it", (bad) => {
    expect(() => validateEntryPaths([bad], root)).toThrow(ZipSlipError);
    try { validateEntryPaths([bad], root); } catch (e) { expect((e as Error).message).toContain(bad); }
  });

  it("rejects a null-byte entry and mentions 'null byte' in the message", () => {
    const bad = "images/p/a\0.png";
    expect(() => validateEntryPaths([bad], root)).toThrow(ZipSlipError);
    try { validateEntryPaths([bad], root); } catch (e) {
      expect((e as Error).message).toContain("null byte");
    }
  });

  it.each([
    ["C:/Windows/system32/evil"],
    ["C:relative"],
  ])("rejects Windows/drive-absolute entry %s", (bad) => {
    expect(() => validateEntryPaths([bad], root)).toThrow(ZipSlipError);
  });

  it("rejects a sibling directory that shares the root name prefix", () => {
    // "../target-evil/smudge.db" resolves to /tmp/target-evil/smudge.db —
    // a sibling that must not be accepted even though it starts with "/tmp/target".
    // This also documents that the '..' guard catches it (belt-and-suspenders).
    const bad = "../target-evil/smudge.db";
    expect(() => validateEntryPaths([bad], root)).toThrow(ZipSlipError);
  });
});

it("readCentralDirectorySizes returns each entry's declared uncompressed size", async () => {
  const zip = new JSZip();
  zip.file("a.txt", "x".repeat(1000));
  zip.file("b.txt", "y".repeat(2000));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const sizes = readCentralDirectorySizes(buf);
  const total = sizes.reduce((n, e) => n + e.uncompressedSize, 0);
  expect(total).toBe(3000);
});

describe("checkDeclaredSizes", () => {
  it("refuses when total exceeds maxUncompressed", () => {
    expect(() =>
      checkDeclaredSizes([{ uncompressedSize: 10 }], 1, { maxUncompressed: 5, maxRatio: 1000 }),
    ).toThrow(DecompressionBombError);
  });
  it("refuses when ratio exceeds maxRatio", () => {
    expect(() =>
      checkDeclaredSizes([{ uncompressedSize: 1000 }], 10, { maxUncompressed: 1e9, maxRatio: 10 }),
    ).toThrow(DecompressionBombError);
  });
  it("accepts a normal 2-4x archive", () => {
    expect(() =>
      checkDeclaredSizes([{ uncompressedSize: 300 }], 100, DEFAULT_BOMB_LIMITS),
    ).not.toThrow();
  });
});

it("runBackup snapshots committed state while a write txn is open", async () => {
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  // Open a second connection and hold an uncommitted write open.
  const live = new Database(dbPath);
  live.exec("BEGIN IMMEDIATE");
  live.prepare("INSERT INTO t (v) VALUES (?)").run("uncommitted");

  const { outFile } = await runBackup({
    dataDir, dbPath, backupsDir, mode: "manual",
    now: () => new Date(2026, 4, 26, 9, 0, 0),
  });

  live.exec("ROLLBACK");
  live.close();

  const zip = await JSZip.loadAsync(await readFile(outFile));
  const dbBytes = await zip.file("smudge.db")!.async("nodebuffer");
  const tmp = join(dataDir, "snap.db");
  await writeFile(tmp, dbBytes);
  const snap = new Database(tmp, { readonly: true });
  // Only the committed row is present; the uncommitted insert is absent.
  expect(snap.prepare("SELECT COUNT(*) c FROM t").get()).toEqual({ c: 1 });
  snap.close();
  await rm(dataDir, { recursive: true, force: true });
});
