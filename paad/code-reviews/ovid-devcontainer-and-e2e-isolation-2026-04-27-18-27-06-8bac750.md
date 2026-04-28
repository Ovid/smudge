# Agentic Code Review: ovid/devcontainer-and-e2e-isolation

**Date:** 2026-04-27 18:27:06
**Branch:** ovid/devcontainer-and-e2e-isolation -> main
**Commit:** 8bac750c49e043bbde31977d338714923ae715cd
**Files changed:** 17 | **Lines changed:** +2035 / -45
**Diff size category:** Large

## Executive Summary

This is a **re-review** — the prior review at `5b89539` (`paad/code-reviews/ovid-devcontainer-and-e2e-isolation-2026-04-27-13-19-24-5b89539.md`) is committed and authoritative for the findings it raised; eleven follow-up commits since then have either applied fixes (C3, I5, I6, S3, S5, S6 — all confirmed resolved) or authored deferred patches for the read-only `.devcontainer/` files (C1, C2, I1, I2, I3, I4, S1, S2, S4, LAT2, OOSI1 — patches committed at `paad/code-reviews/deferred/2026-04-27-*.patch`, awaiting host-side application). This run hunts for issues the prior review missed or that the post-review commits introduced. Headline finding: **the S5 hardening landed at `playwright.config.ts:53-60` is broken** — `errno.path` for ENOTDIR is the requested leaf (verified live: `/tmp/<x>/smudge-e2e-data/images`), not the offending non-directory ancestor as the comment claims, so the user is told to `rm` a path that doesn't exist. Eight Important findings cluster around the new e2e-clean target (port-3457 hardcode with no parity test, IPv4-only probe with TOCTOU vs. server startup, symlink redirection on shared `/tmp`), the static-analysis gap on the now-118-line `playwright.config.ts` (outside `make lint/format-check/typecheck`), the deferred patches' tail gaps (marketplace TOFU window widened to per-container-creation; `fix_directory_ownership` chowns through top-level symlinks), and the layout-coupling of `mkdirSync(.../images)`. No new out-of-scope findings — all anchors are on lines this branch authored. One Latent: the playwright `mkdirSync` race is gated by `workers: 1`.

## Critical Issues

### [C1] `playwright.config.ts:55-60` ENOTDIR error tells user to remove a non-existent path
- **File:** `playwright.config.ts:53-60`
- **Bug:** the S5-2026-04-26 hardening at lines 45-50 documents "Node sets `errno.path` to the actual offender for both ENOTDIR (the non-directory ancestor) and EEXIST (the leaf path)." Verified live on Node 22 in this container: `errno.path` is the *requested* leaf, not the offending ancestor. Reproduced:
  ```
  $ touch /tmp/agentic-review-verify/smudge-e2e-data
  $ node -e "fs.mkdirSync('/tmp/agentic-review-verify/smudge-e2e-data/images', {recursive:true})"
  → e.code = ENOTDIR
  → e.path = /tmp/agentic-review-verify/smudge-e2e-data/images
  ```
  Tracing through the catch block: `offender = errno.path ?? E2E_DATA_DIR` resolves to `/tmp/<x>/smudge-e2e-data/images`. The thrown message reads "a non-directory exists at /tmp/<x>/smudge-e2e-data/images. Remove the conflicting non-directory (e.g. `rm /tmp/<x>/smudge-e2e-data/images`)." The user runs the suggested `rm` and gets "No such file or directory" — the actual offender (`/tmp/<x>/smudge-e2e-data`, the regular file masking the directory) is never named.
