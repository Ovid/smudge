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
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
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
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
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
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
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
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
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
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
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
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
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
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
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
