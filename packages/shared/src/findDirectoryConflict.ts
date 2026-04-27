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

/**
 * Build a sanitized error message for the playwright.config.ts mkdir
 * catch block. Pre-fix, the catch interpolated `offender` straight into
 * a thrown Error and suggested ``rm ${offender}`` — POSIX permits any
 * byte except `\0` and `/` in a filename, so a hostile name with
 * newlines, ANSI escapes, backticks, or `$()` could fake log output,
 * hide preceding lines, or invoke shell command substitution if a
 * downstream consumer piped the message through a shell.
 *
 * Post-fix: every interpolated path is wrapped via `JSON.stringify`,
 * which renders control characters as `\n`/`\t`/`` literals and
 * quotes the path so it reads as a string, not a shell expression.
 * The verb (`rm` vs `unlink`) is chosen by the caller via the
 * `offenderIsSymlink` flag — keeps this function pure (no fs side
 * effects) and unit-testable.
 *
 * The errno code is included so the message is self-diagnostic without
 * the original Error object.
 */
export function formatMkdirDataDirError(params: {
  errnoCode: string;
  dataDir: string;
  offender: string | null;
  offenderIsSymlink: boolean;
}): string {
  const { errnoCode, dataDir, offender, offenderIsSymlink } = params;
  const verb = offenderIsSymlink ? "unlink" : "rm";
  const quotedDataDir = JSON.stringify(dataDir);

  if (errnoCode === "EEXIST") {
    // The leaf itself exists as a non-directory.
    return (
      `playwright.config: expected a directory at ${quotedDataDir}, ` +
      `but a non-directory file exists there (errno: ${errnoCode}). ` +
      `Remove the conflicting file (e.g. \`${verb}\` it) and re-run \`make e2e\`.`
    );
  }

  // ENOTDIR / ENOENT / ELOOP: an ancestor is a non-directory or an
  // unresolvable symlink. If the helper returned null, fall back to
  // pointing at dataDir itself with a generic-but-actionable hint.
  if (offender === null) {
    return (
      `playwright.config: mkdir failed at or above ${quotedDataDir} ` +
      `(errno: ${errnoCode}). Inspect the path manually and re-run \`make e2e\`.`
    );
  }

  const quotedOffender = JSON.stringify(offender);
  const symptom = offenderIsSymlink
    ? "a symlink that does not resolve to a directory"
    : "a non-directory file";
  return (
    `playwright.config: expected a directory at or above ${quotedDataDir}, ` +
    `but ${symptom} exists at ${quotedOffender} (errno: ${errnoCode}). ` +
    `Remove it (e.g. \`${verb}\` it) and re-run \`make e2e\`.`
  );
}
