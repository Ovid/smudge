# Suppress DEP0040 (built-in `punycode`) warnings from `tr46` and `uri-js`.
# See CONTRIBUTING.md for the rationale; remove when those deps ship
# userland-punycode fixes.
export NODE_OPTIONS := --disable-warning=DEP0040 ${NODE_OPTIONS}

.PHONY: all test cover e2e e2e-clean lint lint-check format format-check typecheck dev build clean loc help ensure-native

all: lint-check format-check typecheck cover e2e ## Full CI pass: lint-check, format-check, typecheck, test+coverage, e2e

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

lint: ## Lint with autofix (developer use)
	npm run lint

lint-check: ## Lint without autofix (CI gate — `make all` uses this)
	@# S3 (review 2026-04-27, third pass): `lint` runs `eslint --fix`,
	@# which mutates the tree. CI gates must not mutate. Route `make
	@# all` through this no-autofix variant so the tree is unchanged
	@# whether or not the CI gate passes; humans use `make lint` to
	@# auto-fix locally.
	npm run lint:check

format: ## Format code (developer use — writes)
	npm run format

format-check: ## Check formatting (CI gate — read-only)
	@# I1 (review 2026-04-27, third pass): pre-fix, this recipe ran
	@# `npm run format` (prettier --write), silently mutating the
	@# user's tree on every `make all`. The trailing `git diff
	@# --quiet` guard then printed "formatting changed files" — wrong
	@# root cause when the dirty file was just WIP. Use `format:check`
	@# (`prettier --check`, read-only) and let prettier itself be the
	@# gate. WIP detection (the original git-diff guard's only
	@# remaining value) is dropped — `make all` should not refuse to
	@# run on a dirty tree.
	npm run format:check

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
	@# Detail design notes (kept here because they document load-bearing
	@# design choices; if you "simplify" this recipe, read these first):
	@#
	@# R1 (review 2026-04-26): derive the path via Node's os.tmpdir() so
	@# this target matches playwright.config.ts on every platform.
	@# Hardcoding /tmp was wrong on macOS, where tmpdir() resolves under
	@# /var/folders/.../T/ — `make e2e-clean` was a no-op there.
	@#
	@# S6 (review 2026-04-27): without `node` on PATH the command
	@# substitution silently expands to empty string and `rm -rf ""`
	@# becomes a no-op, hiding the misconfiguration. Fail loudly.
	@#
	@# S5 (review 2026-04-27): refuse to wipe while `make e2e` is
	@# mid-run. Detect via TCP connect to the e2e server port (must
	@# equal E2E_SERVER_PORT in playwright.config.ts; an
	@# e2e-data-dir-parity.test.ts assertion enforces equality). exit 0
	@# = no listener (proceed); exit 1 = listener detected (abort);
	@# exit 2 = probe error or timeout (abort, conservative).
	@#
	@# I4 (review 2026-04-27): the probe closes the steady-state race
	@# (e2e is mid-run) but does NOT close a startup race: the server's
	@# `app.listen(PORT)` only fires after Knex migrations (1-3s after
	@# `npm run dev`). If you run `make e2e-clean` in a second terminal
	@# during that window, the probe sees ECONNREFUSED (correct: no
	@# listener YET), proceeds to rm, and the about-to-start server
	@# then migrates against an empty DB. Workflow: always wait for
	@# `make e2e` to finish (or kill it) before running `make e2e-clean`;
	@# do NOT run them concurrently. A portable advisory lock
	@# (flock-style) would close this hole but requires `make e2e` to
	@# participate, expanding the patch beyond cleanup.
	@#
	@# I5 (review 2026-04-27, third pass): probe + rm now run inside a
	@# SINGLE `/bin/sh` invocation (`\`-continuation, `;`-chained). Pre-
	@# fix, the recipe was two separate `@`-prefixed commands; Make
	@# spawns a fresh shell per recipe line, so the probe ran in shell A
	@# and the rm ran in shell B with a fork/exec gap (50–200ms on a
	@# busy host) where the user could `make e2e` in another terminal,
	@# bind the port mid-rm, and have the rm wipe the just-bound DB.
	@# Single-shell shrinks the gap to a single fork/exec of `rm`.
	@#
	@# I8 (review 2026-04-27, third pass): assert DATA_DIR is under a
	@# canonical tmp prefix before `rm -rf`. os.tmpdir() honors $TMPDIR
	@# (operator-controlled). A developer who set TMPDIR=$HOME for
	@# debugging another tool would otherwise have this recipe issue
	@# `rm -rf "$HOME/smudge-e2e-data-1000"`. Allowlist:
	@#   /tmp/                    — Linux default
	@#   /var/tmp/                — POSIX persistent tmp
	@#   /var/folders/            — macOS default os.tmpdir() target
	@#   /private/var/folders/    — macOS, when /var symlink is resolved
	@#   /private/tmp/            — macOS, when /tmp symlink is resolved
	@# A developer with a non-default TMPDIR can still wipe by hand.
	@#
	@# S1 (review 2026-04-27): capture into a shell variable and assert
	@# non-empty before `rm -rf`. Pre-fix, `node -p` failing for any
	@# reason silently expanded to empty string and `rm -rf ""` was a
	@# no-op — the user thought the wipe succeeded.
	@#
	@# S2 (review 2026-04-27): TIMEOUT_MS = 2000. 500ms was tight under
	@# loopback contention; 2000ms is plenty for either ECONNREFUSED
	@# (returns immediately) or a real connect.
	@#
	@# S8 (review 2026-04-27, third pass): `.catch()` on Promise.all so
	@# sync throws inside net.createConnection (theoretically reachable
	@# for malformed host args; today's `127.0.0.1`/`::1` are safe)
	@# don't print a Node stack trace before our curated message.
	@#
	@# S13 (review 2026-04-27): probe BOTH 127.0.0.1 AND ::1. The
	@# server's `app.listen(PORT)` defaults to `::` on dual-stack Linux.
	@# IPv4-only probes mis-conclude "no listener" on IPv6-only hosts.
	@#
	@# S1 + S13 (review 2026-04-27, third pass): a "refused" verdict
	@# also covers EADDRNOTAVAIL (IPv6 disabled), EAFNOSUPPORT (IPv6
	@# not compiled in), ENETUNREACH (no route), EHOSTUNREACH (transient
	@# IPv6 stack reset by NetworkManager), and ECONNRESET (peer-side
	@# close-without-listener). All mean "no listener reachable here,"
	@# functionally identical to TCP RST. Treating them as errors would
	@# block `make e2e-clean` on transient routing flakes.
	@#
	@# I6 (review 2026-04-27): namespace by UID — see playwright.config.ts
	@# for rationale. The ternary mirrors the `?? "shared"` coalesce
	@# there; `process.getuid` is undefined on Windows.
	@command -v node >/dev/null 2>&1 || { \
		echo "make e2e-clean: \`node\` not on PATH — cannot derive the e2e data dir."; \
		echo "Install Node 22.x (via fnm/nvm) and re-run."; \
		exit 1; \
	}
	@DATA_DIR="$$(node -p 'require("path").join(require("os").tmpdir(), "smudge-e2e-data-" + (process.getuid ? process.getuid() : "shared"))')"; \
		test -n "$$DATA_DIR" || { \
			echo "make e2e-clean: failed to derive e2e data dir from node -p"; \
			exit 1; \
		}; \
		case "$$DATA_DIR" in \
			/tmp/*|/var/tmp/*|/var/folders/*|/private/var/folders/*|/private/tmp/*) ;; \
			*) \
				echo "make e2e-clean: refusing to wipe \"$$DATA_DIR\" — TMPDIR resolves outside the safe allowlist (/tmp, /var/tmp, /var/folders, /private/var/folders, /private/tmp)."; \
				echo "If this is intentional, remove the directory by hand."; \
				exit 1 ;; \
		esac; \
		node -e "\
const net=require('net'),PORT=3457,HOSTS=['127.0.0.1','::1'],T=2000; \
const NOLISTEN=new Set(['ECONNREFUSED','EADDRNOTAVAIL','EAFNOSUPPORT','ENETUNREACH','EHOSTUNREACH','ECONNRESET']); \
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
}).catch((e)=>{console.error('e2e probe internal error:',(e&&e.code)||(e&&e.message)||e);process.exit(2);});" || { \
			echo "make e2e-clean: refusing to wipe — see probe message above."; \
			echo "Wait for \`make e2e\` to finish (or kill it), then re-run \`make e2e-clean\`."; \
			exit 1; \
		}; \
		rm -rf "$$DATA_DIR"

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'
