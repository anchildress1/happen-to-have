## Happen to Have? — repository tooling
##
## pnpm only. Never npm or yarn (constitution, Application Stack).
## Run `make help` (default) for the target list.

.DEFAULT_GOAL := help

# Targets that talk to the database load .env first. `neon checkout` writes DATABASE_URL
# there, and nothing else exports it — without this, `make migrate` and `make seed` fail
# with "DATABASE_URL is not set" even though the value is sitting in the file.
# Missing .env is not an error: production injects the variables directly.
LOAD_ENV := set -a; [ -f .env ] && . ./.env; set +a;

.PHONY: help install dev format format-check format-files lint typecheck test build e2e perf \
	secret-scan clean db-up migrate seed db-sweep db-shell lhci fixtures ai-checks

## ---- Required tooling gates (constitution: Required Tooling) ----

install: ## Install dependencies with a frozen lockfile
	pnpm install --frozen-lockfile

dev: ## Run the Next.js dev server
	$(LOAD_ENV) pnpm run dev

format: ## Format the repository in place
	pnpm run format

format-check: ## Verify formatting without writing (CI-safe)
	pnpm run format:check

## Scoped formatter for lefthook's pre-commit hook. Never combine `stage_fixed: true`
## with the whole-repo `format` target above — lefthook would re-stage every file the
## formatter touched, including unrelated working-tree drift. FILES is the staged list.
format-files:
	@if [ -n "$(FILES)" ]; then pnpm exec biome format --write --no-errors-on-unmatched -- $(FILES); fi

lint: ## Lint the repository
	pnpm run lint

typecheck: ## Type-check with tsc, no emit
	pnpm run typecheck

test: ## Run unit and integration tests
	pnpm run test
	pnpm run test:integration

build: ## Production Next.js build
	pnpm run build

## Deliberately NOT in ai-checks. This calls the live provider and bills real money, so a
## suite that runs it per commit stops being run at all. The suites that gate the build fake
## the provider at the SDK boundary (research D12) and stay free and deterministic.
##
## Generates any missing recording first: tests/fixtures/audio is gitignored, because
## .gitignore refuses original recordings and that guard is worth more than committing
## 8 MB of binaries derivable from tests/fixtures/cases.ts.
fixtures: ## Run the guardrail fixture set against the live provider (costs money)
	$(LOAD_ENV) \
	if [ -z "$$GEMINI_API_KEY" ]; then \
		echo "GEMINI_API_KEY is not set. See .env.example."; exit 1; \
	fi; \
	node scripts/spike/tts.js && node scripts/spike/lite3.js

## Never the branch in .env (FR-005b). Every browser context is a new participant by design
## (FR-001), so a suite run against a shared branch adds hundreds of rows to a database
## someone develops and demos against — 434 of them before this target existed. The trap
## fires on failure and Ctrl-C too, so an aborted run cannot leak the branch.
e2e: ## Run the Playwright end-to-end suite against a disposable Neon branch
	@set -e; \
	BRANCH="e2e-$$(date +%s)-$$$$"; \
	trap 'neon branches delete "$$BRANCH" >/dev/null 2>&1 || true' EXIT INT TERM; \
	echo "Creating throwaway Neon branch $$BRANCH..."; \
	neon branches create --name "$$BRANCH" --parent main --no-secrets >/dev/null; \
	set -a; [ -f .env ] && . ./.env; set +a; \
	DATABASE_URL="$$(neon connection-string "$$BRANCH")"; export DATABASE_URL; \
	DATABASE_URL_UNPOOLED="$$DATABASE_URL"; export DATABASE_URL_UNPOOLED; \
	pnpm run migrate >/dev/null; \
	node --conditions=react-server seed/seed.ts >/dev/null; \
	pnpm run e2e

## Builds first: `next start` serves whatever `.next` holds, so without it Lighthouse
## happily scores the previous build and a regression passes.
lhci: ## Run Lighthouse against a production build of the landing screen
	@SESSION_SECRET="$${SESSION_SECRET:-lighthouse-local-placeholder-never-served}" pnpm run lhci

perf: ## Report production bundle sizes (First Load JS per route)
	pnpm build

secret-scan: ## Scan the working tree for committed secrets
	@if command -v gitleaks > /dev/null; then \
		gitleaks detect --source . --no-banner; \
	else \
		echo "gitleaks not found. Install: https://github.com/gitleaks/gitleaks#installing" >&2; \
		exit 1; \
	fi

clean: ## Remove build artifacts and local caches
	rm -rf node_modules .next dist build coverage .turbo .cache \
		test-results playwright-report blob-report

## ---- Project targets (Firebase SQL Connect / Data Connect) ----

db-up: ## Point at this git branch's Neon database (creates it if missing)
	@# --no-secrets matters: without it the CLI prints a live connection URI, password
	@# and all, straight to stdout — into terminal scrollback, CI logs, and anywhere
	@# else this output is captured. The credential lands in .env via `neon checkout`.
	@neon branches create --name dev-$$(git branch --show-current) --parent main --no-secrets >/dev/null 2>&1 || true
	@neon checkout dev-$$(git branch --show-current) >/dev/null
	@echo "Neon branch: dev-$$(git branch --show-current) (DATABASE_URL written to .env)"


## Runs over DATABASE_URL_UNPOOLED (see package.json), which `neon checkout` writes
## alongside DATABASE_URL. The pooled endpoint is PgBouncer in transaction mode and
## cannot hold the advisory lock node-pg-migrate takes; the server keeps the pooled one.
migrate: ## Apply pending migrations to the checked-out Neon branch
	$(LOAD_ENV) pnpm run migrate


seed: ## Upsert seed/questions.json into the database (idempotent)
	$(LOAD_ENV) node --conditions=react-server seed/seed.ts

## FR-005a. DAYS=0 sweeps every eligible row, which is how the pre-isolation test debris
## was cleared; the default matches the 30-day session cookie, past which no browser can
## still present the id.
db-sweep: ## Delete contribution-less participants inactive for DAYS (default 30)
	$(LOAD_ENV) node --conditions=react-server scripts/sweep-participants.ts $(DAYS)

db-shell: ## psql against the checked-out Neon branch
	neon connect


## ---- Composite gate ----
##
## Order matches the constitution's Verification section. Each target is a
## separate prerequisite so plain `make ai-checks` (no -j) stops at the first
## failure instead of masking it behind a chained shell command.
ai-checks: format-check lint typecheck test secret-scan ## Run every required check; stop on first failure

## ---- Self-documenting help ----

help: ## List available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
