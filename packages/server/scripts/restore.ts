import { createInterface } from "node:readline/promises";
import { connect } from "node:net";
import { basename } from "node:path";
import { getDataDir } from "../src/config/paths";
import { runRestore, RestorePartialError, DEFAULT_BOMB_LIMITS } from "../src/backup/backup-core";

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
    let done = false;
    const finish = (v: boolean) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    for (const host of ["127.0.0.1", "::1"]) {
      const s = connect({ host, port }, () => {
        s.destroy();
        finish(true);
      });
      s.on("error", () => finish(false));
      s.setTimeout(500, () => {
        s.destroy();
        finish(false);
      });
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
  const { movedAsideTo } = await runRestore({
    archivePath,
    dataDir: getDataDir(),
    confirmToken,
    probePort,
    limits: {
      maxUncompressed: Number(arg("max-uncompressed") ?? DEFAULT_BOMB_LIMITS.maxUncompressed),
      maxRatio: Number(arg("max-ratio") ?? DEFAULT_BOMB_LIMITS.maxRatio),
    },
  });
  console.log(`Restored from ${archivePath}. Previous data preserved at ${movedAsideTo}.`);
} catch (e) {
  if (e instanceof RestorePartialError) {
    console.error(`Restore aborted mid-extraction: ${e.message}`);
    console.error(`Your previous data is preserved at: ${e.movedAsideTo}`);
  } else {
    console.error(`Restore aborted: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(1);
}