- **Impact:** the entire point of the S5 hardening was "tell the user to `rm` the right thing." The current code tells them to `rm` a phantom path. Time-to-diagnose climbs from "obvious from message" back to "ls -la each ancestor." EEXIST works correctly (Node sets `errno.path` to the leaf, which IS the offender for EEXIST under recursive mkdir).
- **Suggested fix:** for ENOTDIR, drop the `errno.path` fallback. Either (a) walk ancestors of `path.join(E2E_DATA_DIR, "images")` with `lstatSync` until one is a non-directory and name that one explicitly, or (b) simplify the message to "a non-directory exists at or above `${E2E_DATA_DIR}` — inspect that path and its parents with `ls -ld` to find it." Honest about the API limitation. Keep the EEXIST branch unchanged. Optionally collapse the two branches into one helper since the find-the-real-offender logic is identical for both.
- **Confidence:** High (reproduced live)
- **Found by:** Logic-A (`general-purpose (claude-opus-4-7[1m])`)

## Important Issues

### [I1] `E2E_SERVER_PORT` (3457) duplicated between `Makefile` and `playwright.config.ts` with no parity test
- **File:** `Makefile:177` paired with `playwright.config.ts:20`
- **Bug:** `playwright.config.ts:20` declares `const E2E_SERVER_PORT = "3457"`. The `Makefile` e2e-clean target embeds `port:3457` literally inside the `node -e` net-probe at line 177. The new `e2e-data-dir-parity.test.ts` enforces parity on the data-dir name only — there is no parity check on the port. The Makefile comment at line 171-176 even calls it out: "(3457, hardcoded in playwright.config.ts)". A future change parameterizing the port (env var, per-worker shard) would update playwright.config.ts and pass the parity test, typecheck, and lint — yet `make e2e-clean`'s probe would check the obsolete port. If the new e2e port is bound, the probe sees ECONNREFUSED on 3457, concludes "no listener," and `rm -rf` wipes the live data dir mid-run. This is precisely the failure mode S5 was added to prevent.
- **Impact:** drift hazard with the same severity-class as the data-dir drift the parity test was added to prevent. Same recovery cost as a real S5 incident.
- **Suggested fix:** extend `e2e-data-dir-parity.test.ts` with a second assertion that extracts the port literal from both files (regex `E2E_SERVER_PORT\s*=\s*"(\d+)"` against playwright.config.ts; `port:(\d+)` against Makefile) and asserts equality. Mirror the existing pattern. Cheaper than refactoring the port into a shared constant.
- **Confidence:** High
- **Found by:** Logic-A, Errors-A, Contract & Integration (`general-purpose (claude-opus-4-7[1m])` × 3)

