# Operational Backup Stopgap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the developer-operator an automatic, rotated SQLite+images backup on every `make dev`, plus manual `make backup` / `make restore` commands, as an interim escape hatch from DB corruption until Phase 8b.

**Architecture:** Pure, path-injected logic in `packages/server/src/backup/backup-core.ts` (under coverage); three thin coverage-excluded shells in `packages/server/scripts/` (`backup.ts`, `restore.ts`, `auto-backup.ts`) that resolve real paths via `config/paths.ts`, wire real fs / `better-sqlite3` / `jszip`, and call the core. Makefile targets invoke the shells via `tsx`; `make dev` gains a best-effort `auto-backup` prerequisite. Restore is guarded by zip-slip validation, decompression-bomb limits, an HTTP port probe, a typed-filename confirmation, and move-aside-never-delete.

**Tech Stack:** TypeScript, `better-sqlite3` (`VACUUM INTO`), `jszip` (promoted devDep→dep, MIT election), Vitest, GNU Make, `tsx`.

**Design:** `docs/plans/2026-05-26-operational-backup-stopgap-design.md` (all 6 pushback findings + the 2026-06-03 auto-backup pivot folded in).

**Repo constraints honored throughout:** TDD red/green/refactor; coverage floor 95/85/90/95 (core under coverage, shells excluded); zero unasserted warnings in test output; single PR for the whole phase.

---

## File Structure

| File | Responsibility | Coverage |
|------|----------------|----------|
| `packages/server/src/backup/backup-core.ts` | All logic: stamp/name helpers, `runBackup`, `validateEntryPaths`, `readCentralDirectorySizes`, `checkDeclaredSizes`, `runRestore`, `rotateAutoBackups`, `runAutoBackup`. Path-pure (takes resolved paths as params). | **Under coverage** |
| `packages/server/src/backup/__tests__/backup-core.test.ts` | In-process unit tests against a temp `dataDir` fixture, real fs + better-sqlite3. | n/a |
| `packages/server/scripts/backup.ts` | Thin shell: resolve paths via `config/paths.ts`, call `runBackup({mode:"manual"})`. | **Excluded** |
| `packages/server/scripts/auto-backup.ts` | Thin shell: call `runAutoBackup(...)` (best-effort, rotation). | **Excluded** |
| `packages/server/scripts/restore.ts` | Thin shell: parse argv (`--max-uncompressed`, `--max-ratio`), read stdin confirmation, real TCP port probe, call `runRestore`. | **Excluded** |
| `packages/server/src/__tests__/backup-cli.test.ts` | One child-process wiring smoke test + port-probe-refusal test. | n/a |
| `Makefile` | `backup`, `auto-backup`, `restore` targets; `dev` gains `auto-backup` prereq. | n/a |
| `.gitignore` | Ignore `backups/` + `*.backup-staging.db`. | n/a |
| `docs/backup.md` | One-page operator recipe. | n/a |
| `CLAUDE.md` | §Build & Run Commands: document the three targets + `make dev` side-effect. | n/a |
| `packages/server/package.json` | Promote `jszip` devDep→dep. | n/a |
| `docs/dependency-licenses.md` | jszip MIT election row. | n/a |
| `vitest.config.ts` (root) | Add the three shells to `coverage.exclude`. | n/a |

**Shared type/function names (stable across tasks):**

```ts
type BackupMode = "manual" | "auto";
function isoStampLocal(d: Date): string;                       // "2026-05-26-143211"
function buildBackupName(stamp: string, mode: BackupMode): string; // smudge[-auto]-<stamp>.zip
interface BackupOptions { dataDir: string; dbPath: string; backupsDir: string; mode: BackupMode; now?: () => Date; }
async function runBackup(o: BackupOptions): Promise<{ outFile: string }>;
class ZipSlipError extends Error {}                            // message names the offending entry
function validateEntryPaths(entryPaths: string[], targetRoot: string): void;
function readCentralDirectorySizes(zipBytes: Buffer): { path: string; uncompressedSize: number }[];
interface BombLimits { maxUncompressed: number; maxRatio: number; }
class DecompressionBombError extends Error {}
function checkDeclaredSizes(entries: { uncompressedSize: number }[], compressedTotal: number, limits: BombLimits): void;
interface RestoreOptions { archivePath: string; dataDir: string; confirmToken: string; now?: () => Date; probePort?: () => Promise<boolean>; limits?: BombLimits; }
async function runRestore(o: RestoreOptions): Promise<{ movedAsideTo: string }>;
async function rotateAutoBackups(o: { backupsDir: string; keep: number }): Promise<{ deleted: string[] }>;
type AutoStatus = "ok" | "skipped-no-db" | "skipped-optout" | "failed";
async function runAutoBackup(o: { dataDir: string; dbPath: string; backupsDir: string; keep: number; skip?: boolean; now?: () => Date }): Promise<{ status: AutoStatus; outFile?: string; warning?: string }>;
const DEFAULT_BOMB_LIMITS: BombLimits = { maxUncompressed: 2 * 1024 ** 3, maxRatio: 10 };
const DEFAULT_KEEP = 10;
```

