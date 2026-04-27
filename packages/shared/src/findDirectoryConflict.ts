import { lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Walk from the filesystem root toward `targetPath` and return the first
 * existing path component that is NOT a directory, or `null` if every
 * existing component is a directory.
 *
 * C1 (review 2026-04-27): on Node 22, an `mkdirSync(p, { recursive: true })`
 * that hits a non-directory ancestor throws with `errno.code='ENOTDIR'`
 * and `errno.path=<the requested leaf>` — NOT the actual offender. To
 * produce a useful "rm THIS path" message we walk the chain ourselves
 * with `lstatSync` (so a symlink-as-directory ancestor reads as the
 * offender, not its target — `unlink` the symlink, don't chase it).
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
    let stat;
    try {
      stat = lstatSync(candidate);
    } catch {
      // Component does not exist — not the offender. Continue downward.
      continue;
    }
    if (!stat.isDirectory()) {
      return candidate;
    }
  }
  return null;
}
