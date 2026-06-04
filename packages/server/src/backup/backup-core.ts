import Database from "better-sqlite3";
import JSZip from "jszip";
import { mkdir, rm, readFile, writeFile, readdir, rename, statfs, access } from "node:fs/promises";
import { join, relative, sep, resolve, isAbsolute, win32, basename, dirname } from "node:path";

export type BackupMode = "manual" | "auto";

export const DEFAULT_KEEP = 10;
export const DEFAULT_BOMB_LIMITS = { maxUncompressed: 2 * 1024 ** 3, maxRatio: 10 } as const;

export class ZipSlipError extends Error {}
export class DecompressionBombError extends Error {}
/** Thrown when the post-move extraction byte-budget is exceeded; carries the move-aside path(s). */
export class RestorePartialError extends DecompressionBombError {
  /** When the DB lives outside dataDir, the sibling where the prior external DB was preserved. */
  readonly dbMovedAsideTo?: string;
  constructor(
    message: string,
    readonly movedAsideTo: string,
    options?: { cause?: unknown; dbMovedAsideTo?: string },
  ) {
    super(message, options as ErrorOptions);
    this.dbMovedAsideTo = options?.dbMovedAsideTo;
  }
}
/** Thrown when a precondition for restore is not met (e.g. missing smudge.db, server running,
 *  token mismatch, or insufficient free space). Lets callers distinguish operator/precondition
 *  refusals from security refusals (ZipSlipError / DecompressionBombError). */
export class RestorePreconditionError extends Error {}

// ZIP end-of-central-directory + central-directory record signatures (PKWARE APPNOTE).
const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const ZIP64_SENTINEL = 0xffffffff;

/** Parse declared uncompressed sizes from the central directory without decompressing. */
export function readCentralDirectorySizes(
  buf: Buffer,
): { path: string; uncompressedSize: number }[] {
  // Locate EOCD by scanning backwards (max comment 64KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DecompressionBombError("not a valid zip (no EOCD)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === ZIP64_SENTINEL)
    throw new DecompressionBombError("zip64 archive refused (declared sizes unverifiable)");
  const out: { path: string; uncompressedSize: number }[] = [];
  for (let n = 0; n < count; n++) {
    try {
      if (buf.readUInt32LE(off) !== CEN_SIG)
        throw new DecompressionBombError("corrupt central directory");
      const uncompressed = buf.readUInt32LE(off + 24);
      if (uncompressed === ZIP64_SENTINEL) throw new DecompressionBombError("zip64 entry refused");
      const nameLen = buf.readUInt16LE(off + 28);
      const extraLen = buf.readUInt16LE(off + 30);
      const commentLen = buf.readUInt16LE(off + 32);
      const path = buf.toString("utf8", off + 46, off + 46 + nameLen);
      out.push({ path, uncompressedSize: uncompressed });
      off += 46 + nameLen + extraLen + commentLen;
    } catch (e) {
      if (e instanceof DecompressionBombError) throw e;
      throw new DecompressionBombError(`central directory read overrun at entry ${n}`);
    }
  }
  return out;
}

export interface BombLimits {
  maxUncompressed: number;
  maxRatio: number;
}

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

