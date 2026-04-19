/**
 * Zero-dependency module holding the TipTap depth cap and its structural
 * validator. Broken out of schemas.ts so client-side modules that only
 * need the constant (e.g. countWords in wordcount.ts) don't have to pull
 * in Zod and the full schema graph through the import barrel. Tree-
 * shakers SHOULD eliminate unused schema code, but sibling imports
 * trigger module-level execution — keeping this file dep-free guarantees
 * the countWords path stays lean regardless of bundler behaviour.
 */

/**
 * Maximum nesting depth accepted for a TipTap document. The walkers in
 * @smudge/shared/tiptap-text and countWords recurse into content, so an
 * adversarial (or buggy) client that submits a 5 MB doc of nested
 * { content: [ { content: [ ... ] } ] } could blow the stack. Real-world
 * manuscripts are nowhere near this — even a deeply nested blockquote/list
 * combination rarely exceeds 10–15.
 */
export const MAX_TIPTAP_DEPTH = 64;

/**
 * Walks a TipTap doc and returns false if any `content[]` recursion
 * exceeds MAX_TIPTAP_DEPTH. Exported so callers that work with already-
 * parsed documents (snapshot restore, find/replace) can apply the same
 * guard without paying for full Zod schema parsing.
 */
export function validateTipTapDepth(node: unknown, depth: number = 0): boolean {
  if (depth > MAX_TIPTAP_DEPTH) return false;
  if (!node || typeof node !== "object") return true;
  const content = (node as { content?: unknown }).content;
  if (!Array.isArray(content)) return true;
  for (const child of content) {
    if (!validateTipTapDepth(child, depth + 1)) return false;
  }
  return true;
}
