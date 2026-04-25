# Suppress DEP0040 (built-in `punycode`) warnings from `tr46` and `uri-js`.
# See CONTRIBUTING.md for the rationale; remove when those deps ship
# userland-punycode fixes.
export NODE_OPTIONS := --disable-warning=DEP0040 ${NODE_OPTIONS}

.PHONY: all test cover e2e lint format format-check typecheck dev build clean loc help

all: lint format-check typecheck cover e2e ## Full CI pass: lint, format-check, typecheck, test+coverage, e2e

test: ## Run full test suite (fast, no coverage)
	npx vitest run

cover: ## Run tests with coverage enforcement
	@npx vitest run --coverage || { \
		echo ""; \
		echo "════════════════════════════════════════════════════════════════"; \
		echo "FAILED: Coverage thresholds not met (statements≥95% branches≥85%"; \
		echo "functions≥90% lines≥95%). See 'ERROR: Coverage for...' above."; \
		echo "════════════════════════════════════════════════════════════════"; \
		exit 1; \
	}

e2e: ## Run Playwright e2e tests (starts dev servers automatically)
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

dev: ## Start dev servers (server + client)
	npm run dev

build: ## Build client for production
	npm run build -w packages/client

loc: ## Count lines of code in our own files
	cloc packages/shared/src packages/server/src packages/client/src e2e --exclude-dir=node_modules,dist,coverage

clean: ## Remove SQLite database files (full reset)
	rm -f packages/server/data/smudge.db packages/server/data/smudge.db-shm packages/server/data/smudge.db-wal

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'
