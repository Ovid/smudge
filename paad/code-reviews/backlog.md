# Out-of-Scope Findings Backlog

> **These items were flagged by `/paad:agentic-review` as out of scope for the branch
> on which they were found.** They may be stale, may already have been fixed by other
> means, may no longer apply after refactors, or may simply have been judged not worth
> addressing. Verify each entry against the current code before acting on it. Entries
> are removed only when explicitly addressed — no automatic cleanup.

---

## `5034239f` — `.git/hooks` mounted read-only breaks pre-commit frameworks
- **File (at first sighting):** `.devcontainer/devcontainer.json:51`
- **Symbol:** `mounts[]` (devcontainer.json mounts entry for `.git/hooks`)
- **Bug class:** Contract
- **Description:** `.git/hooks` is bind-mounted with `readonly`. Pre-commit frameworks (lefthook, some husky configs) write into `.git/hooks` at install/refresh time and would silently fail inside the container while working on host. The project does not currently use such a framework, so this is forward-compat hazard rather than a present bug.
- **Suggested fix:** Drop `readonly` if the project plans to adopt a hook framework, or document and add a CI check that all committed hooks are read-only-safe.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Important

## `1807f5f4` — Three curl-bash installs without integrity verification
- **File (at first sighting):** `.devcontainer/Dockerfile:78`
- **Symbol:** `RUN curl … | bash` (claude.ai/install.sh, fnm.vercel.app/install, zsh-in-docker release)
- **Bug class:** Security
- **Description:** Three uncontrolled installer scripts pulled and piped to a shell during image build with no SHA-256 verification. Other lines pin by digest, so the bar is already higher. Container rebuild is a TOFU event — if any endpoint is compromised between builds, attacker-controlled shell runs.
- **Suggested fix:** Download to a temp file, `sha256sum -c -` against a checked-in hash, then execute. Use Renovate annotations to track version+digest pairs.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Important

## `c3daad8d` — `NET_ADMIN` / `NET_RAW` granted unconditionally
- **File (at first sighting):** `.devcontainer/devcontainer.json:15`
- **Symbol:** `runArgs[]`
- **Bug class:** Security
- **Description:** Both Linux capabilities are added on every container build regardless of whether bubblewrap-with-network-namespacing is actually used by the Smudge dev workflow. NET_RAW enables ARP spoofing on the container's Docker bridge — lateral-movement risk on multi-tenant Docker hosts.
- **Suggested fix:** If bubblewrap doesn't need either cap for Smudge, drop them. If it does, document which is needed and why next to the runArgs.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Important

## `f4b4b15c` — `EditorFooter.tsx` `saveFailed` fallback is structurally unreachable
- **File (at first sighting):** `packages/client/src/components/EditorFooter.tsx:40`
- **Symbol:** `EditorFooter` (saveStatus="error" branch)
- **Bug class:** Contract
- **Description:** The `?? STRINGS.editor.saveFailed` defensive fallback at the saveStatus="error" render is unreachable in production: every site in `useProjectEditor.ts` that flips `saveStatus` to `"error"` always sets `saveErrorMessage` first. The branch's rename of `STRINGS.editor.saveFailed` therefore has no user-visible impact at this site, but the dead-code defense is a maintenance hazard.
- **Suggested fix:** Audit reachability and either remove the fallback or document its unreachability inline. Lower priority — purely cosmetic.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `20f2616`
- **Severity:** Suggestion

## `7e2a9d41` — `Editor.flushSave` does not honor `setEditable(false)` lock
- **File (at first sighting):** `packages/client/src/components/Editor.tsx:333`
- **Symbol:** `flushSave` (exposed via `editorRef.current.flushSave`)
- **Bug class:** Logic
- **Description:** The I6 fix on the `ovid/miscellaneous-fixes` branch added an `editorInstance.isEditable === false` short-circuit inside `debouncedSave`. The same rationale (locked editor → save would deterministically 4xx and re-fire the lock setter) applies whenever any caller triggers `flushSave` while the editor is locked, but `flushSave` itself reads `editor.getJSON()` and calls `onSaveRef.current(...)` unconditionally. Today every live caller (Ctrl+S handler, `useEditorMutation`) gates externally via `editorLockedMessageRef`/`isEditorLocked()`, so no live path can reach this — pre-existing dead-defense gap, not exposed by this branch.
- **Suggested fix:** Add `if (!editor.isEditable) return Promise.resolve(true);` at the top of `flushSave` so the invariant is enforced at the Editor level (defense-in-depth). Add a regression test mirroring the I6 test in `Editor.test.tsx`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `20f2616`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `20f2616`
- **Severity:** Suggestion

