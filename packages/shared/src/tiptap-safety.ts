/**
 * Zero-dependency module holding TipTap structural-safety limits: the
 * depth cap, its structural validator, and the prototype-pollution
 * unsafe-key set. Broken out of schemas.ts so client-side modules that only
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
 * Is `value` something a TipTap walker may descend into — a non-null, non-array
 * object?
 *
 * TipTapDocSchema constrains TOP-LEVEL elements only
 * (`content: z.array(z.record(z.unknown()))`) and DB reads bypass Zod entirely,
 * so a `null` / primitive / **array** child is reachable at every nested level.
 * The array arm is the one that gets forgotten: `typeof [] === "object"`, so the
 * first two arms let an array through, and an array has no `.content`, so a
 * walker that returns it verbatim smuggles the whole subtree past its own
 * filter.
 *
 * S1 (dedup review 2026-07-26): this expression was written out byte-identically
 * at seven sites, and the depth-walkers test's "NEW WALKER?" box instructed
 * authors to copy the literal — institutionalising the copy whose omission was
 * the previous review's I2 bug. Callers keep their own degrade in the `if` body;
 * only the predicate is shared, because only the predicate is the same.
 *
 * Two sites deliberately do NOT adopt it: tiptap-safety's own
 * validateTipTapDepth needs array→`false` but primitive→`true`, and
 * tiptap-notes' walker needs array→`undefined` but primitive→`node`. Neither
 * can be expressed by one boolean.
 */
export function isTipTapNode(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Walks a TipTap doc and returns false if any `content[]` recursion
 * exceeds MAX_TIPTAP_DEPTH. Exported so callers that work with already-
 * parsed documents (snapshot restore, find/replace) can apply the same
 * guard without paying for full Zod schema parsing.
 *
 * This walker is the depth cap's ONLY enforcement point — TipTapDocSchema's
 * `.refine` is the sole caller on the write path — so its fail-closed arms are
 * load-bearing for every other walker's "unreachable via the API" assumption.
 *
 * I2 (dedup review 2026-07-26): an ARRAY node returned `true` here, because
 * `typeof [] === "object"` passes the primitive arm and an array has no
 * `.content` to recurse into. TipTapDocSchema types only TOP-LEVEL content
 * (`z.array(z.record(z.unknown()))`), so Zod rejects a top-level array child
 * but not a nested one — which made MAX_TIPTAP_DEPTH bypassable through
 * `PATCH /api/chapters/:id` by nesting through `content: [[...]]`. An array is
 * not a valid TipTap node in any position, so rejecting the document is both
 * the fail-closed answer and the correct one.
 */
export function validateTipTapDepth(node: unknown, depth: number = 0): boolean {
  if (depth > MAX_TIPTAP_DEPTH) return false;
  if (Array.isArray(node)) return false;
  if (!node || typeof node !== "object") return true;
  const content = (node as { content?: unknown }).content;
  // S1 (agentic-review 2026-08-04): an ABSENT content is a leaf and fine; a
  // PRESENT non-array one is a structurally invalid document. Returning true for
  // it made this walker — the API's only content validator — accept
  // `{"type":"paragraph","content":5}`, after which every consumer degraded
  // differently and silently: chapterContentToHtml returns "", so the whole
  // chapter body vanishes from HTML/EPUB/markdown/plaintext export with the
  // title still rendering, behind one logger.warn.
  if (content === undefined) return true;
  if (!Array.isArray(content)) return false;
  for (const child of content) {
    if (!validateTipTapDepth(child, depth + 1)) return false;
  }
  return true;
}

/**
 * Keys that would mutate an object's prototype chain when assigned via
 * bracket access. TipTapDocSchema uses .passthrough(), so content read from
 * the DB can legitimately carry any key — the canonicalization paths strip
 * these so a crafted `{"__proto__": {...}}` attrs value cannot poison the
 * result. Hashing/comparison proceeds with the key absent.
 *
 * Shared by tiptap-text.ts (canonicalJSON / marks comparison) and
 * content-hash.ts (canonicalize / snapshot hashing) so the two defenses
 * cannot drift apart. Typed ReadonlySet so neither consumer can mutate the
 * single shared instance out from under the other.
 */
export const CANONICAL_UNSAFE_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);
