# Suppress DEP0040 (built-in `punycode`) warnings from `tr46` and `uri-js`.
# See CONTRIBUTING.md for the rationale; remove when those deps ship
# userland-punycode fixes.
export NODE_OPTIONS := --disable-warning=DEP0040 ${NODE_OPTIONS}

.PHONY: all test cover e2e lint format format-check typecheck dev build clean loc help ensure-native

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
ensure-native: ## Ensure better-sqlite3 native binding matches current platform
	@node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1 || { \
		echo "→ better-sqlite3 binary does not match current platform; reinstalling..."; \
		(cd node_modules/better-sqlite3 && npx prebuild-install --force) || { \
			echo "prebuild-install failed — try 'rm -rf node_modules && npm install'"; \
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

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'