## `b09b4ec5` — `uv tool install ast-grep-cli` is unpinned
- **File (at first sighting):** `.devcontainer/Dockerfile:87`
- **Symbol:** `RUN uv tool install ast-grep-cli`
- **Bug class:** Security
- **Description:** No version constraint, no Renovate annotation. A typo-squat or compromised PyPI release would be picked up at next image build. Dev-only tool but invoked by Claude skills and `sg` alias, so it does run against source.
- **Suggested fix:** Pin the version (`uv tool install ast-grep-cli==<version>`) with a Renovate `# datasource=pypi depName=ast-grep-cli` annotation matching other pinned tools.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Suggestion

## `afe54fb1` — `claude-yolo` alias and `bypassPermissions` setting are redundant routes
- **File (at first sighting):** `.devcontainer/post_install.py:113`
- **Symbol:** `setup_claude_settings` (and `.devcontainer/.zshrc:35` `claude-yolo` alias)
- **Bug class:** Contract
- **Description:** Two independent mechanisms enable the same Claude Code permission bypass: `post_install.py` writes `permissions.defaultMode = "bypassPermissions"` to `~/.claude/settings.json`, and `.zshrc` defines `alias claude-yolo='claude --dangerously-skip-permissions'`. If Claude Code renames either the setting key or the CLI flag, only one path will be updated.
- **Suggested fix:** Pick one canonical mechanism and document it. Drop the other or add a comment cross-referencing them.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`); Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Suggestion

## `7c3a91e2` — `setup_claude_settings` silently destroys customized `~/.claude/settings.json` on JSONDecodeError
- **File (at first sighting):** `.devcontainer/post_install.py:104`
- **Symbol:** `setup_claude_settings`
- **Bug class:** Logic
- **Description:** `with contextlib.suppress(json.JSONDecodeError): settings = json.loads(settings_file.read_text())` swallows the parse error; `settings` falls back to `{}` and the file is then rewritten with only `permissions.defaultMode = "bypassPermissions"`. Any user-authored hooks/allow-list/env/model preferences are silently destroyed on every devcontainer rebuild. Symmetric to the deferred C1 patch for `~/.claude.json` but for `~/.claude/settings.json`.
- **Suggested fix:** On JSONDecodeError, `shutil.move` the corrupt file to `settings.json.bak`, log a stderr warning, then proceed with `{}`. Covered by `paad/code-reviews/deferred/I1-I2-I4-I6-S4-post_install-hardening.patch`.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling, Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Severity:** Important

## `8d4f2bc1` — `setup_global_gitignore` overwrites `~/.gitignore_global` and `~/.gitconfig.local` unconditionally
- **File (at first sighting):** `.devcontainer/post_install.py:255`
- **Symbol:** `setup_global_gitignore`
- **Bug class:** Logic
- **Description:** Both `gitignore.write_text(...)` (line 255) and `local_gitconfig.write_text(...)` (line 289) run unconditionally on every `postCreateCommand` invocation. Sibling `setup_tmux_config` uses an `if file.exists(): return` guard. User customizations to `~/.gitignore_global` (added language patterns, project ignores) or `~/.gitconfig.local` (custom `[delta]`, `[merge]` overrides, signing config) are destroyed on every container rebuild.
- **Suggested fix:** Mirror `setup_tmux_config`'s `if file.exists(): print("…skipping"); return` guard, or use a sentinel marker (`# managed by post_install.py`) and only rewrite when the marker is present. Covered by `paad/code-reviews/deferred/I1-I2-I4-I6-S4-post_install-hardening.patch`.
- **Confidence:** High
- **Found by:** Logic & Correctness, Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Severity:** Important

