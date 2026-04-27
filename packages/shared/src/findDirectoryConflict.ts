import { lstatSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Walk from the filesystem root toward `targetPath` and return the first
 * existing path component that is NOT a directory after symlink
 * resolution, or `null` if every existing component resolves to a
 * directory.
 *
 * C1 (review 2026-04-27): on Node 22, an `mkdirSync(p, { recursive: true })`
 * that hits a non-directory ancestor throws with `errno.code='ENOTDIR'`
 * and `errno.path=<the requested leaf>` — NOT the actual offender. To
 * produce a useful "rm THIS path" message we walk the chain ourselves.
 *
 * Symlink policy: a symlink whose target is a directory is walked
 * through transparently — `mkdirSync` follows it without raising
 * ENOTDIR, so flagging it as the offender would be a false accusation.
 * On macOS, `/var` is a system symlink to `/private/var`; an `lstat`-only
 * walk would stop at `/var` for every `os.tmpdir()`-rooted path. A
 * symlink whose target is missing, cyclic, or itself a non-directory
 * IS flagged — at the symlink layer (so the actionable hint is
 * "`unlink` the symlink", not "chase the target").
 */
export function findFirstNonDirectoryAncestor(targetPath: string): string | null {
  const resolved = resolve(targetPath);
  const ancestors: string[] = [];
  let current = resolved;
  // Build root-to-leaf list. dirname(root) === root, which is the loop
  // terminator on every platform.
  while (true) {
    ancestors.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  ancestors.reverse();
  for (const candidate of ancestors) {
    try {
      const stat = statSync(candidate);
      if (stat.isDirectory()) continue;
      // Resolves to a non-directory (regular file, or symlink-to-file).
      return candidate;
    } catch {
      // statSync failed: ENOENT (missing or dangling symlink), ELOOP
      // (cyclic symlink), EACCES, etc. Distinguish "truly missing"
      // from "exists at the link layer but unresolvable".
      try {
        lstatSync(candidate);
      } catch {
        // Truly does not exist — not the offender, keep walking.
        continue;
      }
      // Exists as a link but stat couldn't resolve it. That IS the
      // offender for `mkdirSync` purposes.
      return candidate;
    }
  }
  return null;
}
