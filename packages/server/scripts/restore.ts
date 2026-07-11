import { createInterface } from "node:readline/promises";
import { connect } from "node:net";
import { basename } from "node:path";
import { DEFAULT_SERVER_PORT, parsePort } from "@smudge/shared";
import { getDataDir, getDbPath } from "../src/config/paths";
import {
  runRestore,
  RestorePartialError,
  DEFAULT_BOMB_LIMITS,
  resolveBombLimit,
  flagValue,
} from "../src/backup/backup-core";

const arg = (name: string) => flagValue(process.argv, name);

const archivePath = process.env.BACKUP;
if (!archivePath) {
  console.error("Usage: make restore BACKUP=backups/smudge-….zip");
  process.exit(2);
}

// Match the server's port parsing (index.ts): use the shared DEFAULT_SERVER_PORT
// (no divergent hardcoded 3456) and parsePort so a garbage SMUDGE_PORT fails
// fast instead of Number()→NaN silently defeating the running-server probe (I2).
const port = parsePort(process.env.SMUDGE_PORT ?? String(DEFAULT_SERVER_PORT), "SMUDGE_PORT");
// S-F10: this dual-stack "is a server listening?" probe intentionally parallels
// the one in the Makefile `e2e-clean` target (which probes E2E_SERVER_PORT).
// They are NOT a shared implementation — different port, different timeout
// (500 ms here vs 2000 ms there), different runtime (TS vs sh) — and extracting
// across the TS/Makefile boundary isn't worth it. Kept as a cross-reference so a
// change to the probe semantics here prompts a look at the other.
const probePort = () =>
  new Promise<boolean>((resolve) => {
    const hosts = ["127.0.0.1", "::1"];
    const sockets: ReturnType<typeof connect>[] = [];
    let pending = hosts.length;
    let settled = false;
    // Destroy every socket on settle (S8): once one host connects, the other
    // host's socket + its 500 ms timeout timer would otherwise keep the event
    // loop alive and delay process exit by up to ~500 ms.
    const cleanup = () => {
      for (const s of sockets) s.destroy();
    };
    const succeed = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(true);
      }
    };
    const failOne = () => {
      pending -= 1;
      if (!settled && pending === 0) {
        settled = true;
        cleanup();
        resolve(false);
      }
    };
    for (const host of hosts) {
      let socketDone = false;
      const s = connect({ host, port }, () => {
        socketDone = true;
        succeed();
      });
      sockets.push(s);
      const fail = () => {
        if (socketDone) return;
        socketDone = true;
        s.destroy();
        failOne();
      };
      s.on("error", fail);
      s.setTimeout(500, fail);
    }
  });

const rl = createInterface({ input: process.stdin, output: process.stdout });
const confirmToken = (
  await rl.question(
    `This OVERWRITES the data dir at ${getDataDir()}.\nType the backup filename (${basename(archivePath)}) to confirm: `,
  )
).trim();
rl.close();

try {
  const { movedAsideTo, dbMovedAsideTo } = await runRestore({
    archivePath,
    dataDir: getDataDir(),
    dbPath: getDbPath(),
    confirmToken,
    probePort,
    limits: {
      maxUncompressed: resolveBombLimit(
        arg("max-uncompressed"),
        DEFAULT_BOMB_LIMITS.maxUncompressed,
        "max-uncompressed",
      ),
      maxRatio: resolveBombLimit(arg("max-ratio"), DEFAULT_BOMB_LIMITS.maxRatio, "max-ratio"),
    },
  });
  console.log(`Restored from ${archivePath}. Previous data preserved at ${movedAsideTo}.`);
  if (dbMovedAsideTo) {
    console.log(`Previous database (outside the data dir) preserved at ${dbMovedAsideTo}.`);
  }
} catch (e) {
  if (e instanceof RestorePartialError) {
    console.error(`Restore aborted mid-extraction: ${e.message}`);
    console.error(`Your previous data is preserved at: ${e.movedAsideTo}`);
    if (e.dbMovedAsideTo) {
      console.error(`Your previous database is preserved at: ${e.dbMovedAsideTo}`);
    }
  } else {
    console.error(`Restore aborted: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(1);
}