## `1a8e6c5f` — Host gitconfig directives execute under bypassPermissions inside the container
- **File (at first sighting):** `.devcontainer/post_install.py:264`
- **Symbol:** `setup_global_gitignore` (the `[include] path = {host_gitconfig}` block)
- **Bug class:** Security
- **Description:** Host `~/.gitconfig` is bind-mounted readonly into the container, and `setup_global_gitignore` writes `~/.gitconfig.local` containing `[include] path = {host_gitconfig}`. Git resolves directives in the included file when running git commands inside the container, including `core.pager`, `core.fsmonitor`, `core.editor`, `[alias] xyz = !shell-cmd`, `[diff "lfs"] command = …`. Anything in the developer's host gitconfig executes inside the container, where Claude runs with bypassPermissions. Distinct from backlog `5034239f` (`.git/hooks` mount).
- **Suggested fix:** Either (a) parse the host gitconfig at `setup_global_gitignore` time and refuse to `[include]` it if `core.pager`, `core.editor`, `core.fsmonitor`, or any `!`-prefixed alias is present (warn with the offending key), or (b) drop the `[include]` and manually copy only the non-executable subsections (`user.*`, `commit.*`, `pull.*`, etc.). Covered by `paad/code-reviews/deferred/I1-I2-I4-I6-S4-post_install-hardening.patch`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Severity:** Important

## `2b9f7d63` — Third-party plugin marketplaces unpinned in Dockerfile
- **File (at first sighting):** `.devcontainer/Dockerfile:80`
- **Symbol:** `RUN claude plugin marketplace add trailofbits/skills…`
- **Bug class:** Security
- **Description:** `claude plugin marketplace add trailofbits/skills` and `claude plugin marketplace add trailofbits/skills-curated` are added unconditionally with no commit-SHA / tag pin. These are not Anthropic-controlled. Plugins from these marketplaces run with `bypassPermissions` (post_install:113) inside a container that has NET_ADMIN/NET_RAW (devcontainer.json:15-18) and a R/W workspace bind mount. Distinct mechanism from the curl-bash issue tracked in backlog `1807f5f4`: that one is install-script integrity, this one is marketplace content integrity.
- **Suggested fix:** Pin to specific commit SHAs / audited tags via the plugin marketplace CLI's pinning mechanism. Drop whichever of the two marketplaces is unused; document the residual one. Add a Renovate or equivalent track-and-bump rule. Covered by `paad/code-reviews/deferred/I3-dockerfile-marketplaces.patch`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Contract & Integration, Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Important

## `4d5b9e81` — Editor unmount-cleanup PATCH ignores `setEditable(false)` lock
- **File (at first sighting):** `packages/client/src/components/Editor.tsx:218`
- **Symbol:** `Editor` unmount cleanup (the `if (dirtyRef.current && editorInstanceRef.current) { onSaveRef.current(...).catch(...) }` block)
- **Bug class:** Logic
- **Description:** The unmount cleanup at lines 214-228 fires `onSaveRef.current(...)` if `dirtyRef.current && editorInstanceRef.current` regardless of `editor.isEditable`. The companion paths `debouncedSave` (line 182), `onBlur` (line 254), and `flushSave` (line 357 — added in commit `e9bea67`) all check `isEditable`. Pre-existing — the e9bea67 fix did not address the unmount path. Today's lock-banner gate blocks chapter switch / view switch from triggering an unmount of a locked editor, so this is theoretical, but the per-Editor invariant the e9bea67 commit message claims is incomplete.
- **Suggested fix:** Add `if (editorInstanceRef.current.isEditable === false) return;` in the unmount cleanup before the `onSaveRef.current(...)` call, mirroring the other three paths. Note: this is contingent on resolving the C1 finding from review `f346047` first — if the C1 guard is reverted (which it should be, per the silent-data-loss regression), this issue's symmetry argument changes.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-27 on branch `ovid/cluster-a-error-mapping` at `91476d8`
- **Severity:** Important

