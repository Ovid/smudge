import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import JSZip from "jszip";
import {
  isoStampLocal,
  isoStampUtc,
  buildBackupName,
  runBackup,
  runRestore,
  rotateAutoBackups,
  runAutoBackup,
  ZipSlipError,
  resolveKeep,
  resolveBombLimit,
  flagValue,
  DEFAULT_KEEP,
  validateEntryPaths,
  readCentralDirectorySizes,
  findEocdOffset,
  walkCentralDirectory,
  checkDeclaredSizes,
  DecompressionBombError,
  RestorePreconditionError,
  RestorePartialError,
  DEFAULT_BOMB_LIMITS,
} from "../backup-core";

// ── Temp-dir registry: guarantees cleanup even when assertions throw ──────────
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
    // Also clean up any move-aside siblings created by runRestore
    try {
      const parent = dirname(dir);
      const base = basename(dir);
      const entries = await readdir(parent);
      for (const entry of entries) {
        if (entry.startsWith(base + ".before-restore-")) {
          await rm(join(parent, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // Parent may not exist or may have been removed already — ignore
    }
  }
  tempDirs.length = 0;
});

describe("isoStampLocal", () => {
  it("formats local time as YYYY-MM-DD-HHmmss with hyphens only", () => {
    const d = new Date(2026, 4, 26, 14, 32, 11); // local 2026-05-26 14:32:11
    expect(isoStampLocal(d)).toBe("2026-05-26-143211");
  });
});

describe("isoStampUtc (S-F1)", () => {
  it("formats UTC time as YYYY-MM-DDTHHmmssZ (filesystem-safe, no colons)", () => {
    const d = new Date(Date.UTC(2026, 4, 26, 14, 32, 11));
    expect(isoStampUtc(d)).toBe("2026-05-26T143211Z");
  });
  it("sorts lexically == chronologically across a DST fall-back (unlike local time)", () => {
    // A backward wall-clock step (DST fall-back / NTP correction) makes a LATER
    // instant carry an EARLIER local time, inverting a lexical name sort. UTC has
    // no such inversion, so the newer stamp always sorts after the older.
    const earlier = new Date(Date.UTC(2026, 10, 1, 8, 30, 0));
    const later = new Date(Date.UTC(2026, 10, 1, 9, 30, 0));
    expect(isoStampUtc(earlier) < isoStampUtc(later)).toBe(true);
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
  tempDirs.push(dataDir);
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
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(Date.UTC(2026, 4, 26, 14, 32, 11)), // UTC → deterministic filename
  });
  expect(outFile).toBe(join(backupsDir, "smudge-2026-05-26T143211Z.zip"));

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
});

// Root bypasses directory-permission checks, so the unreadable-dir injection only
// works as a non-root user.
it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
  "I4: runBackup fails loudly when an images subdir is unreadable (no silent image loss)",
  async () => {
    const { dataDir, dbPath } = await makeFixture();
    const locked = join(dataDir, "images", "proj-locked");
    await mkdir(locked, { recursive: true });
    await writeFile(join(locked, "secret.png"), Buffer.from([9]));
    await chmod(locked, 0o000); // unreadable → readdir EACCES during the walk
    const backupsDir = join(dataDir, "backups");
    try {
      await expect(
        runBackup({
          dataDir,
          dbPath,
          backupsDir,
          mode: "manual",
          now: () => new Date(2026, 4, 26, 11, 0, 0),
        }),
      ).rejects.toThrow();
    } finally {
      await chmod(locked, 0o700); // restore so afterEach cleanup can rm it
    }
  },
);

it("S2/I3: runBackup replaces an existing archive atomically and leaves no .tmp file", async () => {
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  const now = () => new Date(Date.UTC(2026, 4, 26, 14, 32, 11)); // UTC → deterministic filename
  // Pre-place a stale file at the exact target path: rename must replace it
  // without the previous explicit rm (which opened a no-file window).
  await mkdir(backupsDir, { recursive: true });
  const outPath = join(backupsDir, "smudge-2026-05-26T143211Z.zip");
  await writeFile(outPath, Buffer.from("STALE"));

  const { outFile } = await runBackup({ dataDir, dbPath, backupsDir, mode: "manual", now });
  expect(outFile).toBe(outPath);

  // Stale content gone; the published file is a valid archive.
  const zip = await JSZip.loadAsync(await readFile(outFile));
  expect(zip.file("smudge.db")).toBeTruthy();

  // No per-process .tmp file left behind by the publish.
  expect((await readdir(backupsDir)).filter((f) => f.includes(".tmp"))).toEqual([]);
});

it("S1: cleans up the .tmp publish file when the atomic rename fails", async () => {
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  const now = () => new Date(Date.UTC(2026, 4, 26, 14, 32, 11)); // deterministic filename
  const outPath = join(backupsDir, "smudge-2026-05-26T143211Z.zip");
  // Occupy the target path with a NON-EMPTY directory so `rename(tmp, outFile)`
  // fails (EISDIR/ENOTEMPTY) AFTER the .tmp has been written. rotateAutoBackups
  // only prunes `.zip`, so a leaked `.tmp` would accumulate forever.
  await mkdir(join(outPath, "occupant"), { recursive: true });

  await expect(runBackup({ dataDir, dbPath, backupsDir, mode: "manual", now })).rejects.toThrow();

  // The publish failed, but no orphan .tmp is left in backups/.
  expect((await readdir(backupsDir)).filter((f) => f.includes(".tmp"))).toEqual([]);
});

describe("resolveBombLimit (I5)", () => {
  it("returns the fallback when the flag is absent or blank", () => {
    expect(resolveBombLimit(undefined, 2048, "max-uncompressed")).toBe(2048);
    expect(resolveBombLimit("", 2048, "max-uncompressed")).toBe(2048);
    expect(resolveBombLimit("   ", 2048, "max-uncompressed")).toBe(2048);
  });
  it("honors an explicit 0 as the strictest cap (not a fallback)", () => {
    expect(resolveBombLimit("0", 2048, "max-uncompressed")).toBe(0);
  });
  it("uses a finite non-negative value verbatim, including fractional ratios", () => {
    expect(resolveBombLimit("50", 2048, "max-uncompressed")).toBe(50);
    expect(resolveBombLimit("2.5", 10, "max-ratio")).toBe(2.5);
  });
  it.each([["abc"], ["-1"], ["Infinity"], ["NaN"]])(
    "throws for the invalid value %j instead of silently defaulting",
    (raw) => {
      expect(() => resolveBombLimit(raw, 2048, "max-uncompressed")).toThrow(
        /invalid max-uncompressed/,
      );
    },
  );
});

describe("flagValue (S-F4)", () => {
  it("returns the value after the first '='", () => {
    expect(flagValue(["--max-ratio=10"], "max-ratio")).toBe("10");
  });
  it("returns undefined when the flag is absent", () => {
    expect(flagValue(["--other=1"], "max-ratio")).toBeUndefined();
  });
  it("keeps the FULL value when it contains '=' (no truncation after the first '=')", () => {
    // The old split('=')[1] returned "" for "--max-ratio==10", which
    // resolveBombLimit treated as absent → silent default. Now the "=10" is
    // preserved so the nonsensical value fails loudly instead.
    expect(flagValue(["--max-ratio==10"], "max-ratio")).toBe("=10");
    expect(flagValue(["--k=a=b=c"], "k")).toBe("a=b=c");
  });
  it("returns an empty string for a flag given with a trailing '=' and no value", () => {
    expect(flagValue(["--max-ratio="], "max-ratio")).toBe("");
  });
});