### [I2] `playwright.config.ts` and `e2e/**/*.ts` are outside `make lint`, `make format-check`, and `make typecheck`
- **File:** `package.json:18-21` paired with `Makefile:139` and `playwright.config.ts` (root)
- **Bug:** `format` runs `prettier --write "packages/**/*.{ts,tsx,json,css}"`; `lint` runs `eslint --max-warnings 0 packages/`; `format-check` at `Makefile:139` matches `'packages/**/*.ts' 'packages/**/*.tsx' 'packages/**/*.json' 'packages/**/*.css'`; `typecheck` is `tsc -b packages/shared packages/server packages/client`. None of these globs include `playwright.config.ts` (root) or `e2e/**/*.ts`. This branch grew `playwright.config.ts` from ~30 lines to 118 lines (a try/catch with `NodeJS.ErrnoException` typing, a shared `parsePort` import, env-wired webServers) and changed `e2e/editor-save.spec.ts` substantially — none of which `make all` exercises statically. The recent `8bac750 style(shared): prettier reflow of e2e-data-dir-parity test` commit indicates someone hand-formatted on intent, which only worked because that test sits under `packages/`.
- **Impact:** TypeScript errors and unused imports in `playwright.config.ts` or `e2e/*.spec.ts` won't block `make all` — they land at the next person's `make e2e`, far from the cause. The fact that `import { parsePort } from "@smudge/shared"` resolves at all is a runtime fact no static gate verifies. Pre-existing scope, but the branch made the un-gated surface ~3× larger and load-bearing. Reasoning-promotion: the branch worsens the situation.
- **Suggested fix:** extend the globs in three places: (a) `package.json` `format` and `format:check` to `"{packages,e2e}/**/*.{ts,tsx,json,css}" "*.{ts,json}"`; (b) `package.json` `lint` and `lint:check` to add `e2e/ playwright.config.ts vitest.config.ts`; (c) add a root `tsconfig.json` referencing the workspace projects plus an `include` for `playwright.config.ts` and `e2e/**/*.ts`, and have `typecheck` use it. Mirror the format-check git-diff glob.
- **Confidence:** High
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7[1m])`)

### [I3] `playwright.config.ts:52` `mkdirSync(...,"images")` is unnecessary AND couples to server's storage layout
- **File:** `playwright.config.ts:52` paired with `packages/server/src/images/images.service.ts` (mkdirSync on every save)
- **Bug:** the server creates `<DATA_DIR>/images/<projectId>/...` lazily on first upload (its image service calls `mkdir(path.dirname(filePath), {recursive:true})`). The playwright pre-creation is unnecessary — recursive mkdir on the parent would create `images/` for free if it weren't already there. More importantly, naming the leaf `images` bakes server-side knowledge into the harness. If the server later renames this to `uploads/` or namespaces per-tenant, the pre-creation keeps creating an obsolete `images/` and nothing fails.
- **Impact:** silent contract drift between two packages. Adjacent class to R7 (the prior round flagged "destructive top-level side-effects"); this is a non-destructive but layout-coupling top-level side-effect.
- **Suggested fix:** change line 52 to `fs.mkdirSync(E2E_DATA_DIR, { recursive: true })`. Update the comment block to reflect that `images/` is created by the server on first upload. The ENOTDIR/EEXIST branches now name `E2E_DATA_DIR` directly — and the C1 fix above becomes simpler since both error branches reference the same path.
- **Confidence:** Medium
- **Found by:** Logic-A (`general-purpose (claude-opus-4-7[1m])`)

### [I4] `make e2e-clean` port probe is a TOCTOU window vs. server startup — the probe completes in milliseconds, but `app.listen(3457)` only fires 1-3s after `npm run dev`
- **File:** `Makefile:177-183` paired with `packages/server/src/index.ts:27-53`
- **Bug:** the server's e2e startup sequence is: spawn `npm run dev -w packages/server` → Node startup → `initDb` (Knex migrations) → `purgeOldTrash` → `app.listen(3457)`. Empirically multi-second. The S5 net-probe at Makefile:177 connects in milliseconds, sees ECONNREFUSED, and proceeds. A developer who runs `make e2e-clean && make e2e` (the canonical "fresh slate" workflow) hits a window where:
  1. probe in terminal A sees no listener (exit 0) — server hasn't started yet OR is mid-init;
  2. `make e2e` in terminal B launches; server begins migration on the existing DB;
  3. `rm -rf` in terminal A wipes the data dir, deleting `smudge.db` while better-sqlite3 holds an FD on it;
  4. server continues writing against the deleted inode; next process restart sees an empty DB.
- **Impact:** the prior review's S5 closed the **steady-state** race ("e2e is mid-run") but explicitly opened a **startup** race. The Makefile comment at lines 170-176 reads as if the probe is sufficient; the multi-second startup window where the probe lies is undocumented. The user-facing error mode is a corrupt e2e DB after a sequenced cleanup-then-run — diagnosable only by reading the Makefile.
- **Suggested fix:** acquire an OS-level advisory lock around the cleanup (`flock -n /tmp/smudge-e2e-clean.lock -c '<probe + rm>'`) and have `make e2e` take the same lock for its server lifecycle. Closes both the startup race and the two-concurrent-cleaners variant in one stroke. Or: accept the race, document it in the comment block ("between runs only — do not interleave with `make e2e` startup"), and leave the lock for follow-up.
- **Confidence:** Medium-High
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7[1m])`)

