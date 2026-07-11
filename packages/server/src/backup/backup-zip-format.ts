import { resolve, sep, isAbsolute, win32 } from "node:path";

// ---------------------------------------------------------------------------
// ZIP wire-format parsing + untrusted-archive security primitives.
//
// Extracted from backup-core.ts (F-17: low cohesion — the ZIP byte-format
// layer was mixed with backup lifecycle orchestration in one file). These are
// the pure, dependency-free primitives that parse a ZIP central directory
// WITHOUT decompressing (decompression-bomb defense) and reject zip-slip paths.
//
// They live in their own module — NOT merely their own region — so both
// production (runRestore in backup-core.ts) and the security-critical bomb/
// zip-slip tests import the SAME byte-offset logic. Sharing the module is what
// prevents the offset arithmetic from drifting between test and production
// (S9); single-file co-location was never required for that guarantee, only a
// single importable owner. backup-core.ts re-exports every symbol here so
// existing importers are unaffected.
// ---------------------------------------------------------------------------

export const DEFAULT_BOMB_LIMITS = { maxUncompressed: 2 * 1024 ** 3, maxRatio: 10 } as const;

export class ZipSlipError extends Error {}
export class DecompressionBombError extends Error {}

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
