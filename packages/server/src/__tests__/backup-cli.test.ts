import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";

const run = promisify(execFile);
const REPO = join(__dirname, "../../../.."); // /workspace/packages/server/src/__tests__ → 4× .. → /workspace

/**
 * Returns a snapshot of the smudge-*.zip filenames currently in backups/,
 * excluding smudge-auto-* archives so each test identifies its own output.
 */
async function manualArchivesBefore(): Promise<Set<string>> {
  try {
    const entries = await readdir(join(REPO, "backups"));
    return new Set(
      entries.filter((f) => f.startsWith("smudge-") && !f.startsWith("smudge-auto-")),
    );
  } catch {
    return new Set();
  }
}

/**
 * A successful restore moves the data dir aside to `<dataDir>.before-restore-<stamp>`
 * (a sibling in the same parent). Remove any such sibling so the test leaves no
 * residue in os.tmpdir().
 */
async function removeMovedAsideSiblings(dir: string): Promise<void> {
  try {
    const parent = dirname(dir);
    const prefix = `${basename(dir)}.before-restore-`;
    for (const entry of await readdir(parent)) {
      if (entry.startsWith(prefix)) {
        await rm(join(parent, entry), { recursive: true, force: true });
      }
    }
  } catch {
    /* parent unreadable / already gone — nothing to clean */
  }
}

describe("backup CLI wiring", () => {
  it("make backup → make restore round-trips end-to-end via the shells", async () => {
    const before = await manualArchivesBefore();
    const dataDir = await mkdtemp(join(tmpdir(), "smudge-cli-"));
    let archive: string | null = null;

    try {
      const db = new Database(join(dataDir, "smudge.db"));
      db.exec("CREATE TABLE t (v TEXT)");
      db.prepare("INSERT INTO t VALUES (?)").run("cli");
      db.close();
      await mkdir(join(dataDir, "images", "p"), { recursive: true });
      await writeFile(join(dataDir, "images", "p", "a.png"), Buffer.from([7]));
      const env = { ...process.env, DATA_DIR: dataDir };

      await run("make", ["backup"], { cwd: REPO, env });

      // Set-difference: identify the archive THIS test produced (not a concurrent one).
      const after = await readdir(join(REPO, "backups"));
      const newFiles = after.filter(
        (f) => f.startsWith("smudge-") && !f.startsWith("smudge-auto-") && !before.has(f),
      );
      expect(newFiles.length).toBeGreaterThanOrEqual(1);
      const filename = newFiles.sort().pop()!;
      archive = join(REPO, "backups", filename);

      // Pipe the confirmation token (the filename) to restore via stdin.
      await run(
        "bash",
        ["-c", `echo '${filename}' | node_modules/.bin/tsx packages/server/scripts/restore.ts`],
        { cwd: REPO, env: { ...env, BACKUP: archive } },
      );

      const restored = new Database(join(dataDir, "smudge.db"), { readonly: true });
      expect(restored.prepare("SELECT v FROM t").get()).toEqual({ v: "cli" });
      restored.close();
    } finally {
      if (archive) await rm(archive, { force: true });
      await rm(dataDir, { recursive: true, force: true });
      await removeMovedAsideSiblings(dataDir);
    }
  }, 60_000);

  it("restore refuses while a server is bound on SMUDGE_PORT", async () => {
    const { createServer } = await import("node:net");
    const before = await manualArchivesBefore();
    const dataDir = await mkdtemp(join(tmpdir(), "smudge-cli2-"));
    let archive: string | null = null;
    const srv = createServer().listen(39999, "127.0.0.1");
    await new Promise<void>((r) => srv.once("listening", r));

    try {
      const db = new Database(join(dataDir, "smudge.db"));
      db.exec("CREATE TABLE t (v TEXT)");
      db.close();
      const env = { ...process.env, DATA_DIR: dataDir, SMUDGE_PORT: "39999" };

      await run("make", ["backup"], { cwd: REPO, env });

      const after = await readdir(join(REPO, "backups"));
      const newFiles = after.filter(
        (f) => f.startsWith("smudge-") && !f.startsWith("smudge-auto-") && !before.has(f),
      );
      expect(newFiles.length).toBeGreaterThanOrEqual(1);
      const filename = newFiles.sort().pop()!;
      archive = join(REPO, "backups", filename);

      await expect(
        run(
          "bash",
          ["-c", `echo '${filename}' | node_modules/.bin/tsx packages/server/scripts/restore.ts`],
          { cwd: REPO, env: { ...env, BACKUP: archive } },
        ),
      ).rejects.toThrow();
    } finally {
      srv.close();
      if (archive) await rm(archive, { force: true });
      await rm(dataDir, { recursive: true, force: true });
      await removeMovedAsideSiblings(dataDir);
    }
  }, 60_000);
});
