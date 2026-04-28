# Agentic Code Review: ovid/devcontainer-and-e2e-isolation

**Date:** 2026-04-27 13:19:24
**Branch:** ovid/devcontainer-and-e2e-isolation -> main
**Commit:** 5b895398f3e516ebf0f18c2d7e91e18a8a81b10a
**Files changed:** 8 | **Lines changed:** +850 / -14
**Diff size category:** Large

## Executive Summary

The branch implements Phase 4b.6 (E2E Test Isolation) and adds a new devcontainer scaffold. The e2e-isolation half is solid; the devcontainer half carries three live correctness defects in `post_install.py` that survive all the prior-review hardening. The highest-severity finding is a reproduced data-corruption bug in `_git_get`'s round-trip — a host gitconfig with `#` or `;` in user.name/email gets silently mangled in the container's identity. Two more Critical findings: a fall-through in the corrupt-JSON branch of `setup_onboarding_bypass` masks an auth failure, and the Phase 4b.6 Definition of Done is unmet because `vite.config.ts:5–13`'s forward-looking comment was not updated to reflect that the wiring it described as future is now done. Six Important findings (all in `.devcontainer/`), six Suggestions, two Latent. One out-of-scope supply-chain finding (`dpkg -i` and `tar -xz` of unverified GitHub release artifacts) joins the backlog. One existing backlog entry (`e132b042`) is resolved by this branch and should be deleted.

## Critical Issues