describe("validateEntryPaths", () => {
  const root = "/tmp/target";
  it("accepts in-tree entries", () => {
    expect(() => validateEntryPaths(["smudge.db", "images/p/a.png"], root)).not.toThrow();
  });
  it("accepts an in-tree entry containing whitespace (S3: not a traversal vector)", () => {
    // A space in a filename is safe — it resolves inside root. The design's
    // enumerated checks (null/absolute/drive/.. /escapes-root) do not include
    // whitespace, and forward-compat requires any old archive to stay restorable.
    expect(() => validateEntryPaths(["images/p/my chapter.png"], root)).not.toThrow();
  });
  it.each([["../../etc/passwd"], ["/etc/passwd"], ["a/../../etc/passwd"], ["images/../../escape"]])(
    "rejects %s and names it",
    (bad) => {
      expect(() => validateEntryPaths([bad], root)).toThrow(ZipSlipError);
      try {
        validateEntryPaths([bad], root);
      } catch (e) {
        expect((e as Error).message).toContain(bad);
      }
    },
  );

  it("rejects a null-byte entry and mentions 'null byte' in the message", () => {
    const bad = "images/p/a\0.png";
    expect(() => validateEntryPaths([bad], root)).toThrow(ZipSlipError);
    try {
      validateEntryPaths([bad], root);
    } catch (e) {
      expect((e as Error).message).toContain("null byte");
    }
  });

  it.each([["C:/Windows/system32/evil"], ["C:relative"]])(
    "rejects Windows/drive-absolute entry %s",
    (bad) => {
      expect(() => validateEntryPaths([bad], root)).toThrow(ZipSlipError);
    },
  );

  it("S3: escapes control characters in the rejected path (terminal-injection guard)", () => {
    // The rejected name is up to 65535 arbitrary bytes from an untrusted
    // archive and is printed straight to the operator's terminal by
    // scripts/restore.ts. A CR or ANSI erase-line sequence in it can overwrite
    // the abort message itself, so the operator is told the wrong thing about
    // a restore that just refused (CWE-117). JSON.stringify is the escaping
    // idiom already used by resolveBombLimit.
    const bad = "images/\u001b[2K\revil/../../etc/passwd";
    try {
      validateEntryPaths([bad], root);
      expect.unreachable("expected ZipSlipError");
    } catch (e) {
      const message = (e as Error).message;
      // No raw control character survives into the message (a regex literal
      // would trip eslint's no-control-regex, so compare code points).
      expect([...message].filter((c) => c.codePointAt(0)! < 0x20)).toEqual([]);
      expect(message).toContain("\\u001b");
      expect(message).toContain("\\r");
    }
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
  expect(() => readCentralDirectorySizes(Buffer.from("this is definitely not a zip file"))).toThrow(
    DecompressionBombError,
  );
});

it("readCentralDirectorySizes throws DecompressionBombError (not RangeError) for truncated central directory", async () => {
  const zip = new JSZip();
  zip.file("a.txt", "x".repeat(2000));
  const buf = await zip.generateAsync({ type: "nodebuffer" });

  // Locate the EOCD with the shared production parser (S9: no hand-rolled offsets).
  const eocd = findEocdOffset(buf);
  expect(eocd).toBeGreaterThan(-1); // sanity: real EOCD found

  // Overwrite the central-directory offset (EOCD+16) with an out-of-range value.
  // Use 0xFFFFFFFE — not the zip64 sentinel (0xFFFFFFFF) — so it hits the read-overrun
  // path rather than the zip64-refused early-exit.
  const corrupted = Buffer.from(buf);
  corrupted.writeUInt32LE(0xfffffffe, eocd + 16);

  // Without Fix 1 this would throw a raw Node RangeError; with Fix 1 it must be DecompressionBombError.
  expect(() => readCentralDirectorySizes(corrupted)).toThrow(DecompressionBombError);
});

// Backlog e8ba6c7b asked findEocdOffset to skip a 0x06054b50 that appears
// inside the archive comment, by requiring the candidate's declared comment
// length to reach exactly end-of-buffer. That guard shipped (fe7acdb7) and was
// reverted the same day: it refused archives with trailing bytes (pinned by
// "restores an archive that carries trailing bytes after the EOCD comment"
// above) while rescuing none, because jszip mis-locates the same decoy.
//
// These tests pin the SECOND half of that finding, which is the half a future
// author will not think to check: the fix is impossible at this layer. The
// locator can be made to find the true record, and the archive is still
// unrestorable, because a different parser does the extraction.
describe("findEocdOffset — comment containing the EOCD signature (e8ba6c7b)", () => {
  // The EOCD signature as bytes, then padding that pushes the decoy far enough
  // from the end that the backward scan reaches it first.
  const DECOY_COMMENT = `PK${String.fromCharCode(5, 6)}${"A".repeat(40)}`;

  async function decoyArchive() {
    const zip = new JSZip();
    zip.file("a.txt", "hello");
    zip.file("b.txt", "world");
    return zip.generateAsync({ type: "nodebuffer", comment: DECOY_COMMENT });
  }

  it("jszip refuses the archive, so no locator change here can restore it", async () => {
    const buf = await decoyArchive();
    // The extraction parser (runRestore step 6) mis-locates the decoy exactly
    // as this module's locator does, and gives up. THIS is why e8ba6c7b cannot
    // be closed by editing findEocdOffset: fixing step 1 leaves step 6 failing.
    await expect(JSZip.loadAsync(buf)).rejects.toThrow(/End of data reached/);
  });

  it("locates the decoy, matching jszip's choice rather than diverging from it", async () => {
    const buf = await decoyArchive();
    const offset = findEocdOffset(buf);
    // Not the true record — and deliberately so. Agreeing with the extraction
    // parser is worth more than being right alone: a locator that picked the
    // true record here would have Smudge validate one central directory while
    // jszip extracts from another.
    expect(offset).toBeGreaterThan(-1);
    expect(offset + 22 + buf.readUInt16LE(offset + 20)).not.toBe(buf.length);

    // S7 (review 2026-08-23): the two assertions above are "a record was
    // found" and "it is not the true record" — neither of which is the
    // invariant this test is named for. Agreement with jszip is the whole
    // justification for leaving the bare signature scan unguarded, and nothing
    // in the suite pinned it: a locator that picked some THIRD offset passed
    // both.
    //
    // jszip's rule is `lastIndexOfSignature(CENTRAL_DIRECTORY_END)` —
    // ArrayReader.js, a backward scan from `length - 4` with `zero` still 0 at
    // that point. Buffer.lastIndexOf is a different implementation of the same
    // rule, so this is a genuine cross-check rather than a second copy of the
    // loop under test. Pinned to jszip 3.10.x; a version that changes the
    // locator turns this red, which is the signal we want.
    const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    expect(offset).toBe(buf.lastIndexOf(EOCD_SIGNATURE));
  });

  it("reports -1 for a buffer that is not a zip at all", () => {
    expect(findEocdOffset(Buffer.alloc(200, 0x41))).toBe(-1);
  });

  it("reports -1 for a buffer shorter than an EOCD record", () => {
    expect(findEocdOffset(Buffer.alloc(21, 0x41))).toBe(-1);
  });

  it("still walks the central directory of an ordinary commented archive", async () => {
    const zip = new JSZip();
    zip.file("a.txt", "hello");
    zip.file("b.txt", "world");
    const buf = await zip.generateAsync({ type: "nodebuffer", comment: "an ordinary comment" });

    const paths = [...walkCentralDirectory(buf)].map((e) => e.path).sort();
    expect(paths).toEqual(["a.txt", "b.txt"]);
  });
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
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
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
});

// ── runRestore tests (Task 7) ────────────────────────────────────────────────

async function makeArchive(dataDir: string, mode: "manual" | "auto" = "manual") {
  const backupsDir = join(dataDir, "backups");
  const { outFile } = await runBackup({
    dataDir,
    dbPath: join(dataDir, "smudge.db"),
    backupsDir,
    mode,
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
    archivePath: archive,
    dataDir,
    confirmToken: basename(archive),
    probePort: async () => false, // server not running
    now: () => new Date(2026, 4, 26, 13, 0, 0),
  });

  const restored = new Database(join(dataDir, "smudge.db"), { readonly: true });
  expect(restored.prepare("SELECT COUNT(*) c FROM t").get()).toEqual({ c: 1 }); // "after-backup" gone
  restored.close();
  expect(movedAsideTo).toContain(".before-restore-");
  // movedAsideTo is a sibling of dataDir — afterEach handles cleanup via the
  // move-aside sibling scan registered against dataDir
});

// Review 2026-08-23 (I1): a backup that has picked up trailing bytes — block
// padding from an archiving tool, a transfer that rounded up, a zip embedded at
// the head of a larger file — must still restore. jszip locates the record and
// loads such an archive without complaint, so a locator that refuses it makes
// Smudge strictly less capable than the library it hands the bytes to, on the
// one path an operator reaches for after losing data.
//
// This drives the WHOLE restore, not findEocdOffset in isolation: the parser
// that validates and the parser that extracts are different code (backup-core
// step 1 vs step 6), and a locator change can only be judged at the layer where
// both run.
it("restores an archive that carries trailing bytes after the EOCD comment", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  await writeFile(archive, Buffer.concat([await readFile(archive), Buffer.alloc(16, 0)]));

  const db = new Database(join(dataDir, "smudge.db"));
  db.prepare("INSERT INTO t (v) VALUES (?)").run("after-backup");
  db.close();

  await runRestore({
    archivePath: archive,
    dataDir,
    confirmToken: basename(archive),
    probePort: async () => false,
    now: () => new Date(2026, 4, 26, 13, 0, 0),
  });

  const restored = new Database(join(dataDir, "smudge.db"), { readonly: true });
  expect(restored.prepare("SELECT COUNT(*) c FROM t").get()).toEqual({ c: 1 });
  restored.close();
});

