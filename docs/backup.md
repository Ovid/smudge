# Operator Backup and Restore

## What this is

An operator recipe for backing up and restoring Smudge data from a
source checkout. It is designed for the dev/source-checkout workflow:
you run `make` targets from the repo root, and the same Node.js
toolchain used to run Smudge is used to create and restore archives.

Every `make dev` runs an automatic backup before starting the server.
Restoring from a backup is a manual operation — you run one command,
confirm it, and the server is back on the previous data.

## What this is not

- **Not the Phase 8b per-project `.smg` export.** That will be an
  in-app feature for end-users to export individual projects as
  portable archives. This recipe captures the full data directory.
- **Not per-project.** One archive covers the entire Smudge database
  and all uploaded images.
- **Not an in-app feature.** There is no UI. You run `make` targets in
  a terminal.
- **Not offsite.** Archives land in `backups/` at the repo root. You
  are responsible for copying them somewhere safe (see
  [Offsite storage](#offsite-storage)).
- **Not a daemon or scheduled job.** Auto-backup fires on `make dev`.
  Nothing runs in the background between dev sessions.

## Automatic backup

Every `make dev` writes a best-effort auto-backup to `backups/` before
starting the dev server:

```
backups/smudge-auto-YYYY-MM-DDTHHmmssZ.zip
```

The timestamp is **UTC** (the trailing `Z`) so filenames always sort
chronologically — even across a daylight-saving fall-back, when a local
wall-clock would briefly run backward and mis-order the rotation.

"Best-effort" means: if the backup fails for any reason, a WARNING is
printed and the dev server starts anyway. The server is never blocked by
a backup hiccup.

Auto-backups are rotated automatically. The newest `SMUDGE_BACKUP_KEEP`
archives are kept; older ones are deleted. The default is 10.

```bash
# Keep only the newest 5 auto-backups
SMUDGE_BACKUP_KEEP=5 make dev

# Skip auto-backup entirely for this session
SMUDGE_SKIP_AUTO_BACKUP=1 make dev
```

**If you see the WARNING on every `make dev`, investigate.** It means
auto-backups are silently not happening. A persistently failing backup
is not a nuisance — it is a gap in your safety net.

## Manual backup

```bash
make backup
```

Safe to run while Smudge is up. Writes a timestamped zip to `backups/`:

```
backups/smudge-YYYY-MM-DDTHHmmssZ.zip
```

(The timestamp is UTC — the trailing `Z` — same as auto-backups above.)

Manual backups are never auto-pruned. Run them before risky operations
(schema migrations, bulk edits, dependency upgrades) and keep them as
long as you need.

Each archive contains a hot-consistent copy of the SQLite database (via
`VACUUM INTO`) and the full `images/` tree.

## Restore

**Stop Smudge before restoring.** The restore script probes port 3456
(or `SMUDGE_PORT`) and refuses to proceed if the server is running.

```bash
make restore BACKUP=backups/smudge-2026-06-03T143000Z.zip
```

You will be prompted to type the backup filename (just the basename, not
the full path) to confirm. This is a deliberate gate — it prevents
accidental overwrites when the command is run from a script or muscle
memory.

Before touching the data directory, the script:

1. Validates the archive (zip-slip check, decompression-bomb size and
   ratio limits, presence of `smudge.db`, free-space pre-check).
2. Moves the existing data directory aside to
   `<data-dir>.before-restore-<time>/` — it is **never deleted**.
3. Extracts the archive into a fresh data directory.

If extraction fails mid-way (e.g. an unexpectedly large archive, a disk
error), the script prints the path of the preserved original:

```
Restore aborted mid-extraction: …
Your previous data is preserved at: /path/to/data-dir.before-restore-…/
```

No data is lost: move the preserved directory back into place and you
are where you started.

On success:

```
Restored from backups/smudge-….zip. Previous data preserved at /path/to/data-dir.before-restore-…/
```

The moved-aside directory is yours to delete once you are satisfied with
the restore.

### Overriding bomb limits

The archive validator rejects files whose declared uncompressed size
exceeds 2 GiB or whose compression ratio exceeds 10×. For legitimate
large databases you can raise those limits with the `MAX_UNCOMPRESSED`
(bytes) and `MAX_RATIO` make variables:

```bash
make restore BACKUP=backups/smudge-….zip MAX_UNCOMPRESSED=4294967296 MAX_RATIO=20
```

### Size ceiling (hard)

`MAX_UNCOMPRESSED` raises a **soft** cap. There is also a **hard** one: the
archive format is classic (non-zip64), so any archive whose total size or a
single entry reaches 4 GiB is **refused on restore** ("zip64 archive refused")
— and no `MAX_*` override lifts that, because the refusal happens before the
size limits are consulted. In practice keep the whole data directory (DB +
images) comfortably under ~4 GiB. If a manuscript's images ever approach that,
split the workload or archive out cold projects; the per-project `.smg` export
in Phase 8b is the long-term answer for large installs.

### Restore with a non-default port

If you run Smudge on a port other than 3456:

```bash
SMUDGE_PORT=4000 make restore BACKUP=backups/smudge-….zip
```

## Offsite storage

The `backups/` directory is gitignored and never committed. Copy it — or
cherry-pick individual archives — to a USB drive, a cloud-sync folder,
or any storage you trust:

```bash
cp backups/smudge-2026-06-03T143000Z.zip ~/Dropbox/smudge-backups/
```

A backup sitting next to the data it was taken from is not a backup in
any meaningful disaster scenario. Move at least the manual snapshots
offsite.

## When Phase 8b ships

Phase 8b introduces per-project `.smg` export as an in-app feature.
At that point this recipe becomes a full-machine snapshot utility rather
than the primary backup story. Archives written by the current
implementation remain readable by any Smudge version that includes the
same restore script — the zip layout (`smudge.db` + `images/` tree) is
stable.
