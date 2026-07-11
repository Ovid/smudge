import Database from "better-sqlite3";
import JSZip from "jszip";
import {
  mkdir,
  rm,
  readFile,
  writeFile,
  readdir,
  rename,
  statfs,
  stat,
  access,
} from "node:fs/promises";
import { join, relative, sep, resolve, isAbsolute, win32, basename, dirname } from "node:path";
import { getImagesDir } from "../config/paths";

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

/** Locate the end-of-central-directory record by scanning backward from the end
 *  (max 64 KiB comment). Returns its byte offset, or -1 if not found. Exported so
 *  the security-critical bomb tests parse archives with the SAME logic as
 *  production — the byte offsets cannot drift apart (S9). */
export function findEocdOffset(buf: Buffer): number {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

export interface CentralDirEntry {
  path: string;
  uncompressedSize: number;
  /** Absolute byte offset of this entry's 4-byte uncompressed-size field (CEN+24). */
  sizeFieldOffset: number;
}

/** Walk the central directory, yielding each entry's declared uncompressed size
 *  and the byte offset of its size field — without decompressing. Shared by
 *  readCentralDirectorySizes (production) and the bomb tests (which patch the
 *  size field) so the offset arithmetic lives in exactly one place (S9). */
export function* walkCentralDirectory(buf: Buffer): Generator<CentralDirEntry> {
  const eocd = findEocdOffset(buf);
  if (eocd < 0) throw new DecompressionBombError("not a valid zip (no EOCD)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === ZIP64_SENTINEL)
    throw new DecompressionBombError("zip64 archive refused (declared sizes unverifiable)");
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
      yield { path, uncompressedSize: uncompressed, sizeFieldOffset: off + 24 };
      off += 46 + nameLen + extraLen + commentLen;
    } catch (e) {
      if (e instanceof DecompressionBombError) throw e;
      throw new DecompressionBombError(`central directory read overrun at entry ${n}`);
    }
  }
}