it("refuses if the server is running (port probe true)", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  await expect(
    runRestore({
      archivePath: archive,
      dataDir,
      confirmToken: basename(archive),
      probePort: async () => true,
    }),
  ).rejects.toThrow(/running/i);
});

it("refuses on a confirmation-token mismatch without touching the data dir", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  const before = await readFile(join(dataDir, "smudge.db"));
  await expect(
    runRestore({
      archivePath: archive,
      dataDir,
      confirmToken: "WRONG",
      probePort: async () => false,
    }),
  ).rejects.toThrow(/confirm/i);
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before);
});

it("refuses an archive missing smudge.db", async () => {
  const { dataDir } = await makeFixture();
  const zip = new JSZip();
  zip.file("images/p/a.png", Buffer.from([9]));
  const bad = join(dataDir, "backups", "smudge-bad.zip");
  await mkdir(join(dataDir, "backups"), { recursive: true });
  await writeFile(bad, await zip.generateAsync({ type: "nodebuffer" }));
  await expect(
    runRestore({
      archivePath: bad,
      dataDir,
      confirmToken: "smudge-bad.zip",
      probePort: async () => false,
    }),
  ).rejects.toThrow(/smudge\.db/);
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
  await expect(
    runRestore({
      archivePath: bad,
      dataDir,
      confirmToken: "smudge-slip.zip",
      probePort: async () => false,
    }),
  ).rejects.toThrow(ZipSlipError);
  // data dir untouched: original DB intact, no move-aside sibling created for THIS dataDir
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before);
  const dataDirBasename = basename(dataDir);
  expect(
    (await readdir(join(dataDir, ".."))).some(
      (f) => f.startsWith(dataDirBasename) && f.includes(".before-restore-"),
    ),
  ).toBe(false);
});

it("refuses a declared-size bomb archive and leaves the data dir untouched", async () => {
  const { dataDir } = await makeFixture();
  const before = await readFile(join(dataDir, "smudge.db"));
  const zip = new JSZip();
  zip.file("smudge.db", before);
  const bad = join(dataDir, "backups", "smudge-bomb.zip");
  await mkdir(join(dataDir, "backups"), { recursive: true });
  await writeFile(bad, await zip.generateAsync({ type: "nodebuffer" }));
  await expect(
    runRestore({
      archivePath: bad,
      dataDir,
      confirmToken: "smudge-bomb.zip",
      probePort: async () => false,
      limits: { maxUncompressed: 1, maxRatio: 1 }, // tiny caps force the refusal
    }),
  ).rejects.toThrow(DecompressionBombError);
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before); // validate-before-move-aside
});

// ── Change 1: free-space pre-check ──────────────────────────────────────────

it("refuses restore when free space is insufficient, leaving data dir untouched", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  const before = await readFile(join(dataDir, "smudge.db"));

  await expect(
    runRestore({
      archivePath: archive,
      dataDir,
      confirmToken: basename(archive),
      probePort: async () => false,
      freeBytes: async () => 0, // simulate a full disk
    }),
  ).rejects.toThrow(RestorePreconditionError);

  // data dir untouched: original DB intact, no move-aside sibling for this dataDir
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before);
  const dataDirBasename = basename(dataDir);
  expect(
    (await readdir(join(dataDir, ".."))).some(
      (f) => f.startsWith(dataDirBasename) && f.includes(".before-restore-"),
    ),
  ).toBe(false);
});

