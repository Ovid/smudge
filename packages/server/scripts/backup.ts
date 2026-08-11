import { getBackupsDir, getDataDir, getDbPath } from "../src/config/paths";
import { runBackup } from "../src/backup/backup-core";

const dataDir = getDataDir();
const { outFile } = await runBackup({
  dataDir,
  dbPath: getDbPath(),
  backupsDir: getBackupsDir(),
  mode: "manual",
});
console.log(`Backup written: ${outFile}`);
