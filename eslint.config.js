import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import importPlugin from "eslint-plugin-import";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import { resolve } from "node:path";

// S5 (review 2026-08-16): `packageDir` entries are resolved with
// `path.resolve()`, i.e. against `process.cwd()`. With a two-element array
// `import/no-extraneous-dependencies` reads each manifest with throwAtRead
// off, so any ESLint run whose cwd is not the repo root silently finds no
// package.json and reports nothing at all — a false green, not an error.
// Anchor to this config file's own directory instead.
const REPO_ROOT = import.meta.dirname;

export default tseslint.config(
  { ignores: ["**/dist/", "**/node_modules/", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      // Both entries are load-bearing for `import/no-cycle` on TypeScript, and
      // each fails SILENTLY when missing — the rule reports nothing and looks
      // like a clean bill of health (F-09). Verified by fixture:
      //   - no resolver:  `import/no-unresolved` fires on a *valid*
      //     extensionless relative TS import, so the cycle walk never starts.
      //   - resolver but no `import/parsers`: resolution succeeds, but the
      //     plugin cannot parse the *imported* .ts file to read its own
      //     imports, so a real two-file cycle goes undetected.
      // Only with both does a planted cycle report "Dependency cycle detected."
      // `eslintImportCycleRule.test.ts` plants exactly that fixture so this
      // cannot silently regress to a false green.
      "import/resolver": { typescript: true },
      "import/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import/first": "error",
      // S-02 (acyclic module graph) was protected by review alone. Zero cycles
      // exist today — re-measured after the detection above was made to work.
      "import/no-cycle": "error",
    },
  },
  // One block per workspace so `packageDir` is [repo root, that workspace]:
  // root catches shared tooling (eslint, vitest), the workspace catches its
  // own deps, and a package declared only in a *sibling* workspace still
  // errors. That cross-workspace precision is the point — F-11 was exactly
  // that drift (server declaring @tiptap/* it never imported, client importing
  // an undeclared @tiptap/core that resolved only via hoisting).
  // The JSDoc cast is load-bearing: inside `.map()` the object literal gets no
  // contextual type, so `["error", {...}]` widens to `(string | {...})[]` and
  // no longer satisfies `RuleEntry`'s tuple. The sibling blocks below are
  // direct arguments to `tseslint.config()` and infer the tuple for free.
  ...["shared", "server", "client"].map(
    (workspace) =>
      /** @type {import("typescript-eslint").ConfigWithExtends} */ ({
        files: [`packages/${workspace}/**/*.{ts,tsx}`],
        rules: {
          "import/no-extraneous-dependencies": [
            "error",
            {
              packageDir: [REPO_ROOT, resolve(REPO_ROOT, "packages", workspace)],
              // Production source may not import a devDependency (it would ship
              // broken); tests and local config may.
              devDependencies: [
                "**/__tests__/**",
                "**/*.test.{ts,tsx}",
                "**/*.spec.{ts,tsx}",
                "**/*.config.{ts,mts}",
              ],
            },
          ],
        },
      }),
  ),
  {
    files: ["e2e/**/*.ts", "scripts/**/*.{ts,mjs}", "*.config.{ts,js}", "*.config.{mts,mjs}"],
    rules: {
      "import/no-extraneous-dependencies": [
        "error",
        { packageDir: REPO_ROOT, devDependencies: true },
      ],
    },
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["packages/client/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
      "no-restricted-syntax": [
        "error",
        {
          // Sequence-ref staleness pattern: `local !== ref.current` or
          // `local === ref.current`. Both operators express the same
          // underlying anti-pattern (catching only `!==` leaves an obvious
          // bypass via `===`). MemberExpression on the LEFT — common
          // legitimate patterns like `activeChapterRef.current?.id === id`
          // — does not match this selector. Use useAbortableSequence instead.
          // esquery attribute-matching: a BinaryExpression whose operator is
          // either !== or ===, whose left is an Identifier, and whose right
          // is a MemberExpression ending in `.current`. Using attribute paths
          // (`left.type`, `right.type`, `right.property.name`) rather than
          // child/sibling combinators because BinaryExpression's left/right
          // are named fields, not positional siblings.
          //
          // NOT caught: the MIRRORED form `ref.current !== local` /
          // `ref.current === local`. Adding a `[left.property.name='current']
          // [right.type='Identifier']` selector was considered (review S1,
          // 2026-04-22) and rejected after testing: it false-positives on 14
          // legitimate sites — prev-value diff detection
          // (`prevSlugArgRef.current !== slug`), abort-controller identity
          // (`saveAbortRef.current === controller`), slug-drift checks,
          // still-on-chapter checks, and the canonical epoch comparison
          // inside `useAbortableSequence` itself. The original sequence-ref
          // anti-pattern typically pairs `++ref.current` (the bump) with a
          // comparison; esquery cannot express that cross-statement
          // constraint. The primary defense is the useAbortableSequence
          // primitive; this rule is a backstop for the simplest bypass.
          selector:
            "BinaryExpression[operator=/^[!=]==$/][left.type='Identifier'][right.type='MemberExpression'][right.property.name='current']",
          message:
            "Sequence-ref staleness check detected. Use useAbortableSequence (packages/client/src/hooks/useAbortableSequence.ts): start() bumps and returns a token, capture() reads current epoch, abort() invalidates outstanding tokens, and unmount auto-aborts.",
        },
        // ── Raw UI-string rule (Phase 4b.4) ────────────────────────────────
        // Flags WORD-BEARING string literals (text containing a Unicode
        // letter, \p{L}) in JSX text children and the six user-facing
        // attributes. Letters-only BY DESIGN: glyphs, separators, and
        // punctuation are language-neutral (not i18n surface), and bare-glyph
        // accessible-name coverage is owned by aXe-core (Playwright), not this
        // rule. Six selectors (one per AST shape) rather than one :matches()
        // form, so each gets a targeted message and the contract test
        // (packages/client/src/__tests__/eslintRawStringsRule.test.ts) can pin
        // them one shape at a time. EXEMPTIONS: name a decorative glyph as a
        // const → {GLYPH} (the rule does not fire on member/identifier
        // expressions); test fixtures use
        // `// eslint-disable-next-line no-restricted-syntax -- test fixture
        // (not user-facing)` — the separator is TWO hyphens `--` (an em-dash
        // silently disables nothing). ESLint reports a JSXText violation at the
        // opening-tag line, so a disable comment must sit above the opening
        // tag, not above the visible text.
        //
        // NOT caught (known gaps, by the same "add a selector when it shows up,
        // don't speculate" discipline as the seq-ref rule above and the design's
        // BinaryExpression note): word-bearing literals reached through an
        // intervening expression — ternary/logical operands such as
        // `{cond ? "Yes" : "No"}` or `aria-label={cond && "Save"}` — and
        // literal/template *containers* nested directly under a JSX fragment
        // (`<>{"Save"}</>`). A bare fragment text child (`<>Save</>`) IS caught
        // because the JSXText selector has no parent constraint. These shapes
        // were flagged (agentic-review 2026-05-29 findings S1/S2) but had ZERO
        // live violations in the tree, and the obvious broadening (a descendant
        // combinator) false-positives on `{obj["key"]}`, `{t("Save")}`, and
        // state comparisons like `{x === "loading" ? a : b}`. Add a targeted
        // ConditionalExpression/LogicalExpression/JSXFragment sibling selector
        // (verified against the tree for false positives) if/when a real
        // violation appears.
        {
          selector: "JSXText[value=/\\p{L}/u]",
          message:
            "Raw UI string in JSX text. UI strings must live in packages/client/src/strings.ts (CLAUDE.md §String externalization). Name a decorative glyph as a const → {GLYPH}; a test fixture uses `// eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing)`.",
        },
        {
          selector: "JSXElement > JSXExpressionContainer > Literal[value=/\\p{L}/u]",
          message:
            "Raw UI string literal in a JSX child. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          selector:
            "JSXElement > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.cooked=/\\p{L}/u]",
          message:
            "Raw UI string in a JSX-child template literal. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|title|placeholder|alt)$/][value.value=/\\p{L}/u]",
          message:
            "Raw UI string in a user-facing JSX attribute. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|title|placeholder|alt)$/] > JSXExpressionContainer > Literal[value=/\\p{L}/u]",
          message:
            "Raw UI string literal in a user-facing JSX attribute. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|title|placeholder|alt)$/] > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.cooked=/\\p{L}/u]",
          message:
            "Raw UI string in a user-facing JSX attribute template literal. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          // Phase 4b.7: ban raw console spies. Every console spy must route through
          // expectConsole() (packages/client/src/__tests__/expectConsole.ts), which
          // makes "installed ⇒ asserted" a structural invariant (CLAUDE.md §Testing
          // Philosophy). The helper file itself carries the sole inline exemption.
          // Two selectors cover the bare-identifier (`console`) and member-access
          // (`globalThis.console` / `window.console`) first-arg forms. Known gap:
          // an aliased or destructured `spyOn` slips both selectors — that is the
          // runtime backstop's job, not the lint's. A bypass-form raw spy never
          // registers with the helper, so it is never resolved; the runtime guard
          // (assertConsoleExpectationsSettled) simply leaves the real console
          // method in place and the suppression does not take effect. The ban is
          // "direct-form lint + runtime backstop," not a structural-impossibility
          // proof.
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name='spyOn'][arguments.0.name='console']",
          message:
            "Spy on console via expectConsole() from src/__tests__/expectConsole.ts (CLAUDE.md §Testing Philosophy). Raw console spies must be asserted; the helper enforces it.",
        },
        {
          // Member-access first arg: vi.spyOn(globalThis.console, …) / window.console.
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name='spyOn'][arguments.0.property.name='console']",
          message:
            "Spy on console via expectConsole() from src/__tests__/expectConsole.ts (CLAUDE.md §Testing Philosophy). Raw console spies must be asserted; the helper enforces it.",
        },
        {
          // Phase 4b.17: ban hand-rolled useRef<AbortController> allocations.
          // Cancellation belongs in useAbortableAsyncOperation (network) /
          // useAbortableSequence (staleness). The DESCENDANT combinator (space)
          // after TSTypeParameterInstantiation is load-bearing: it covers the
          // union (`AbortController | null`), nested (`Record<string,
          // AbortController>`), and multi-line generic forms in one selector, and
          // the exact typeName rejects `AbortControllerWrapper`/`MyAbortController`.
          // Justified survivors carry an inline
          // `// eslint-disable-next-line no-restricted-syntax -- <reason>`.
          //
          // DELIBERATE GAPS (same "add a selector when it shows up" discipline
          // as the seq-ref/raw-string rules; all zero-occurrence today):
          //   - callee shape: keys on `callee.name='useRef'`, so a
          //     `React.useRef<AbortController>` MemberExpression callee, or an
          //     aliased `import { useRef as ur }`, slips through. Every useRef<
          //     site today is a bare, unaliased `useRef`.
          //   - qualified type name: keys on `typeName.name`, so a qualified
          //     `useRef<globalThis.AbortController>` (a TSQualifiedName, which
          //     has no `.name`) slips through. Every site uses the bare global
          //     `AbortController`. The deleted regex caught this textually; add
          //     `[typeName.right.name='AbortController']` if one ever appears.
          selector:
            "CallExpression[callee.name='useRef'] > TSTypeParameterInstantiation TSTypeReference[typeName.name='AbortController']",
          message:
            "Hand-rolled useRef<AbortController> is banned. Route network cancellation through useAbortableAsyncOperation (packages/client/src/hooks/useAbortableAsyncOperation.ts) or response-staleness through useAbortableSequence. A justified second-tier-recovery survivor uses `// eslint-disable-next-line no-restricted-syntax -- <reason>` (the separator is two hyphens).",
        },
      ],
    },
  },
  {
    // F-9: client source must not call console.* directly — raw error objects
    // would reach the production browser console. Route through clientWarn /
    // clientError (DEV-gated, errors/clientLog.ts) or devWarn (abort-aware).
    files: ["packages/client/src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // The DEV-gated logger modules are the only allowed console call sites,
    // and test files use console (spies, fixtures) freely.
    files: [
      "packages/client/src/errors/clientLog.ts",
      "packages/client/src/errors/devWarn.ts",
      "packages/client/src/**/__tests__/**/*.{ts,tsx}",
      "packages/client/src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Tooling scripts are plain Node ESM (.mjs). They need Node globals
    // (process, console) that the TS files get for free, and they legitimately
    // use createRequire's require() for JSON / module resolution.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  prettierConfig,
);
