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
      ],
    },
  },
  prettierConfig
);
