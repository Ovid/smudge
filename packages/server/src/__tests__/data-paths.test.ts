import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { createKnexConfig } from "../db/knexfile";
import { getDataDir } from "../images/images.paths";
import { getImagesDir } from "../config/paths";

// Safety net for architecture flaw F-5 (configuration sprawl: the
// data-directory default is duplicated across getDataDir(),
// purgeOldTrash(), and knexfile, and the DATA_DIR↔DB_PATH relationship
// is implicit/unvalidated).
//
// F-5 centralizes "where Smudge stores data" into a single owner and
// derives the SQLite default path from the data dir. This test pins the
// load-bearing invariant the refactor must preserve: with neither
// DATA_DIR nor DB_PATH set, the default SQLite file lives directly
// inside the default data directory (i.e. they are NOT independent
// defaults that happen to coincide — they share one base). After F-5
// this holds by construction; before F-5 it holds by the two literals
// happening to agree, which is exactly the fragility F-5 removes.
describe("data-path defaults single-owner relationship (F-5 safety net)", () => {
  let savedDataDir: string | undefined;
  let savedDbPath: string | undefined;

  beforeEach(() => {
    savedDataDir = process.env.DATA_DIR;
    savedDbPath = process.env.DB_PATH;
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
  });

  afterEach(() => {
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
    if (savedDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = savedDbPath;
  });

  it("defaults the SQLite file directly inside the default data dir", () => {
    const conn = createKnexConfig().connection as { filename: string };
    expect(conn.filename).toBe(path.join(getDataDir(), "smudge.db"));
  });

  it("honors an explicit DB_PATH override over the data-dir default", () => {
    process.env.DB_PATH = "/tmp/explicit-smudge.db";
    const conn = createKnexConfig().connection as { filename: string };
    expect(conn.filename).toBe("/tmp/explicit-smudge.db");
  });

  // F-5 fix: DATA_DIR and DB_PATH are no longer independent defaults.
  // With DATA_DIR set and DB_PATH unset, the SQLite file follows the
  // data dir instead of falling back to a separate hard-coded location.
  it("derives the SQLite default from DATA_DIR when DB_PATH is unset", () => {
    process.env.DATA_DIR = "/custom/data";
    const conn = createKnexConfig().connection as { filename: string };
    expect(conn.filename).toBe(path.join("/custom/data", "smudge.db"));
  });

  // S-F9: config/paths is the single owner of the "images" subdir name too.
  it("getImagesDir defaults to <data-dir>/images and honors DATA_DIR", () => {
    expect(getImagesDir()).toBe(path.join(getDataDir(), "images"));
    process.env.DATA_DIR = "/custom/data";
    expect(getImagesDir()).toBe(path.join("/custom/data", "images"));
  });

  it("getImagesDir uses an explicit dataDir override without reading env", () => {
    process.env.DATA_DIR = "/env/data";
    expect(getImagesDir("/injected/dir")).toBe(path.join("/injected/dir", "images"));
  });
});