it("S-F2: refuses restore when the EXTERNAL DB partition is full even if the dataDir partition has room", async () => {
  // DB_PATH points outside dataDir onto a (simulated) different partition. The
  // restored smudge.db lands on the DB's partition, images on dataDir's. A
  // path-aware freeBytes reports the DB partition full but dataDir roomy; the
  // pre-check must consult BOTH partitions, not just dataDir's.
  const parent = await mkdtemp(join(tmpdir(), "smudge-f2-"));
  tempDirs.push(parent);
  const dataDir = join(parent, "data");
  const dbPath = join(parent, "external", "smudge.db"); // outside dataDir
  await mkdir(join(dataDir, "images", "p"), { recursive: true });
  await writeFile(join(dataDir, "images", "p", "a.png"), Buffer.from([1, 2, 3]));
  await mkdir(dirname(dbPath), { recursive: true });
  const seed = new Database(dbPath);
  seed.exec("CREATE TABLE t (v TEXT)");
  seed.prepare("INSERT INTO t VALUES (?)").run("live");
  seed.close();
  const backupsDir = join(parent, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 12, 0, 0),
  });
  const liveDbBefore = await readFile(dbPath);

  await expect(
    runRestore({
      archivePath: archive,
      dataDir,
      dbPath,
      confirmToken: basename(archive),
      probePort: async () => false,
      // Simulate genuinely different partitions so the DB and images are checked
      // independently (this test targets the two-partition path, not I1's shared one).
      sameDevice: async () => false,
      // DB partition (under .../external) is full; dataDir partition is roomy.
      freeBytes: async (p: string) => (p.includes("external") ? 42 : 10 * 1024 ** 3),
    }),
  ).rejects.toThrow(RestorePreconditionError);

  // Precondition failure ⇒ nothing touched: the live external DB is intact and
  // was not moved aside.
  expect(await readFile(dbPath)).toEqual(liveDbBefore);
  expect((await readdir(dirname(dbPath))).some((f) => f.includes(".before-restore-"))).toBe(false);
});

it("I1: refuses restore when the external DB shares dataDir's partition and the SUM exceeds free (even though each half fits)", async () => {
  // "External" only means "outside dataDir", not "different disk". When the DB
  // dir and the dataDir live on the SAME physical partition, the restored DB and
  // images draw from ONE free-space pool, so the pre-check must reserve the full
  // declared total — not validate each half independently against the same free
  // figure (which under-reserves to max(halves) and then ENOSPCs mid-write).
  const parent = await mkdtemp(join(tmpdir(), "smudge-i1-"));
  tempDirs.push(parent);
  const dataDir = join(parent, "data");
  const dbPath = join(parent, "external", "smudge.db"); // outside dataDir…
  await mkdir(join(dataDir, "images", "p"), { recursive: true });
  await writeFile(join(dataDir, "images", "p", "a.png"), Buffer.from([1, 2, 3, 4, 5]));
  await mkdir(dirname(dbPath), { recursive: true });
  const seed = new Database(dbPath);
  seed.exec("CREATE TABLE t (v TEXT)");
  seed.prepare("INSERT INTO t VALUES (?)").run("live");
  seed.close();
  const backupsDir = join(parent, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 12, 0, 0),
  });

  // Derive a free-bytes figure strictly inside the buggy/fixed window:
  //   max(dbDeclared, imagesDeclared) + headroom  <=  free  <  total + headroom
  // The buggy per-half check passes at this value; the correct summed check fails.
  const sizes = readCentralDirectorySizes(await readFile(archive));
  const total = sizes.reduce((n, e) => n + e.uncompressedSize, 0);
  const dbDeclared = sizes.find((e) => e.path === "smudge.db")!.uncompressedSize;
  const images = total - dbDeclared;
  const HEADROOM = 100 * 1024 * 1024;
  const free = Math.max(dbDeclared, images) + HEADROOM + 1;
  expect(free).toBeLessThan(total + HEADROOM); // guard: both halves are non-trivial

  await expect(
    runRestore({
      archivePath: archive,
      dataDir,
      dbPath,
      confirmToken: basename(archive),
      probePort: async () => false,
      // Same physical partition → the DB and images share one free pool.
      sameDevice: async () => true,
      freeBytes: async () => free,
    }),
  ).rejects.toThrow(RestorePreconditionError);
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
});

// ── Change 3: typed precondition errors ─────────────────────────────────────

it("throws RestorePreconditionError (not bare Error) for missing smudge.db", async () => {
  const { dataDir } = await makeFixture();
  const zip = new JSZip();
  zip.file("images/p/a.png", Buffer.from([9]));
  const bad = join(dataDir, "backups", "smudge-bad.zip");
  await mkdir(join(dataDir, "backups"), { recursive: true });
  await writeFile(bad, await zip.generateAsync({ type: "nodebuffer" }));
  await expect(
    runRestore({
      archivePath: bad,
      dataDir,
      confirmToken: "smudge-bad.zip",
      probePort: async () => false,
    }),
  ).rejects.toBeInstanceOf(RestorePreconditionError);
});

it("throws RestorePreconditionError (not bare Error) when the server is running", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  await expect(
    runRestore({
      archivePath: archive,
      dataDir,
      confirmToken: basename(archive),
      probePort: async () => true,
    }),
  ).rejects.toBeInstanceOf(RestorePreconditionError);
});

it("throws RestorePreconditionError (not bare Error) on confirmation-token mismatch", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  await expect(
    runRestore({
      archivePath: archive,
      dataDir,
      confirmToken: "WRONG",
      probePort: async () => false,
    }),
  ).rejects.toBeInstanceOf(RestorePreconditionError);
});

// ── Change 4 (T-3): fresh-restore into a non-existent dataDir ───────────────

it("restores successfully when dataDir does not exist yet (ENOENT rename branch)", async () => {
  // Build the archive from a separate fixture, then point restore at a sibling
  // path that does not exist — exercises the rename().catch(ENOENT) path.
  const fixtureDir = await mkdtemp(join(tmpdir(), "smudge-t3-src-"));
  tempDirs.push(fixtureDir);
  const db = new Database(join(fixtureDir, "smudge.db"));
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run("t3-value");
  db.close();
  await mkdir(join(fixtureDir, "images", "proj-t3"), { recursive: true });
  await writeFile(join(fixtureDir, "images", "proj-t3", "x.png"), Buffer.from([0xab]));

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
  tempDirs.push(nonExistent);
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
});

// ── C1: restore honors an external DB_PATH (outside the data dir) ────────────

it("C1: restore writes smudge.db to an external dbPath and preserves the old external DB", async () => {
  // DB_PATH-outside config: dataDir holds images only; the live DB lives in a
  // sibling directory outside dataDir. Backup honors getDbPath(); restore must too.
  const parent = await mkdtemp(join(tmpdir(), "smudge-c1-"));
  tempDirs.push(parent);
  const dataDir = join(parent, "data");
  const dbPath = join(parent, "external", "smudge.db"); // outside dataDir
  await mkdir(join(dataDir, "images", "p"), { recursive: true });
  await writeFile(join(dataDir, "images", "p", "a.png"), Buffer.from([1, 2, 3]));
  await mkdir(dirname(dbPath), { recursive: true });
  const seed = new Database(dbPath);
  seed.exec("CREATE TABLE t (v TEXT)");
  seed.prepare("INSERT INTO t VALUES (?)").run("backed-up");
  seed.close();

  // Backup reads the DB from the external dbPath.
  const backupsDir = join(parent, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 12, 0, 0),
  });

  // Mutate the external DB after backup so we can prove restore reverts it AND
  // preserves the mutated copy at the move-aside path.
  const live = new Database(dbPath);
  live.prepare("INSERT INTO t VALUES (?)").run("after-backup");
  live.close();
  const mutatedDb = await readFile(dbPath);

  const { movedAsideTo, dbMovedAsideTo } = await runRestore({
    archivePath: archive,
    dataDir,
    dbPath,
    confirmToken: basename(archive),
    probePort: async () => false,
    now: () => new Date(2026, 4, 26, 13, 0, 0),
  });

  // The external DB was restored to the backed-up state (the post-backup mutation is gone).
  const restored = new Database(dbPath, { readonly: true });
  expect(restored.prepare("SELECT COUNT(*) c FROM t").get()).toEqual({ c: 1 });
  restored.close();

  // The old external DB was preserved (never deleted), with its mutation intact.
  expect(dbMovedAsideTo).toBeTruthy();
  expect(dbMovedAsideTo).toContain(".before-restore-");
  expect(await readFile(dbMovedAsideTo!)).toEqual(mutatedDb);

  // Images restored into dataDir; the old data dir was moved aside.
  expect(await readFile(join(dataDir, "images", "p", "a.png"))).toEqual(Buffer.from([1, 2, 3]));
  expect(movedAsideTo).toContain(".before-restore-");
});

