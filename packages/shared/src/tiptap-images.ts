import { MAX_TIPTAP_DEPTH } from "./tiptap-safety";
type Node = { type?: string; content?: Node[]; [k: string]: unknown };
function strip(node: Node, depth: number): Node | null {
  if (node.type === "image") return null;
  if (depth > MAX_TIPTAP_DEPTH || !Array.isArray(node.content)) return node;
  const content = node.content
    .map((c) => strip(c, depth + 1))
    .filter((c): c is Node => c !== null);
  return { ...node, content };
}
/** Returns a copy of `doc` with all image nodes removed. */
export function stripImageNodes(doc: Record<string, unknown>): Record<string, unknown> {
  const result = strip(doc as Node, 0);
  return (result ?? { type: "doc", content: [] }) as Record<string, unknown>;
}
