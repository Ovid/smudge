import { getBackupsDir, getDataDir, getDbPath } from "../src/config/paths";
import { runAutoBackup, resolveKeep } from "../src/backup/backup-core";

const keep = resolveKeep(process.env.SMUDGE_BACKUP_KEEP);
const r = await runAutoBackup({
  dataDir: getDataDir(),
  dbPath: getDbPath(),
  backupsDir: getBackupsDir(),
  keep,
  skip: process.env.SMUDGE_SKIP_AUTO_BACKUP === "1",
});
if (r.status === "ok") {
  console.log(`Auto-backup: ${r.outFile}`);
  // F-15: the archive succeeded but pruning did not, so backups/ is growing.
  // Read on the ok path too — this branch previously ignored `warning`, which
  // is why a rotation failure was invisible however loudly backup-core reported it.
  if (r.warning) console.error(`WARNING: auto-backup ${r.warning}`);
} else if (r.status === "skipped-no-db") console.log("Auto-backup: no database yet — skipping.");
else if (r.status === "skipped-optout")
  console.log("Auto-backup skipped (SMUDGE_SKIP_AUTO_BACKUP).");
else console.error(`WARNING: auto-backup failed: ${r.warning} — starting Smudge anyway.`);
// Always exit 0: best-effort, must never block `make dev`.