it("C1: restore into an external dbPath with no prior DB file succeeds (ENOENT branch)", async () => {
  // External dbPath, but nothing lives there yet → the move-aside rename hits
  // ENOENT (nothing to preserve) and dbMovedAsideTo stays undefined.
  const parent = await mkdtemp(join(tmpdir(), "smudge-c1b-"));
  tempDirs.push(parent);
  const dataDir = join(parent, "data");
  const dbPath = join(parent, "external", "smudge.db");
  await mkdir(join(dataDir, "images", "p"), { recursive: true });
  await writeFile(join(dataDir, "images", "p", "a.png"), Buffer.from([5]));
  await mkdir(dirname(dbPath), { recursive: true });
  const seed = new Database(dbPath);
  seed.exec("CREATE TABLE t (v TEXT)");
  seed.prepare("INSERT INTO t VALUES (?)").run("seed");
  seed.close();
  const backupsDir = join(parent, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 12, 0, 0),
  });
  await rm(dbPath); // remove the external DB so restore preserves nothing

  const { dbMovedAsideTo } = await runRestore({
    archivePath: archive,
    dataDir,
    dbPath,
    confirmToken: basename(archive),
    probePort: async () => false,
    now: () => new Date(2026, 4, 26, 13, 0, 0),
  });
  expect(dbMovedAsideTo).toBeUndefined();
  const restored = new Database(dbPath, { readonly: true });
  expect(restored.prepare("SELECT v FROM t").get()).toEqual({ v: "seed" });
  restored.close();
});

it("C1: an internal dbPath (default) reports no separate dbMovedAsideTo", async () => {
  // Default config: DB lives inside dataDir. The data-dir move-aside already
  // preserves it, so there must be no second move-aside path.
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  const { dbMovedAsideTo } = await runRestore({
    archivePath: archive,
    dataDir,
    dbPath: join(dataDir, "smudge.db"),
    confirmToken: basename(archive),
    probePort: async () => false,
    now: () => new Date(2026, 4, 26, 13, 0, 0),
  });
  expect(dbMovedAsideTo).toBeUndefined();
});

it("S6: move-aside path includes the pid to avoid same-second restore collisions", async () => {
  const { dataDir } = await makeFixture();
  const archive = await makeArchive(dataDir);
  const { movedAsideTo } = await runRestore({
    archivePath: archive,
    dataDir,
    confirmToken: basename(archive),
    probePort: async () => false,
    now: () => new Date(2026, 4, 26, 13, 0, 0),
  });
  expect(movedAsideTo.endsWith(`.${process.pid}`)).toBe(true);
});

// ── I1: a recreate (mkdir) failure after the move-aside is wrapped, not raw ──

// Root bypasses the directory-permission check, so the failure injection only
// works as a non-root user. The mkdir-inside-try branch itself is covered by
// every happy-path restore test regardless; this gates only the fault injection.
it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
  "I1: mkdir-recreate failure after move-aside throws RestorePartialError carrying movedAsideTo",
  async () => {
    const { dataDir: srcDir } = await makeFixture();
    const archive = await makeArchive(srcDir);

    // Read-only parent; dataDir itself does not exist. The move-aside rename is a
    // clean ENOENT no-op (source absent), then mkdir(dataDir) fails EACCES on the
    // read-only parent. Before the fix that mkdir sat outside the try and threw a
    // raw fs error; it must now surface as RestorePartialError carrying movedAsideTo.
    const roParent = await mkdtemp(join(tmpdir(), "smudge-i1-ro-"));
    tempDirs.push(roParent);
    const dataDir = join(roParent, "data"); // does not exist
    await chmod(roParent, 0o500);
    try {
      let caught: unknown;
      try {
        await runRestore({
          archivePath: archive,
          dataDir,
          confirmToken: basename(archive),
          probePort: async () => false,
          freeBytes: async () => 10 * 1024 ** 3, // bypass the free-space precheck
          now: () => new Date(2026, 4, 26, 17, 0, 0),
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RestorePartialError);
      expect((caught as RestorePartialError).movedAsideTo).toContain(".before-restore-");
    } finally {
      await chmod(roParent, 0o700); // restore perms so afterEach cleanup can rm it
    }
  },
);

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
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
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

  // Walk the central directory with the shared production parser (S9) and patch
  // big.bin's declared uncompressed size at its real byte offset.
  let patched = false;
  for (const entry of walkCentralDirectory(buf)) {
    if (entry.path === "images/proj-t1/big.bin") {
      buf.writeUInt32LE(10, entry.sizeFieldOffset); // lie: claim uncompressed size is 10 bytes
      patched = true;
    }
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
  // afterEach handles its cleanup via the move-aside sibling scan registered against dataDir.
  const movedDbPath = join(err.movedAsideTo, "smudge.db");
  let movedStat: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    movedStat = await stat(movedDbPath);
  } catch {
    /* intentionally empty */
  }
  expect(movedStat).not.toBeNull(); // original smudge.db preserved at movedAsideTo

  // The preserved DB must contain the post-backup mutation (i.e. the ORIGINAL live data,
  // not the backup snapshot).
  const movedDbBytes = await readFile(movedDbPath);
  expect(movedDbBytes).toEqual(originalDb);
});

// ── T-2 (F-14): the byte-budget guard actually fires ─────────────────────────

