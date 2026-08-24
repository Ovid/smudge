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
 *  production — the byte offsets cannot drift apart (S9).
 *
 *  DELIBERATELY a bare signature match, and specifically NOT validated against
 *  the record's own comment-length field. Backlog e8ba6c7b asked for that guard
 *  (accept only when `i + 22 + buf.readUInt16LE(i + 20) === buf.length`) to stop
 *  a comment containing 0x06054b50 from shadowing the true record. It shipped in
 *  fe7acdb7 and was reverted the same day, because measurement showed it trades
 *  a real capability for a theoretical one:
 *
 *    - It refuses every archive carrying trailing bytes after the comment —
 *      block padding, a transfer that rounded up, a zip at the head of a larger
 *      file. Measured at +1/+4/+17/+18/+22/+30/+1000 bytes: `JSZip.loadAsync`
 *      loads all of them, the guard returns -1 for all of them. `make restore`
 *      is the post-data-loss path; it must not be pickier than the library it
 *      hands the bytes to.
 *    - It rescues nothing. On the decoy archive the guard was written for,
 *      jszip's own locator (`lastIndexOfSignature`, zipEntries.js
 *      `readEndOfCentral` — no comment-length validation either) still selects
 *      the decoy and `loadAsync` throws "End of data reached". runRestore parses
 *      each archive TWICE, with Smudge's parser at step 1 and jszip's at step 6,
 *      so a locator fix at step 1 cannot make step 6 succeed.
 *    - Smudge cannot even produce the shape: runBackup never passes a `comment`
 *      to generateAsync, and the backlog entry itself recorded the case as
 *      hypothetical ("our archives carry no comment").
 *
 *  The two parsers are not identical, and the LOCATOR is the smaller half of
 *  that. Two divergences, in increasing order of consequence:
 *
 *    1. Locator range. jszip scans the whole buffer from `length - 4`; this one
 *       stops at `length - 22` and after 64 KiB. An archive with an over-long
 *       comment loads in jszip and is refused here under ANY rule.
 *    2. Central-directory ORIGIN, and this one is reachable while the locators
 *       AGREE (I2, review 2026-08-23). jszip's `readEndOfCentral`
 *       (zipEntries.js) computes
 *       `extraBytes = endOfCentralDirOffset - (centralDirOffset + centralDirSize)`
 *       and, when positive, sets `reader.zero = extraBytes` — the standard
 *       handling for data prepended to a zip. `walkCentralDirectory` below
 *       applies no such adjustment: it reads the EOCD's central-directory
 *       offset as ABSOLUTE. So an archive with a prepended fake central
 *       directory gives both parsers the same EOCD and two DIFFERENT central
 *       directories. Reproduced read-only: `smudge.db` at 200,000 B and
 *       `images/a.png` at 100,000 B, with the prefix's size fields rewritten to
 *       1 — identical EOCD offsets, this parser reporting 1-byte entries, jszip
 *       inflating the real 200,000 and 100,000.
 *
 *  Divergence 2 defeats the bomb gate outright, because `checkDeclaredSizes` is
 *  computed entirely from this side: the archive validates three declared bytes
 *  and passes trivially, and step 8 then materialises the real entries — after
 *  step 7 has already moved the live data dir aside. Closing it means ONE
 *  parser, not a better second one; see backlog `3d5f0a91`.
 *
 *  Do NOT reach for the obvious interim guard — refusing any archive where
 *  `eocdOffset !== centralDirOffset + centralDirSize`. That inequality is
 *  exactly the prepended-data shape jszip supports on purpose, so the guard
 *  would refuse archives the extraction parser loads happily: the same trade
 *  the fe7acdb7 revert above rejected, one case over. `make restore` is the
 *  post-data-loss path; it must not be pickier than the library it hands the
 *  bytes to. Matching jszip's `extraBytes` relocation would close it without
 *  that cost, but that is the single-parser work, not a patch to this
 *  function. */
export function findEocdOffset(buf: Buffer): number {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

export interface CentralDirEntry {
  path: string;
  uncompressedSize: number;
  /** Declared COMPRESSED size (CEN+20). Backlog `ebdb1c53`: the bomb ratio's
   *  denominator must be the sum of these, not the file length — see
   *  `checkDeclaredSizes`. */
  compressedSize: number;
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
      const compressed = buf.readUInt32LE(off + 20);
      if (compressed === ZIP64_SENTINEL) throw new DecompressionBombError("zip64 entry refused");
      const nameLen = buf.readUInt16LE(off + 28);
      const extraLen = buf.readUInt16LE(off + 30);
      const commentLen = buf.readUInt16LE(off + 32);
      const path = buf.toString("utf8", off + 46, off + 46 + nameLen);
      yield {
        path,
        uncompressedSize: uncompressed,
        compressedSize: compressed,
        sizeFieldOffset: off + 24,
      };
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
): { path: string; uncompressedSize: number; compressedSize: number }[] {
  const out: { path: string; uncompressedSize: number; compressedSize: number }[] = [];
  for (const e of walkCentralDirectory(buf)) {
    out.push({
      path: e.path,
      uncompressedSize: e.uncompressedSize,
      compressedSize: e.compressedSize,
    });
  }
  return out;
}

export interface BombLimits {
  maxUncompressed: number;
  maxRatio: number;
}

/** Reject an archive whose DECLARED sizes already break the bomb limits, before
 *  anything is inflated.
 *
 *  `compressedTotal` must be the sum of the entries' own declared compressed
 *  sizes, NOT the file length (backlog `ebdb1c53`). Passing `buf.length` let
 *  anything appended after the end-of-central-directory record dilute the
 *  ratio without touching a single entry — and trailing-byte tolerance is a
 *  pinned, required capability of `findEocdOffset`, which is what made the
 *  padding free to add. The dilution is bounded, because padding past 64 KiB
 *  puts the EOCD out of this parser's backward-scan reach and the archive is
 *  refused outright — but 64 KiB is enough to drag a 28x archive down to 2.9x,
 *  measured, so the ratio arm was passable by roughly `10 x 64 KiB` of extra
 *  uncompressed bytes. Callers may still clamp with the file length as an upper
 *  sanity bound; forged-large compressed sizes must not RAISE the denominator.
 */
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
  // Every rejection below JSON.stringify-s the offending path (the idiom
  // resolveBombLimit already uses). `p` is up to 65535 arbitrary bytes from an
  // untrusted archive and these messages are printed straight to the operator's
  // terminal by scripts/restore.ts, where an embedded CR or ANSI erase-line
  // sequence could overwrite the abort notice itself (CWE-117).
  for (const p of entryPaths) {
    if (p.includes("\0")) throw new ZipSlipError(`null byte in entry path: ${JSON.stringify(p)}`);
    // S3: no blanket whitespace reject — a space is not a traversal vector and the
    // design enumerates only null/absolute/drive/.. /escapes-root. The resolve()
    // containment check below is the real backstop; rejecting whitespace would
    // mislabel a benign filename and break the "any old archive restorable" pledge.
    if (isAbsolute(p) || win32.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) {
      throw new ZipSlipError(`absolute entry path rejected: ${JSON.stringify(p)}`);
    }
    if (p.split(/[\\/]/).includes("..")) {
      throw new ZipSlipError(`'..' segment rejected: ${JSON.stringify(p)}`);
    }
    const dest = resolve(root, p);
    if (dest !== root && !dest.startsWith(root + sep)) {
      throw new ZipSlipError(`entry escapes target dir: ${JSON.stringify(p)}`);
    }
  }
}
