import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { isoStampLocal, buildBackupName, runBackup, runRestore, ZipSlipError, validateEntryPaths, readCentralDirectorySizes, checkDeclaredSizes, DecompressionBombError, DEFAULT_BOMB_LIMITS } from "../backup-core";

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

it("readCentralDirectorySizes throws DecompressionBombError for garbage / non-ZIP buffer", () => {
  expect(() =>
    readCentralDirectorySizes(Buffer.from("this is definitely not a zip file")),
  ).toThrow(DecompressionBombError);
});

it("readCentralDirectorySizes throws DecompressionBombError (not RangeError) for truncated central directory", async () => {
  const zip = new JSZip();
  zip.file("a.txt", "x".repeat(2000));
  const buf = await zip.generateAsync({ type: "nodebuffer" });

  // Locate the EOCD by scanning backwards for its signature (0x06054b50).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  expect(eocd).toBeGreaterThan(-1); // sanity: real EOCD found

  // Overwrite the central-directory offset (EOCD+16) with an out-of-range value.
  // Use 0xFFFFFFFE — not the zip64 sentinel (0xFFFFFFFF) — so it hits the read-overrun
  // path rather than the zip64-refused early-exit.
  const corrupted = Buffer.from(buf);
  corrupted.writeUInt32LE(0xfffffffe, eocd + 16);

  // Without Fix 1 this would throw a raw Node RangeError; with Fix 1 it must be DecompressionBombError.
  expect(() => readCentralDirectorySizes(corrupted)).toThrow(DecompressionBombError);
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

// ── runRestore tests (Task 7) ────────────────────────────────────────────────

async function makeArchive(dataDir: string, mode: "manual" | "auto" = "manual") {
  const backupsDir = join(dataDir, "backups");
  const { outFile } = await runBackup({
    dataDir, dbPath: join(dataDir, "smudge.db"), backupsDir, mode,
    now: () => new Date(2026, 4, 26, 12, 0, 0),
  });
  return outFile;
}

it("runRestore round-trips after wiping the data dir; old data is moved aside", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  // mutate live data so we can prove restore reverts it
  const db = new Database(join(dataDir, "smudge.db"));
  db.prepare("INSERT INTO t (v) VALUES (?)").run("after-backup");
  db.close();

  const { movedAsideTo } = await runRestore({
    archivePath: archive, dataDir, confirmToken: basename(archive),
    probePort: async () => false, // server not running
    now: () => new Date(2026, 4, 26, 13, 0, 0),
  });

  const restored = new Database(join(dataDir, "smudge.db"), { readonly: true });
  expect(restored.prepare("SELECT COUNT(*) c FROM t").get()).toEqual({ c: 1 }); // "after-backup" gone
  restored.close();
  expect(movedAsideTo).toContain(".before-restore-");
  await rm(movedAsideTo, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

it("refuses if the server is running (port probe true)", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  await expect(runRestore({
    archivePath: archive, dataDir, confirmToken: basename(archive),
    probePort: async () => true,
  })).rejects.toThrow(/running/i);
  await rm(dataDir, { recursive: true, force: true });
});

it("refuses on a confirmation-token mismatch without touching the data dir", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  const before = await readFile(join(dataDir, "smudge.db"));
  await expect(runRestore({
    archivePath: archive, dataDir, confirmToken: "WRONG", probePort: async () => false,
  })).rejects.toThrow(/confirm/i);
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before);
  await rm(dataDir, { recursive: true, force: true });
});

it("refuses an archive missing smudge.db", async () => {
  const { dataDir } = await makeFixture();
  const zip = new JSZip();
  zip.file("images/p/a.png", Buffer.from([9]));
  const bad = join(dataDir, "backups", "smudge-bad.zip");
  await mkdir(join(dataDir, "backups"), { recursive: true });
  await writeFile(bad, await zip.generateAsync({ type: "nodebuffer" }));
  await expect(runRestore({
    archivePath: bad, dataDir, confirmToken: "smudge-bad.zip", probePort: async () => false,
  })).rejects.toThrow(/smudge\.db/);
  await rm(dataDir, { recursive: true, force: true });
});

it("refuses a zip-slip archive and leaves the data dir untouched", async () => {
  const { dataDir } = await makeFixture();
  const before = await readFile(join(dataDir, "smudge.db"));
  const zip = new JSZip();
  zip.file("smudge.db", before);
  zip.file("../../escape.txt", Buffer.from("x"));
  const bad = join(dataDir, "backups", "smudge-slip.zip");
  await mkdir(join(dataDir, "backups"), { recursive: true });
  await writeFile(bad, await zip.generateAsync({ type: "nodebuffer" }));
  await expect(runRestore({
    archivePath: bad, dataDir, confirmToken: "smudge-slip.zip", probePort: async () => false,
  })).rejects.toThrow(ZipSlipError);
  // data dir untouched: original DB intact, no move-aside sibling created for THIS dataDir
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before);
  const dataDirBasename = basename(dataDir);
  expect(
    (await readdir(join(dataDir, ".."))).some(
      (f) => f.startsWith(dataDirBasename) && f.includes(".before-restore-"),
    ),
  ).toBe(false);
  await rm(dataDir, { recursive: true, force: true });
});

it("refuses a declared-size bomb archive and leaves the data dir untouched", async () => {
  const { dataDir } = await makeFixture();
  const before = await readFile(join(dataDir, "smudge.db"));
  const zip = new JSZip();
  zip.file("smudge.db", before);
  const bad = join(dataDir, "backups", "smudge-bomb.zip");
  await mkdir(join(dataDir, "backups"), { recursive: true });
  await writeFile(bad, await zip.generateAsync({ type: "nodebuffer" }));
  await expect(runRestore({
    archivePath: bad, dataDir, confirmToken: "smudge-bomb.zip", probePort: async () => false,
    limits: { maxUncompressed: 1, maxRatio: 1 }, // tiny caps force the refusal
  })).rejects.toThrow(DecompressionBombError);
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before); // validate-before-move-aside
  await rm(dataDir, { recursive: true, force: true });
});
