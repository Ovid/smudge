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
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
- **Severity:** Suggestion