### [I5] Marketplace runtime-add (deferred patch) widens TOFU window from per-image-build to per-container-creation
- **File:** `paad/code-reviews/deferred/2026-04-27-marketplace-runtime-add.patch:64-123` (proposed `setup_plugin_marketplaces`)
- **Bug:** the patch correctly fixes the volume-shadowing bug (I3 from prior review) by moving `claude plugin marketplace add anthropics/skills && claude plugin marketplace add trailofbits/...` from Dockerfile RUN to `postCreateCommand`. The trust-frequency shifts: pre-fix, the marketplace manifests were re-fetched once per image rebuild (rare — Renovate-driven); post-fix, on every "Reopen in Container" / fresh clone (frequent — daily). Each call re-fetches the manifest from upstream. With `bypassPermissions` (opt-in), `NET_ADMIN`/`NET_RAW` caps, and the R/W workspace mount, plugin compromise has wide blast radius (already tracked in backlog `2b9f7d63` as a static "unpinned" issue). The frequency-of-trust-event is a separate dimension the deferred patch does not call out — its trust-posture commentary is copied forward verbatim.
- **Impact:** an attacker who briefly compromises a third-party marketplace (e.g. `trailofbits/skills`) lands plugin code on the next container creation, not the next image build. Window expands from "weeks" to "minutes/hours."
- **Suggested fix:** add a state file at `~/.claude/.smudge-marketplaces-registered` keyed by marketplace name. `setup_plugin_marketplaces()` skips the `add` call if the marketplace is already in it. Re-fetch only when an explicit "refresh marketplaces" affordance is invoked, OR when the patch's marketplace list changes (hash the list, write to the state file). The named volume persists state across recreations, so closing the per-creation re-fetch loop doesn't reintroduce the volume-shadowing bug.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7[1m])`)

### [I6] `os.tmpdir()`-based e2e data dir vulnerable to symlink redirection on non-sticky `/tmp`
- **File:** `playwright.config.ts:18, 52` paired with `Makefile:183`
- **Bug:** `E2E_DATA_DIR = path.join(os.tmpdir(), "smudge-e2e-data")` — fixed name, follows symlinks. On systems with sticky `/tmp` (Linux default), only the owner of the existing entry can have created/replaced it — self-footgun only. On systems WITHOUT sticky `/tmp` (some CI runners, certain shared dev hosts, BSD configs without it), another local user can pre-create `/tmp/smudge-e2e-data` as a symlink to a sensitive directory before the victim runs `make e2e`. The mkdirSync, server `DB_PATH=/tmp/smudge-e2e-data/smudge.db`, and `DATA_DIR=/tmp/smudge-e2e-data` all land at the redirected target. `make e2e-clean`'s `rm -rf` of a symlink removes the symlink itself, not the target — but the test run's writes already landed elsewhere. Realistic attack: co-tenant pre-creates `/tmp/smudge-e2e-data -> /home/victim/.ssh`; victim's `make e2e` writes the e2e SQLite DB and image files into `~/.ssh`, possibly clobbering `authorized_keys`.
- **Impact:** multi-user/CI hosts without sticky `/tmp` are exposed. Severity = data destruction in the victim's home dir.
- **Suggested fix:** namespace the path by UID: `path.join(os.tmpdir(), \`smudge-e2e-data-${process.getuid?.() ?? "shared"}\`)`. Eliminates cross-user collisions and the pre-positioned-symlink attack (the attacker would need to predict the victim's UID *and* race to create the symlink, both materially harder). Mirror in `Makefile:183` and the parity test.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7[1m])`)

### [I7] `fix_directory_ownership` `chown -R` follows top-level symlinks via the path argument
- **File:** `.devcontainer/post_install.py:240-253` (current state — NOT addressed by any 2026-04-27 deferred patch)
- **Bug:** `subprocess.run(["sudo", "chown", "-R", f"{uid}:{gid}", str(dir_path)], check=True, ...)`. GNU coreutils `chown -R` does NOT dereference symlinks encountered during recursion (default `--no-dereference`), but it DOES dereference the top-level command-line argument. If `Path.home() / ".claude"` is a symlink (left by a prior compromised container, hostile volume init, stale developer hack), `sudo chown -R vscode:vscode /home/vscode/.claude` follows the symlink and chowns everything under the target. A symlink to `/etc` chowns all of `/etc` to vscode — soft-bricks the container and is sudo blast in reverse.
- **Impact:** the named volume `devc-...-config-${devcontainerId}` is fresh per devcontainerId, so an attacker controlling volume contents pre-mount must already be inside the container or on the Docker socket. But the named volume CAN be inherited across rebuilds — an exploit running in a prior container that writes a `.claude -> /etc` symlink before rebuild lands the chown blast on the next postCreate. Sudo runs unconditionally (passwordless via base image), no auth gate.
- **Suggested fix:** before each chown, `if dir_path.is_symlink(): print warning; continue`. Or add `-h` to chown when `is_symlink()` is true (chowns the symlink itself, not the target). Refusing entirely is the cleaner default — there's no legitimate reason for `~/.claude` to be a symlink in this devcontainer. Either fix is one line.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7[1m])`)

### [I8] Inline `parsePort` drift hazard widened — now 4 sources of truth (canonical, vite-inline, parity test, playwright import)
- **File:** `packages/client/vite.config.ts:81-100` paired with `packages/shared/src/parsePort.ts`, `playwright.config.ts:5`
- **Bug:** before this branch, `parsePort` had two real consumers (server `index.ts`, client `vite.config.ts`) plus the canonical shared module and one parity test. The `vite.config.ts` inline copy was justified by bare-Node-ESM. This branch adds `playwright.config.ts:5` as a third real consumer, importing from `@smudge/shared` — proving the canonical version is reachable for at least one non-vite TS-config loader. There is now exactly one outlier: `vite.config.ts`. The drift-detection (vite-config-default-port.test.ts) covers the `DEFAULT_SERVER_PORT_VITE` literal but NOT the `parsePort` body. If shared `parsePort` evolves (e.g. accepts `0` for ephemeral binding, adds an `IPv4-only` flag), the vite copy silently diverges and dev workflow disagrees with server/playwright/the spec — no test fails.
- **Impact:** the comment block at `vite.config.ts:46-54` says "Keep this implementation in lockstep with shared/parsePort.ts; the test suite over there is the spec for both." That's a manual-discipline check. The branch widens the discipline burden by adding playwright as a successful import case, which itself argues that vite's inline justification has weakened (other config loaders manage). Drift hazard on a load-bearing utility that has historically been the target of S1/S9/I1 fixes (the comment block carries 4 review IDs).
- **Suggested fix:** add a textual parity test alongside `vite-config-default-port.test.ts`: read `parsePort.ts`'s function body (regex literal + range check) and `vite.config.ts`'s inline body, normalize whitespace, assert byte-equal. Or: prove the bare-Node-ESM constraint can be worked around (publish `@smudge/shared/parsePort` as a sub-path export pointing at compiled `.mjs`) and remove the inline copy. The latter is the right fix; the former is the pragmatic stopgap.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7[1m])`)

## Suggestions

- **[S1]** `Makefile:183` `rm -rf "$(node -p '...')"` fails opaque on `node -p` non-zero exit (substitutes empty → `rm -rf ""` no-ops). Capture into a make variable with non-empty assertion. Found by Logic-A, Errors-A.
- **[S2]** `Makefile:177` net-probe `setTimeout(500, …)` exits 2 → recipe aborts with "either e2e is running or the probe errored." 500ms is tight under loopback contention; bump to 2000ms or distinguish timeout from error. Found by Errors-A, Concurrency.
- **[S3]** `e2e-data-dir-parity.test.ts:18-19` regex matches first occurrence — a future commented-out historical example would silently match. Use `matchAll` and assert exactly one match per file. Found by Errors-A, Contract & Integration.
- **[S4]** `vite.config.ts:5-13` rewrite enumerates "SMUDGE_PORT, SMUDGE_CLIENT_PORT, and DB_PATH" but omits `DATA_DIR` (set at `playwright.config.ts:102`). Found by Logic-A.
- **[S5]** `.devcontainer/post_install.py:246-250` `sudo chown -R` lacks `-n` and `timeout=`; hangs interactively if invoked from a TTY. Add both for symmetry with sibling subprocess calls. Found by Errors-A.
- **[S6]** `.devcontainer/post_install.py:244-245` `fix_directory_ownership` decides on root `stat().st_uid` only — child files root-owned beneath a vscode-owned root are skipped. Drop the precondition or walk one level. Found by Errors-A.
- **[S7]** `paad/code-reviews/deferred/2026-04-27-post_install-correctness-and-hardening.patch:185-232` `_load_json_or_backup` doesn't catch `UnicodeDecodeError` (a `ValueError` subclass, NOT under `OSError`). Binary-content `~/.claude.json` aborts postCreate. Broaden to `(json.JSONDecodeError, UnicodeDecodeError)`. Found by Logic-A, Security.
- **[S8]** `paad/code-reviews/deferred/2026-04-27-post_install-correctness-and-hardening.patch:411-424` `_git_quote_value` doesn't escape `\n`/`\t`/`\r`. A host gitconfig with embedded control chars (rare, but a malicious-host vector) would corrupt `.gitconfig.local`. Reject the value or git-escape it. Found by Security.
- **[S9]** `paad/code-reviews/deferred/2026-04-27-post_install-correctness-and-hardening.patch:430` the `[include] path = {host_gitconfig}` opt-in branch is NOT routed through `_git_quote_value` — asymmetric defense. Latent today (path is a fixed literal); applies the moment a future env var lets users override the include source. Found by Security.
- **[S10]** `paad/code-reviews/deferred/2026-04-27-post_install-correctness-and-hardening.patch:462-467` `_git_quote_value` is applied to `commit.gpgsign` — a canonicalized boolean (`true`/`false`/`yes`/`no`/`1`/`0`/`on`/`off`) that has no metacharacters. Quoting is gratuitous and risks future git parser tightening rejecting quoted booleans. Skip the wrapper for this key. Found by Logic-A.
- **[S11]** `paad/code-reviews/deferred/2026-04-27-dockerfile-checksums.patch` ships PLACEHOLDER hash strings; build hard-fails post-commit on next image rebuild, AFTER the bad commit has landed. Add a pre-commit/CI grep that fails on `PLACEHOLDER_REPLACE_WITH_REAL_HASH` under `.devcontainer/`. Found by Security.
- **[S12]** `CLAUDE.md` and `CONTRIBUTING.md` Build & Run / Everyday workflow blocks don't list `make e2e-clean` (new user-facing target with non-trivial semantics). `playwright.config.ts:26` even cross-references it. Found by Contract & Integration.
- **[S13]** `Makefile:177` net-probe `host:'127.0.0.1'` only — server `app.listen(PORT)` defaults to `::` on dual-stack. IPv6-only hosts (or hosts with `bindv6only=1`) get false-negative probe → unsafe wipe. Probe `::1` as well. Found by Contract & Integration, Concurrency.
- **[S14]** `CLAUDE.md:9-18` "Ignore .devcontainer/" routinizes blind-spotting on a directory full of `dpkg -i` / `curl|bash` / capability grants. Routine `/security-review` invocations now skip the highest-trust-elevation surface. Add a one-line carve-out: the read-only-mount constraint applies to *editing*, not *security review*. Found by Security.

## Latent

> Findings on lines this branch authored where the bug is not currently reachable
> via any live code path, but the pattern itself is brittle or load-bearing for
> future work. **Not a merge-blocker** — record so the next change in this area
> is informed. Does not enter the OOS backlog (the branch authored these).

### [LAT1] `playwright.config.ts:52` mkdirSync runs in main + every worker — currently safe under `workers: 1`, brittle if cap is removed without sharding
- **File:** `playwright.config.ts:51-85`
- **Bug:** `mkdirSync(path, {recursive:true})` runs at module load time. Playwright loads the config in main + each worker (verified by reading playwright transform internals). With `workers: 1` (line 85), that's 2 concurrent invocations max. Recursive mkdir is race-safe in libuv (EEXIST during walk is swallowed for recursive mode), so today no spurious error fires.
- **Why latent:** the `workers: 1` cap holds the concurrency at safe levels, AND Node's recursive-mkdir implementation is correct under racing identical paths.
- **What would make it active:** removing the `workers: 1` cap (the comment at lines 76-84 envisages this for wall-time relief). If the path isn't sharded per worker (`process.env.TEST_PARALLEL_INDEX` per the comment), N workers each load the config, all mkdir the same `images/` leaf. Mostly still safe, but the file-at-leaf race becomes real and the catch block's "rm the offender" advice is unsafe on a symlink.
- **Suggested hardening:** when removing the `workers: 1` cap, derive the data dir per worker (`smudge-e2e-data-${TEST_PARALLEL_INDEX}`). And: in the EEXIST/ENOTDIR catch, `lstatSync` the offender path; refuse to suggest `rm` if it's a symlink — recommend `unlink` and surface the link target. Closes a separate hazard worth pre-empting.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7[1m])`)

