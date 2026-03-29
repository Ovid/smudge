.PHONY: all test cover lint format dev build help

all: lint format test ## Lint, format, and test

test: ## Run full test suite
	npm test

cover: ## Generate code coverage report (one-shot)
	npx vitest run --workspace vitest.workspace.ts --coverage -- --run

lint: ## Lint with autofix
	npm run lint

format: ## Format code
	npm run format

dev: ## Start dev servers (server + client)
	npm run dev

build: ## Build client for production
	npm run build -w packages/client

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'