export function validateEntryPaths(entryPaths: string[], targetRoot: string): void {
  const root = resolve(targetRoot);
  for (const p of entryPaths) {
    if (p.includes("\0")) throw new ZipSlipError(`null byte in entry path: ${p}`);
    if (/\s/.test(p)) throw new ZipSlipError(`whitespace in entry path: ${p}`);
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

const FREE_SPACE_HEADROOM = 100 * 1024 * 1024;

export interface RestoreOptions {
  archivePath: string;
  dataDir: string;
  /** Absolute path to the DB file; defaults to `join(dataDir, "smudge.db")`.
   *  May point OUTSIDE dataDir (the `DB_PATH` config that backup already
   *  honors). When external, restore writes the restored DB here and preserves
   *  the prior external DB at a `.before-restore-<stamp>` sibling. */
  dbPath?: string;
  confirmToken: string;
  now?: () => Date;
  probePort?: () => Promise<boolean>;
  limits?: BombLimits;
  /** Injectable seam: returns available bytes on the partition containing `path`.
   *  Defaults to `statfs(dirname(dataDir))` — the parent always exists and is
   *  on the same partition whether or not dataDir itself exists yet. */
  freeBytes?: (path: string) => Promise<number>;
}

export async function runRestore(
  opts: RestoreOptions,
): Promise<{ movedAsideTo: string; dbMovedAsideTo?: string }> {
  const limits = opts.limits ?? DEFAULT_BOMB_LIMITS;
  // The DB may live outside dataDir (DB_PATH config). When it does, the data-dir
  // move-aside below will NOT preserve it, so we move it aside separately and
  // write the restored DB to its real home rather than into dataDir.
  const dbPath = opts.dbPath ?? join(opts.dataDir, "smudge.db");
  const dbIsExternal = !resolve(dbPath).startsWith(resolve(opts.dataDir) + sep);
  const freeBytesImpl =
    opts.freeBytes ??
    (async (p: string) => {
      const s = await statfs(p);
      return s.bavail * s.bsize;
    });
  const buf = await readFile(opts.archivePath);

  // 1. zip-slip + presence validation (read names from central directory)
  const sizes = readCentralDirectorySizes(buf);
  const names = sizes.map((e) => e.path);
  validateEntryPaths(names, opts.dataDir);
  if (!names.includes("smudge.db")) {
    throw new RestorePreconditionError(`archive is missing smudge.db: ${opts.archivePath}`);
  }
  // 2. bomb limits (declared sizes, before loadAsync)
  // Hoist declaredTotal here so it's shared by the free-space check (#6) and the
  // post-extraction byte-budget assertion below.
  const declaredTotal = sizes.reduce((n, e) => n + e.uncompressedSize, 0);
  checkDeclaredSizes(sizes, buf.length, limits);
  // 3. running-server probe
  if (opts.probePort && (await opts.probePort())) {
    throw new RestorePreconditionError("Smudge is running — stop it and rerun restore.");
  }
  // 4. typed-filename confirmation
  if (opts.confirmToken !== basename(opts.archivePath)) {
    throw new RestorePreconditionError(
      "restore not confirmed: token did not match the backup filename.",
    );
  }
  // 5. free-space pre-check (design §2b defense #3): must have declaredTotal + 100 MiB
  // available on the partition. Use the PARENT of dataDir (always exists, same partition).
  const available = await freeBytesImpl(dirname(opts.dataDir));
  if (available < declaredTotal + FREE_SPACE_HEADROOM) {
    throw new RestorePreconditionError(
      `insufficient free space: need ${declaredTotal + FREE_SPACE_HEADROOM} bytes, have ${available}`,
    );
  }
  // 6. move existing data dir aside (never delete). A rename failure here means
  // nothing was touched yet, so it propagates as a precondition-style raw error.
  const stamp = isoStampLocal((opts.now ?? (() => new Date()))());
  const movedAsideTo = `${opts.dataDir}.before-restore-${stamp}`;
  await rename(opts.dataDir, movedAsideTo).catch((e) => {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      /* nothing to move */
    } else throw e;
  });

  // 7. recreate dataDir, move an external DB aside, and extract — all inside one
  // try so ANY failure after the data-dir move-aside (mkdir recreate, the external
  // DB rename, JSZip internal throws, ENOSPC, the byte-budget overrun) surfaces as
  // RestorePartialError carrying the preservation path(s). The operator always
  // learns where the original data is. (I1: mkdir is inside; C1: external DB here.)
  let dbMovedAsideTo: string | undefined;
  try {
    await mkdir(opts.dataDir, { recursive: true });
    if (dbIsExternal) {
      const dbAside = `${dbPath}.before-restore-${stamp}`;
      await rename(dbPath, dbAside).then(
        () => {
          dbMovedAsideTo = dbAside;
        },
        (e) => {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            /* no existing external DB to preserve */
          } else throw e;
        },
      );
    }
    let written = 0;
    const zip = await JSZip.loadAsync(buf);
    for (const name of names) {
      const file = zip.file(name);
      if (!file) continue;
      // NOTE: file.async("nodebuffer") decompresses the full entry into memory here —
      // a single entry is fully in RAM before being written. The byte-budget below
      // bounds DISK usage (cumulative write), not RAM (the declared-size cap #1 bounds
      // the honest case; this assertion catches a lying central directory).
      const bytes = await file.async("nodebuffer");
      written += bytes.length;
      if (written > declaredTotal + 1024 * 1024) {
        // Rare lying-archive case (central directory under-declared sizes). We do
        // NOT roll back the partial extraction: the original data is preserved at
        // movedAsideTo, so there is no data loss — the operator recovers from the
        // move-aside dir. See design §2b. RestorePartialError extends
        // DecompressionBombError so existing instanceof checks still hold.
        throw new RestorePartialError(
          "extraction exceeded declared size — aborting",
          movedAsideTo,
          {
            dbMovedAsideTo,
          },
        );
      }
      // The DB lands at its real home (possibly outside dataDir); everything else
      // extracts into the freshly recreated dataDir.
      const dest = name === "smudge.db" ? dbPath : join(opts.dataDir, name);
      await mkdir(join(dest, ".."), { recursive: true });
      await writeFile(dest, bytes);
    }
  } catch (e) {
    if (e instanceof RestorePartialError) throw e;
    throw new RestorePartialError(
      `restore failed after move-aside (original preserved at ${movedAsideTo}): ${e instanceof Error ? e.message : String(e)}`,
      movedAsideTo,
      { cause: e, dbMovedAsideTo },
    );
  }
  return { movedAsideTo, dbMovedAsideTo };
}