## Plan Alignment

Plan source: `docs/roadmap.md` Phase 4b.6 (E2E Test Isolation) and `paad/code-reviews/deferred/2026-04-27-*.patch` (4 patches).

### Implemented since the prior review (5b89539 → 8bac750)
- **C3 fixed** (`vite.config.ts:5-13` rewritten in present tense — commit `7163dd8`). Phase 4b.6 DoD #3 now met.
- **I5 fixed** (`CLAUDE.md:9-18` mirrors `.github/copilot-instructions.md:5-14` verbatim — commit `48afa52`). Behavior asymmetry between Claude Code and Copilot resolved.
- **I6 fixed** (`playwright.config.ts:5,94,107` imports shared `parsePort` — commit `b56e169`). Confirmed Playwright loads via Babel, not bare-Node ESM.
- **S3 fixed** (parity test added for E2E_DATA_DIR — commit `db91709`). Brittleness flagged at S3 above.
- **S5/S6 fixed** (`make e2e-clean` no longer destructive on live runs / silent without node — commit `f274d5a`). Residual gaps flagged at I4, S1, S2, S13 above.
- **Backlog `e132b042`** (playwright never sets SMUDGE_*) confirmed deleted from `paad/code-reviews/backlog.md`.

### Not yet implemented (informational, not blocking)
- All four 2026-04-27 deferred patches (`paad/code-reviews/deferred/2026-04-27-{post_install-correctness-and-hardening,marketplace-runtime-add,devcontainer-remoteenv-passthroughs,dockerfile-checksums}.patch`) authored but pending host-side application. Until applied, the live `.devcontainer/` source still carries C1, C2, I1, I2, I3, I4, S1, S2, S4, LAT2, and OOSI1 from the prior review. Standard out-of-band flow per CLAUDE.md §Ignore `.devcontainer/`.
- The older `R5-R6-devcontainer-supply-chain-and-caps.patch` is a **sibling** (not superseded) of the new dockerfile-checksums patch — different binaries, different lines (R5: claude.ai/install.sh, fnm, zsh-in-docker; new: git-delta, fzf). Both still pending.