it("T-2 (F-14): a duplicate central-directory entry that under-declares the total trips the byte-budget guard", async () => {
  // F-14: the last-ditch decompression-bomb defense in runRestore
  // (`written > declaredTotal + 1MiB`) was dead in the coverage report. T-1
  // above aims at it but concedes in its own comment that it accepts EITHER
  // JSZip's size-mismatch throw or our overrun — and JSZip always wins, so the
  // branch never ran. Verified: patching a central-directory entry's declared
  // uncompressed size makes JSZip throw "Bug : uncompressed data size mismatch"
  // while decompressing, because it checks each entry's actual output length
  // against the size the central directory declared. Per-entry lying is
  // therefore caught upstream of us and cannot reach the budget check.
  //
  // What DOES reach it is a central directory that lists the same path TWICE
  // with different declared sizes — the classic duplicate-entry / "zip
  // confusion" shape. readCentralDirectorySizes sums the small decoy, while
  // the extraction loop iterates those same (duplicated) names and extracts
  // the real, large entry on BOTH passes. Every individual entry decompresses
  // to exactly the length its record declares, so JSZip is satisfied and only
  // the cumulative budget notices. That is precisely the "lying central
  // directory" the guard's comment describes.
  const { dataDir, dbPath } = await makeFixture();
  const bigBin = randomBytes(1_600_000); // incompressible → stored, ratio ~1
  await mkdir(join(dataDir, "images", "proj-f14"), { recursive: true });
  await writeFile(join(dataDir, "images", "proj-f14", "big.bin"), bigBin);

  const backupsDir = join(dataDir, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 17, 0, 0),
  });

  const orig = Buffer.from(await readFile(archive));

  // Locate entries with the SHARED production parser (S9) so the byte offsets
  // in this test cannot drift from the ones runRestore uses.
  const entries = [...walkCentralDirectory(orig)];
  const big = entries.find((e) => e.path === "images/proj-f14/big.bin");
  const small = entries.find((e) => e.path === "smudge.db");
  expect(big).toBeDefined();
  expect(small).toBeDefined();

  // Forge an extra central-directory record: smudge.db's record (small declared
  // size, valid local-header offset) re-labelled with big.bin's path. Extra and
  // comment fields are zeroed so the record is exactly 46 + nameLen bytes.
  const eocd = findEocdOffset(orig);
  expect(eocd).toBeGreaterThanOrEqual(0);
  const cdStart = orig.readUInt32LE(eocd + 16);
  const cdSize = orig.readUInt32LE(eocd + 12);

  const bigName = Buffer.from(big!.path, "utf8");
  const head = Buffer.from(orig.subarray(small!.sizeFieldOffset - 24, small!.sizeFieldOffset + 22));
  head.writeUInt16LE(bigName.length, 28); // file name length
  head.writeUInt16LE(0, 30); // extra field length
  head.writeUInt16LE(0, 32); // file comment length
  const forgedRecord = Buffer.concat([head, bigName]);

  // Rebuild: [local data][forged record][original central directory][EOCD],
  // with the EOCD's record counts, directory size and directory offset fixed
  // up so both parsers agree the forged record is part of the directory.
  const newCd = Buffer.concat([forgedRecord, orig.subarray(cdStart, cdStart + cdSize)]);
  const before = orig.subarray(0, cdStart);
  const newEocd = Buffer.from(orig.subarray(eocd));
  newEocd.writeUInt16LE(entries.length + 1, 8); // records on this disk
  newEocd.writeUInt16LE(entries.length + 1, 10); // total records
  newEocd.writeUInt32LE(newCd.length, 12);
  newEocd.writeUInt32LE(before.length, 16);
  const forgedArchive = Buffer.concat([before, newCd, newEocd]);

  // Sanity: the archive now under-declares. The duplicated path appears twice
  // in the directory, but the declared total counts the decoy's small size.
  const forgedEntries = [...walkCentralDirectory(forgedArchive)];
  const declaredTotal = forgedEntries.reduce((n, e) => n + e.uncompressedSize, 0);
  expect(forgedEntries.filter((e) => e.path === "images/proj-f14/big.bin")).toHaveLength(2);
  expect(declaredTotal).toBeLessThan(2 * bigBin.length);

  const forgedPath = join(backupsDir, "smudge-forged.zip");
  await writeFile(forgedPath, forgedArchive);

  await expect(
    runRestore({
      archivePath: forgedPath,
      dataDir,
      confirmToken: basename(forgedPath),
      probePort: async () => false,
      freeBytes: async () => 10 * 1024 * 1024 * 1024,
      // Generous caps so the DECLARED-size gate (defense #1) passes and the
      // cumulative budget is genuinely the thing that stops this.
      limits: { maxUncompressed: 2 * 1024 ** 3, maxRatio: 1000 },
      now: () => new Date(2026, 4, 26, 17, 1, 0),
    }),
    // The message is the discriminator: this is OUR guard, not JSZip's
    // size-mismatch and not the generic post-move wrapper. Without asserting
    // it, this test would pass on any extraction failure — which is exactly
    // the weakness that let the branch go uncovered.
  ).rejects.toThrow(/extraction exceeded declared size/);
});

// ── OOSI1: central-directory names vs JSZip's local-header key space ─────────

it("OOSI1: an entry named in the central directory but not extractable fails loudly", async () => {
  // runRestore validates `names` read from the CENTRAL DIRECTORY but extracts
  // with `zip.file(name)`, and JSZip keys its map by the LOCAL header name
  // (zipEntry.js readLocalPart overwrites fileName; readCentralPart skips it).
  // When the two key spaces disagree the entry was silently skipped by
  // `if (!file) continue` — so patching smudge.db's LOCAL name to an equal-
  // length string (no offset shift) passed the presence check, passed zip-slip
  // and the bomb caps, moved the live data dir aside, wrote nothing, and
  // RESOLVED. The operator was told the restore succeeded and left looking at
  // an empty data dir.
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 18, 0, 0),
  });

  const forged = Buffer.from(await readFile(archive));
  const entry = [...walkCentralDirectory(forged)].find((e) => e.path === "smudge.db");
  expect(entry).toBeDefined();
  // Central-directory layout: sizeFieldOffset is record+24, so the local
  // header offset field sits 18 bytes further on. Local header is 30 bytes
  // before its name.
  const localHeaderOffset = forged.readUInt32LE(entry!.sizeFieldOffset + 18);
  const nameOffset = localHeaderOffset + 30;
  expect(forged.subarray(nameOffset, nameOffset + 9).toString("utf8")).toBe("smudge.db");
  forged.write("smudge.dc", nameOffset, "utf8");

  const forgedPath = join(backupsDir, "smudge-localname.zip");
  await writeFile(forgedPath, forged);

  await expect(
    runRestore({
      archivePath: forgedPath,
      dataDir,
      confirmToken: basename(forgedPath),
      probePort: async () => false,
      freeBytes: async () => 10 * 1024 * 1024 * 1024,
      now: () => new Date(2026, 4, 26, 18, 1, 0),
    }),
  ).rejects.toThrow(/declared in the central directory but not extractable/);
});

