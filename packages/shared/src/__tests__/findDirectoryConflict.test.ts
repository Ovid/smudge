import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFirstNonDirectoryAncestor } from "../findDirectoryConflict";

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

  it("returns the symlink when an ancestor is a symlink (lstat does not follow)", () => {
    const link = join(scratch, "link");
    symlinkSync("/nonexistent-target", link);
    // A symlink masquerading as a directory entry is itself a non-
    // directory by lstat — refusing to recurse into it surfaces the
    // symlink as the offender, which is the right call for an ENOTDIR
    // message (the user should `unlink` the symlink, not chase its
    // target).
    expect(findFirstNonDirectoryAncestor(join(link, "child"))).toBe(link);
  });
});
