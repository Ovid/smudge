.PHONY: all test cover lint format dev build clean loc help

all: lint format test ## Lint, format, and test

test: ## Run full test suite
	npx vitest run

cover: ## Generate code coverage report (one-shot)
	npx vitest run --coverage

lint: ## Lint with autofix
	npm run lint

format: ## Format code
	npm run format

dev: ## Start dev servers (server + client)
	npm run dev

build: ## Build client for production
	npm run build -w packages/client

loc: ## Count lines of code in our own files
	cloc packages/shared/src packages/server/src packages/client/src e2e --exclude-dir=node_modules,dist,coverage

clean: ## Remove SQLite database files (full reset)
	rm -f packages/server/data/smudge.db packages/server/data/smudge.db-shm packages/server/data/smudge.db-wal

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'