it("C1: a central-directory name forged to end in '/' cannot smuggle a skip", async () => {
  // The OOSI1 carve-out must not decide "is this a directory?" from the
  // CENTRAL-directory name string: that string is exactly the half of the
  // disagreement an attacker controls. JSZip classifies directories from the
  // LOCAL header (external-attribute bit, then a trailing-slash fail-safe on
  // `fileNameStr` — zipEntry.js processAttributes), and keys its map by the
  // local name. So patching only the CENTRAL name of a real file to an
  // equal-length string ending in `/` (no offset shift, so every pre-move
  // check still passes) used to hit `if (name.endsWith("/")) continue` — the
  // image was dropped and runRestore RESOLVED, which is verbatim the OOSI1
  // outcome. The existing OOSI1 test patches the LOCAL name, the direction
  // that already threw.
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 18, 0, 0),
  });

  const forged = Buffer.from(await readFile(archive));
  const entry = [...walkCentralDirectory(forged)].find((e) => e.path === "images/proj-1/a.png");
  expect(entry).toBeDefined();
  // Central record layout: sizeFieldOffset is record+24, so the name starts 22
  // bytes further on (record+46). Overwrite in place, same byte length.
  const centralNameOffset = entry!.sizeFieldOffset + 22;
  expect(forged.subarray(centralNameOffset, centralNameOffset + 19).toString("utf8")).toBe(
    "images/proj-1/a.png",
  );
  forged.write("images/proj-1/a.pn/", centralNameOffset, "utf8");

  const forgedPath = join(backupsDir, "smudge-centralslash.zip");
  await writeFile(forgedPath, forged);

  await expect(
    runRestore({
      archivePath: forgedPath,
      dataDir,
      confirmToken: basename(forgedPath),
      probePort: async () => false,
      freeBytes: async () => 10 * 1024 * 1024 * 1024,
      now: () => new Date(2026, 4, 26, 18, 1, 0),
    }),
  ).rejects.toThrow(/declared in the central directory but not extractable/);
});

it("S1: a directory entry marked by the MS-DOS attribute bit is skipped, not rejected", async () => {
  // JSZip decides `dir` from the external-file-attributes bit FIRST
  // (zipEntry.js processAttributes) and only then falls back to a trailing
  // slash. So an archive can carry a directory entry whose name has no slash
  // at all — JSZip parses it happily, keys it force-slashed, and zip.file()
  // returns null. Deciding directory-ness from the central name string would
  // hard-abort that restore mid-extraction; asking `entry.dir` skips it.
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 18, 0, 0),
  });

  const forged = Buffer.from(await readFile(archive));
  const entry = [...walkCentralDirectory(forged)].find((e) => e.path === "images/proj-1/a.png");
  expect(entry).toBeDefined();
  // Central record: external file attributes are 4 bytes at record+38, and
  // sizeFieldOffset is record+24. Bit 4 (0x10) is the MS-DOS directory flag.
  forged.writeUInt32LE(0x10, entry!.sizeFieldOffset + 14);

  const forgedPath = join(backupsDir, "smudge-attrdir.zip");
  await writeFile(forgedPath, forged);

  const zip = await JSZip.loadAsync(forged);
  // Precondition of the test: JSZip really does classify it as a directory,
  // under a force-slashed key, and zip.file() really does miss it.
  expect(zip.files["images/proj-1/a.png/"]?.dir).toBe(true);
  expect(zip.file("images/proj-1/a.png")).toBeNull();

  await expect(
    runRestore({
      archivePath: forgedPath,
      dataDir,
      confirmToken: basename(forgedPath),
      probePort: async () => false,
      freeBytes: async () => 10 * 1024 * 1024 * 1024,
      now: () => new Date(2026, 4, 26, 18, 1, 0),
    }),
  ).resolves.toMatchObject({ movedAsideTo: expect.any(String) });
  expect(await readdir(dataDir)).toContain("smudge.db");
});

it("S4/OOSS1: an unopenable archive is refused pre-move, leaving the live data dir intact", async () => {
  // JSZip.loadAsync used to run AFTER the move-aside, so an archive that was
  // never openable at all (nothing pre-move inspects the encrypted bit flag or
  // the compression method) tore down the working data directory before the
  // failure was discovered. Opening pre-move turns "data dir destroyed,
  // partial state" into "refused, nothing touched".
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  const { outFile: archive } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 18, 0, 0),
  });

  const forged = Buffer.from(await readFile(archive));
  for (const entry of walkCentralDirectory(forged)) {
    // General-purpose bit flag is 2 bytes at record+8; sizeFieldOffset is
    // record+24. Bit 0 = encrypted.
    const flagOffset = entry.sizeFieldOffset - 16;
    forged.writeUInt16LE(forged.readUInt16LE(flagOffset) | 0x0001, flagOffset);
  }

  const forgedPath = join(backupsDir, "smudge-encrypted.zip");
  await writeFile(forgedPath, forged);

  const before = (await readdir(dataDir)).sort();
  await expect(
    runRestore({
      archivePath: forgedPath,
      dataDir,
      confirmToken: basename(forgedPath),
      probePort: async () => false,
      freeBytes: async () => 10 * 1024 * 1024 * 1024,
      now: () => new Date(2026, 4, 26, 18, 1, 0),
    }),
  ).rejects.toThrow(RestorePreconditionError);
  // Nothing touched: the live data dir is exactly as it was, and no
  // move-aside sibling was created for the operator to have to recover from.
  expect((await readdir(dataDir)).sort()).toEqual(before);
  const siblings = (await readdir(dirname(dataDir))).filter((e) =>
    e.startsWith(`${basename(dataDir)}.before-restore-`),
  );
  expect(siblings).toEqual([]);
});

// ── I2: SMUDGE_BACKUP_KEEP resolution ────────────────────────────────────────

describe("resolveKeep", () => {
  it("falls back to DEFAULT_KEEP when the env var is absent", () => {
    expect(resolveKeep(undefined)).toBe(DEFAULT_KEEP);
  });
  it("honors a valid non-negative integer", () => {
    expect(resolveKeep("5")).toBe(5);
  });
  it("treats an explicit 0 as 'keep none' (not a fallback)", () => {
    expect(resolveKeep("0")).toBe(0);
  });
  it("falls back to DEFAULT_KEEP for a negative value (must not wipe backups)", () => {
    expect(resolveKeep("-5")).toBe(DEFAULT_KEEP);
  });
  it.each([["abc"], ["3.5"], [""], ["  "], ["NaN"]])(
    "falls back to DEFAULT_KEEP for the invalid input %j",
    (raw) => {
      expect(resolveKeep(raw)).toBe(DEFAULT_KEEP);
    },
  );
});

it("rotateAutoBackups with keep=0 deletes every auto-backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-rot0-"));
  tempDirs.push(dir);
  for (const f of [
    "smudge-auto-2026-05-26-100000.zip",
    "smudge-auto-2026-05-26-100001.zip",
    "smudge-2026-05-01-090000.zip", // manual — must survive
  ]) {
    await writeFile(join(dir, f), Buffer.from("x"));
  }
  const { deleted } = await rotateAutoBackups({ backupsDir: dir, keep: 0 });
  expect([...deleted].sort()).toEqual([
    "smudge-auto-2026-05-26-100000.zip",
    "smudge-auto-2026-05-26-100001.zip",
  ]);
  expect(await readdir(dir)).toEqual(["smudge-2026-05-01-090000.zip"]);
});

it("rotateAutoBackups clamps a negative keep to 0 rather than over-reading", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-rotneg-"));
  tempDirs.push(dir);
  await writeFile(join(dir, "smudge-auto-2026-05-26-100000.zip"), Buffer.from("x"));
  // A negative keep must not produce a len-(-k) over-read; clamped to 0 → delete all.
  const { deleted } = await rotateAutoBackups({ backupsDir: dir, keep: -5 });
  expect(deleted).toEqual(["smudge-auto-2026-05-26-100000.zip"]);
});