---

## Task 1: Promote jszip to a runtime dependency + license election

**Files:**
- Modify: `packages/server/package.json`
- Modify: `docs/dependency-licenses.md`

- [ ] **Step 1: Confirm the license string**

Run: `node -e "console.log(require('jszip/package.json').license)"`
Expected: `(MIT OR GPL-3.0-or-later)`

- [ ] **Step 2: Move `jszip` from devDependencies to dependencies**

In `packages/server/package.json`, delete the `"jszip": "^3.10.1"` line from `devDependencies` and add it to `dependencies` (keep the same version `^3.10.1` so the lockfile version is unchanged — no cooldown trigger).

- [ ] **Step 3: Reinstall to update the lockfile graph (no version change)**

Run: `npm install`
Expected: `package-lock.json` shows `jszip` reachable as a prod dep of `packages/server`; the resolved version stays `3.10.1`.

- [ ] **Step 4: Record the MIT election**

Add a row to `docs/dependency-licenses.md` for `jszip` — license `MIT OR GPL-3.0-or-later`, **elected: MIT** (per CLAUDE.md §Dependency Licenses #5), note: "Promoted devDep→dep in Phase 4b.14 for backup/restore zipping."

- [ ] **Step 5: Verify the cooldown gate stays green**

Run: `make dep-cooldown`
Expected: pass — jszip 3.10.1 is years old, no new young version introduced.

- [ ] **Step 6: Commit**

```bash
git add packages/server/package.json package-lock.json docs/dependency-licenses.md
git commit -m "build(4b.14): promote jszip to a runtime dep; elect MIT"
```

---

## Task 2: Timestamp + archive-name helpers

**Files:**
- Create: `packages/server/src/backup/backup-core.ts`
- Create: `packages/server/src/backup/__tests__/backup-core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isoStampLocal, buildBackupName } from "../backup-core";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w packages/server -- backup-core`
Expected: FAIL — cannot find module `../backup-core`.

- [ ] **Step 3: Implement the helpers**

Create `backup-core.ts`:

```ts
export type BackupMode = "manual" | "auto";

export const DEFAULT_KEEP = 10;
export const DEFAULT_BOMB_LIMITS = { maxUncompressed: 2 * 1024 ** 3, maxRatio: 10 } as const;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Local-time stamp "YYYY-MM-DD-HHmmss" (hyphens only — filesystem-safe). */
export function isoStampLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function buildBackupName(stamp: string, mode: BackupMode): string {
  return mode === "auto" ? `smudge-auto-${stamp}.zip` : `smudge-${stamp}.zip`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w packages/server -- backup-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/backup/backup-core.ts packages/server/src/backup/__tests__/backup-core.test.ts
git commit -m "feat(4b.14): backup stamp + archive-name helpers"
```

---

## Task 3: `runBackup` — VACUUM INTO snapshot + zip (round-trip foundation)

**Files:**
- Modify: `packages/server/src/backup/backup-core.ts`
- Modify: `packages/server/src/backup/__tests__/backup-core.test.ts`

- [ ] **Step 1: Write the failing test (round-trip of DB + nested images)**

```ts
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { runBackup } from "../backup-core";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/server -- backup-core`
Expected: FAIL — `runBackup` not exported.

- [ ] **Step 3: Implement `runBackup`**

Add to `backup-core.ts`:

```ts
import Database from "better-sqlite3";
import JSZip from "jszip";
import { mkdir, rm, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface BackupOptions {
  dataDir: string;
  dbPath: string;
  backupsDir: string;
  mode: BackupMode;
  now?: () => Date;
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // images dir may not exist yet
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full);
    else if (e.isFile()) yield full;
  }
}

export async function runBackup(opts: BackupOptions): Promise<{ outFile: string }> {
  const now = (opts.now ?? (() => new Date()))();
  const stamp = isoStampLocal(now);
  const outFile = join(opts.backupsDir, buildBackupName(stamp, opts.mode));
  const staging = join(opts.dataDir, `${stamp}.${process.pid}.backup-staging.db`);

  await mkdir(opts.backupsDir, { recursive: true });
  await rm(staging, { force: true });
  try {
    const db = new Database(opts.dbPath, { readonly: true });
    try {
      db.exec(`VACUUM INTO '${staging.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }

    const zip = new JSZip();
    zip.file("smudge.db", await readFile(staging));
    const imagesDir = join(opts.dataDir, "images");
    for await (const file of walkFiles(imagesDir)) {
      const rel = relative(opts.dataDir, file).split(sep).join("/"); // images/<proj>/<file>
      zip.file(rel, await readFile(file));
    }

    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const tmpOut = `${outFile}.tmp`;
    await writeFile(tmpOut, buf);
    await rm(outFile, { force: true });
    const { rename } = await import("node:fs/promises");
    await rename(tmpOut, outFile); // atomic publish
    return { outFile };
  } finally {
    await rm(staging, { force: true });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/server -- backup-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/backup/
git commit -m "feat(4b.14): runBackup — VACUUM INTO snapshot + zip with nested images"
```

---

## Task 4: Live-DB safety test (VACUUM INTO under an open write transaction)

**Files:**
- Modify: `packages/server/src/backup/__tests__/backup-core.test.ts`

- [ ] **Step 1: Write the test**

```ts
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
```

- [ ] **Step 2: Run to verify it passes (behavior already implemented)**

Run: `npm test -w packages/server -- backup-core`
Expected: PASS — `VACUUM INTO` reads a consistent committed snapshot.

> Note: This is a characterization test of existing behavior (no red phase needed); it locks in the live-safety contract.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/backup/__tests__/backup-core.test.ts
git commit -m "test(4b.14): VACUUM INTO snapshots committed state under open write txn"
```

---

## Task 5: `validateEntryPaths` — zip-slip defense

**Files:**
- Modify: `packages/server/src/backup/backup-core.ts`
- Modify: `packages/server/src/backup/__tests__/backup-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { ZipSlipError, validateEntryPaths } from "../backup-core";

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
    ["foo bar"],
  ])("rejects %s and names it", (bad) => {
    expect(() => validateEntryPaths([bad], root)).toThrow(ZipSlipError);
    try { validateEntryPaths([bad], root); } catch (e) { expect((e as Error).message).toContain(bad); }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/server -- backup-core`
Expected: FAIL — `validateEntryPaths`/`ZipSlipError` not exported.

- [ ] **Step 3: Implement**

```ts
import { resolve, isAbsolute, win32 } from "node:path";

export class ZipSlipError extends Error {}

export function validateEntryPaths(entryPaths: string[], targetRoot: string): void {
  const root = resolve(targetRoot);
  for (const p of entryPaths) {
    if (p.includes(" ")) throw new ZipSlipError(`null byte in entry path: ${p}`);
    if (isAbsolute(p) || win32.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) {
      throw new ZipSlipError(`absolute entry path rejected: ${p}`);
    }
    if (p.split(/[\\/]/).includes("..")) {
      throw new ZipSlipError(`'..' segment rejected: ${p}`);
    }
    const dest = resolve(root, p);
    if (dest !== root && !dest.startsWith(root + sep)) {
      throw new ZipSlipError(`entry escapes target dir: ${p}`);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/server -- backup-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/backup/
git commit -m "feat(4b.14): zip-slip path validation for restore"
```

---

## Task 6: Declared-size reader + bomb-limit check

**Files:**
- Modify: `packages/server/src/backup/backup-core.ts`
- Modify: `packages/server/src/backup/__tests__/backup-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { readCentralDirectorySizes, checkDeclaredSizes, DecompressionBombError, DEFAULT_BOMB_LIMITS } from "../backup-core";
import JSZip from "jszip";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/server -- backup-core`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Implement (minimal ZIP central-directory parse, non-zip64)**

```ts
export class DecompressionBombError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const ZIP64_SENTINEL = 0xffffffff;

/** Parse declared uncompressed sizes from the central directory without decompressing. */
export function readCentralDirectorySizes(buf: Buffer): { path: string; uncompressedSize: number }[] {
  // Locate EOCD by scanning backwards (max comment 64KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new DecompressionBombError("not a valid zip (no EOCD)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === ZIP64_SENTINEL) throw new DecompressionBombError("zip64 archive refused (declared sizes unverifiable)");
  const out: { path: string; uncompressedSize: number }[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== CEN_SIG) throw new DecompressionBombError("corrupt central directory");
    const uncompressed = buf.readUInt32LE(off + 24);
    if (uncompressed === ZIP64_SENTINEL) throw new DecompressionBombError("zip64 entry refused");
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const path = buf.toString("utf8", off + 46, off + 46 + nameLen);
    out.push({ path, uncompressedSize: uncompressed });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export interface BombLimits { maxUncompressed: number; maxRatio: number; }

export function checkDeclaredSizes(
  entries: { uncompressedSize: number }[],
  compressedTotal: number,
  limits: BombLimits,
): void {
  const total = entries.reduce((n, e) => n + e.uncompressedSize, 0);
  if (total > limits.maxUncompressed) {
    throw new DecompressionBombError(
      `decompression bomb: declared ${total} bytes exceeds cap ${limits.maxUncompressed}`,
    );
  }
  if (compressedTotal > 0 && total / compressedTotal > limits.maxRatio) {
    throw new DecompressionBombError(
      `decompression bomb: ratio ${(total / compressedTotal).toFixed(1)} exceeds ${limits.maxRatio}`,
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/server -- backup-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/backup/
git commit -m "feat(4b.14): central-directory size reader + decompression-bomb limits"
```

---

## Task 7: `runRestore` — validate, probe, confirm, move-aside, extract

**Files:**
- Modify: `packages/server/src/backup/backup-core.ts`
- Modify: `packages/server/src/backup/__tests__/backup-core.test.ts`

- [ ] **Step 1: Write the failing tests (happy path + all guards)**

```ts
import { runRestore } from "../backup-core";
import { basename } from "node:path";

async function makeArchive(dataDir: string, mode: "manual" = "manual") {
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
  // data dir untouched: original DB intact, no move-aside sibling created
  expect(await readFile(join(dataDir, "smudge.db"))).toEqual(before);
  expect((await readdir(join(dataDir, ".."))).some((f) => f.includes(".before-restore-"))).toBe(false);
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
```

> These two cases prove `runRestore` validates **before** it touches the data dir (the two-pass contract), not just that the validators work in isolation. `ZipSlipError`/`DecompressionBombError`/`readdir` are already imported in this file (Tasks 3/5/6).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/server -- backup-core`
Expected: FAIL — `runRestore` not exported.

- [ ] **Step 3: Implement**

```ts
export interface RestoreOptions {
  archivePath: string;
  dataDir: string;
  confirmToken: string;
  now?: () => Date;
  probePort?: () => Promise<boolean>;
  limits?: BombLimits;
}

export async function runRestore(opts: RestoreOptions): Promise<{ movedAsideTo: string }> {
  const limits = opts.limits ?? { ...DEFAULT_BOMB_LIMITS };
  const { basename } = await import("node:path");
  const buf = await readFile(opts.archivePath);

  // 1. zip-slip + presence validation (read names from central directory)
  const sizes = readCentralDirectorySizes(buf);
  const names = sizes.map((e) => e.path);
  validateEntryPaths(names, opts.dataDir);
  if (!names.includes("smudge.db")) {
    throw new Error(`archive is missing smudge.db: ${opts.archivePath}`);
  }
  // 2. bomb limits (declared sizes, before loadAsync)
  checkDeclaredSizes(sizes, buf.length, limits);
  // 3. running-server probe
  if (opts.probePort && (await opts.probePort())) {
    throw new Error("Smudge is running — stop it and rerun restore.");
  }
  // 4. typed-filename confirmation
  if (opts.confirmToken !== basename(opts.archivePath)) {
    throw new Error("restore not confirmed: token did not match the backup filename.");
  }
  // 5. move existing data dir aside (never delete)
  const stamp = isoStampLocal((opts.now ?? (() => new Date()))());
  const movedAsideTo = `${opts.dataDir}.before-restore-${stamp}`;
  const { rename } = await import("node:fs/promises");
  await rename(opts.dataDir, movedAsideTo).catch(async (e) => {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") { /* nothing to move */ }
    else throw e;
  });
  await mkdir(opts.dataDir, { recursive: true });

  // 6. extract with a post-extraction cumulative-size assertion
  const declaredTotal = sizes.reduce((n, e) => n + e.uncompressedSize, 0);
  let written = 0;
  const zip = await JSZip.loadAsync(buf);
  for (const name of names) {
    const file = zip.file(name);
    if (!file) continue;
    const bytes = await file.async("nodebuffer");
    written += bytes.length;
    if (written > declaredTotal + 1024 * 1024) {
      // Rare lying-archive case (central directory under-declared sizes). We do
      // NOT roll back the partial extraction: the original data is preserved at
      // movedAsideTo, so there is no data loss — the operator recovers from the
      // move-aside dir. See design §2b.
      throw new DecompressionBombError("extraction exceeded declared size — aborting");
    }
    const dest = join(opts.dataDir, name);
    await mkdir(join(dest, ".."), { recursive: true });
    await writeFile(dest, bytes);
  }
  return { movedAsideTo };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/server -- backup-core`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/backup/
git commit -m "feat(4b.14): runRestore with zip-slip/bomb/port/confirm guards + move-aside"
```

---

## Task 8: `rotateAutoBackups` — prune only `smudge-auto-*`

**Files:**
- Modify: `packages/server/src/backup/backup-core.ts`
- Modify: `packages/server/src/backup/__tests__/backup-core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { rotateAutoBackups } from "../backup-core";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/server -- backup-core`
Expected: FAIL — `rotateAutoBackups` not exported.

- [ ] **Step 3: Implement**

```ts
export async function rotateAutoBackups(o: { backupsDir: string; keep: number }): Promise<{ deleted: string[] }> {
  let names: string[];
  try {
    names = await readdir(o.backupsDir);
  } catch {
    return { deleted: [] };
  }
  const autos = names.filter((f) => f.startsWith("smudge-auto-") && f.endsWith(".zip")).sort(); // lexical == chronological
  const toDelete = autos.slice(0, Math.max(0, autos.length - o.keep));
  for (const f of toDelete) await rm(join(o.backupsDir, f), { force: true });
  return { deleted: toDelete };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/server -- backup-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/backup/
git commit -m "feat(4b.14): rotateAutoBackups prunes only smudge-auto-* archives"
```

---

## Task 9: `runAutoBackup` — skip conditions + best-effort

**Files:**
- Modify: `packages/server/src/backup/backup-core.ts`
- Modify: `packages/server/src/backup/__tests__/backup-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { runAutoBackup } from "../backup-core";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/server -- backup-core`
Expected: FAIL — `runAutoBackup` not exported.

- [ ] **Step 3: Implement**

```ts
import { access } from "node:fs/promises";

export type AutoStatus = "ok" | "skipped-no-db" | "skipped-optout" | "failed";

export async function runAutoBackup(o: {
  dataDir: string; dbPath: string; backupsDir: string; keep: number; skip?: boolean; now?: () => Date;
}): Promise<{ status: AutoStatus; outFile?: string; warning?: string }> {
  if (o.skip) return { status: "skipped-optout" };
  try {
    await access(o.dbPath);
  } catch {
    return { status: "skipped-no-db" };
  }
  try {
    const { outFile } = await runBackup({
      dataDir: o.dataDir, dbPath: o.dbPath, backupsDir: o.backupsDir, mode: "auto", now: o.now,
    });
    await rotateAutoBackups({ backupsDir: o.backupsDir, keep: o.keep }).catch(() => {/* rotation is best-effort */});
    return { status: "ok", outFile };
  } catch (e) {
    return { status: "failed", warning: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/server -- backup-core`
Expected: PASS.

- [ ] **Step 5: Run full server coverage to confirm the core clears the floor**

Run: `npx vitest run --coverage` (or `make cover`)
Expected: PASS — `backup-core.ts` ≥95% lines/statements, ≥85% branches, ≥90% functions. Add targeted tests for any uncovered branch before proceeding.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/backup/
git commit -m "feat(4b.14): runAutoBackup — skip conditions + best-effort rotation"
```

---

## Task 10: Thin shells + coverage exclusion

**Files:**
- Create: `packages/server/scripts/backup.ts`
- Create: `packages/server/scripts/auto-backup.ts`
- Create: `packages/server/scripts/restore.ts`
- Modify: `vitest.config.ts` (root)

- [ ] **Step 1: Add the shells to the coverage-exclude list FIRST (so the new files never count against the floor)**

In root `vitest.config.ts`, append to `coverage.exclude` (after the `dep-cooldown.mjs` entry):

```ts
        // Thin IO shells for `make backup` / `make dev` auto-backup / `make restore`.
        // The testable logic lives in packages/server/src/backup/backup-core.ts
        // (under coverage). Same precedent as ensure-native.mjs / dep-cooldown.mjs.
        "packages/server/scripts/backup.ts",
        "packages/server/scripts/auto-backup.ts",
        "packages/server/scripts/restore.ts",
```

- [ ] **Step 2: Write `scripts/backup.ts`**

```ts
import { join } from "node:path";
import { getDataDir, getDbPath } from "../src/config/paths";
import { runBackup } from "../src/backup/backup-core";

const dataDir = getDataDir();
const { outFile } = await runBackup({
  dataDir, dbPath: getDbPath(), backupsDir: join(process.cwd(), "backups"), mode: "manual",
});
console.log(`Backup written: ${outFile}`);
```

- [ ] **Step 3: Write `scripts/auto-backup.ts`**

```ts
import { join } from "node:path";
import { getDataDir, getDbPath } from "../src/config/paths";
import { runAutoBackup, DEFAULT_KEEP } from "../src/backup/backup-core";

const keep = Number(process.env.SMUDGE_BACKUP_KEEP ?? DEFAULT_KEEP) || DEFAULT_KEEP;
const r = await runAutoBackup({
  dataDir: getDataDir(),
  dbPath: getDbPath(),
  backupsDir: join(process.cwd(), "backups"),
  keep,
  skip: process.env.SMUDGE_SKIP_AUTO_BACKUP === "1",
});
if (r.status === "ok") console.log(`Auto-backup: ${r.outFile}`);
else if (r.status === "skipped-no-db") console.log("Auto-backup: no database yet — skipping.");
else if (r.status === "skipped-optout") console.log("Auto-backup skipped (SMUDGE_SKIP_AUTO_BACKUP).");
else console.error(`WARNING: auto-backup failed: ${r.warning} — starting Smudge anyway.`);
// Always exit 0: best-effort, must never block `make dev`.
```

- [ ] **Step 4: Write `scripts/restore.ts`**

```ts
import { createInterface } from "node:readline/promises";
import { connect } from "node:net";
import { basename } from "node:path";
import { getDataDir } from "../src/config/paths";
import { runRestore, DEFAULT_BOMB_LIMITS } from "../src/backup/backup-core";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

const archivePath = process.env.BACKUP;
if (!archivePath) {
  console.error("Usage: make restore BACKUP=backups/smudge-….zip");
  process.exit(2);
}

const port = Number(process.env.SMUDGE_PORT ?? 3456);
const probePort = () =>
  new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    for (const host of ["127.0.0.1", "::1"]) {
      const s = connect({ host, port }, () => { s.destroy(); finish(true); });
      s.on("error", () => finish(false));
      s.setTimeout(500, () => { s.destroy(); finish(false); });
    }
  });

