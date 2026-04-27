import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findFirstNonDirectoryAncestor,
  formatMkdirDataDirError,
} from "../findDirectoryConflict";

// C1 (review 2026-04-27): Node sets `errno.path` to the requested leaf
// for ENOTDIR, NOT the offending non-directory ancestor. Verified live:
//   $ touch /tmp/x/data
//   $ mkdirSync('/tmp/x/data/sub', {recursive:true})
//   → errno.code='ENOTDIR', errno.path='/tmp/x/data/sub' (the requested leaf)
// To produce a useful "rm THIS path" message, we need to walk ancestors
// and find the real offender ourselves.

describe("findFirstNonDirectoryAncestor", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "findconflict-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("returns null when the path does not exist and every ancestor is a directory", () => {
    expect(findFirstNonDirectoryAncestor(join(scratch, "missing", "leaf"))).toBeNull();
  });

  it("returns null when the path exists as a directory", () => {
    mkdirSync(join(scratch, "dir"), { recursive: true });
    expect(findFirstNonDirectoryAncestor(join(scratch, "dir"))).toBeNull();
  });

  it("returns the leaf when the leaf itself is a regular file", () => {
    const leaf = join(scratch, "file");
    writeFileSync(leaf, "");
    expect(findFirstNonDirectoryAncestor(leaf)).toBe(leaf);
  });

  it("returns the offending ancestor when an intermediate component is a regular file", () => {
    const offender = join(scratch, "blocker");
    writeFileSync(offender, "");
    expect(findFirstNonDirectoryAncestor(join(offender, "child", "grandchild"))).toBe(offender);
  });

  it("returns the highest non-directory when multiple ancestors would conflict", () => {
    // Realistically only the highest-up offender ever fires (mkdir stops
    // there), but the helper should return the *root-most* offender so
    // the message points at the cause rather than a downstream symptom.
    const top = join(scratch, "top");
    writeFileSync(top, "");
    // Cannot actually create deeper paths under `top` (it's a file), but
    // the helper must walk root-to-leaf and return `top`, not something
    // farther down.
    expect(findFirstNonDirectoryAncestor(join(top, "a", "b"))).toBe(top);
  });

  it("returns the symlink when an ancestor is a dangling symlink", () => {
    const link = join(scratch, "link");
    symlinkSync("/nonexistent-target", link);
    // A dangling symlink genuinely blocks `mkdirSync(p, {recursive:true})`
    // — Node can't resolve its target. Flag the symlink itself as the
    // offender so the user knows to `unlink` it, not chase the target.
    expect(findFirstNonDirectoryAncestor(join(link, "child"))).toBe(link);
  });

  it("walks through a symlink-to-directory ancestor without flagging it", () => {
    // Regression for macOS: `/var` is a symlink to `/private/var`, so
    // `os.tmpdir()`-rooted paths cross a symlink-to-directory at the
    // first ancestor. `mkdirSync` follows it transparently and does NOT
    // raise ENOTDIR, so the helper must not flag it either.
    const realDir = join(scratch, "real");
    mkdirSync(realDir);
    const link = join(scratch, "link-to-dir");
    symlinkSync(realDir, link);
    expect(findFirstNonDirectoryAncestor(join(link, "child", "leaf"))).toBeNull();
  });

  it("returns the symlink when its target is a regular file", () => {
    const target = join(scratch, "target-file");
    writeFileSync(target, "");
    const link = join(scratch, "link-to-file");
    symlinkSync(target, link);
    // `mkdirSync` would raise ENOTDIR here; the symlink is the
    // actionable path (`unlink` it), not its file target.
    expect(findFirstNonDirectoryAncestor(join(link, "child"))).toBe(link);
  });
});

