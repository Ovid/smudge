#!/usr/bin/env python3
"""Post-install configuration for Claude Code devcontainer.

Runs on container creation to set up:
- Onboarding bypass (when CLAUDE_CODE_OAUTH_TOKEN is set)
- Claude settings (bypassPermissions mode)
- Tmux configuration (200k history, mouse support)
- Directory ownership fixes for mounted volumes
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def setup_onboarding_bypass():
    """Bypass the interactive onboarding wizard when CLAUDE_CODE_OAUTH_TOKEN is set.

    Runs `claude -p` to seed ~/.claude.json with auth state. The subprocess
    writes the config file during startup before the API call completes, so
    a timeout is expected and acceptable. After the subprocess finishes (or
    times out), we check whether ~/.claude.json was populated and only then
    set hasCompletedOnboarding.

    Workaround for https://github.com/anthropics/claude-code/issues/8938.
    """
    token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip()
    if not token:
        print(
            "[post_install] No CLAUDE_CODE_OAUTH_TOKEN set, skipping onboarding bypass",
            file=sys.stderr,
        )
        return

    # When `CLAUDE_CONFIG_DIR` is set, as is done in `devcontainer.json`, `claude` unexpectedly 
    # looks for `.claude.json` in *that* folder, instead of in `~`, contradicting the documentation.
    #  See https://github.com/anthropics/claude-code/issues/3833#issuecomment-3694918874
    claude_json_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home()))
    claude_json = claude_json_dir / ".claude.json"

    print("[post_install] Running claude -p to populate auth state...", file=sys.stderr)
    try:
        result = subprocess.run(
            ["claude", "-p", "ok"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            # C1 (review 2026-04-26): bail out without touching
            # ~/.claude.json. Falling through here would write
            # {hasCompletedOnboarding: true} over a stale-but-valid
            # config (from a prior successful run), masking the auth
            # failure: subsequent `claude` invocations would skip
            # onboarding and fail with a confusing "not authenticated"
            # error instead of re-running the wizard.
            print(
                f"[post_install] claude -p exited {result.returncode}: "
                f"{result.stderr.strip()} — onboarding bypass skipped",
                file=sys.stderr,
            )
            return
    except subprocess.TimeoutExpired:
        print(
            "[post_install] claude -p timed out (expected on cold start)",
            file=sys.stderr,
        )
    except (FileNotFoundError, OSError) as e:
        print(
            f"[post_install] Warning: could not run claude ({e}) — "
            "onboarding bypass skipped",
            file=sys.stderr,
        )
        return

    if not claude_json.exists():
        print(
            f"[post_install] Warning: {claude_json} not created by claude -p — "
            "onboarding bypass skipped",
            file=sys.stderr,
        )
        return

    config: dict = {}
    try:
        config = json.loads(claude_json.read_text())
    except json.JSONDecodeError as e:
        # C1 (review 2026-04-26): a corrupt config may still hold partially
        # recoverable auth/MCP/session state. Move it aside before we write
        # over it so the user can inspect/recover, rather than silently
        # destroying it.
        backup = claude_json.with_suffix(claude_json.suffix + ".bak")
        try:
            shutil.move(str(claude_json), str(backup))
            print(
                f"[post_install] Warning: {claude_json} had invalid JSON "
                f"({e}); backed up to {backup} and starting fresh",
                file=sys.stderr,
            )
        except OSError as move_err:
            print(
                f"[post_install] Warning: {claude_json} had invalid JSON "
                f"({e}) and could not be backed up ({move_err}) — "
                "onboarding bypass skipped to preserve the original file",
                file=sys.stderr,
            )
            return

    config["hasCompletedOnboarding"] = True

    claude_json.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(
        f"[post_install] Onboarding bypass configured: {claude_json}", file=sys.stderr
    )


def setup_claude_settings():
    """Configure Claude Code with bypassPermissions enabled (opt-in).

    I4 (review 2026-04-26): bypassPermissions is gated on the
    SMUDGE_DEVCONTAINER_BYPASS env var. Default-off so a fresh
    "Reopen in Container" isn't silently permission-free. The
    `claude-yolo` alias in .zshrc remains for explicit per-invocation
    bypass. Set SMUDGE_DEVCONTAINER_BYPASS=1 in remoteEnv (or
    localEnv pass-through) to restore the previous always-on default.
    """
    if os.environ.get("SMUDGE_DEVCONTAINER_BYPASS") != "1":
        print(
            "[post_install] SMUDGE_DEVCONTAINER_BYPASS not set; "
            "leaving Claude permissions at default. Use the `claude-yolo` "
            "alias for opt-in bypass per invocation.",
            file=sys.stderr,
        )
        return

    claude_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))
    claude_dir.mkdir(parents=True, exist_ok=True)

    settings_file = claude_dir / "settings.json"

    # I1 (review 2026-04-26): mirror C1's discipline. The previous
    # contextlib.suppress(JSONDecodeError) silently overwrote
    # user-authored settings (custom hooks, allow-list, env, model
    # preferences) on every parse failure. Move the corrupt file to
    # .bak so the user can recover manually instead.
    settings: dict = {}
    if settings_file.exists():
        try:
            settings = json.loads(settings_file.read_text())
        except json.JSONDecodeError as e:
            backup = settings_file.with_suffix(settings_file.suffix + ".bak")
            try:
                shutil.move(str(settings_file), str(backup))
                print(
                    f"[post_install] Warning: {settings_file} had invalid "
                    f"JSON ({e}); backed up to {backup} and starting fresh",
                    file=sys.stderr,
                )
            except OSError as move_err:
                print(
                    f"[post_install] Warning: {settings_file} had invalid "
                    f"JSON ({e}) and could not be backed up ({move_err}) — "
                    "settings setup skipped to preserve the original file",
                    file=sys.stderr,
                )
                return

    # Set bypassPermissions mode
    if "permissions" not in settings:
        settings["permissions"] = {}
    settings["permissions"]["defaultMode"] = "bypassPermissions"

    settings_file.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    print(
        f"[post_install] Claude settings configured: {settings_file}", file=sys.stderr
    )


def setup_tmux_config():
    """Configure tmux with 200k history, mouse support, and vi keys."""
    tmux_conf = Path.home() / ".tmux.conf"

    if tmux_conf.exists():
        print("[post_install] Tmux config exists, skipping", file=sys.stderr)
        return

    config = """\