const rl = createInterface({ input: process.stdin, output: process.stdout });
const confirmToken = (await rl.question(
  `This OVERWRITES the data dir at ${getDataDir()}.\nType the backup filename (${basename(archivePath)}) to confirm: `,
)).trim();
rl.close();

try {
  const { movedAsideTo } = await runRestore({
    archivePath,
    dataDir: getDataDir(),
    confirmToken,
    probePort,
    limits: {
      maxUncompressed: Number(arg("max-uncompressed") ?? DEFAULT_BOMB_LIMITS.maxUncompressed),
      maxRatio: Number(arg("max-ratio") ?? DEFAULT_BOMB_LIMITS.maxRatio),
    },
  });
  console.log(`Restored from ${archivePath}. Previous data preserved at ${movedAsideTo}.`);
} catch (e) {
  console.error(`Restore aborted: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
```

- [ ] **Step 5: Verify coverage still passes (shells excluded, core unchanged)**

Run: `make cover`
Expected: PASS — the new shells do not appear in the coverage report.

- [ ] **Step 6: Commit**

```bash
git add packages/server/scripts/ vitest.config.ts
git commit -m "feat(4b.14): thin backup/auto-backup/restore shells; exclude from coverage"
```

---

## Task 11: Makefile targets + `make dev` auto-backup prerequisite

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add the three targets and wire `dev`**

Add `backup auto-backup restore` to the `.PHONY` line. Add the targets:

```makefile
backup: ensure-native ## Make an on-demand backup zip under backups/
	@node_modules/.bin/tsx packages/server/scripts/backup.ts

# best-effort: a backup hiccup must never block the dev server (|| true).
auto-backup: ensure-native
	@node_modules/.bin/tsx packages/server/scripts/auto-backup.ts || true

restore: ensure-native ## Restore a backup zip: make restore BACKUP=backups/smudge-….zip
	@node_modules/.bin/tsx packages/server/scripts/restore.ts
```

Then add `auto-backup` as a prerequisite of the existing `dev` target (do not change its recipe), e.g. `dev: ensure-native auto-backup`.

- [ ] **Step 2: Verify `make backup` works against the real dev data dir**

Run: `make backup`
Expected: prints `Backup written: …/backups/smudge-<stamp>.zip`; the file exists. (If there is no `packages/server/data/smudge.db` yet, run the app once first, or rely on the Task 12 fixture test.)

- [ ] **Step 3: Verify `make dev` still starts and triggers auto-backup**

Run: `make dev` (then Ctrl-C once it's up)
Expected: an `Auto-backup: …` or `no database yet — skipping` line appears before the servers start; the dev server starts regardless.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(4b.14): make backup/auto-backup/restore targets; dev auto-backups"
```

---

## Task 12: `.gitignore` + child-process wiring smoke test

**Files:**
- Modify: `.gitignore`
- Create: `packages/server/src/__tests__/backup-cli.test.ts`

- [ ] **Step 1: Update `.gitignore`**

Append:

```gitignore
# Operational backups (Phase 4b.14) — never commit the writer's manuscript.
backups/
*.backup-staging.db
```

(Confirm `packages/server/data/` is already ignored; if not, that is a separate pre-existing gap — note it but do not expand scope here.)

- [ ] **Step 2: Write the wiring smoke test (the only child-process test)**

```ts
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const run = promisify(execFile);
const REPO = join(__dirname, "../../../.."); // repo root

it("make backup → make restore round-trips end-to-end via the shells", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "smudge-cli-"));
  const db = new Database(join(dataDir, "smudge.db"));
  db.exec("CREATE TABLE t (v TEXT)");
  db.prepare("INSERT INTO t VALUES (?)").run("cli");
  db.close();
  await mkdir(join(dataDir, "images", "p"), { recursive: true });
  await writeFile(join(dataDir, "images", "p", "a.png"), Buffer.from([7]));
  const env = { ...process.env, DATA_DIR: dataDir };

  await run("make", ["backup"], { cwd: REPO, env });
  const entries = await readdir(join(REPO, "backups"));
  const file = entries.filter((f) => f.startsWith("smudge-") && !f.startsWith("smudge-auto-")).sort().pop()!;
  const archive = join(REPO, "backups", file);

  // pipe the confirmation token (the filename) to restore
  await run("bash", ["-c", `echo '${file}' | node_modules/.bin/tsx packages/server/scripts/restore.ts`],
    { cwd: REPO, env: { ...env, BACKUP: archive } });

  const restored = new Database(join(dataDir, "smudge.db"), { readonly: true });
  expect(restored.prepare("SELECT v FROM t").get()).toEqual({ v: "cli" });
  restored.close();

  await rm(archive, { force: true });
  await rm(dataDir, { recursive: true, force: true });
}, 60_000);

