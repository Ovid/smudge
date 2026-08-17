# Configuration

Every knob Smudge reads at runtime, in one place.

**There is no `.env` file support.** Smudge has no `dotenv` dependency and no
code path that reads a `.env` file — an `.env.example` would be actively
misleading, so this repository deliberately does not ship one. Every variable
below must be set in the process environment: exported in your shell, passed on
the command line (`SMUDGE_PORT=4000 make dev`), or supplied by the container or
service manager running Smudge.

All variables are optional. Each has a default that makes a fresh checkout run.

## Runtime — the server

| Variable | Default | What it does |
|---|---|---|
| `DATA_DIR` | `packages/server/data` | Root of everything Smudge persists: the SQLite database and the image store (`DATA_DIR/images/…`). Point this at a Docker volume or a backed-up disk in any real deployment. |
| `DB_PATH` | `DATA_DIR/smudge.db` | The SQLite database file. Defaults *inside* `DATA_DIR`, so setting `DATA_DIR` alone moves the database with the images. Set this only to split the database away from the image store; an explicit `DB_PATH` wins over the `DATA_DIR` default. |
| `SMUDGE_PORT` | `3456` | Port the Express server binds. Must be an integer from 1 to 65535 — a garbage value **fails fast at startup** rather than silently falling back. |
| `LOG_LEVEL` | `info` | Log verbosity. One of `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. An unrecognised value prints a warning and falls back to `info` rather than failing — so a typo here degrades quietly, and the warning on stderr is your only signal. **This is the knob to reach for when diagnosing a live problem.** |
| `NODE_ENV` | unset | Only `development` is special-cased: it turns on pretty-printed logs. Any other value (or none) gives structured JSON output. |

## Development

| Variable | Default | What it does |
|---|---|---|
| `SMUDGE_CLIENT_PORT` | `5173` | Port the Vite dev server binds under `make dev`. Same validation as `SMUDGE_PORT`. Not used in production — the built client is served by Express. |

## Backup and restore

See [backup.md](backup.md) for the full backup story; these are the variables it
reads.

| Variable | Default | What it does |
|---|---|---|
| `SMUDGE_BACKUP_KEEP` | `10` | How many rotated auto-backups `make dev` retains. Blank or non-integer is treated as *not provided* and falls back to the default — deliberately, because `Number("")` is `0`, which would silently delete every backup. `0` **is** honoured when set explicitly. Manual `make backup` archives are never auto-pruned. |
| `SMUDGE_SKIP_AUTO_BACKUP` | unset | Set to exactly `1` to skip the automatic pre-start backup on `make dev`. Any other value is ignored. |
| `BACKUP` | *(required for restore)* | Path to the archive `make restore BACKUP=<file>` should restore. Not optional — `make restore` exits with a usage message if it is absent. |

## Tooling

| Variable | Default | What it does |
|---|---|---|
| `DEP_COOLDOWN_DAYS` | `7` | Quarantine window for the supply-chain gate (`make dep-cooldown`). No lockfile version younger than this many days passes unless it is allowlisted in `dependency-cooldown-allowlist.json`. Lowering it weakens the protection described in CLAUDE.md §Dependency Cooldown. |

---

**Keeping this current.** `scripts/__tests__/configuration-doc.test.mjs` fails
when production source reads a `process.env.NAME` that has no row here, or when
a row names a variable nothing reads. It scans for *literal* `process.env.NAME`
reads only — a destructured (`const { X } = process.env`) or computed
(`process.env[name]`) read is invisible to it, so a green suite is not proof
that this table is complete. Add those rows by hand.