### [C1] `_git_get` round-trip strips git-INI escape/quote/comment chars
- **File:** `.devcontainer/post_install.py:366-398`
- **Bug:** `_git_get` calls `git config --file <host_gitconfig> --get <key>` which returns the *parsed* value (quotes/escapes resolved). The script then re-emits this verbatim into `.gitconfig.local` at lines 390/392/394/397 as `name = {user_name}`. When `.gitconfig.local` is later loaded as `GIT_CONFIG_GLOBAL`, those raw characters are *re-parsed* by git's INI rules and corrupt the value. Reproduced live: a host `[user] name = Test #1 User` round-trips to a container identity of `Test ` (everything after `#` becomes a comment). `;` truncates the same way (`j@x;y.com` → `j@x`). `"` and `\` get similarly mangled.
- **Impact:** silent data corruption of the developer's commit identity. A user with a perfectly normal `#` or `;` in their name or email gets a malformed `git commit --author` inside the container with no warning.
- **Suggested fix:** wrap each value in double quotes and escape internal `"` and `\`, or use `git config --file <local> set <key> <value>` to let git handle its own escaping.
- **Confidence:** High (reproduced)
- **Found by:** Logic-A (`general-purpose (claude-opus-4-7)`)

### [C2] Corrupt-JSON branch in `setup_onboarding_bypass` falls through to write a `hasCompletedOnboarding: true` stub
- **File:** `.devcontainer/post_install.py:87-114`
- **Bug:** When `claude -p` exits 0 but writes corrupt JSON, the `except json.JSONDecodeError` branch (90–110) moves the corrupt file to `.bak` and *does not return*. Control falls through to line 112: `config["hasCompletedOnboarding"] = True` runs against an empty dict, then line 114 writes `{"hasCompletedOnboarding": true}` to a fresh `.claude.json`. This is precisely the "stub over a stale-but-valid config" failure mode the C1-marked guard at lines 52–65 was added to prevent — except here we're stubbing over a *just-corrupted* config.
- **Impact:** masks an auth failure with a fake "onboarded" state. Subsequent `claude` invocations skip onboarding and fail with a confusing "not authenticated" error. Inconsistent with the documented C1 discipline at lines 53–59.
- **Suggested fix:** add a `return` after the `shutil.move` succeeds (lines 97–102) — recovery hands off to the next container restart, the same shape as the rc-nonzero branch at line 65.
- **Confidence:** High
- **Found by:** Logic-A (`general-purpose (claude-opus-4-7)`)

### [C3] `vite.config.ts:5-13` comment is now stale (Phase 4b.6 Definition of Done unmet)
- **File:** `packages/client/vite.config.ts:5-13` (file unchanged by this branch)
- **Bug:** The comment says "playwright.config.ts hardcodes 3456/5173, sets no env, and uses reuseExistingServer — so the isolation rationale is forward-looking. Roadmap Phase 4b.6 (E2E Test Isolation) will wire SMUDGE_PORT, SMUDGE_CLIENT_PORT, and DB_PATH on the playwright side and make the rationale true." This branch IS Phase 4b.6 and DOES wire those env vars (`playwright.config.ts:99-113`) and uses `reuseExistingServer: false` (97, 107). The comment is now factually wrong.
- **Impact:** Phase 4b.6's Definition of Done explicitly enumerates updating this comment ("no forward-looking TODO left behind"). Future readers will believe the isolation isn't actually wired and chase ghosts. Anchor is outside touched-lines but reasoning-promotion applies — this branch is the cause of the comment being stale.
- **Suggested fix:** rewrite the block in present tense — "playwright.config.ts wires SMUDGE_PORT/SMUDGE_CLIENT_PORT and DB_PATH; defaults preserve the standard `make dev` pair." Drop the now-obsolete S1/S9 sub-blocks that refer to "the comment block above".
- **Confidence:** High (`git diff main...HEAD -- packages/client/vite.config.ts` is empty)
- **Found by:** Logic-B, Errors-B, Contract & Integration, Plan Alignment (`general-purpose (claude-opus-4-7)` × 4 — high-confidence consensus)

## Important Issues

### [I1] `SMUDGE_DEVCONTAINER_BYPASS` and `_INCLUDE_HOST_GITCONFIG` opt-ins unreachable: not in `containerEnv`/`remoteEnv`
- **File:** `.devcontainer/post_install.py:127-130, 378` paired with `.devcontainer/devcontainer.json:53-71`
- **Bug:** the docstring at lines 127–129 tells users "Set SMUDGE_DEVCONTAINER_BYPASS=1 in remoteEnv (or localEnv pass-through)". `devcontainer.json:53-67` (`containerEnv`) and `:68-71` (`remoteEnv`) declare neither var nor a `${localEnv:...}` pass-through. Setting either env var on the host shell never reaches the script.
- **Impact:** the I4/I6 deferred patches were specifically scoped to make these flags discoverable opt-ins. As shipped, both are write-only — only an editor manually invoking `SMUDGE_DEVCONTAINER_BYPASS=1 uv run …` inside the container can flip them. That defeats the point of the opt-in.
- **Suggested fix:** add `"SMUDGE_DEVCONTAINER_BYPASS": "${localEnv:SMUDGE_DEVCONTAINER_BYPASS:}"` and `"SMUDGE_DEVCONTAINER_INCLUDE_HOST_GITCONFIG": "${localEnv:SMUDGE_DEVCONTAINER_INCLUDE_HOST_GITCONFIG:}"` to `remoteEnv`. Verify the var is visible during `postCreateCommand` (some devcontainer-cli versions only apply remoteEnv to user shells); fall back to `containerEnv` if needed.
- **Confidence:** High
- **Found by:** Logic-A, Security (`general-purpose (claude-opus-4-7)` × 2)

### [I2] `setup_claude_settings` runs *before* `fix_directory_ownership`, so a root-owned settings file kills postCreate
- **File:** `.devcontainer/post_install.py:448-456`
- **Bug:** `main()` order: `setup_onboarding_bypass` → `setup_claude_settings` → `setup_tmux_config` → `fix_directory_ownership` → `setup_global_gitignore`. Both `setup_onboarding_bypass:89` and `setup_claude_settings:152` call `path.read_text()`, which raises `PermissionError` (uncaught — only `JSONDecodeError` is handled). If a previous container run was as root and wrote `~/.claude/settings.json` or `~/.claude.json` root-owned, postCreate dies before `fix_directory_ownership` (the function explicitly designed to chown them) ever runs.
- **Impact:** the recovery code is downstream of the broken step. Container ends up with no tmux config, wrong ownership on `/commandhistory` and `~/.config/gh`, and no git identity.
- **Suggested fix:** move `fix_directory_ownership()` to be the *first* call in `main()`, or wrap the `read_text()` calls in `try/except OSError` with the same backup-and-continue treatment as `JSONDecodeError`.
- **Confidence:** High
- **Found by:** Errors-A (`general-purpose (claude-opus-4-7)`)

### [I3] Marketplace add at image-build time invisible on volume reuse
- **File:** `.devcontainer/Dockerfile:94-97` paired with `.devcontainer/devcontainer.json:46`
- **Bug:** `claude plugin marketplace add` writes to `/home/vscode/.claude` during the build (image layer). `devcontainer.json:46` mounts a named volume at `/home/vscode/.claude`. Docker's "populate empty named volume from image dir" rule applies only to *empty* volumes; on rebuild without `docker volume rm` (the default for VS Code "Rebuild Container"), existing volume contents shadow the image dir entirely.
- **Impact:** marketplace pin updates won't propagate to existing developers. Today: the registrations baked at build time work on first creation but stop reflecting Dockerfile changes after that. Symptom is silent staleness.
- **Suggested fix:** move the `claude plugin marketplace add` calls out of the Dockerfile and into `post_install.py` so they run *after* the volume mount on every container creation. Idempotent — adding an already-registered marketplace is a no-op.
- **Confidence:** Medium
- **Found by:** Logic-A (`general-purpose (claude-opus-4-7)`)

### [I4] `_git_get` swallows malformed-config errors silently → empty-of-identity container
- **File:** `.devcontainer/post_install.py:366-376` paired with `.devcontainer/devcontainer.json:48, 72`
- **Bug:** `git config --file --get` returns rc=1 for "key absent" (normal) and rc=128 for "couldn't parse the file" (malformed gitconfig). The function returns `""` for both. Combined with `setup_global_gitignore:387` (`if user_name or user_email or signing_key`), a malformed host gitconfig produces a `.gitconfig.local` with *no `[user]` section at all*. `GIT_CONFIG_GLOBAL` then resolves to that file; the very first `git commit` fails with "Author identity unknown". Same shape applies to absent gitconfig: `initializeCommand` `touch`es one if missing, then every `_git_get` returns `""`.
- **Impact:** the developer can't tell whether they need to set identity, fix their host gitconfig, or what — they just see "Author identity unknown" and dig.
- **Suggested fix:** distinguish rc=1 (return `""`) from rc≠0,1 (warn and return `""`). Emit a clearly-formatted warning to stderr when no `[user]` section is being written.
- **Confidence:** High
- **Found by:** Errors-A, Contract & Integration (`general-purpose (claude-opus-4-7)` × 2)

### [I5] CLAUDE.md missing "Ignore .devcontainer/" mirror that copilot-instructions.md has
- **File:** `CLAUDE.md` (no devcontainer reference) paired with `.github/copilot-instructions.md:5-15`
- **Bug:** copilot-instructions:5–15 tells Copilot to ignore `.devcontainer/` because it's bind-mounted read-only and changes go through `paad/code-reviews/deferred/*.patch`. The same constraint applies to Claude Code (which reads CLAUDE.md), but there's no equivalent directive. `grep -i "devcontainer" CLAUDE.md` returns empty.
- **Impact:** Claude Code will happily edit `.devcontainer/post_install.py` from inside the container, fail because the mount is read-only, retry, get confused, and burn time. The two AI assistants have asymmetric behavior on the same repo.
- **Suggested fix:** mirror the "Ignore .devcontainer/" section into CLAUDE.md verbatim (adjusted for "Claude Code" instead of "GitHub Copilot").
- **Confidence:** High
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)

### [I6] `playwright.config.ts:93,106` uses `Number.parseInt` instead of canonical `parsePort`
- **File:** `playwright.config.ts:93, 106`
- **Bug:** Hardcoded port literals `"3457"`/`"5174"` parsed with `Number.parseInt(..., 10)`. Today inputs are clean literals so behavior is correct. Risk is precedent: anyone refactoring to `process.env.X ?? "..."` reintroduces the exact bugs the inline `parsePort` in `vite.config.ts:81-100` was created to prevent (leading-zero octal-looking values, `"3456abc"` trailing junk, NaN). The codebase has explicit precedent — server `index.ts` and vite `config.ts` both use `parsePort` with documented rationale; playwright is the odd one out.
- **Impact:** drift hazard. Missing the parsePort discipline in playwright.config means the next env-var-aware refactor lands a subtle regression.
- **Suggested fix:** `import { parsePort } from "@smudge/shared"` (Playwright loads via Node/tsx, not bare ESM, so the constraint that forced inlining in vite.config.ts does not apply here — `node:fs`/`node:os`/`node:path` are already imported successfully). Then `port: parsePort(E2E_SERVER_PORT, "E2E_SERVER_PORT")`.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)

## Suggestions

- **[S1]** `shutil.move(path, .bak)` silently overwrites a prior backup at `.devcontainer/post_install.py:97, 156`; use a timestamp-suffixed backup name. Found by Logic-A, Errors-A.
- **[S2]** `SMUDGE_DEVCONTAINER_BYPASS` / `_INCLUDE_HOST_GITCONFIG` exact-string-match `"1"` only at `.devcontainer/post_install.py:130, 378`; normalize via `.strip().lower() in {"1","true","yes","on"}`. Found by Errors-A.
- **[S3]** Two derivations of `E2E_DATA_DIR` with no parity test — `Makefile:161` and `playwright.config.ts:17`; export the constant or add a parity vitest. Found by Contract & Integration.
- **[S4]** Duplicated load-or-backup pattern at `.devcontainer/post_install.py:88-110` and `:149-169`; extract `_load_json_or_backup(path) -> tuple[dict, bool]`. Found by Contract & Integration.
- **[S5]** `make e2e-clean` while `make e2e` is mid-run wipes the live data dir at `Makefile:156-161`; check for a listener on `E2E_SERVER_PORT` before `rm -rf`. Found by Concurrency.
- **[S6]** `make e2e-clean` silently no-ops when `node` is not on PATH at `Makefile:161`; add `command -v node` guard. Found by Logic-B, Errors-B.

## Latent

> Findings on lines this branch authored where the bug is not currently reachable
> via any live code path, but the pattern itself is brittle or load-bearing for
> future work. **Not a merge-blocker** — record so the next change in this area
> is informed. Does not enter the OOS backlog (the branch authored these).

### [LAT1] `daily_snapshots` upsert doesn't filter `deleted_at` → orphan rows possible if `afterEach` races unmount cleanup
- **File:** `e2e/editor-save.spec.ts:40-45` paired with `packages/client/src/components/Editor.tsx:205-229` and `packages/server/src/velocity/velocity.repository.ts:4-16`
- **Bug:** `Editor.tsx`'s unmount cleanup at 214–227 fires a fire-and-forget PATCH if `dirtyRef.current` is true. `velocity.repository.upsertDailySnapshot` does an unconditional INSERT/ON CONFLICT — no `WHERE deleted_at IS NULL` on the parent project. If a unmount-cleanup PATCH lands *after* `afterEach`'s `deleteProject` soft-deletes the project, `recordSave → updateDailySnapshot` writes a `daily_snapshots` row referencing a soft-deleted project.
- **Why latent:** every save spec awaits the "Saved" status before `afterEach` runs (lines 62, 109, 150, 159, 184, 197, 227), so `dirtyRef` is false at unmount and no fire-and-forget PATCH is dispatched. The race window is closed by spec design, not by the API.
- **What would make it active:** any future save spec that omits the "Saved" wait before navigating away (e.g. testing offline behavior, or testing chapter-switch racing). Or any spec that types and immediately calls `request.delete(project.slug)` outside `afterEach`.
- **Suggested hardening:** in `upsertDailySnapshot`, add a `WHERE` predicate on the parent project: `INSERT INTO daily_snapshots ... SELECT ... FROM projects WHERE id = ? AND deleted_at IS NULL`. Alternatively, route through a `findProjectById(projectId, { activeOnly: true })` guard before any velocity write.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7)`)

### [LAT2] `fix_directory_ownership` hardcodes `~/.claude` instead of `CLAUDE_CONFIG_DIR`
- **File:** `.devcontainer/post_install.py:235`
- **Bug:** `dirs_to_fix` lists `Path.home() / ".claude"`. Today `devcontainer.json:55` sets `CLAUDE_CONFIG_DIR=/home/vscode/.claude` which equals `~/.claude`, so the bug is unreachable.
- **Why latent:** the env var literally equals the home-relative default in the current devcontainer.json.
- **What would make it active:** if the user customizes `CLAUDE_CONFIG_DIR` to a different path (e.g. `/workspace/.claude` for per-project state), ownership-fix doesn't visit it.
- **Suggested hardening:** `Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude")))` — same pattern already used at line 139 in `setup_claude_settings`.
- **Confidence:** Medium
- **Found by:** Errors-A (`general-purpose (claude-opus-4-7)`)

## Out of Scope

> **Handoff instructions for any agent processing this report:** The findings below are
> pre-existing bugs that this branch did not cause or worsen. Do **not** assume they
> should be fixed on this branch, and do **not** assume they should be skipped.
> Instead, present them to the user **batched by tier**: one ask for all out-of-scope
> Critical findings, one ask for all Important, one for Suggestions. For each tier, the
> user decides which (if any) to address. When you fix an out-of-scope finding, remove
> its entry from `paad/code-reviews/backlog.md` by ID.

### Out-of-Scope Important
#### [OOSI1] git-delta `.deb` (Dockerfile:39) and fzf tarball (Dockerfile:55) fetched without checksum verification — backlog id: `7d3a91ef`
- **File:** `.devcontainer/Dockerfile:39, 55`
- **Bug:** Two GitHub-release fetches not enumerated in backlog `1807f5f4` (which calls out only the three *curl-bash* sites at 94/108/117). `dpkg -i` runs maintainer scripts as root; the fzf binary lands in `/usr/local/bin` and runs every Ctrl-T/Ctrl-R. A compromised release lands attacker-controlled native code with elevated trust.
- **Impact:** new supply-chain trust events not on the existing backlog. Distinct mitigation pattern from the curl-bash sites — each can have a baked SHA-256 alongside the version `ARG`.
- **Suggested fix:** add a `sha256sum -c` step against a hash literal in the Dockerfile, kept in lockstep with the version `ARG` (renovate can update both atomically).
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7)`)
- **Backlog status:** new (first logged 2026-04-27)

### Out-of-Scope Suggestions

(Backlog `last_seen` updates only — these entries were re-confirmed on this branch but not introduced or worsened. Listed here for transparency; no new asks.)

- `5034239f` — `.git/hooks` mounted readonly (`devcontainer.json:51`)
- `1807f5f4` — three curl-bash installs without integrity verification (`Dockerfile:94, 108, 117`)
- `c3daad8d` — `NET_ADMIN`/`NET_RAW` granted unconditionally (`devcontainer.json:16-17`)
- `b09b4ec5` — `uv tool install ast-grep-cli` unpinned (`Dockerfile:103`)
- `afe54fb1` — `claude-yolo` alias and `bypassPermissions` redundant routes (`.zshrc:35`, `post_install.py:120-179`)
- `2b9f7d63` — third-party plugin marketplaces unpinned (`Dockerfile:96-97`)
- `afcaee1c` — Steering files don't mention `SMUDGE_PORT`/`SMUDGE_CLIENT_PORT`. Partially addressed (`vite.config.ts:5-13` mentions them — but that comment is now stale per C3 above) but `copilot-instructions.md` and `CLAUDE.md` still don't.
- `ca84e075` — `CLAUDE.md` / `README` / `copilot-instructions` reference `docker-compose` that doesn't exist.

### Backlog entry resolved by this branch — recommend deletion

- **`e132b042`** — "playwright.config.ts hardcodes 3456/5173 and never sets SMUDGE_PORT/SMUDGE_CLIENT_PORT". Resolved by `playwright.config.ts:93-115`, which sets `SMUDGE_PORT=3457`, `SMUDGE_CLIENT_PORT=5174`, `DB_PATH`, `DATA_DIR`, and uses `reuseExistingServer: false`. Delete from `backlog.md`.

## Plan Alignment

Plan source: `docs/roadmap.md` Phase 4b.6 (E2E Test Isolation) and `paad/code-reviews/deferred/*.patch`.

### Implemented
- Phase 4b.6 Scope #1 (env-var wiring): `playwright.config.ts:97-114` sets `SMUDGE_PORT`, `DB_PATH`, `DATA_DIR` on server entry; `SMUDGE_PORT`, `SMUDGE_CLIENT_PORT` on client entry.
- Phase 4b.6 Scope #2 (port waits + baseURL): `playwright.config.ts:86, 93, 106` — `baseURL: http://localhost:5174`, `port: 3457`, `port: 5174`. `reuseExistingServer: false` on both (97, 107).
- Phase 4b.6 DoD #1 (simultaneous run): distinct ports — e2e 3457/5174, dev 3456/5173.
- Phase 4b.6 DoD #2 (DB isolation): `E2E_DB_PATH = path.join(os.tmpdir(), "smudge-e2e-data", "smudge.db")` (playwright.config.ts:17-18, 100); `make e2e-clean` derives the same path (Makefile:161).
- Deferred patches C1, I1-I2-I4-I6-S4, I3 — all applied per recent commits (`46f06ee`, `5b89539`, `a7f5386`).

### Not yet implemented (informational, not blocking)
- Phase 4b.6 DoD #3 ("`vite.config.ts:5-10` comment reflects what `playwright.config.ts` actually does — no forward-looking TODO left behind"): not done. Tracked above as **C3**.
- Deferred patch `R5-R6-devcontainer-supply-chain-and-caps.patch`: not applied. The patch must be applied from the host, and its own README notes a placeholder SHA that the maintainer must regenerate. Items addressed by this patch (R5 supply-chain comment + zsh-in-docker SHA, R6 capabilities rationale) remain pending.

### Deviations
- `workers: 1` cap (`playwright.config.ts:75-84`) is not in the Phase 4b.6 plan; it's a follow-on hardening from a same-branch agentic review (the I5 comment cites it). Reasonable corollary — a single-DB/single-port webServer with default `os.cpus()/2` workers would race.
- `make e2e-clean` target (`Makefile:156-161`) is not in the Phase 4b.6 plan; supporting affordance the playwright.config explicitly leans on (line 25).
- E2e spec touch-ups (`e2e/editor-save.spec.ts:128-138, 153`) tighten the `**/api/chapters/**` glob to `*` (S3) and `await` the route handlers (R4) — useful test-quality fixes outside the Phase 4b.6 Scope/DoD.
- Devcontainer scaffold + e2e isolation are arguably two themes per CLAUDE.md §Pull Request Scope ("One-feature rule"). The devcontainer hardening commits are remediations of the scaffold introduced earlier in the same branch, so they read as "feature + same-feature follow-ups" plus "the e2e-isolation phase" — maintainer judgment call.
- `.github/copilot-instructions.md` "Ignore .devcontainer/" block is not in any plan source; companion to the read-only-mount rationale.

## Review Metadata

- **Agents dispatched:** Logic-A, Logic-B, Errors-A, Errors-B, Contract & Integration, Concurrency & State, Security, Plan Alignment (8 specialists)
- **Scope:** changed (.devcontainer/.zshrc, Dockerfile, devcontainer.json, post_install.py; .github/copilot-instructions.md; Makefile; e2e/editor-save.spec.ts; playwright.config.ts) + adjacent (packages/server/src/index.ts, packages/client/vite.config.ts, packages/server/src/images/images.paths.ts, packages/shared/src/parsePort.ts, CLAUDE.md, CONTRIBUTING.md, docs/roadmap.md)
- **Raw findings:** 32 (before verification)
- **Verified findings:** 17 (after verification, dedup, threshold)
- **Filtered out:** 15 (drops: husky-not-in-use, unverifiable CLI behavior, pure style/clarity, out-of-current-state edge cases, subsumed by other findings)
- **Latent findings:** 2 (Critical: 0, Important: 1, Suggestion: 1)
- **Out-of-scope findings:** 1 new + 8 backlog re-seen (Critical: 0, Important: 1, Suggestion: 0)
- **Backlog:** 1 new entry added (`7d3a91ef`), 8 re-confirmed, 1 resolved-by-this-branch (`e132b042`) flagged for deletion. See `paad/code-reviews/backlog.md`.
- **Steering files consulted:** CLAUDE.md, .github/copilot-instructions.md, CONTRIBUTING.md
- **Plan/design docs consulted:** docs/roadmap.md (Phase 4b.6), paad/code-reviews/deferred/*.patch (4 patches), prior reviews ovid-miscellaneous-fixes-2026-04-26-19-32-27-f346047.md and ovid-native-binding-build-infra-2026-04-27-09-35-21-aff8498.md