# 200k line scrollback history
set-option -g history-limit 200000

# Enable mouse support
set -g mouse on

# Use vi keys in copy mode
setw -g mode-keys vi

# Start windows and panes at 1, not 0
set -g base-index 1
setw -g pane-base-index 1

# Renumber windows when one is closed
set -g renumber-windows on

# Faster escape time for vim
set -sg escape-time 10

# True color support
set -g default-terminal "tmux-256color"
set -ag terminal-overrides ",xterm-256color:RGB"

# Terminal features (ghostty, cursor shape in vim)
set -as terminal-features ",xterm-ghostty:RGB"
set -as terminal-features ",xterm*:RGB"
set -ga terminal-overrides ",xterm*:colors=256"
set -ga terminal-overrides '*:Ss=\\E[%p1%d q:Se=\\E[ q'

# Status bar
set -g status-style 'bg=#333333 fg=#ffffff'
set -g status-left '[#S] '
set -g status-right '%Y-%m-%d %H:%M'
"""
    tmux_conf.write_text(config, encoding="utf-8")
    print(f"[post_install] Tmux configured: {tmux_conf}", file=sys.stderr)


def fix_directory_ownership():
    """Fix ownership of mounted volumes that may have root ownership."""
    uid = os.getuid()
    gid = os.getgid()

    dirs_to_fix = [
        Path.home() / ".claude",
        Path("/commandhistory"),
        Path.home() / ".config" / "gh",
    ]

    for dir_path in dirs_to_fix:
        if dir_path.exists():
            try:
                # Use sudo to fix ownership if needed
                stat_info = dir_path.stat()
                if stat_info.st_uid != uid:
                    subprocess.run(
                        ["sudo", "chown", "-R", f"{uid}:{gid}", str(dir_path)],
                        check=True,
                        capture_output=True,
                    )
                    print(
                        f"[post_install] Fixed ownership: {dir_path}", file=sys.stderr
                    )
            except (OSError, subprocess.CalledProcessError) as e:
                # S4 (review 2026-04-26): broaden to OSError so a stale
                # symlink (FileNotFoundError) or mid-mount NotADirectoryError
                # doesn't propagate and skip the remaining setup steps.
                # Surface the chown stderr if available so the failure is
                # debuggable.
                stderr = ""
                if isinstance(e, subprocess.CalledProcessError) and e.stderr:
                    stderr = (
                        e.stderr.decode("utf-8", errors="replace")
                        if isinstance(e.stderr, bytes)
                        else str(e.stderr)
                    )
                tail = f" — stderr: {stderr}" if stderr else ""
                print(
                    f"[post_install] Warning: Could not fix ownership of {dir_path}: {e}{tail}",
                    file=sys.stderr,
                )


def setup_global_gitignore():
    """Set up global gitignore and local git config.

    Since ~/.gitconfig is mounted read-only from host, we create a local
    config file that copies safe identity keys from the host config and
    adds container-specific settings like core.excludesfile and delta
    configuration.

    GIT_CONFIG_GLOBAL env var (set in devcontainer.json) points git to this
    local config as the "global" config.

    I2 (review 2026-04-26): mirror setup_tmux_config — don't clobber
    user customizations on every container rebuild. The two output
    files (.gitignore_global and .gitconfig.local) are guarded
    independently because one may exist while the other does not
    (e.g. user customized .gitconfig.local but never touched
    .gitignore_global).

    I6 (review 2026-04-26): the previous version included the host
    gitconfig via `[include] path = {host_gitconfig}`. Git resolves
    directives in the included file (core.pager, core.fsmonitor,
    core.editor, !-prefixed aliases, custom diff/merge drivers) when
    running git commands inside the container — under
    bypassPermissions, that's a privilege-escalation surface from the
    host's gitconfig into a capabilities-elevated container. Drop the
    `[include]` and copy only known-safe identity keys verbatim. Set
    SMUDGE_DEVCONTAINER_INCLUDE_HOST_GITCONFIG=1 to restore the
    previous form (with the documented security caveat).
    """
    home = Path.home()
    gitignore = home / ".gitignore_global"
    local_gitconfig = home / ".gitconfig.local"
    host_gitconfig = home / ".gitconfig"

    # Create global gitignore with common patterns
    patterns = """\
