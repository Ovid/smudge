# Suppress DEP0040 (built-in `punycode`) warnings from `tr46` and `uri-js`.
# See CONTRIBUTING.md for the rationale; remove when those deps ship
# userland-punycode fixes.
export NODE_OPTIONS := --disable-warning=DEP0040 ${NODE_OPTIONS}

.PHONY: all test cover e2e e2e-clean lint format format-check typecheck dev build clean loc help ensure-native check-no-placeholders

all: lint format-check typecheck check-no-placeholders cover e2e ## Full CI pass: lint, format-check, typecheck, placeholder check, test+coverage, e2e

# S11 (review 2026-04-27): the deferred dockerfile-checksums.patch
# ships PLACEHOLDER_REPLACE_WITH_REAL_HASH ARG defaults that the
# maintainer must fill in with real SHA-256 hashes BEFORE committing
# the applied patch. If they forget, the next image rebuild will fail
# (curl-pipe-sha256-verify aborts on hash mismatch) — but only AFTER
# the bad commit has landed and someone tries to rebuild. Catch it
# pre-commit: a one-line grep over .devcontainer/ that fires before
# `make all` declares success.
check-no-placeholders: ## Fail if PLACEHOLDER_REPLACE_WITH_REAL_HASH appears under .devcontainer/
	@if grep -rq "PLACEHOLDER_REPLACE_WITH_REAL_HASH" .devcontainer/ 2>/dev/null; then \
		echo "make check-no-placeholders: FAIL — .devcontainer/ contains PLACEHOLDER_REPLACE_WITH_REAL_HASH."; \
		echo "Replace each placeholder with the actual SHA-256 of the binary it pins"; \
		echo "(host-side, before committing) and re-run \`make all\`."; \
		grep -rn "PLACEHOLDER_REPLACE_WITH_REAL_HASH" .devcontainer/; \
		exit 1; \
	fi

