import { createInterface } from "node:readline/promises";
import { connect } from "node:net";
import { basename } from "node:path";
import { getDataDir, getDbPath } from "../src/config/paths";
import {
  runRestore,
  RestorePartialError,
  DEFAULT_BOMB_LIMITS,
  resolveBombLimit,
} from "../src/backup/backup-core";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

const archivePath = process.env.BACKUP;
if (!archivePath) {
  console.error("Usage: make restore BACKUP=backups/smudge-….zip");
  process.exit(2);
}

const port = Number(process.env.SMUDGE_PORT ?? 3456);
const probePort = () =>
  new Promise<boolean>((resolve) => {
    const hosts = ["127.0.0.1", "::1"];
    let pending = hosts.length;
    let settled = false;
    const succeed = () => {
      if (!settled) {
        settled = true;
        resolve(true);
      }
    };
    const failOne = () => {
      pending -= 1;
      if (!settled && pending === 0) {
        settled = true;
        resolve(false);
      }
    };
    for (const host of hosts) {
      let socketDone = false;
      const s = connect({ host, port }, () => {
        socketDone = true;
        s.destroy();
        succeed();
      });
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
