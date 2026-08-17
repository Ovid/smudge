import { MAX_TIPTAP_DEPTH, isTipTapNode } from "./tiptap-safety";
type Node = { type?: string; content?: Node[]; [k: string]: unknown };

/**
 * Decides whether a given image node should be removed. Receives the image
 * node itself (not just its src) so the caller can apply its own src-parsing
 * rules — the `/api/images/<uuid>` matcher is deliberately NOT shared (see
 * CLAUDE.md §Accepted Architectural Trade-offs F-16: the client sanitizer and
 * the server reference-scanner encode different threat models and must not be
 * unified into `shared`).
 */
export type ImageNodePredicate = (node: Record<string, unknown>) => boolean;

const STRIP_EVERY_IMAGE: ImageNodePredicate = () => true;

function strip(node: Node, depth: number, shouldStrip: ImageNodePredicate): Node | null {
  // TipTapDocSchema constrains TOP-LEVEL elements only (z.array(z.record(...)));
  // nested content[] is unvalidated, and DB-read content bypasses Zod entirely.
  // Fail CLOSED on anything this walker cannot see inside: dereferencing a null
  // child threw an uncaught TypeError (500 where the contract says 400), and an
  // array-wrapped child has no .content, so returning it verbatim smuggled its
  // images past the strip. Kept symmetric with extractImageIds (images.references.ts),
  // which likewise finds nothing inside such a child.
  if (!isTipTapNode(node)) return null;
  if (node.type === "image" && shouldStrip(node)) return null;
  // Fail CLOSED at the depth cap: drop the over-deep subtree rather than return
  // it verbatim, which kept every image inside it — the one failure mode this
  // walker exists to prevent. Matches stripNoteMarks (-> undefined),
  // collectLeafBlocks (-> []) and validateTipTapDepth (-> false). Unreachable
  // via the API (Zod rejects depth > MAX_TIPTAP_DEPTH before insert); reachable
  // from a hand-edited DB or a restored backup.
  if (depth > MAX_TIPTAP_DEPTH) return null;
  // I1 (agentic-review 2026-08-04): the CONTAINER shape, not the child shape.
  // `{"type":"paragraph","content":{"type":"image",…}}` has nothing to iterate,
  // and returning the node verbatim kept the image the walker never inspected —
  // exactly the smuggling the docblock above says cannot happen. Drop the
  // unreadable container; the two siblings hardened one commit apart already do
  // (wordcount.ts extractText, tiptap-plaintext.ts walk).
  if (!Array.isArray(node.content)) return { ...node, content: undefined };
  const content = node.content
    .map((c) => strip(c, depth + 1, shouldStrip))
    .filter((c): c is Node => c !== null);
  return { ...node, content };
}
/**
 * Returns a copy of `doc` with image nodes removed. Fails closed: a subtree
 * past MAX_TIPTAP_DEPTH, a child this walker cannot descend into (null,
 * primitive, array), or a `content` CONTAINER that is not an array, is DROPPED
 * rather than passed through — no caller has to depth-validate first for the
 * no-images guarantee to hold.
 *
 * By default EVERY image node is removed, which is the guarantee the outtakes
 * capture path depends on (outtake JSON is invisible to the image
 * reference-counter, so an image referenced only by an outtake would be GC'd —
 * see CLAUDE.md §Data Model). Pass `shouldStrip` to remove only SOME images;
 * doing so deliberately weakens the blanket no-images guarantee to whatever
 * the predicate decides, so a caller that needs "no images at all" must not
 * pass one. The fail-closed drops above are unconditional either way: an
 * unreadable subtree is discarded whether or not it contained images.
 */
export function stripImageNodes(
  doc: Record<string, unknown>,
  shouldStrip: ImageNodePredicate = STRIP_EVERY_IMAGE,
): Record<string, unknown> {
  const result = strip(doc as Node, 0, shouldStrip);
  return (result ?? { type: "doc", content: [] }) as Record<string, unknown>;
}