# better-sqlite3 ships a precompiled .node binary keyed on
# {platform, arch, node-abi}. Any flow that ends up running tests
# under a different {platform, arch, node-abi} than the one that
# installed node_modules will hit a dlopen failure on the .node.
# Common triggers: (1) a devcontainer or VM that bind-mounts the
# host's node_modules into a different OS — host (macOS) install
# leaves a Mach-O binary where the guest (Linux) needs an ELF, and
# vice versa; (2) a container or CI image whose npm config sets
# `ignore-scripts=true` (or `NPM_CONFIG_IGNORE_SCRIPTS=true`), so a
# fresh `npm install` skips better-sqlite3's prebuild-install step
# and leaves only stale or missing artifacts behind. The symptom is
# either "invalid ELF header" (Linux loading Mach-O) or "slice is
# not valid mach-o file" (macOS loading ELF), and every server test
# fails with the same dlopen error. Run a load test up front; if it
# fails, rebuild better-sqlite3 from source in place so the native
# binding matches the active platform/runtime. Cheap on the happy
# path (single node startup, ~50ms); only does substantive work on
# cross-platform churn.
#
# Note: the repo's `.devcontainer/` is currently empty — neither
# trigger is reachable in-tree today. The recipe is forward-looking
# defense for when a devcontainer or similar is reintroduced, and
# is also useful for ad-hoc host↔VM crossings.
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
# a prebuilt fetch. Cross-platform churn is rare (host↔guest
# crossings, fresh-machine setup) so the cost is paid infrequently.
# Override NPM_CONFIG_IGNORE_SCRIPTS=false defensively in case any
# environment (a future devcontainer, a CI image, or a contributor's
# global npm config) sets `ignore-scripts=true` to harden installs.
# Rebuild is an explicit, opt-in compile that must run lifecycle
# scripts even when the global default forbids them. No-op in
# environments where `ignore-scripts` is already false.
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
const m = String(eng).match(/^[\\^~]?(\\d+)(?:\\.(?:\\d+|x))?(?:\\.(?:\\d+|x))?$$/); \
if (!m) { \
  console.error('→ engines.node = ' + eng + ' is not a single-major form ensure-native supports.'); \
  console.error('   Supported: \"22\", \"22.x\", \"22.5.0\", \"^22.5\", \"~22.5\".'); \
  console.error('   Multi-major ranges (\"22 || 24\") would silently pin to the first major; update this recipe to iterate allowed majors if broadening is intentional.'); \
  process.exit(2); \
} \
const expected = m[1]; \
const actual = process.versions.node.split('.')[0]; \
if (actual !== expected) { \
  console.error('→ Active Node v' + process.versions.node + ' major (' + actual + ') does not match engines.node (' + eng + ').'); \
  console.error('   Run: fnm use ' + expected + '  (or nvm use ' + expected + ')  before \`make test/cover/e2e/dev\`.'); \
  process.exit(1); \
}" || exit $$?
	@node -e "try { require.resolve('better-sqlite3'); } catch { console.error('→ better-sqlite3 not installed. Run npm install first.'); process.exit(2); }" || exit $$?
	@node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null || { \
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
			echo "  Active Node major matches engines.node (verified above), so the cause is likely:"; \
			echo "    - Stale node-gyp cache (try: rm -rf ~/.cache/node-gyp && rm -rf node_modules/better-sqlite3 && npm install better-sqlite3)"; \
			echo "    - Multiple .node copies left in node_modules from an interrupted install"; \
			echo "    - Missing system shared libraries the build linked against (check ldd / otool -L on the .node)"; \
			echo "    - Incomplete extraction — partial files in node_modules/better-sqlite3"; \
			echo "  See the dlopen error above for the specific cause."; \
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
	@git diff --quiet -- 'packages/**/*.ts' 'packages/**/*.tsx' 'packages/**/*.json' 'packages/**/*.css' 'e2e/**/*.ts' playwright.config.ts vitest.config.ts || { echo "Error: formatting changed files — commit before running make all"; exit 1; }

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
	@# S6 (review 2026-04-27): without `node` on PATH the command
	@# substitution at the rm line silently expands to empty string and
	@# `rm -rf ""` is a no-op, hiding the misconfiguration. Fail loudly
	@# instead so the user knows nothing was wiped.
	@command -v node >/dev/null 2>&1 || { \
		echo "make e2e-clean: \`node\` not on PATH — cannot derive the e2e data dir."; \
		echo "Install Node 22.x (via fnm/nvm) and re-run."; \
		exit 1; \
	}
	@# S5 (review 2026-04-27): refuse to wipe while \`make e2e\` is mid-run.
	@# Detect via TCP connect to the e2e server port (must equal
	@# E2E_SERVER_PORT in playwright.config.ts; an
	@# e2e-data-dir-parity.test.ts assertion enforces equality). The
	@# server only binds during a live run; after cleanup the port is
	@# closed. Node's `net` module is used rather than lsof/nc/socat so
	@# the probe works on any host. exit 0 = no listener (proceed);
	@# exit 1 = listener detected (abort); exit 2 = probe error or
	@# timeout (abort, conservative).
	@#
	@# I4 (review 2026-04-27): the probe closes the steady-state race
	@# (e2e is mid-run) but does NOT close a startup race: the server's
	@# `app.listen(PORT)` only fires after Knex migrations (1-3s after
	@# `npm run dev`). If the user runs `make e2e-clean` in a second
	@# terminal during that window, the probe sees ECONNREFUSED
	@# (correct: no listener YET), proceeds to rm, and the about-to-
	@# start server then migrates against an empty DB. Workflow:
	@# always wait for `make e2e` to finish (or kill it) before running
	@# `make e2e-clean`; do NOT run them concurrently. A portable
	@# advisory lock (flock-style) would close this hole but requires
	@# `make e2e` to participate, expanding the patch beyond cleanup.
	@#
	@# S2 (review 2026-04-27): bumped TIMEOUT_MS from 500ms to 2000ms.
	@# 500ms was tight under loopback contention; 2000ms is plenty for
	@# either ECONNREFUSED (returns immediately) or a real connect.
	@# Distinct error messages are printed before exit so the user can
	@# see which host/code triggered the abort.
	@#
	@# S13 (review 2026-04-27): probe BOTH 127.0.0.1 AND ::1. The
	@# server's `app.listen(PORT)` defaults to `::` on dual-stack
	@# Linux. On IPv6-only hosts (or hosts with `bindv6only=1`), an
	@# IPv4-only probe would see ECONNREFUSED while the server listens
	@# on ::1, mis-conclude "no listener," and `rm -rf` the live data
	@# dir. PORT is pulled into a single constant so the parity test
	@# anchors on one assignment.
	@# A "refused" verdict ALSO covers EADDRNOTAVAIL (IPv6 disabled),
	@# EAFNOSUPPORT (IPv6 not compiled in), and ENETUNREACH (no route)
	@# — all mean "no listener can be reached at this address," which
	@# is functionally identical to a TCP RST for this probe. Treating
	@# them as errors would block `make e2e-clean` on any IPv4-only
	@# host (most devcontainers).
	@node -e "\
const net=require('net'),PORT=3457,HOSTS=['127.0.0.1','::1'],T=2000; \
const NOLISTEN=new Set(['ECONNREFUSED','EADDRNOTAVAIL','EAFNOSUPPORT','ENETUNREACH']); \
const probe=(h)=>new Promise((r)=>{ \
  const s=net.createConnection({port:PORT,host:h}); \
  let done=false; \
  const finish=(st,de)=>{if(done)return;done=true;s.destroy();r({st,de,h});}; \
  s.on('connect',()=>finish('listener')); \
  s.on('error',(e)=>finish(NOLISTEN.has(e.code)?'refused':'error',e.code)); \
  s.setTimeout(T,()=>finish('timeout','>'+T+'ms')); \
}); \
Promise.all(HOSTS.map(probe)).then((rs)=>{ \
  const live=rs.find((r)=>r.st==='listener'); \
  if(live){console.error('e2e listener bound on '+live.h+':'+PORT+'; refusing to wipe.');process.exit(1);} \
  const odd=rs.find((r)=>r.st!=='refused'); \
  if(odd){console.error('e2e probe '+odd.st+' on '+odd.h+':'+PORT+' ('+odd.de+'); refusing to wipe.');process.exit(2);} \
});" || { \
		echo "make e2e-clean: refusing to wipe — see probe message above."; \
		echo "Wait for \`make e2e\` to finish (or kill it), then re-run \`make e2e-clean\`."; \
		exit 1; \
	}
	@# I6 (review 2026-04-27): namespace by UID — see playwright.config.ts
	@# for rationale. The ternary mirrors the `?? "shared"` coalesce there;
	@# `process.getuid` is undefined on Windows, where the "shared"
	@# literal restores POSIX-style stable naming for the data dir.
	@#
	@# S1 (review 2026-04-27): capture into a shell variable and assert
	@# non-empty before `rm -rf`. Pre-fix, `node -p` failing for any
	@# reason silently expanded to empty string and `rm -rf ""` was a
	@# no-op — the user thought the wipe succeeded.
	@DATA_DIR="$$(node -p 'require("path").join(require("os").tmpdir(), "smudge-e2e-data-" + (process.getuid ? process.getuid() : "shared"))')"; \
		test -n "$$DATA_DIR" || { \
			echo "make e2e-clean: failed to derive e2e data dir from node -p"; \
			exit 1; \
		}; \
		rm -rf "$$DATA_DIR"

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'
