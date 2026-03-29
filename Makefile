.PHONY: all test cover lint format dev build clean help

all: lint format test ## Lint, format, and test

test: ## Run full test suite
	npm test

cover: ## Generate code coverage report (one-shot)
	npm exec -w packages/shared -- vitest run --coverage && npm exec -w packages/server -- vitest run --coverage && npm exec -w packages/client -- vitest run --coverage --passWithNoTests

lint: ## Lint with autofix
	npm run lint

format: ## Format code
	npm run format

dev: ## Start dev servers (server + client)
	npm run dev

build: ## Build client for production
	npm run build -w packages/client

clean: ## Remove SQLite database files (full reset)
	rm -f packages/server/data/smudge.db packages/server/data/smudge.db-shm packages/server/data/smudge.db-wal

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'