it("restore refuses while a server is bound on SMUDGE_PORT", async () => {
  const { createServer } = await import("node:net");
  const dataDir = await mkdtemp(join(tmpdir(), "smudge-cli2-"));
  const db = new Database(join(dataDir, "smudge.db")); db.exec("CREATE TABLE t (v TEXT)"); db.close();
  const env = { ...process.env, DATA_DIR: dataDir, SMUDGE_PORT: "39999" };
  await run("make", ["backup"], { cwd: REPO, env });
  const file = (await readdir(join(REPO, "backups")))
    .filter((f) => f.startsWith("smudge-") && !f.startsWith("smudge-auto-")).sort().pop()!;
  const srv = createServer().listen(39999, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  await expect(
    run("bash", ["-c", `echo '${file}' | node_modules/.bin/tsx packages/server/scripts/restore.ts`],
      { cwd: REPO, env: { ...env, BACKUP: join(REPO, "backups", file) } }),
  ).rejects.toThrow();
  srv.close();
  await rm(join(REPO, "backups", file), { force: true });
  await rm(dataDir, { recursive: true, force: true });
}, 60_000);
```

> Note: if `make` is unavailable in CI for this test, fall back to invoking the shell directly via `tsx` as the second case does. Keep this the *only* child-process test — all logic coverage comes from Task 2–9.

- [ ] **Step 3: Run the smoke tests**

Run: `npm test -w packages/server -- backup-cli`
Expected: PASS (both cases).

- [ ] **Step 4: Confirm backups are not stageable**

Run: `git status --porcelain backups/`
Expected: empty (the `backups/` produced by the test is ignored).

- [ ] **Step 5: Commit**

```bash
git add .gitignore packages/server/src/__tests__/backup-cli.test.ts
git commit -m "test(4b.14): CLI wiring smoke test + port-probe refusal; ignore backups/"
```

---

## Task 13: `docs/backup.md`

**Files:**
- Create: `docs/backup.md`

- [ ] **Step 1: Write the doc**

Write `docs/backup.md` following the §3 outline of the design, with these sections (use real prose, not placeholders):

1. **What this is** — operator recipe, run from a Smudge source checkout (needs `make` + the dev toolchain). Auto on `make dev`; restore is manual.
2. **What it is not** — not 8b's `.smg`, not per-project, not an in-app feature, not offsite, not a daemon/cron.
3. **Automatic backup** — every `make dev` writes `backups/smudge-auto-<time>.zip` before starting (best-effort; warning printed on failure but the server still starts). Keeps newest `SMUDGE_BACKUP_KEEP` (default 10); `SMUDGE_SKIP_AUTO_BACKUP=1` to skip. **Repeated WARNING ⇒ backups are NOT happening — investigate.**
4. **Manual backup** — `make backup`; safe while Smudge is up; never auto-pruned.
5. **Restore** — `make restore BACKUP=…`; Smudge must be stopped; type the filename to confirm; old data moved to `<data-dir>.before-restore-<time>/`, not deleted.
6. **Offsite** — copy `backups/` to a USB/cloud-sync folder yourself.
7. **When 8b ships** — deprecated or kept as a full-machine snapshot; archives stay readable by the version that wrote them.

- [ ] **Step 2: Sanity-check the commands in the doc match the Makefile**

Run: `grep -E "make (backup|restore)" docs/backup.md` and cross-check against `Makefile`.
Expected: command spellings match exactly.

- [ ] **Step 3: Commit**

```bash
git add docs/backup.md
git commit -m "docs(4b.14): operator backup/restore recipe"
```

---

## Task 14: CLAUDE.md §Build & Run Commands update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the targets to the Testing & Quality / Build block**

In §Build & Run Commands, add (near the other `make` targets):

```bash
make backup                          # On-demand backup zip under backups/ (safe while running)
make restore BACKUP=<file>           # Restore a backup zip (Smudge must be stopped; confirms by filename)
```

- [ ] **Step 2: Add a one-line note on the `make dev` side-effect**

Add a short paragraph after the command block: "**`make dev` auto-backs up.** Each `make dev` writes a rotated `backups/smudge-auto-<time>.zip` of the existing DB+images before starting (best-effort — never blocks the server). Keeps the newest `SMUDGE_BACKUP_KEEP` (default 10); `SMUDGE_SKIP_AUTO_BACKUP=1` skips it. Manual `make backup` archives are never auto-pruned. See `docs/backup.md`. These are operator tools run from a source checkout, an interim stopgap until Phase 8b."

- [ ] **Step 3: Verify CLAUDE.md still loads cleanly (no broken markdown)**

Run: `npx prettier --check CLAUDE.md` (or the repo's format-check)
Expected: PASS, or run `make format` to fix.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(4b.14): document make backup/restore + dev auto-backup in CLAUDE.md"
```

---

## Task 15: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Lint + format + typecheck**

Run: `make lint-check && make format-check && make typecheck`
Expected: all PASS.

- [ ] **Step 2: Full coverage run**

Run: `make cover`
Expected: PASS — thresholds met; `backup-core.ts` well above the floor; shells absent from the report.

- [ ] **Step 3: Zero-warning check**

Inspect the test output for any unasserted `console.warn`/`console.error`. The best-effort failure test (Task 9) and the auto-backup shell must not emit unasserted console noise in the *unit* suite (the shells live outside it).
Expected: clean stderr.

- [ ] **Step 4: Cooldown gate**

Run: `make dep-cooldown`
Expected: PASS.

- [ ] **Step 5: Commit any format fixes, then confirm the branch is green**

```bash
git status
# If make format changed files:
git add -A && git commit -m "style(4b.14): formatting"
```

---

## Self-Review (run against the design)

**1. Spec coverage** — every design In-Scope item maps to a task:
- In-Scope 1 (`make backup`) → Tasks 3, 11. In-Scope 1a (auto on `make dev`, rotation, best-effort, skip) → Tasks 8, 9, 11. In-Scope 2 (`make restore`) → Tasks 7, 11. In-Scope 3 (`docs/backup.md`) → Task 13. In-Scope 4 (tests: round-trip, rotation, best-effort, skip + wiring smoke) → Tasks 3–9, 12. In-Scope 5 (`.gitignore`) → Task 12. In-Scope 6 (CLAUDE.md) → Task 14.
- Pushback Issue 1 (paths via `config/paths.ts`) → shells in Task 10 call `getDataDir()/getDbPath()`; core takes paths as params. Issue 2 (HTTP port probe) → Task 7 (`probePort` seam) + Task 10 restore shell + Task 12 probe test. Issue 3 (core/shell coverage split) → Tasks 2–10 + vitest exclude. Issue 4 (`tsx`) → Tasks 10–11. Issue 5 (`.gitignore`) → Task 12. Issue 6 (nested `images/<projectId>/`) → fixtures in Tasks 3, 12.
- jszip MIT election + promotion → Task 1.

**2. Placeholder scan** — no "TBD"/"handle errors"/"similar to"; every code step contains real code.

**3. Type consistency** — `runBackup`, `runRestore`, `runAutoBackup`, `rotateAutoBackups`, `validateEntryPaths`, `readCentralDirectorySizes`, `checkDeclaredSizes`, `ZipSlipError`, `DecompressionBombError`, `BombLimits`, `DEFAULT_BOMB_LIMITS`, `DEFAULT_KEEP` are defined once (Tasks 2–9) and reused with matching signatures in the shells (Task 10) and tests.

---

## Execution Handoff

Implement in a separate session via **superpowers:subagent-driven-development** (recommended; fresh subagent per task with review between) or **superpowers:executing-plans** (inline, batched with checkpoints). Single PR for the whole phase, referencing roadmap Phase 4b.14.
