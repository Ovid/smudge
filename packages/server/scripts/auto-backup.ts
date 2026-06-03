import { join } from "node:path";
import { getDataDir, getDbPath } from "../src/config/paths";
import { runAutoBackup, DEFAULT_KEEP } from "../src/backup/backup-core";

const keep = Number(process.env.SMUDGE_BACKUP_KEEP ?? DEFAULT_KEEP) || DEFAULT_KEEP;
const r = await runAutoBackup({
  dataDir: getDataDir(),
  dbPath: getDbPath(),
  backupsDir: join(process.cwd(), "backups"),
  keep,
  skip: process.env.SMUDGE_SKIP_AUTO_BACKUP === "1",
});
if (r.status === "ok") console.log(`Auto-backup: ${r.outFile}`);
else if (r.status === "skipped-no-db") console.log("Auto-backup: no database yet — skipping.");
else if (r.status === "skipped-optout") console.log("Auto-backup skipped (SMUDGE_SKIP_AUTO_BACKUP).");
else console.error(`WARNING: auto-backup failed: ${r.warning} — starting Smudge anyway.`);
// Always exit 0: best-effort, must never block `make dev`.