### Deviations
- **No design or plan document exists for the devcontainer scaffold.** `find docs/plans -iname "*devcontainer*"` and `grep -rn devcontainer docs/` both empty. Every other meaningful contribution in `docs/plans/` follows `YYYY-MM-DD-<feature>-design.md` + `-plan.md`; the ~1,000 lines of `.devcontainer/` content (Dockerfile, post_install.py, devcontainer.json, .zshrc) bypassed plan-first discipline. Future maintainers re-evaluating trust posture / capabilities / marketplace list will have no design doc to reference; the patch READMEs carry some rationale, but no top-level "why the devcontainer looks this way" record exists.
- **One-feature rule.** The branch now bundles three themes: (a) Phase 4b.6 e2e isolation, (b) devcontainer scaffold, (c) three rounds of devcontainer hardening. The prior review noted this as a maintainer judgment call; since then, more devcontainer hardening has accumulated (S5/S6, I6, I5, plus 4 new deferred patches, plus the review-notes commit). Phase-boundary rule says each roadmap phase is a PR — Phase 4b.6 is a phase; the devcontainer scaffold is not. If accepted as-is, it sets a precedent that "devcontainer" can ride alongside any roadmap phase indefinitely.
- **`workers: 1` cap and `make e2e-clean`** are not in Phase 4b.6's documented Scope or Definition of Done in `docs/roadmap.md`. Both are reasonable corollaries; documenting them as part of Phase 4b.6's *implementation* in the roadmap closes the loop.
- **`docs/roadmap.md:37`** Phase 4b.6 row still reads "Planned" — standard pre-merge state, but worth noting if the project's convention is to flip earlier in the PR cycle.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (Logic-A), Error Handling & Edge Cases (Errors-A), Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists)
- **Scope:** changed (.devcontainer/{.zshrc, Dockerfile, devcontainer.json, post_install.py}; .github/copilot-instructions.md; CLAUDE.md; Makefile; e2e/editor-save.spec.ts; paad/code-reviews/{backlog.md, deferred/2026-04-27-*.patch (4), ovid-devcontainer-and-e2e-isolation-2026-04-27-13-19-24-5b89539.md}; packages/client/vite.config.ts; packages/shared/src/__tests__/e2e-data-dir-parity.test.ts; playwright.config.ts) + adjacent (packages/server/src/index.ts, packages/server/src/images/images.{paths,service}.ts, packages/shared/src/{index.ts,parsePort.ts,__tests__/vite-config-default-port.test.ts}, package.json, eslint.config.js, docs/roadmap.md, CONTRIBUTING.md)
- **Raw findings:** 38 (before verification + dedup)
- **Verified findings:** 24 (1 Critical, 8 Important, 14 Suggestions, 1 Latent — after dedup, threshold, and re-confirmation against the prior 5b89539 report so already-tracked items are not re-flagged)
- **Filtered out:** 14 (drops: duplicates of prior-review findings, unverifiable behavior, pure stylistic preference, claims contradicted by live verification — N1 was the inverse: live verification *confirmed* a finding the prior review's S5 commit had not validated)
- **Latent findings:** 1 (Critical: 0, Important: 1, Suggestion: 0)
- **Out-of-scope findings:** 0 — all anchors are on lines this branch authored (the entire `.devcontainer/` directory is wholly new; `playwright.config.ts:51-118`, `Makefile:156-183`, `e2e-data-dir-parity.test.ts`, and the 4 deferred patches are likewise new on this branch)
- **Backlog:** 0 new entries, 0 re-confirmed (re-confirmation runs only when surfacing OOS findings; this review surfaced none — the prior review at 5b89539 is the authoritative re-confirmation for backlog entries on this branch)
- **Steering files consulted:** CLAUDE.md, .github/copilot-instructions.md, CONTRIBUTING.md
- **Plan/design docs consulted:** docs/roadmap.md (Phase 4b.6 lines 836-867); paad/code-reviews/deferred/2026-04-27-*.patch (4 patches); prior review ovid-devcontainer-and-e2e-isolation-2026-04-27-13-19-24-5b89539.md
