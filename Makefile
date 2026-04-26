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
# I5 (review 2026-04-26): pre-fix, this target invoked
# `prebuild-install` to fetch a precompiled .node binary from the URL
# in better-sqlite3's `binary` field. That fetch had no SHA-256
# verification — a network-trust event on every cross-platform churn
# (a compromised release could land an attacker-controlled native
# binary running with the developer's privileges). Switch to
# `npm rebuild --build-from-source` so compilation replaces network
# trust: the only inputs are the package source already in
# node_modules (covered by package-lock.json integrity) and the local
# C++ toolchain. Trade-off: ~60s per cross-platform churn vs. <1s for
# a prebuilt fetch. Cross-platform churn is rare (host ↔ devcontainer
# crossings, fresh-machine setup) so the cost is paid infrequently.
# Override NPM_CONFIG_IGNORE_SCRIPTS because the devcontainer sets it
# to true to harden `npm install`; rebuild is an explicit, opt-in
# compile that must run lifecycle scripts.
#
# S10 (review 2026-04-26): pin to engines.node major BEFORE the dlopen
# probe so a developer with a foreign Node active never reaches the
# rebuild path. Pre-fix, prebuild-install accepted whatever Node was
# active and would have fetched a wrong-major ABI binary (Node 20/24
# active when Smudge requires 22.x); tests would then run on the wrong
# runtime entirely. Compare majors only — patch-level drift inside
# 22.x is fine and we don't want to thrash on every Node 22 LTS bump.
#
# S6 (review 2026-04-26): re-probe after `npm rebuild` succeeds. A
# successful compile that nonetheless produces a binary that won't
# load (wrong-ABI compile, NODE_MODULE_VERSION mismatch with the
# active runtime, partial extraction) would otherwise propagate as
# the same opaque dlopen error in vitest with no signal pointing back
# to the rebuild step.
ensure-native: ## Ensure better-sqlite3 native binding matches current platform (rebuilds from source on dlopen failure; no remote binary fetched)
	@node -e "\
const eng = require('./package.json').engines && require('./package.json').engines.node; \
if (!eng) { console.error('→ package.json has no engines.node; cannot validate Node major.'); process.exit(2); } \
const m = String(eng).match(/^[\\^~]?([0-9]+)/); \
if (!m) { console.error('→ engines.node has no parseable major: ' + eng); process.exit(2); } \
const expected = m[1]; \
const actual = process.versions.node.split('.')[0]; \
if (actual !== expected) { \
  console.error('→ Active Node v' + process.versions.node + ' major (' + actual + ') does not match engines.node (' + eng + ').'); \
  console.error('   Run: fnm use ' + expected + '  (or nvm use ' + expected + ')  before \`make test/cover/e2e/dev\`.'); \
  process.exit(1); \
}" || exit $$?
	@node -e "try { require.resolve('better-sqlite3'); } catch { console.error('→ better-sqlite3 not installed. Run npm install first.'); process.exit(2); }" || exit $$?
	@node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1 || { \
		NODE_VER=$$(node -p 'process.versions.node'); \
		PLATFORM=$$(node -p 'process.platform + "/" + process.arch'); \
		echo "→ better-sqlite3 binary won't load (dlopen failed); rebuilding from source for Node $$NODE_VER on $$PLATFORM..."; \
		echo "  (one-time cost on cross-platform churn; no remote .node binary fetched)"; \
		NPM_CONFIG_IGNORE_SCRIPTS=false npm rebuild better-sqlite3 --build-from-source >/dev/null || { \
			echo ""; \
			echo "npm rebuild --build-from-source failed. Possible causes:"; \
			echo "  - Missing C++ toolchain — install 'build-essential' (Linux) or Xcode CLT (macOS)"; \
			echo "  - Missing python3 — required by node-gyp"; \
			echo "  - Active Node version ($$NODE_VER) differs from engines.node — verify with 'node --version'"; \
			echo "  - Try 'rm -rf node_modules && npm install' to start clean"; \
			echo ""; \
			echo "  See the npm/node-gyp stderr above for the actual error."; \
			exit 1; \
		}; \
		node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null || { \
			echo ""; \
			echo "→ npm rebuild succeeded but the resulting binary still won't dlopen."; \
			echo "  This is unusual — the freshly-compiled .node may target a different ABI than the active runtime."; \
			echo "  See the dlopen error above for the specific cause."; \
			echo "  Try: rm -rf node_modules/better-sqlite3 && npm install better-sqlite3"; \
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
