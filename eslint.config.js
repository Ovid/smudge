import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import importPlugin from "eslint-plugin-import";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/", "**/node_modules/", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    plugins: {
      import: importPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import/first": "error",
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
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name='spyOn'][arguments.0.name='console']",
          message:
            "Spy on console via expectConsole() from src/__tests__/expectConsole.ts (CLAUDE.md §Testing Philosophy). Raw console spies must be asserted; the helper enforces it.",
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
  prettierConfig,
);