/** Resolve a raw `SMUDGE_BACKUP_KEEP` env value to a retention count. Absent or
 *  invalid (negative, NaN, non-integer) falls back to {@link DEFAULT_KEEP} so a
 *  typo can never wipe retained backups — a clamp-to-0 would silently delete them
 *  all. An explicit `"0"` is honored as "keep none". */
export function resolveKeep(raw: string | undefined): number {
  // Absent or blank (`SMUDGE_BACKUP_KEEP=` / whitespace) is treated as
  // not-provided — Number("") is 0, which would silently wipe every backup.
  if (raw === undefined || raw.trim() === "") return DEFAULT_KEEP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_KEEP;
}

export type AutoStatus = "ok" | "skipped-no-db" | "skipped-optout" | "failed";

export async function runAutoBackup(o: {
  dataDir: string;
  dbPath: string;
  backupsDir: string;
  keep: number;
  skip?: boolean;
  now?: () => Date;
}): Promise<{ status: AutoStatus; outFile?: string; warning?: string }> {
  if (o.skip) return { status: "skipped-optout" };
  try {
    await access(o.dbPath);
  } catch {
    return { status: "skipped-no-db" };
  }
  try {
    const { outFile } = await runBackup({
      dataDir: o.dataDir,
      dbPath: o.dbPath,
      backupsDir: o.backupsDir,
      mode: "auto",
      now: o.now,
    });
    await rotateAutoBackups({ backupsDir: o.backupsDir, keep: o.keep }).catch(() => {
      /* rotation is best-effort */
    });
    return { status: "ok", outFile };
  } catch (e) {
    return { status: "failed", warning: e instanceof Error ? e.message : String(e) };
  }
}

export async function rotateAutoBackups(o: {
  backupsDir: string;
  keep: number;
}): Promise<{ deleted: string[] }> {
  let names: string[];
  try {
    names = await readdir(o.backupsDir);
  } catch {
    return { deleted: [] };
  }
  const autos = names.filter((f) => f.startsWith("smudge-auto-") && f.endsWith(".zip")).sort(); // lexical == chronological
  // Defensive clamp: a negative/non-integer keep reaching this low-level function
  // (the env-string sanitizing lives in resolveKeep) must never produce a
  // len-(-k) over-read. keep<0 → 0 (delete all); keep is floored.
  const keep = Math.max(0, Math.floor(o.keep));
  const toDelete = autos.slice(0, Math.max(0, autos.length - keep));
  for (const f of toDelete) await rm(join(o.backupsDir, f), { force: true });
  return { deleted: toDelete };
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
    await rename(tmpOut, outFile); // atomic publish
    return { outFile };
  } finally {
    await rm(staging, { force: true });
  }
}
