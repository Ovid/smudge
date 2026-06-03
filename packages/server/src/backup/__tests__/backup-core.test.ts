import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { isoStampLocal, buildBackupName, runBackup, runRestore, rotateAutoBackups, runAutoBackup, ZipSlipError, validateEntryPaths, readCentralDirectorySizes, checkDeclaredSizes, DecompressionBombError, RestorePreconditionError, RestorePartialError, DEFAULT_BOMB_LIMITS } from "../backup-core";

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

// ── Change 1: free-space pre-check ──────────────────────────────────────────

it("refuses restore when free space is insufficient, leaving data dir untouched", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  const before = await readFile(join(dataDir, "smudge.db"));

  await expect(runRestore({
    archivePath: archive,
    dataDir,
    confirmToken: basename(archive),
    probePort: async () => false,
    freeBytes: async () => 0, // simulate a full disk
  })).rejects.toThrow(RestorePreconditionError);

  // data dir untouched: original DB intact, no move-aside sibling for this dataDir
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before);
  const dataDirBasename = basename(dataDir);
  expect(
    (await readdir(join(dataDir, ".."))).some(
      (f) => f.startsWith(dataDirBasename) && f.includes(".before-restore-"),
    ),
  ).toBe(false);

  await rm(dataDir, { recursive: true, force: true });
});

it("includes the needed and available byte counts in the free-space error message", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);

  let caughtMessage = "";
  try {
    await runRestore({
      archivePath: archive,
      dataDir,
      confirmToken: basename(archive),
      probePort: async () => false,
      freeBytes: async () => 42,
    });
  } catch (e) {
    caughtMessage = (e as Error).message;
  }
  expect(caughtMessage).toMatch(/insufficient free space/);
  expect(caughtMessage).toContain("42"); // reports have bytes
  await rm(dataDir, { recursive: true, force: true });
});

// ── Change 3: typed precondition errors ─────────────────────────────────────

it("throws RestorePreconditionError (not bare Error) for missing smudge.db", async () => {
  const { dataDir } = await makeFixture();
  const zip = new JSZip();
  zip.file("images/p/a.png", Buffer.from([9]));
  const bad = join(dataDir, "backups", "smudge-bad.zip");
  await mkdir(join(dataDir, "backups"), { recursive: true });
  await writeFile(bad, await zip.generateAsync({ type: "nodebuffer" }));
  await expect(runRestore({
    archivePath: bad, dataDir, confirmToken: "smudge-bad.zip", probePort: async () => false,
  })).rejects.toBeInstanceOf(RestorePreconditionError);
  await rm(dataDir, { recursive: true, force: true });
});

it("throws RestorePreconditionError (not bare Error) when the server is running", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  await expect(runRestore({
    archivePath: archive, dataDir, confirmToken: basename(archive),
    probePort: async () => true,
  })).rejects.toBeInstanceOf(RestorePreconditionError);
  await rm(dataDir, { recursive: true, force: true });
});

it("throws RestorePreconditionError (not bare Error) on confirmation-token mismatch", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  await expect(runRestore({
    archivePath: archive, dataDir, confirmToken: "WRONG", probePort: async () => false,
  })).rejects.toBeInstanceOf(RestorePreconditionError);
  await rm(dataDir, { recursive: true, force: true });
});

// ── Change 4 (T-3): fresh-restore into a non-existent dataDir ───────────────

it("restores successfully when dataDir does not exist yet (ENOENT rename branch)", async () => {
  // Build the archive from a separate fixture, then point restore at a sibling
  // path that does not exist — exercises the rename().catch(ENOENT) path.
  const fixtureDir = await mkdtemp(join(tmpdir(), "smudge-t3-src-"));
  const db = new Database(join(fixtureDir, "smudge.db"));
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run("t3-value");
  db.close();
  await mkdir(join(fixtureDir, "images", "proj-t3"), { recursive: true });
  await writeFile(join(fixtureDir, "images", "proj-t3", "x.png"), Buffer.from([0xAB]));

  const backupsDir = join(fixtureDir, "backups");
  const { outFile: archive } = await runBackup({
    dataDir: fixtureDir,
    dbPath: join(fixtureDir, "smudge.db"),
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 15, 0, 0),
  });

  // Target a non-existent sibling directory
  const nonExistent = join(fixtureDir, "..", `smudge-t3-does-not-exist-${Date.now()}`);
  const { movedAsideTo } = await runRestore({
    archivePath: archive,
    dataDir: nonExistent,
    confirmToken: basename(archive),
    probePort: async () => false,
    now: () => new Date(2026, 4, 26, 15, 1, 0),
  });

  // movedAsideTo should contain the suffix even if ENOENT triggered (path is computed, not verified)
  expect(movedAsideTo).toContain(".before-restore-");

  // The restored data dir was created with the DB inside
  const restoredDb = new Database(join(nonExistent, "smudge.db"), { readonly: true });
  expect(restoredDb.prepare("SELECT v FROM t").get()).toEqual({ v: "t3-value" });
  restoredDb.close();

  // Cleanup
  await rm(fixtureDir, { recursive: true, force: true });
  await rm(nonExistent, { recursive: true, force: true });
});