// I7 + S2 + S7 + S9 + S11 (review 2026-04-27, third pass): the
// playwright.config.ts mkdir catch interpolates the offender path into
// a thrown Error. POSIX permits any byte except `\0` and `/` in a
// filename — newlines, ANSI escapes, backticks, `$()`. An attacker who
// can place a file in `/tmp` (any local user; `/tmp` is mode-1777)
// could craft a name that fakes log output, hides preceding lines, or
// invokes shell command substitution if a downstream consumer pipes
// the message through a shell. Sanitize via JSON.stringify and pick
// the verb (`rm` vs `unlink`) based on whether the offender is a
// symlink. Include the errno code so the message is self-diagnostic.
describe("formatMkdirDataDirError", () => {
  const dataDir = "/tmp/smudge-e2e-data-1000";

  it("emits a leaf message for EEXIST", () => {
    const msg = formatMkdirDataDirError({
      errnoCode: "EEXIST",
      dataDir,
      offender: dataDir,
      offenderIsSymlink: false,
    });
    expect(msg).toContain("EEXIST");
    expect(msg).toContain(JSON.stringify(dataDir));
    expect(msg).toContain("rm");
    expect(msg).not.toContain("unlink");
  });

  it("emits an ancestor message for ENOTDIR with an actionable verb", () => {
    const offender = "/tmp/blocking-file";
    const msg = formatMkdirDataDirError({
      errnoCode: "ENOTDIR",
      dataDir,
      offender,
      offenderIsSymlink: false,
    });
    expect(msg).toContain("ENOTDIR");
    expect(msg).toContain(JSON.stringify(offender));
    expect(msg).toContain(JSON.stringify(dataDir));
    expect(msg).toContain("rm");
  });

  it("uses the unlink verb for symlink offenders (S11)", () => {
    const offender = "/tmp/dangling-link";
    const msg = formatMkdirDataDirError({
      errnoCode: "ENOENT",
      dataDir,
      offender,
      offenderIsSymlink: true,
    });
    expect(msg).toContain("unlink");
    // We should not also suggest `rm` for a symlink — that confuses
    // the reader about which call to make.
    expect(msg).not.toMatch(/\brm\b/);
  });

  it("handles ELOOP with the same shape as ENOTDIR/ENOENT", () => {
    const offender = "/tmp/cyclic-link";
    const msg = formatMkdirDataDirError({
      errnoCode: "ELOOP",
      dataDir,
      offender,
      offenderIsSymlink: true,
    });
    expect(msg).toContain("ELOOP");
    expect(msg).toContain(JSON.stringify(offender));
    expect(msg).toContain("unlink");
  });

  it("falls back to dataDir when the helper returns null", () => {
    // findFirstNonDirectoryAncestor returns null when nothing in the
    // chain looks non-directory. Surface dataDir itself with a
    // generic-but-actionable hint so the user has somewhere to look.
    const msg = formatMkdirDataDirError({
      errnoCode: "ENOENT",
      dataDir,
      offender: null,
      offenderIsSymlink: false,
    });
    expect(msg).toContain(JSON.stringify(dataDir));
    expect(msg).toContain("ENOENT");
  });

  it("escapes newlines in offender paths (log-injection defense, I7)", () => {
    const malicious = "/tmp/legit\n[ok] tests passing";
    const msg = formatMkdirDataDirError({
      errnoCode: "ENOTDIR",
      dataDir,
      offender: malicious,
      offenderIsSymlink: false,
    });
    // The literal newline must NOT appear in the message — otherwise
    // the second line could fake green output in the same log stream.
    expect(msg).not.toMatch(/\n\[ok\]/);
    // JSON.stringify renders the newline as `\n` (backslash-n).
    expect(msg).toContain("\\n[ok] tests passing");
  });

  it("escapes ANSI escape sequences in offender paths (I7)", () => {
    const malicious = "/tmp/x\x1b[2K\x1b[1A";
    const msg = formatMkdirDataDirError({
      errnoCode: "ENOTDIR",
      dataDir,
      offender: malicious,
      offenderIsSymlink: false,
    });
    // The raw 0x1b byte must not appear — JSON.stringify renders it as ``.
    expect(msg).not.toContain("\x1b");
    expect(msg).toContain("\\u001b");
  });

  it("does not embed an unquoted shell-command suggestion (I7)", () => {
    // The pre-fix message read: `... e.g. \`rm ${offender}\` ...`. If a
    // downstream consumer piped the log through a shell helper or
    // xargs, command substitution from `$()` or backticks in the path
    // would execute. The post-fix message wraps the path via
    // JSON.stringify so the consumer sees a quoted string literal,
    // not a shell expression to copy verbatim.
    const malicious = "/tmp/$(touch /tmp/pwned)";
    const msg = formatMkdirDataDirError({
      errnoCode: "ENOTDIR",
      dataDir,
      offender: malicious,
      offenderIsSymlink: false,
    });
    // The path appears wrapped in quotes (JSON.stringify), not bare.
    expect(msg).toContain(JSON.stringify(malicious));
    // The pre-fix template was `e.g. \`rm <bare-path>\``. After
    // sanitization the path is JSON.stringified, so a bare
    // unquoted occurrence of the shell-substitution token would be
    // a regression.
    expect(msg).not.toMatch(/`rm \$\(touch/);
    expect(msg).not.toMatch(/`unlink \$\(touch/);
  });
});