/** Parse declared uncompressed sizes from the central directory without decompressing. */
export function readCentralDirectorySizes(
  buf: Buffer,
): { path: string; uncompressedSize: number }[] {
  const out: { path: string; uncompressedSize: number }[] = [];
  for (const e of walkCentralDirectory(buf)) {
    out.push({ path: e.path, uncompressedSize: e.uncompressedSize });
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

/** Resolve a `--max-*` restore CLI value. Absent or blank → fallback (the default
 *  applies only when the flag is omitted). A finite value >= 0 is used verbatim,
 *  so `--max-*=0` applies the strictest possible cap instead of being silently
 *  coerced to the default. NaN / negative / Infinity (a typo'd or nonsensical cap)
 *  throws rather than silently defaulting, so the operator is never told a
 *  stricter limit is in force than actually is. */
export function resolveBombLimit(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid ${label}: ${JSON.stringify(raw)} (expected a number >= 0)`);
  }
  return n;
}

/** Extract the value of a `--name=value` CLI flag from an argv array.
 *  Keeps EVERYTHING after the first `=`, so a value that itself contains `=`
 *  (e.g. a typo'd `--max-ratio==10`) is preserved verbatim and reaches
 *  {@link resolveBombLimit}, which fails loudly rather than being truncated to
 *  `""` and silently treated as absent (S-F4). Returns undefined if absent. */
export function flagValue(argv: string[], name: string): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(hit.indexOf("=") + 1);
}

export function validateEntryPaths(entryPaths: string[], targetRoot: string): void {
  const root = resolve(targetRoot);
  for (const p of entryPaths) {
    if (p.includes("\0")) throw new ZipSlipError(`null byte in entry path: ${p}`);
    // S3: no blanket whitespace reject — a space is not a traversal vector and the
    // design enumerates only null/absolute/drive/.. /escapes-root. The resolve()
    // containment check below is the real backstop; rejecting whitespace would
    // mislabel a benign filename and break the "any old archive restorable" pledge.
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

/** Local-time stamp "YYYY-MM-DD-HHmmss" (hyphens only — filesystem-safe).
 *  Operator-facing display only (the restore move-aside path); NOT used for
 *  backup filenames — see isoStampUtc for why. */
export function isoStampLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** UTC stamp "YYYY-MM-DDTHHmmssZ" — filesystem-safe (no colons) and, crucially,
 *  lexically sortable == chronological even across a DST fall-back or backward
 *  clock step. Backup FILENAMES use this so rotateAutoBackups' name-based sort
 *  never inverts and prunes the wrong file (S-F1). '-' < 'T', so any legacy
 *  `...YYYY-MM-DD-HHmmss.zip` names (made before this change, hence genuinely
 *  older) sort before all new `...T...Z` names — mixed dirs rotate correctly
 *  with no migration. isoStampLocal stays for human-facing display. */
export function isoStampUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
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
  } catch (e) {
    // ENOENT is the only swallowable case — the images dir (or a project subdir
    // mid-walk) may legitimately not exist yet. A permission/IO error (EACCES,
    // EPERM, …) would otherwise silently omit real images from a "successful"
    // backup, so re-throw and fail the backup loudly.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
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
  /** Injectable seam: true when both paths reside on the same physical partition.
   *  Defaults to comparing `stat().dev`. Used only when the DB is external, to
   *  decide whether the DB + images draw from one free-space pool (reserve the
   *  full declared total) or two (reserve each half on its own partition). */
  sameDevice?: (a: string, b: string) => Promise<boolean>;
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
  const sameDeviceImpl =
    opts.sameDevice ??
    (async (a: string, b: string) => {
      const [sa, sb] = await Promise.all([stat(a), stat(b)]);
      return sa.dev === sb.dev;
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
  // 5. free-space pre-check (design §2b defense #3): each destination partition
  // must have (its declared bytes) + 100 MiB free. Use the PARENT of dataDir
  // (always exists, same partition). When the DB is external it may land on a
  // DIFFERENT partition than the images, so check both separately (S-F2) —
  // checking only dataDir's partition would let a full external partition slip
  // through to a mid-write ENOSPC.
  const ensureFree = async (path: string, need: number) => {
    const available = await freeBytesImpl(path);
    if (available < need + FREE_SPACE_HEADROOM) {
      throw new RestorePreconditionError(
        `insufficient free space: need ${need + FREE_SPACE_HEADROOM} bytes, have ${available}`,
      );
    }
  };
  // "External" only means "outside dataDir", NOT "different disk": an external DB
  // dir may share dataDir's physical partition. Split the reservation across two
  // partitions ONLY when they are genuinely different devices; when they share one
  // (or the DB is internal), the DB + images bytes land on a SINGLE free pool and
  // must be checked as one sum — otherwise each half validates against the same
  // free figure and their sum can still ENOSPC mid-write (S-F2 follow-up, I1).
  const splitPartitions =
    dbIsExternal && !(await sameDeviceImpl(dirname(dbPath), dirname(opts.dataDir)));
  if (splitPartitions) {
    const dbDeclared = sizes.find((e) => e.path === "smudge.db")?.uncompressedSize ?? 0;
    await ensureFree(dirname(dbPath), dbDeclared); // DB → its own partition
    await ensureFree(dirname(opts.dataDir), declaredTotal - dbDeclared); // images → dataDir's
  } else {
    await ensureFree(dirname(opts.dataDir), declaredTotal); // everything on one partition
  }
  // 6. move existing data dir aside (never delete). A rename failure here means
  // nothing was touched yet, so it propagates as a precondition-style raw error.
  // pid-qualified (S6): two same-second restores must not compute the same
  // move-aside target (a rename collision would risk the never-delete guarantee).
  // ponytail: single-container assumption — pid alone disambiguates because the
  // deployment target is one container over one data volume. Two containers in
  // separate PID namespaces sharing a volume could both be pid 1 and collide;
  // add a random suffix here (and at the runBackup staging/tmpOut paths) if that
  // topology ever ships (S-F8).
  const stamp = `${isoStampLocal((opts.now ?? (() => new Date()))())}.${process.pid}`;
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
  } catch (e) {
    // ENOENT is the only swallowable case — backupsDir may not exist yet.
    // A permission/IO error (EACCES/EIO/…) would otherwise be masked as
    // "nothing to prune"; re-throw it (parallels walkFiles' narrowing, S-F5).
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { deleted: [] };
    throw e;
  }
  // lexical == chronological: filenames carry a UTC isoStampUtc stamp (S-F1), so
  // the name sort stays monotonic even across a DST fall-back / backward clock step.
  const autos = names.filter((f) => f.startsWith("smudge-auto-") && f.endsWith(".zip")).sort();
  // Defensive clamp: a negative/non-integer keep reaching this low-level function
  // (the env-string sanitizing lives in resolveKeep) must never delete the wrong
  // set. keep<0 → 0 (delete all); keep is floored.
  const keep = Math.max(0, Math.floor(o.keep));
  // Keep the newest `keep` BY NAME (S7), then delete every other auto. Keying on
  // names rather than a positional slice makes two rotations run with the SAME
  // `keep` idempotent: each only removes archives outside the newest-`keep`
  // survivor set, so overlapping `make dev` rotations can't over-prune a recent
  // backup. (Two concurrent runs with divergent SMUDGE_BACKUP_KEEP compute
  // different survivor sets — a non-issue for the single-operator target.)
  const survivors = new Set(keep > 0 ? autos.slice(-keep) : []);
  const toDelete = autos.filter((f) => !survivors.has(f));
  for (const f of toDelete) await rm(join(o.backupsDir, f), { force: true });
  return { deleted: toDelete };
}

export async function runBackup(opts: BackupOptions): Promise<{ outFile: string }> {
  const now = (opts.now ?? (() => new Date()))();
  const stamp = isoStampUtc(now); // UTC → rotation name-sort never inverts (S-F1)
  const outFile = join(opts.backupsDir, buildBackupName(stamp, opts.mode));
  const staging = join(opts.dataDir, `${stamp}.${process.pid}.backup-staging.db`);
  // Per-process temp (I3): two same-mode backups in the same wall-clock second must
  // not share a temp path and interleave their writes into a torn archive. Declared
  // here (not inside the try) so the finally can remove it even when the publish
  // rename throws AFTER the write — rotateAutoBackups only prunes `.zip`, so a
  // leaked `.tmp` would otherwise accumulate in backups/ forever (S1).
  const tmpOut = `${outFile}.${process.pid}.tmp`;

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
    const imagesDir = getImagesDir(opts.dataDir); // config/paths owns the "images" subdir (S-F9)
    for await (const file of walkFiles(imagesDir)) {
      const rel = relative(opts.dataDir, file).split(sep).join("/"); // images/<proj>/<file>
      // I1 (F3): "safe while running" — the image reaper (or a delete) can unlink
      // a file between walkFiles' readdir and this read. Skip a vanished image
      // (ENOENT) rather than aborting the whole backup; re-throw every other IO
      // error (EACCES/EIO/…) so a real failure never silently omits an image.
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      zip.file(rel, bytes);
    }

    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await writeFile(tmpOut, buf);
    // rename atomically replaces any existing outFile (S2): the prior explicit
    // rm(outFile) was redundant and opened a no-file window a concurrent backup
    // could delete the other's just-published archive through.
    await rename(tmpOut, outFile); // atomic publish
    return { outFile };
  } finally {
    await rm(staging, { force: true });
    // On the happy path the rename already consumed tmpOut (force ignores ENOENT);
    // on a mid-publish failure this reclaims the orphan.
    await rm(tmpOut, { force: true });
  }
}
