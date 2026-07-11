import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";

// I1 (F3): a live `make backup` runs while the server can unlink an image
// between `walkFiles`' readdir and the per-file readFile. That ENOENT must be
// skipped (the backup is advertised as safe-while-running); any OTHER read
// error must still fail the backup loudly (no silent image loss). Named-import
// spying can't intercept backup-core's `readFile` under ESM ("namespace is not
// configurable"), so this dedicated file vi.mock's node:fs/promises with a
// per-test injected error, delegating every other path to the real fs.
let injected: { match: (p: string) => boolean; code: string } | undefined;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    readFile: ((p: unknown, ...rest: unknown[]) => {
      if (injected && typeof p === "string" && injected.match(p)) {
        const err = new Error("injected") as NodeJS.ErrnoException;
        err.code = injected.code;
        return Promise.reject(err);
      }
      return (actual.readFile as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof actual.readFile,
  };
});

const { runBackup } = await import("../backup-core");
const { readFile: realReadFile } = await vi.importActual<typeof import("node:fs/promises")>(
  "node:fs/promises",
);

const tempDirs: string[] = [];
beforeEach(() => {
  injected = undefined;
});
afterEach(async () => {
  injected = undefined;
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

async function makeFixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "smudge-backup-ci-"));
  tempDirs.push(dataDir);
  const dbPath = join(dataDir, "smudge.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
  db.close();
  await mkdir(join(dataDir, "images", "proj-1"), { recursive: true });
  await writeFile(join(dataDir, "images", "proj-1", "a.png"), Buffer.from([1, 2, 3]));
  await writeFile(join(dataDir, "images", "proj-1", "b.png"), Buffer.from([4, 5, 6]));
  return { dataDir, dbPath, backupsDir: join(dataDir, "backups") };
}

describe("runBackup concurrent image delete (I1/F3)", () => {
  it("skips an image unlinked mid-walk (ENOENT) and still produces a valid backup", async () => {
    const { dataDir, dbPath, backupsDir } = await makeFixture();
    injected = { match: (p) => p.endsWith("a.png"), code: "ENOENT" };

    const { outFile } = await runBackup({
      dataDir,
      dbPath,
      backupsDir,
      mode: "manual",
      now: () => new Date(2026, 4, 26, 14, 32, 11),
    });

    const zip = await JSZip.loadAsync(await realReadFile(outFile));
    expect(zip.file("smudge.db")).toBeTruthy();
    expect(zip.file("images/proj-1/b.png")).toBeTruthy();
    expect(zip.file("images/proj-1/a.png")).toBeNull(); // the deleted image is skipped, not fatal
  });

  it("still fails loudly when an image read fails non-ENOENT (EACCES)", async () => {
    const { dataDir, dbPath, backupsDir } = await makeFixture();
    injected = { match: (p) => p.endsWith("a.png"), code: "EACCES" };

    await expect(
      runBackup({
        dataDir,
        dbPath,
        backupsDir,
        mode: "manual",
        now: () => new Date(2026, 4, 26, 14, 32, 11),
      }),
    ).rejects.toMatchObject({ code: "EACCES" });
  });
});
