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
