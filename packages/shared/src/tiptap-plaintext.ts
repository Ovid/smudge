import { MAX_TIPTAP_DEPTH } from "./tiptap-safety";
type Node = { type?: string; text?: string; content?: Node[] };
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "listItem",
  "codeBlock",
  "horizontalRule",
]);
function needsNewline(out: string[]): boolean {
  const last = out[out.length - 1];
  return last !== undefined && !last.endsWith("\n");
}
function walk(node: Node, depth: number, out: string[]): void {
  // Nested content[] is unvalidated by TipTapDocSchema and DB-read content
  // bypasses Zod, so a null/primitive/array child is reachable; dereferencing
  // one threw. Contributes nothing, exactly like an unknown empty node.
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  if (depth > MAX_TIPTAP_DEPTH) return;
  if (typeof node.text === "string") {
    out.push(node.text);
    return;
  }
  if (node.type === "hardBreak") {
    out.push("\n");
    return;
  }
  const isBlock = node.type ? BLOCK_TYPES.has(node.type) : false;
  if (isBlock && needsNewline(out)) out.push("\n");
  for (const child of node.content ?? []) walk(child, depth + 1, out);
  if (isBlock && needsNewline(out)) out.push("\n");
}
/** TipTap JSON → plain text, blocks separated by "\n". Empty/null → "". */
export function toPlainText(doc: Record<string, unknown> | null): string {
  if (!doc) return "";
  const out: string[] = [];
  walk(doc as Node, 0, out);
  return out
    .join("")
    .replace(/\n+/g, "\n")
    .replace(/^\n|\n$/g, "");
}