// ── Change 5 (T-1): post-move failure surfaces RestorePartialError carrying movedAsideTo ──

it("T-1: on post-move extraction failure (JSZip size-mismatch or byte-budget overrun), throws RestorePartialError carrying movedAsideTo and preserves original DB", async () => {
  // Build a real fixture with a large incompressible file so it passes checkDeclaredSizes
  // with its real size, but we then patch the CD to under-declare it — causing either
  // JSZip's own size-mismatch throw or our byte-budget overrun. Change A wraps both.
  const { dataDir, dbPath } = await makeFixture();
  const bigBin = randomBytes(1_600_000);
  await mkdir(join(dataDir, "images", "proj-t1"), { recursive: true });
  await writeFile(join(dataDir, "images", "proj-t1", "big.bin"), bigBin);

  const backupsDir = join(dataDir, "backups");
  const { outFile: archive } = await runBackup({
    dataDir, dbPath, backupsDir, mode: "manual",
    now: () => new Date(2026, 4, 26, 16, 0, 0),
  });

  // Mutate the live DB AFTER backup so we can prove the original (with the mutation)
  // is what's preserved at movedAsideTo.
  const liveDb = new Database(dbPath);
  liveDb.prepare("INSERT INTO t (v) VALUES (?)").run("post-backup-mutation");
  liveDb.close();
  const originalDb = await readFile(dbPath);

  // Read the archive buffer and patch the central-directory's uncompressed-size field
  // for big.bin from ~1.6 MiB to 10 bytes. This causes checkDeclaredSizes to pass
  // (declaredTotal is now tiny) but then JSZip's decompression throws a size-mismatch
  // error when it verifies the actual stream length. Change A wraps that throw into
  // RestorePartialError carrying movedAsideTo.
  const buf = Buffer.from(await readFile(archive));

  const EOCD_SIG_T1 = 0x06054b50;
  const CEN_SIG_T1 = 0x02014b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG_T1) { eocd = i; break; }
  }
  expect(eocd).toBeGreaterThan(-1); // sanity: real EOCD found

  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);

  // Walk the central directory to find big.bin and patch its declared uncompressed size.
  let off = cdOffset;
  let patched = false;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(off) !== CEN_SIG_T1) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const entryName = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (entryName === "images/proj-t1/big.bin") {
      buf.writeUInt32LE(10, off + 24); // lie: claim uncompressed size is 10 bytes
      patched = true;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }

  expect(patched).toBe(true); // ensure the entry was found and patched

  const patchedArchive = join(backupsDir, "smudge-patched.zip");
  await writeFile(patchedArchive, buf);

  // runRestore with generous limits so checkDeclaredSizes passes the now-tiny declared total,
  // but the actual extraction triggers either JSZip's own error or our byte-budget check.
  // Either way, Change A wraps the failure into RestorePartialError.
  let caughtErr: unknown;
  try {
    await runRestore({
      archivePath: patchedArchive,
      dataDir,
      confirmToken: basename(patchedArchive),
      probePort: async () => false,
      freeBytes: async () => 10 * 1024 * 1024 * 1024, // 10 GiB — plenty
      limits: { maxUncompressed: 2 * 1024 ** 3, maxRatio: 1000 },
      now: () => new Date(2026, 4, 26, 16, 1, 0),
    });
  } catch (e) {
    caughtErr = e;
  }

  // Must have thrown (patched archive is corrupt — extraction always fails).
  expect(caughtErr).toBeDefined();

  // Must be instanceof RestorePartialError (and therefore instanceof DecompressionBombError).
  expect(caughtErr).toBeInstanceOf(RestorePartialError);
  expect(caughtErr).toBeInstanceOf(DecompressionBombError);

  const err = caughtErr as RestorePartialError;

  // Must carry the move-aside path.
  expect(typeof err.movedAsideTo).toBe("string");
  expect(err.movedAsideTo).toContain(".before-restore-");

  // The move-aside directory must exist on disk.
  const movedDbPath = join(err.movedAsideTo, "smudge.db");
  let movedStat: Awaited<ReturnType<typeof stat>> | null = null;
  try { movedStat = await stat(movedDbPath); } catch { /* intentionally empty */ }
  expect(movedStat).not.toBeNull(); // original smudge.db preserved at movedAsideTo

  // The preserved DB must contain the post-backup mutation (i.e. the ORIGINAL live data,
  // not the backup snapshot).
  const movedDbBytes = await readFile(movedDbPath);
  expect(movedDbBytes).toEqual(originalDb);

  // Cleanup
  await rm(err.movedAsideTo, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

// ── Task 8: rotateAutoBackups ────────────────────────────────────────────────

it("keeps newest N auto-backups; never touches manual or unrelated files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-rot-"));
  const autos = Array.from({ length: 12 }, (_, i) =>
    `smudge-auto-2026-05-26-1000${String(i).padStart(2, "0")}.zip`);
  for (const f of [...autos, "smudge-2026-05-01-090000.zip", "smudge-2026-05-02-090000.zip", "notes.txt"]) {
    await writeFile(join(dir, f), Buffer.from("x"));
  }
  const { deleted } = await rotateAutoBackups({ backupsDir: dir, keep: 10 });
  expect(deleted).toHaveLength(2); // 12 - 10
  const left = (await readdir(dir)).sort();
  expect(left).toContain("smudge-2026-05-01-090000.zip");
  expect(left).toContain("smudge-2026-05-02-090000.zip");
  expect(left).toContain("notes.txt");
  expect(left.filter((f) => f.startsWith("smudge-auto-"))).toHaveLength(10);
  // the two OLDEST autos are the ones gone
  expect(left).not.toContain("smudge-auto-2026-05-26-100000.zip");
  expect(left).not.toContain("smudge-auto-2026-05-26-100001.zip");
  await rm(dir, { recursive: true, force: true });
});

