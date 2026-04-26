# Suppress DEP0040 (built-in `punycode`) warnings from `tr46` and `uri-js`.
# See CONTRIBUTING.md for the rationale; remove when those deps ship
# userland-punycode fixes.
export NODE_OPTIONS := --disable-warning=DEP0040 ${NODE_OPTIONS}

.PHONY: all test cover e2e e2e-clean lint format format-check typecheck dev build clean loc help ensure-native

all: lint format-check typecheck cover e2e ## Full CI pass: lint, format-check, typecheck, test+coverage, e2e

# better-sqlite3 ships a precompiled .node binary keyed on
# {platform, arch, node-abi}. The dev workflow can leave a wrong-platform
# binary in place in two ways: (1) the devcontainer bind-mounts the host's
# node_modules into the container, so a host install (macOS) puts a
# Mach-O binary where the container (Linux) needs an ELF — and vice
# versa; (2) the container sets NPM_CONFIG_IGNORE_SCRIPTS=true, so a
# fresh `npm install` inside the container does not auto-fetch the
# correct binary via better-sqlite3's install script. The symptom is
# either "invalid ELF header" (Linux loading Mach-O) or "slice is not
# valid mach-o file" (macOS loading ELF), and every server test fails
# with the same dlopen error. Run a load test up front; if it fails,
# fetch the right prebuilt binary in place. Cheap on the happy path
# (single node startup, ~50ms); only does work on cross-platform churn.
#
# I2 (review 2026-04-26): prebuild-install fetches a remote binary at
# runtime — this target is a network-trust event. Pin --target to the
# active Node's exact version and --runtime=node so a developer with a
# foreign Node active (e.g. `nvm use 20` from another repo) cannot
# silently fetch a binary keyed on the wrong ABI. Probe with
# require.resolve first to distinguish "package missing entirely"
# (run `npm install`) from "binary present but won't load" (the actual
# cross-platform case this target solves).
ensure-native: ## Ensure better-sqlite3 native binding matches current platform (network-trust event: fetches a prebuilt .node binary)
	@node -e "try { require.resolve('better-sqlite3'); } catch { console.error('→ better-sqlite3 not installed. Run npm install first.'); process.exit(2); }" || exit $$?
	@node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1 || { \
		NODE_VER=$$(node -p 'process.versions.node'); \
		PLATFORM=$$(node -p 'process.platform + "/" + process.arch'); \
		echo "→ better-sqlite3 binary won'\''t load (dlopen failed); reinstalling for Node $$NODE_VER on $$PLATFORM..."; \
		(cd node_modules/better-sqlite3 && npx --no-install prebuild-install --force --target=$$NODE_VER --runtime=node) || { \
			echo ""; \
			echo "prebuild-install failed. Possible causes:"; \
			echo "  - Offline or proxy blocks GitHub releases (this target requires network)"; \
			echo "  - Active Node version ($$NODE_VER) differs from engines.node — verify with 'node --version'"; \
			echo "  - prebuilt binary unavailable for this {platform, arch, abi} — try 'rm -rf node_modules && npm install'"; \
			exit 1; \
		}; \
	}

test: ensure-native ## Run full test suite (fast, no coverage)
	npx vitest run

cover: ensure-native ## Run tests with coverage enforcement
	@npx vitest run --coverage || { \
		echo ""; \
		echo "════════════════════════════════════════════════════════════════"; \
		echo "FAILED: Coverage thresholds not met (statements≥95% branches≥85%"; \
		echo "functions≥90% lines≥95%). See 'ERROR: Coverage for...' above."; \
		echo "════════════════════════════════════════════════════════════════"; \
		exit 1; \
	}

e2e: ensure-native ## Run Playwright e2e tests (starts dev servers automatically)
	npx playwright test

lint: ## Lint with autofix
	npm run lint

format: ## Format code
	npm run format

format-check: ## Format code, then fail if anything changed
	npm run format
	@git diff --quiet -- 'packages/**/*.ts' 'packages/**/*.tsx' 'packages/**/*.json' 'packages/**/*.css' || { echo "Error: formatting changed files — commit before running make all"; exit 1; }

typecheck: ## Type-check all packages
	npm run typecheck

dev: ensure-native ## Start dev servers (server + client)
	npm run dev

build: ## Build client for production
	npm run build -w packages/client

loc: ## Count lines of code in our own files
	cloc packages/shared/src packages/server/src packages/client/src e2e --exclude-dir=node_modules,dist,coverage

clean: ## Remove SQLite database files (full reset)
	rm -f packages/server/data/smudge.db packages/server/data/smudge.db-shm packages/server/data/smudge.db-wal

e2e-clean: ## Wipe the isolated e2e data dir (next `make e2e` starts fresh)
	@# R1 (review 2026-04-26): derive the path via Node's os.tmpdir() so
	@# this target matches playwright.config.ts on every platform.
	@# Hardcoding /tmp was wrong on macOS, where tmpdir() resolves under
	@# /var/folders/.../T/ — `make e2e-clean` was a no-op there.
	rm -rf "$$(node -p 'require("path").join(require("os").tmpdir(), "smudge-e2e-data")')"

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'
