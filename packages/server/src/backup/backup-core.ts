import Database from "better-sqlite3";
import JSZip from "jszip";
import { mkdir, rm, readFile, writeFile, readdir, rename } from "node:fs/promises";
import { join, relative, sep, resolve, isAbsolute, win32 } from "node:path";

export type BackupMode = "manual" | "auto";

export const DEFAULT_KEEP = 10;
export const DEFAULT_BOMB_LIMITS = { maxUncompressed: 2 * 1024 ** 3, maxRatio: 10 } as const;

export class ZipSlipError extends Error {}

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
