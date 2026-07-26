import { MAX_TIPTAP_DEPTH, isTipTapNode } from "./tiptap-safety";
type Node = { type?: string; content?: Node[]; [k: string]: unknown };
function strip(node: Node, depth: number): Node | null {
  // TipTapDocSchema constrains TOP-LEVEL elements only (z.array(z.record(...)));
  // nested content[] is unvalidated, and DB-read content bypasses Zod entirely.
  // Fail CLOSED on anything this walker cannot see inside: dereferencing a null
  // child threw an uncaught TypeError (500 where the contract says 400), and an
  // array-wrapped child has no .content, so returning it verbatim smuggled its
  // images past the strip. Kept symmetric with extractImageIds (images.references.ts),
  // which likewise finds nothing inside such a child.
  if (!isTipTapNode(node)) return null;
  if (node.type === "image") return null;
  // Fail CLOSED at the depth cap: drop the over-deep subtree rather than return
  // it verbatim, which kept every image inside it — the one failure mode this
  // walker exists to prevent. Matches stripNoteMarks (-> undefined),
  // collectLeafBlocks (-> []) and validateTipTapDepth (-> false). Unreachable
  // via the API (Zod rejects depth > MAX_TIPTAP_DEPTH before insert); reachable
  // from a hand-edited DB or a restored backup.
  if (depth > MAX_TIPTAP_DEPTH) return null;
  if (!Array.isArray(node.content)) return node;
  const content = node.content.map((c) => strip(c, depth + 1)).filter((c): c is Node => c !== null);
  return { ...node, content };
}
/**
 * Returns a copy of `doc` with all image nodes removed. Fails closed: a subtree
 * past MAX_TIPTAP_DEPTH, or a child this walker cannot descend into (null,
 * primitive, array), is DROPPED rather than passed through — no caller has to
 * depth-validate first for the no-images guarantee to hold.
 */
export function stripImageNodes(doc: Record<string, unknown>): Record<string, unknown> {
  const result = strip(doc as Node, 0);
  return (result ?? { type: "doc", content: [] }) as Record<string, unknown>;
}