// ── Task 8: rotateAutoBackups ────────────────────────────────────────────────

it("keeps newest N auto-backups; never touches manual or unrelated files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-rot-"));
  tempDirs.push(dir);
  const autos = Array.from(
    { length: 12 },
    (_, i) => `smudge-auto-2026-05-26-1000${String(i).padStart(2, "0")}.zip`,
  );
  for (const f of [
    ...autos,
    "smudge-2026-05-01-090000.zip",
    "smudge-2026-05-02-090000.zip",
    "notes.txt",
  ]) {
    await writeFile(join(dir, f), Buffer.from("x"));
  }
  const { deleted } = await rotateAutoBackups({ backupsDir: dir, keep: 10 });
  expect(deleted).toHaveLength(2); // 12 - 10
  expect([...deleted].sort()).toEqual([
    "smudge-auto-2026-05-26-100000.zip",
    "smudge-auto-2026-05-26-100001.zip",
  ]);
  const left = (await readdir(dir)).sort();
  expect(left).toContain("smudge-2026-05-01-090000.zip");
  expect(left).toContain("smudge-2026-05-02-090000.zip");
  expect(left).toContain("notes.txt");
  expect(left.filter((f) => f.startsWith("smudge-auto-"))).toHaveLength(10);
  // the two OLDEST autos are the ones gone
  expect(left).not.toContain("smudge-auto-2026-05-26-100000.zip");
  expect(left).not.toContain("smudge-auto-2026-05-26-100001.zip");
});

// ── walkFiles: no images dir (catch-return branch) ──────────────────────────

it("runBackup succeeds when there is no images directory (walkFiles readdir-catch branch)", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "smudge-noimages-"));
  tempDirs.push(dataDir);
  const dbPath = join(dataDir, "smudge.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.close();
  // No images/ dir created — exercises the walkFiles readdir-catch return.
  const backupsDir = join(dataDir, "backups");
  const { outFile } = await runBackup({
    dataDir,
    dbPath,
    backupsDir,
    mode: "manual",
    now: () => new Date(2026, 4, 26, 10, 0, 0),
  });
  const zip = await JSZip.loadAsync(await readFile(outFile));
  expect(zip.file("smudge.db")).toBeTruthy();
  // No images entries
  expect(Object.keys(zip.files).filter((k) => k.startsWith("images/"))).toHaveLength(0);
});

// ── Task 8 supplemental: rotateAutoBackups with non-existent backupsDir ─────

it("rotateAutoBackups returns empty deleted list when backupsDir does not exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-rot-nodir-"));
  tempDirs.push(dir);
  const nonExistent = join(dir, "does-not-exist");
  const { deleted } = await rotateAutoBackups({ backupsDir: nonExistent, keep: 10 });
  expect(deleted).toEqual([]);
});

// S-F5: a non-ENOENT readdir failure (EACCES/EIO) must propagate, not be
// masked as "nothing to prune" — parallels walkFiles' ENOENT-only narrowing.
it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
  "rotateAutoBackups re-throws a non-ENOENT readdir error (EACCES) instead of swallowing it",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "smudge-rot-eacces-"));
    tempDirs.push(dir);
    const locked = join(dir, "backups");
    await mkdir(locked, { recursive: true });
    await chmod(locked, 0o000); // unreadable → readdir EACCES
    try {
      await expect(rotateAutoBackups({ backupsDir: locked, keep: 10 })).rejects.toMatchObject({
        code: "EACCES",
      });
    } finally {
      await chmod(locked, 0o700); // restore so afterEach cleanup can rm it
    }
  },
);

// ── Task 9: runAutoBackup ────────────────────────────────────────────────────

it("skips when there is no database", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-auto-"));
  tempDirs.push(dir);
  const r = await runAutoBackup({
    dataDir: dir,
    dbPath: join(dir, "smudge.db"),
    backupsDir: join(dir, "backups"),
    keep: 10,
  });
  expect(r.status).toBe("skipped-no-db");
  expect(r.outFile).toBeUndefined();
});

it("skips on opt-out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smudge-auto-optout-"));
  tempDirs.push(dir);
  const r = await runAutoBackup({
    dataDir: dir,
    dbPath: join(dir, "does-not-exist.db"),
    backupsDir: join(dir, "backups"),
    keep: 10,
    skip: true,
  });
  expect(r.status).toBe("skipped-optout");
});

it("produces a smudge-auto archive and rotates, status ok", async () => {
  const { dataDir, dbPath } = await makeFixture();
  const r = await runAutoBackup({
    dataDir,
    dbPath,
    backupsDir: join(dataDir, "backups"),
    keep: 10,
    now: () => new Date(Date.UTC(2026, 4, 26, 8, 0, 0)), // UTC → deterministic filename
  });
  expect(r.status).toBe("ok");
  expect(r.outFile).toContain("smudge-auto-2026-05-26T080000Z.zip");
});

// F-15: rotateAutoBackups deliberately narrows — ENOENT is "nothing to prune",
// everything else re-throws (and that re-throw has its own test above) — and the
// sole production caller swallowed exactly that with a bare `.catch(() => {})`.
// A per-file rm that keeps failing means backups/ grows on every `make dev`
// forever, with no log line, no warning field, and status: "ok".
it("reports a rotation failure as a warning while the backup itself stays ok", async () => {
  const { dataDir, dbPath } = await makeFixture();
  const backupsDir = join(dataDir, "backups");
  await mkdir(backupsDir, { recursive: true });

  // A stale auto-backup that is really a non-empty DIRECTORY. rotateAutoBackups
  // prunes with rm(path, { force: true }) and no `recursive`, so this throws
  // EISDIR/ERR_FS_EISDIR — the same post-readdir per-file failure shape as the
  // EACCES/EPERM case the narrowing exists to preserve.
  const undeletable = join(backupsDir, "smudge-auto-2020-01-01T000000Z.zip");
  await mkdir(undeletable, { recursive: true });
  await writeFile(join(undeletable, "blocker"), "x");

  const r = await runAutoBackup({
    dataDir,
    dbPath,
    backupsDir,
    keep: 1, // forces the stale entry out of the survivor set
    now: () => new Date(Date.UTC(2026, 4, 26, 8, 0, 0)),
  });

  // The archive genuinely succeeded — this must not masquerade as a failure.
  expect(r.status).toBe("ok");
  expect(r.outFile).toContain("smudge-auto-2026-05-26T080000Z.zip");
  // ...but the operator is told pruning did not happen.
  expect(r.warning).toBeTruthy();
  expect(r.warning).toMatch(/rotat/i);
});

it("is best-effort: returns 'failed' with a warning instead of throwing", async () => {
  const { dataDir, dbPath } = await makeFixture();
  // point backupsDir at a path whose parent is a FILE, so mkdir fails
  const blocker = join(dataDir, "blocker");
  await writeFile(blocker, "x");
  const r = await runAutoBackup({
    dataDir,
    dbPath,
    backupsDir: join(blocker, "backups"),
    keep: 10,
  });
  expect(r.status).toBe("failed");
  expect(r.warning).toBeTruthy();
});