// ── walkFiles: no images dir (catch-return branch) ──────────────────────────

it("runBackup succeeds when there is no images directory (walkFiles readdir-catch branch)", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "smudge-noimages-"));
  const dbPath = join(dataDir, "smudge.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.close();
  // No images/ dir created — exercises the walkFiles readdir-catch return.
  const backupsDir = join(dataDir, "backups");
  const { outFile } = await runBackup({
    dataDir, dbPath, backupsDir, mode: "manual",
    now: () => new Date(2026, 4, 26, 10, 0, 0),
  });
  const zip = await JSZip.loadAsync(await readFile(outFile));
  expect(zip.file("smudge.db")).toBeTruthy();
  // No images entries
  expect(Object.keys(zip.files).filter((k) => k.startsWith("images/"))).toHaveLength(0);
  await rm(dataDir, { recursive: true, force: true });
});

// ── Task 8 supplemental: rotateAutoBackups with non-existent backupsDir ─────

it("rotateAutoBackups returns empty deleted list when backupsDir does not exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-rot-nodir-"));
  const nonExistent = join(dir, "does-not-exist");
  const { deleted } = await rotateAutoBackups({ backupsDir: nonExistent, keep: 10 });
  expect(deleted).toEqual([]);
  await rm(dir, { recursive: true, force: true });
});

// ── Task 9: runAutoBackup ────────────────────────────────────────────────────

it("skips when there is no database", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-auto-"));
  const r = await runAutoBackup({
    dataDir: dir, dbPath: join(dir, "smudge.db"), backupsDir: join(dir, "backups"), keep: 10,
  });
  expect(r.status).toBe("skipped-no-db");
  expect(r.outFile).toBeUndefined();
  await rm(dir, { recursive: true, force: true });
});

it("skips on opt-out", async () => {
  const { dataDir, dbPath } = await makeFixture();
  const r = await runAutoBackup({
    dataDir, dbPath, backupsDir: join(dataDir, "backups"), keep: 10, skip: true,
  });
  expect(r.status).toBe("skipped-optout");
  await rm(dataDir, { recursive: true, force: true });
});

it("produces a smudge-auto archive and rotates, status ok", async () => {
  const { dataDir, dbPath } = await makeFixture();
  const r = await runAutoBackup({
    dataDir, dbPath, backupsDir: join(dataDir, "backups"), keep: 10,
    now: () => new Date(2026, 4, 26, 8, 0, 0),
  });
  expect(r.status).toBe("ok");
  expect(r.outFile).toContain("smudge-auto-2026-05-26-080000.zip");
  await rm(dataDir, { recursive: true, force: true });
});

it("is best-effort: returns 'failed' with a warning instead of throwing", async () => {
  const { dataDir, dbPath } = await makeFixture();
  // point backupsDir at a path whose parent is a FILE, so mkdir fails
  const blocker = join(dataDir, "blocker");
  await writeFile(blocker, "x");
  const r = await runAutoBackup({
    dataDir, dbPath, backupsDir: join(blocker, "backups"), keep: 10,
  });
  expect(r.status).toBe("failed");
  expect(r.warning).toBeTruthy();
  await rm(dataDir, { recursive: true, force: true });
});