## `9e5a73d4` — `fix_directory_ownership` exception list still too narrow; subprocess stderr swallowed
- **File (at first sighting):** `.devcontainer/post_install.py:193`
- **Symbol:** `fix_directory_ownership`
- **Bug class:** Error Handling
- **Description:** `except (PermissionError, subprocess.CalledProcessError)` does not catch bare `OSError` (`FileNotFoundError` from a stale symlink, `NotADirectoryError`/ENOTDIR mid-mount race). An uncaught exception propagates and skips the remaining `setup_global_gitignore()`, leaving the dev environment half-configured. Captured `subprocess.run(... capture_output=True)` `stderr` is also never surfaced — only the exception's `repr` is printed.
- **Suggested fix:** Broaden to `except (OSError, subprocess.CalledProcessError) as e`, and on `CalledProcessError` also print `e.stderr.decode("utf-8", errors="replace")` so the chown failure is debuggable. Covered by `paad/code-reviews/deferred/I1-I2-I4-I6-S4-post_install-hardening.patch`.
- **Confidence:** Medium-High
- **Found by:** Logic & Correctness, Error Handling (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Severity:** Suggestion

## `3c4e8f72` — `chapter.create` scope lacks 5xx mapping; sibling-asymmetric to `chapter.save` 502/503/504
- **File (at first sighting):** `packages/client/src/errors/scopes.ts:157`
- **Symbol:** `chapter.create` scope
- **Bug class:** Error Handling
- **Description:** S7 of the prior review extended `chapter.save.byStatus` to map 500/502/503/504 → `saveFailedServer`. The same gap exists for `chapter.create`: it only maps 404 (project-gone) and the `committed`/network paths. A bare 500 (DB writer-lock saturation, transient sqlite I/O error) or a reverse-proxy 502/503/504 falls through to the `createChapterFailed` fallback. Same UX problem S7 was opened to solve, in a sibling scope.
- **Suggested fix:** Either add `byStatus: { 500/502/503/504: <new server-trouble copy> }` to `chapter.create`, or document the deliberate asymmetry inline. The new copy could reuse `STRINGS.editor.saveFailedServer`'s phrasing.
- **Confidence:** Medium
- **Found by:** Error Handling (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Severity:** Suggestion

## `5e6c7a92` — `ChapterTitle.test.tsx` retry-exhaustion test mocks raw `TypeError` instead of `ApiRequestError`
- **File (at first sighting):** `packages/client/src/__tests__/ChapterTitle.test.tsx:432`
- **Symbol:** retry-exhaustion test
- **Bug class:** Contract
- **Description:** `vi.mocked(api.chapters.update).mockRejectedValue(new TypeError("Failed to fetch"));`. Production's `apiFetch` wraps `TypeError("Failed to fetch")` into `new ApiRequestError("[dev] Failed to fetch", 0, "NETWORK")` before it reaches `useProjectEditor`. The test bypasses the entire NETWORK scope mapping; it passes because `scope.fallback` happens to equal `STRINGS.editor.saveFailed`. Real NETWORK retry exhaustion would surface `saveFailedNetwork` ("Unable to save — check your connection.") not `saveFailed` ("Save failed. Try again."). The test would still pass even if the scope's network mapping were broken.
- **Suggested fix:** Change the mock to `new ApiRequestError("[dev] Failed to fetch", 0, "NETWORK")` and update the assertion to `STRINGS.editor.saveFailedNetwork`. This actually exercises the scope.network mapping.
- **Confidence:** Medium-High
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Severity:** Suggestion

## `afcaee1c` — Steering files don't mention SMUDGE_PORT/SMUDGE_CLIENT_PORT
- **File (at first sighting):** `CLAUDE.md`
- **Symbol:** "Tech Stack" / "Build & Run Commands" / project README sections
- **Bug class:** Contract
- **Description:** The branch `ovid/shared-port-validation` introduced a real env-var contract (`SMUDGE_PORT`, `SMUDGE_CLIENT_PORT`) for both server and client dev workflow, but no steering file mentions them. CLAUDE.md still describes "Express serves API + static frontend on port 3456" without qualification. CONTRIBUTING.md, README.md, and `.github/copilot-instructions.md` are similarly silent. Future maintainers reading CLAUDE.md as the contract will not realize these env vars exist or how they're validated.
- **Suggested fix:** Add a one-paragraph "Configuration" section to CLAUDE.md (and mirror in CONTRIBUTING.md) listing the supported env vars: `SMUDGE_PORT`, `SMUDGE_CLIENT_PORT`, `DB_PATH`, `LOG_LEVEL`, `NODE_ENV`. Reference `@smudge/shared/parsePort` for validation rules.
- **Confidence:** High
- **Found by:** Contract & Integration (`claude-opus-4-7`)
- **First seen:** 2026-04-26 on branch `ovid/shared-port-validation` at `e6b6447`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Suggestion

## `ca84e075` — CLAUDE.md / README / copilot-instructions reference docker-compose that doesn't exist
- **File (at first sighting):** `CLAUDE.md:22, 66`
- **Symbol:** "Tech Stack" / "Build & Run Commands" docker references
- **Bug class:** Contract
- **Description:** CLAUDE.md, README, and `.github/copilot-instructions.md` all describe `docker compose up` running the app on port 3456, but `find -maxdepth 2 \( -name "docker-compose*" -o -name "Dockerfile*" \) -not -path "*/node_modules/*"` returns nothing in the repo. The mvp.md plan references a future `${SMUDGE_PORT:-3456}:3456` mapping but the file does not exist. The newly-added JSDoc on `packages/shared/src/constants.ts:11` continues this pattern, claiming the constant is "Documented in CLAUDE.md and docker-compose."
- **Suggested fix:** Either add a minimal `docker-compose.yml` that uses `${SMUDGE_PORT:-3456}` and a matching Dockerfile (the architecture spec calls for it), or strip the docker references from CLAUDE.md / README / copilot-instructions / constants.ts JSDoc until those files exist. Document drift, pre-existing on main.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Contract & Integration (`claude-opus-4-7`)
- **First seen:** 2026-04-26 on branch `ovid/shared-port-validation` at `e6b6447`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Suggestion

## `a4f29c1d` — Workspace `package.json` files lack `engines.node`
- **File (at first sighting):** `packages/server/package.json`
- **Symbol:** `engines` field (absent)
- **Bug class:** Contract
- **Description:** Root `package.json` declares `"engines": { "node": "22.x" }`, but `packages/shared/package.json`, `packages/server/package.json`, and `packages/client/package.json` have no `engines` field. With npm workspaces this is normally fine because the root constraint applies to monorepo-wide installs, but a future `npm install -w packages/server` invoked with `engine-strict=true` would not enforce 22.x at the per-workspace boundary. Pre-existing on main; not worsened by this branch.
- **Suggested fix:** Either propagate `"engines": { "node": "22.x" }` into each workspace's `package.json` (so the constraint is local), or document inline that the root engines field is authoritative for the monorepo.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `b7e3d042` — `make all` reaches `ensure-native` only after lint/format-check/typecheck
- **File (at first sighting):** `Makefile:8`
- **Symbol:** `all` target prereq order
- **Bug class:** Contract
- **Description:** `all: lint format-check typecheck cover e2e`. Make resolves prereqs left-to-right by default, so a contributor with broken native bindings burns ~30s on lint/format-check/typecheck before `cover` invokes `ensure-native` and surfaces the rebuild prompt. The `all` target's order pre-dates this branch; the `ensure-native` prereq added by this branch only reaches it via `cover`/`e2e`. Cosmetic-touch demoted to OOS — line 8 was not modified.
- **Suggested fix:** Add `ensure-native` as the first explicit prereq of `all`, or as a prereq of `lint`/`format-check`/`typecheck`. Trade-off: ~50ms happy-path cost on every lint/format/typecheck run, paid more often than the cross-platform-churn rebuild it guards.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `c9e54a31` — Em-dashes / arrows in Makefile error messages mojibake under non-UTF-8 locales
- **File (at first sighting):** `Makefile:65`
- **Symbol:** `ensure-native` diagnostic strings
- **Bug class:** Error Handling
- **Description:** The recipe uses UTF-8 glyphs (`→`, `—`) in error messages at lines 65, 73, 88, etc. On terminals with `LANG=C`/`LC_ALL=C`/minimal locales these render as mojibake. Most modern terminals are UTF-8 by default (macOS Terminal, iTerm2, GNOME Terminal, Windows Terminal, GitHub Actions runners, devcontainer terminals), so this is cosmetic in practice. Consistent with existing pattern in `cover` recipe (`════` boxes). Pre-existing repo-wide convention.
- **Suggested fix:** Replace `→` with `>>` and `—` with `--` for ASCII-safety, or document UTF-8 as a contributor-environment requirement. Repo-wide consistency matters more than locale resilience here.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `d8a1f562` — `npm rebuild` could surface `EBADENGINE` warnings to recipe stderr
- **File (at first sighting):** `Makefile:75`
- **Symbol:** `ensure-native` rebuild branch
- **Bug class:** Error Handling
- **Description:** Hypothetical: if a transitive dep declares an `engines.node` that current Node 22 doesn't satisfy, `npm rebuild` emits `npm warn EBADENGINE` to stderr. Per CLAUDE.md "Zero warnings in test output", this could be confused with a violation. However: (a) the zero-warnings rule applies to test runner output, not Make recipe output; (b) line 75 deliberately preserves stderr so warnings ARE meant to surface; (c) no current dep in `package-lock.json` has an unmet engines requirement. Current behavior is correct as-is.
- **Suggested fix:** None — surfacing warnings is the desired UX. If confusion recurs, document the rule's scope clarification ("zero warnings in test runner output, not Make recipe stderr") in CLAUDE.md.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `e7c64d29` — Round-trip dlopen probe cannot distinguish a partial `.node` from a Ctrl-C'd rebuild
- **File (at first sighting):** `Makefile:70`
- **Symbol:** `ensure-native` dlopen probes
- **Bug class:** Concurrency
- **Description:** Concurrency specialist's claim: a `Ctrl-C` mid-rebuild could leave a `.node` whose ELF header is valid but `.text` truncated, passing the `:memory:` probe and crashing on first real query. In practice, the dynamic linker maps file segments by offset — a truncated `.text` would either fail at `dlopen` (mmap returns ENXIO when offset+length exceeds file size) or surface as `SIGBUS` on first symbol resolution. The `new(...)(:memory:)` constructor exercises symbol resolution immediately. The probe is more robust than the finding suggests; pre-existing concern, low ROI to harden.
- **Suggested fix:** None — probe is sufficient for the threat model. If extra paranoia desired, switch the recipe to write to a temp path and atomically `mv -f` after a successful build to close the partial-write window. Most users will simply re-run `make test` after a Ctrl-C.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `f3b8201a` — Direct `npm test` / `npm test -w` / `npx playwright test` bypass `ensure-native`
- **File (at first sighting):** `package.json:14-15`
- **Symbol:** root `scripts.test` and per-workspace `npm test -w` paths
- **Bug class:** Contract
- **Description:** Root `package.json` script `test` runs `npm test -w packages/{shared,server,client}` directly, and CONTRIBUTING.md (`:90-95`) actively recommends `npm test -w packages/server` and `npx playwright test` as per-package workflows. Neither path triggers `ensure-native`. A contributor doing per-package work after a host↔devcontainer crossing has no native-binding guard. Pre-existing — these scripts were not modified by this branch (the branch only added `ensure-native` to `make`-driven targets).
- **Suggested fix:** Add a `pretest` script in each workspace `package.json` (e.g. `"pretest": "node ../../scripts/ensure-native.mjs"` after extracting the recipe body), or strengthen the guidance in CONTRIBUTING.md to note "If you bypass `make`, run `make ensure-native` first when switching between host and devcontainer." Cleanest is to extract the probe into a node script with a single home.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `05f9c8a4` — Compile-from-source still trusts the publisher's source tarball
- **File (at first sighting):** `Makefile:75`
- **Symbol:** `ensure-native` rebuild path (and the I5 rationale framing)
- **Bug class:** Security
- **Description:** General supply-chain residual: a compromised better-sqlite3 publisher can include malicious C++ in the next tarball; `package-lock.json` integrity hashes faithfully match the post-compromise source, so `npm rebuild --build-from-source` would compile and run that C++ at the next cross-platform churn. The branch's I5 framing ("eliminates ... attacker-controlled native binary running with developer's privileges") accurately describes the binary-trust improvement but understates the source-trust residual. The trust model is strictly better than `prebuild-install` (publisher compromise must include malicious source visible to code review, not just a `.node` on a CDN), but it is not zero-trust.
- **Suggested fix:** Document the residual precisely in CLAUDE.md (or a SECURITY.md). Optionally pin better-sqlite3 to an exact version (e.g., `=12.9.0` instead of `^12.x.x`) in `packages/server/package.json` to remove auto-pickup of compromised patches; pair with `npm audit signatures` (sigstore) to catch publisher key changes.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `1f9d4b27` — `latestContentRef` clobbered by unmount-cleanup save targeting old chapter
- **File (at first sighting):** `packages/client/src/hooks/useProjectEditor.ts:273`
- **Symbol:** `handleSave` (the `latestContentRef.current = { id: savingChapterId, content }` assignment)
- **Bug class:** Concurrency
- **Description:** `handleSave` unconditionally writes `latestContentRef.current = { id: savingChapterId, content }`. When the OLD Editor's unmount cleanup (Editor.tsx:218) fires `onSave(getJSON, mountChapterId)` after a chapter switch, `savingChapterId` is the old chapter id but the user is already typing on the new one, whose draft just landed in `latestContentRef`. The cleanup-save overwrites the new chapter's `latestContentRef` entry with the old chapter's id+content. A subsequent backoff-retry for the new chapter reads `latestContentRef`, sees the id mismatch, and falls back to the closure `content` rather than picking up keystrokes typed during the backoff window. Pre-existing race; surfaced during the Cluster A review while reading the new lastErr capture path.
- **Suggested fix:** Gate the `latestContentRef.current = ...` assignment on `activeChapterRef.current?.id === savingChapterId`, OR have the unmount-cleanup save bypass `handleSave` entirely (call `api.chapters.update` directly with no shared-state side effects).
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/cluster-a-error-mapping` at `4b43b07`
- **Last seen:** 2026-04-27 on branch `ovid/cluster-a-error-mapping` at `4b43b07`
- **Severity:** Important

## `8e3c1a47` — `cancelPendingSaves` clears `saveErrorMessage` but leaves `editorLockedMessage` banner stale
- **File (at first sighting):** `packages/client/src/hooks/useProjectEditor.ts:1243`
- **Symbol:** `cancelPendingSaves`
- **Bug class:** Logic
- **Description:** `cancelPendingSaves` sets `setSaveStatus("idle")` and `setSaveErrorMessage(null)` but does not clear the `editorLockedMessage` banner. If the user is in a `setEditable(false)` locked state and a flow calls `cancelPendingSaves` (e.g. snapshot restore initiation, future cleanup callers), the footer status clears but the alert lock banner remains, leaving a contradictory UI: footer says "idle" while alert still says "no longer available." Edge case — requires a cancel call after a terminal-code lock.
- **Suggested fix:** Factor the lock-banner clear into `cancelPendingSaves`, OR document that lock state is independent of save state and add an `editorLockedMessage` clear-on-success path in the lock-firing scopes.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/cluster-a-error-mapping` at `4b43b07`
- **Last seen:** 2026-04-27 on branch `ovid/cluster-a-error-mapping` at `4b43b07`
- **Severity:** Suggestion

## `7d3a91ef` — git-delta `.deb` and fzf tarball fetched without checksum verification
- **File (at first sighting):** `.devcontainer/Dockerfile:39, 55`
- **Symbol:** `RUN curl … git-delta_${VERSION}.deb` + `dpkg -i`; `RUN curl … fzf-${VERSION}.tar.gz | tar -xz -C /usr/local/bin`
- **Bug class:** Security
- **Description:** Two GitHub-release fetches that are not enumerated in backlog `1807f5f4` (which calls out only the three *curl-bash* sites at Dockerfile lines 94/108/117). These are different mechanisms: line 39 pipes a `.deb` into `dpkg -i`, which executes maintainer scripts as root during install; line 55 unpacks a tarball into `/usr/local/bin`, where the binary runs every Ctrl-T/Ctrl-R from the shell. A compromise of the upstream GitHub releases (or a MitM on the CDN at build time) lands attacker-controlled native code with elevated trust — the .deb postinst is a particularly broad foothold. Versions are pinned via `ARG`, so the matching SHA-256 can be baked alongside the version literal.
- **Suggested fix:** For each fetch, add `sha256sum -c -` against a hash literal in the Dockerfile, kept in lockstep with the version `ARG` (renovate can update both atomically). For git-delta, also verify the .deb's GPG signature if the project ships one. Alternatively, fold this enumeration into `1807f5f4` if a single backlog entry per supply-chain class is preferred.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Important