# Claude Code
.claude/

# macOS
.DS_Store
.AppleDouble
.LSOverride
._*

# Python
*.pyc
*.pyo
__pycache__/
*.egg-info/
.eggs/
*.egg
.venv/
venv/
.mypy_cache/
.ruff_cache/

# Node
node_modules/
.npm/

# Editors
*.swp
*.swo
*~
.idea/
.vscode/
*.sublime-*

# Misc
*.log
.env.local
.env.*.local
"""
    if gitignore.exists():
        print(
            f"[post_install] Global gitignore already exists at {gitignore}; "
            "skipping (delete the file to regenerate).",
            file=sys.stderr,
        )
    else:
        gitignore.write_text(patterns, encoding="utf-8")
        print(f"[post_install] Global gitignore created: {gitignore}", file=sys.stderr)

    # Build the identity section. Either include the host gitconfig
    # whole (opt-in via env), or copy only safe identity keys via
    # `git config --file ... --get`. Copying via git config (rather
    # than parsing the file ourselves) lets git handle line-
    # continuations, includes, and the [includeIf] case the same way
    # it would if we did include the file — but the values we ingest
    # are limited to user.name, user.email, user.signingkey, and
    # commit.gpgsign, none of which can shell out at runtime.
    def _git_get(key: str) -> str:
        try:
            r = subprocess.run(
                ["git", "config", "--file", str(host_gitconfig), "--get", key],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return r.stdout.strip() if r.returncode == 0 else ""
        except (OSError, subprocess.SubprocessError):
            return ""

    use_full_include = os.environ.get("SMUDGE_DEVCONTAINER_INCLUDE_HOST_GITCONFIG") == "1"
    if use_full_include:
        identity_section = f"[include]\n    path = {host_gitconfig}\n"
    else:
        identity_lines: list[str] = []
        user_name = _git_get("user.name")
        user_email = _git_get("user.email")
        signing_key = _git_get("user.signingkey")
        commit_gpgsign = _git_get("commit.gpgsign")
        if user_name or user_email or signing_key:
            identity_lines.append("[user]")
            if user_name:
                identity_lines.append(f"    name = {user_name}")
            if user_email:
                identity_lines.append(f"    email = {user_email}")
            if signing_key:
                identity_lines.append(f"    signingkey = {signing_key}")
        if commit_gpgsign:
            identity_lines.append("[commit]")
            identity_lines.append(f"    gpgsign = {commit_gpgsign}")
        identity_section = ("\n".join(identity_lines) + "\n") if identity_lines else ""

    # Create local git config: identity section (above), excludesfile,
    # delta. Delta config is here so it works even if the host hasn't
    # configured it.
    local_config = f"""\
# Container-local git config
# I6 (review 2026-04-26): copies only identity keys from the host
# gitconfig to avoid pulling in attacker-controlled directives
# (core.pager / core.editor / core.fsmonitor / !-aliases / custom
# diff drivers). Set SMUDGE_DEVCONTAINER_INCLUDE_HOST_GITCONFIG=1
# to restore the previous full-include form.

{identity_section}
[core]
    excludesfile = {gitignore}
    pager = delta

[interactive]
    diffFilter = delta --color-only

[delta]
    navigate = true
    light = false
    line-numbers = true
    side-by-side = false

[merge]
    conflictstyle = diff3

[diff]
    colorMoved = default

[gpg "ssh"]
    program = /usr/bin/ssh-keygen
"""
    if local_gitconfig.exists():
        print(
            f"[post_install] Local git config already exists at {local_gitconfig}; "
            "skipping (delete the file to regenerate).",
            file=sys.stderr,
        )
    else:
        local_gitconfig.write_text(local_config, encoding="utf-8")
        print(
            f"[post_install] Local git config created: {local_gitconfig}",
            file=sys.stderr,
        )


def main():
    """Run all post-install configuration."""
    print("[post_install] Starting post-install configuration...", file=sys.stderr)

    setup_onboarding_bypass()
    setup_claude_settings()
    setup_tmux_config()
    fix_directory_ownership()
    setup_global_gitignore()

    print("[post_install] Configuration complete!", file=sys.stderr)


if __name__ == "__main__":
    main()
