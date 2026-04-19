import { describe, it, expect } from "vitest";
import { searchInDoc, replaceInDoc, assertSafeRegexPattern } from "../tiptap-text";

// --- Typed helpers for building TipTap doc fixtures ---

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TipTapTextNode {
  type: "text";
  text: string;
  marks?: TipTapMark[];
}

interface TipTapBlock {
  type: string;
  attrs?: Record<string, unknown>;
  content?: (TipTapBlock | TipTapTextNode)[];
}

interface TipTapDoc {
  type: "doc";
  content: TipTapBlock[];
}

function doc(...blocks: TipTapBlock[]): Record<string, unknown> {
  return { type: "doc", content: blocks } as unknown as Record<string, unknown>;
}

function paragraph(...nodes: TipTapTextNode[]): TipTapBlock {
  return { type: "paragraph", content: nodes };
}

function heading(level: number, ...nodes: TipTapTextNode[]): TipTapBlock {
  return { type: "heading", attrs: { level }, content: nodes };
}

function text(t: string, marks?: TipTapMark[]): TipTapTextNode {
  const node: TipTapTextNode = { type: "text", text: t };
  if (marks && marks.length > 0) node.marks = marks;
  return node;
}

function bold(): TipTapMark {
  return { type: "bold" };
}

function italic(): TipTapMark {
  return { type: "italic" };
}

function blockquote(...blocks: TipTapBlock[]): TipTapBlock {
  return { type: "blockquote", content: blocks };
}

function bulletList(...items: TipTapBlock[]): TipTapBlock {
  return { type: "bulletList", content: items };
}

function listItem(...blocks: TipTapBlock[]): TipTapBlock {
  return { type: "listItem", content: blocks };
}

/** Extract flat text from a result block's content nodes. */
function flatTextOf(block: Record<string, unknown>): string {
  const content = block.content as TipTapTextNode[] | undefined;
  if (!content) return "";
  return content.map((n) => n.text).join("");
}

/** Get the content blocks from a result doc. */
function contentOf(d: Record<string, unknown>): TipTapBlock[] {
  return (d as unknown as TipTapDoc).content;
}

describe("searchInDoc", () => {
  it("finds literal match in single paragraph", () => {
    const d = doc(paragraph(text("The quick brown fox")));
    const results = searchInDoc(d, "quick");
    expect(results).toHaveLength(1);
    expect(results[0]!.index).toBe(0);
    expect(results[0]!.blockIndex).toBe(0);
    expect(results[0]!.offset).toBe(4);
    expect(results[0]!.length).toBe(5);
  });

  it("finds multiple matches across paragraphs", () => {
    const d = doc(paragraph(text("The cat sat on the mat")), paragraph(text("The cat came back")));
    const results = searchInDoc(d, "cat");
    expect(results).toHaveLength(2);
    expect(results[0]!.blockIndex).toBe(0);
    expect(results[1]!.blockIndex).toBe(1);
    expect(results[0]!.index).toBe(0);
    expect(results[1]!.index).toBe(1);
  });

  it("performs case-insensitive search by default", () => {
    const d = doc(paragraph(text("Hello World hello HELLO")));
    const results = searchInDoc(d, "hello");
    expect(results).toHaveLength(3);
  });

  it("performs case-sensitive search when specified", () => {
    const d = doc(paragraph(text("Hello World hello HELLO")));
    const results = searchInDoc(d, "hello", { case_sensitive: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.offset).toBe(12);
  });

  it("supports whole-word search", () => {
    const d = doc(paragraph(text("the cat sat on the category mat")));
    const results = searchInDoc(d, "cat", { whole_word: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.offset).toBe(4);
  });

  it("supports regex search", () => {
    const d = doc(paragraph(text("color and colour are the same")));
    const results = searchInDoc(d, "colou?r", { regex: true });
    expect(results).toHaveLength(2);
  });

  it("returns context around matches", () => {
    const longText =
      "This is a very long sentence that goes on and on and eventually mentions the target word somewhere in the middle of it all";
    const d = doc(paragraph(text(longText)));
    const results = searchInDoc(d, "target");
    expect(results).toHaveLength(1);
    expect(results[0]!.context).toContain("target");
    expect(results[0]!.context.length).toBeLessThanOrEqual("target".length + 80 + 10);
  });

  it("finds match spanning two text nodes with different marks", () => {
    const d = doc(paragraph(text("she "), text("sud", [bold()]), text("denly realized")));
    const results = searchInDoc(d, "suddenly");
    expect(results).toHaveLength(1);
    expect(results[0]!.offset).toBe(4);
    expect(results[0]!.length).toBe(8);
  });

  it("returns empty array for no matches", () => {
    const d = doc(paragraph(text("The quick brown fox")));
    const results = searchInDoc(d, "zebra");
    expect(results).toEqual([]);
  });

  it("handles empty doc", () => {
    const d = doc();
    const results = searchInDoc(d, "anything");
    expect(results).toEqual([]);
  });

  it("handles doc with no text content", () => {
    const d = { type: "doc", content: [{ type: "horizontalRule" }] };
    const results = searchInDoc(d, "anything");
    expect(results).toEqual([]);
  });

  it("finds matches in headings", () => {
    const d = doc(heading(1, text("Chapter One")));
    const results = searchInDoc(d, "Chapter");
    expect(results).toHaveLength(1);
  });

  it("finds matches in nested blockquote > paragraph", () => {
    const d = doc(blockquote(paragraph(text("A wise saying"))));
    const results = searchInDoc(d, "wise");
    expect(results).toHaveLength(1);
  });

  it("finds matches in list items", () => {
    const d = doc(
      bulletList(listItem(paragraph(text("First item"))), listItem(paragraph(text("Second item")))),
    );
    const results = searchInDoc(d, "item");
    expect(results).toHaveLength(2);
  });

  it("escapes special regex characters in literal mode", () => {
    const d = doc(paragraph(text("Price is $100.00 (USD)")));
    const results = searchInDoc(d, "$100.00");
    expect(results).toHaveLength(1);
  });

  it("handles multiple matches in one paragraph", () => {
    const d = doc(paragraph(text("the the the")));
    const results = searchInDoc(d, "the");
    expect(results).toHaveLength(3);
    expect(results[0]!.offset).toBe(0);
    expect(results[1]!.offset).toBe(4);
    expect(results[2]!.offset).toBe(8);
  });
});

describe("replaceInDoc", () => {
  it("replaces in single text node", () => {
    const d = doc(paragraph(text("The quick brown fox")));
    const result = replaceInDoc(d, "quick", "slow");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("The slow brown fox");
  });

  it("replaces across mark boundaries preserving marks", () => {
    const d = doc(paragraph(text("she "), text("sud", [bold()]), text("denly realized")));
    const result = replaceInDoc(d, "suddenly", "quickly");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("she quickly realized");
  });

  it("replaces all occurrences in a block", () => {
    const d = doc(paragraph(text("the cat and the cat")));
    const result = replaceInDoc(d, "cat", "dog");
    expect(result.count).toBe(2);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("the dog and the dog");
  });

  it("replaces across multiple blocks", () => {
    const d = doc(paragraph(text("hello world")), paragraph(text("hello again")));
    const result = replaceInDoc(d, "hello", "goodbye");
    expect(result.count).toBe(2);
    const blocks = contentOf(result.doc);
    expect(flatTextOf(blocks[0] as unknown as Record<string, unknown>)).toBe("goodbye world");
    expect(flatTextOf(blocks[1] as unknown as Record<string, unknown>)).toBe("goodbye again");
  });

  it("performs case-insensitive replacement by default", () => {
    const d = doc(paragraph(text("Hello HELLO hello")));
    const result = replaceInDoc(d, "hello", "hi");
    expect(result.count).toBe(3);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("hi hi hi");
  });

  it("performs whole-word replacement", () => {
    const d = doc(paragraph(text("the cat sat in the category")));
    const result = replaceInDoc(d, "cat", "dog", { whole_word: true });
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe(
      "the dog sat in the category",
    );
  });

  it("supports regex replacement with capture groups", () => {
    const d = doc(paragraph(text("quickly and suddenly")));
    const result = replaceInDoc(d, "(\\w+)ly", "$1", { regex: true });
    expect(result.count).toBe(2);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("quick and sudden");
  });

  it("replaces only the Nth match when match_index is set (single block)", () => {
    const d = doc(paragraph(text("cat cat cat")));
    const result = replaceInDoc(d, "cat", "dog", { match_index: 1 });
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("cat dog cat");
  });

  it("replaces only the Nth match when match_index spans blocks", () => {
    const d = doc(paragraph(text("cat cat")), paragraph(text("cat dog")));
    // global indexes: [0]cat [1]cat [2]cat
    const result = replaceInDoc(d, "cat", "fox", { match_index: 2 });
    expect(result.count).toBe(1);
    const paras = contentOf(result.doc);
    expect(flatTextOf(paras[0] as unknown as Record<string, unknown>)).toBe("cat cat");
    expect(flatTextOf(paras[1] as unknown as Record<string, unknown>)).toBe("fox dog");
  });

  it("does nothing when match_index is out of range", () => {
    const d = doc(paragraph(text("cat cat")));
    const result = replaceInDoc(d, "cat", "dog", { match_index: 5 });
    expect(result.count).toBe(0);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("cat cat");
  });

  it("treats $ in replacement as literal text when regex mode is off", () => {
    const d = doc(paragraph(text("price is USD")));
    const result = replaceInDoc(d, "USD", "$100");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("price is $100");
  });

  it("does not expand $& / $1 / $$ in literal replacement", () => {
    const d = doc(paragraph(text("foo bar baz")));
    const result = replaceInDoc(d, "bar", "$& and $1 and $$");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("foo $& and $1 and $$ baz");
  });

  it("expands $1 / $& / $$ backreferences in regex mode", () => {
    const d = doc(paragraph(text("hello world")));
    const result = replaceInDoc(d, "(hello) (world)", "$2 $1 $&", { regex: true });
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("world hello hello world");
  });

  it("$NN out-of-range backref falls back to $N + literal digit (native semantics)", () => {
    // Native String.prototype.replace: "foo".replace(/(f)oo/, "$12") === "f2"
    // because $12 parses as $1 (valid) + literal "2" when there is no group 12.
    const d = doc(paragraph(text("abc")));
    const result = replaceInDoc(d, "(a)", "$12", { regex: true });
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("a2bc");
  });

  it("$NN where both digits are out of range stays literal", () => {
    // $99 with no groups: preserve literal per native replace ("abc".replace(/a/, "$99") === "$99bc").
    const d = doc(paragraph(text("abc")));
    const result = replaceInDoc(d, "a", "$99", { regex: true });
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("$99bc");
  });

  it("regex-mode lookbehind matches and replaces (no sliced re-execution)", () => {
    const d = doc(paragraph(text("foobar foobaz")));
    const result = replaceInDoc(d, "(?<=foo)bar", "qux", { regex: true });
    // Should replace 'bar' (preceded by foo) with 'qux'.
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("fooqux foobaz");
  });

  it("regex-mode lookahead matches and replaces (no sliced re-execution)", () => {
    const d = doc(paragraph(text("ab ac ad")));
    const result = replaceInDoc(d, "a(?=c)", "X", { regex: true });
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("ab Xc ad");
  });

  it("replaces with empty string (deletion)", () => {
    const d = doc(paragraph(text("remove this word")));
    const result = replaceInDoc(d, " this", "");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("remove word");
  });

  it("returns unchanged doc if no matches", () => {
    const d = doc(paragraph(text("The quick brown fox")));
    const result = replaceInDoc(d, "zebra", "horse");
    expect(result.count).toBe(0);
    expect(result.doc).toEqual(d);
  });

  it("returns correct count", () => {
    const d = doc(paragraph(text("aaa")), paragraph(text("aaa")), paragraph(text("bbb")));
    const result = replaceInDoc(d, "aaa", "ccc");
    expect(result.count).toBe(2);
  });

  it("merges adjacent text nodes with same marks after replacement", () => {
    const d = doc(
      paragraph(text("the "), text("qui", [bold()]), text("ck", [bold()]), text(" fox")),
    );
    const result = replaceInDoc(d, "quick", "fast");
    const para = contentOf(result.doc)[0];
    const content = para!.content as TipTapTextNode[];
    const boldNodes = content.filter((n) => n.marks && n.marks.some((m) => m.type === "bold"));
    expect(boldNodes).toHaveLength(1);
    expect(boldNodes[0]!.text).toBe("fast");
  });

  it("removes empty text nodes after replacement", () => {
    const d = doc(paragraph(text("hello"), text(" world")));
    const result = replaceInDoc(d, "hello", "");
    const para = contentOf(result.doc)[0];
    const content = para!.content as TipTapTextNode[];
    for (const node of content) {
      expect(node.text).not.toBe("");
    }
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe(" world");
  });

  it("handles nested structures (blockquote > paragraph)", () => {
    const d = doc(blockquote(paragraph(text("A wise old saying"))));
    const result = replaceInDoc(d, "wise", "foolish");
    expect(result.count).toBe(1);
    const bq = contentOf(result.doc)[0]!;
    const para = bq.content![0] as TipTapBlock;
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("A foolish old saying");
  });

  it("does not mutate the original doc", () => {
    const d = doc(paragraph(text("hello world")));
    const original = JSON.stringify(d);
    replaceInDoc(d, "hello", "goodbye");
    expect(JSON.stringify(d)).toBe(original);
  });

  it("preserves marks on text surrounding the replacement", () => {
    const d = doc(
      paragraph(
        text("I am "),
        text("very", [bold()]),
        text(" "),
        text("happy", [italic()]),
        text(" today"),
      ),
    );
    const result = replaceInDoc(d, "happy", "sad");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("I am very sad today");
    const content = para!.content as TipTapTextNode[];
    const sadNode = content.find((n) => n.text === "sad");
    expect(sadNode).toBeDefined();
    expect(sadNode!.marks).toEqual([italic()]);
  });

  it("handles replacement that changes text length", () => {
    const d = doc(paragraph(text("a b c")));
    const result = replaceInDoc(d, "b", "longer-replacement");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("a longer-replacement c");
  });

  it("handles marksAtOffset past end of segments (replacement longer than original)", () => {
    // When replacement is longer than the original text, marksAtOffset gets
    // called with offset past the end of segments — triggers fallback path
    const d = doc(paragraph(text("ab", [bold()])));
    const result = replaceInDoc(d, "ab", "abcdef");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    expect(flatTextOf(para as unknown as Record<string, unknown>)).toBe("abcdef");
    // The replacement should inherit the bold mark from the match start
    const content = para!.content as TipTapTextNode[];
    expect(content[0]!.marks).toEqual([bold()]);
  });

  it("handles empty segments in marksAtOffset (empty paragraph)", () => {
    // A paragraph that has no text nodes — segments will be empty
    const d = { type: "doc", content: [{ type: "paragraph", content: [] }] };
    const result = searchInDoc(d as unknown as Record<string, unknown>, "anything");
    expect(result).toEqual([]);
  });

  it("searches within codeBlock nodes", () => {
    const d = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const x = 42;" }],
        },
      ],
    } as unknown as Record<string, unknown>;
    const results = searchInDoc(d, "42");
    expect(results).toHaveLength(1);
    expect(results[0]!.blockIndex).toBe(0);
  });

  it("handles replacement when all text is deleted", () => {
    const d = doc(paragraph(text("hello")));
    const result = replaceInDoc(d, "hello", "");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0];
    const content = (para!.content ?? []) as TipTapTextNode[];
    for (const node of content) {
      expect(node.text).not.toBe("");
    }
  });

  it("preserves non-text inline nodes (hardBreak) during replace", () => {
    const hardBreak = { type: "hardBreak" } as unknown as TipTapTextNode;
    const d = doc(paragraph(text("hello"), hardBreak, text("world")));
    const result = replaceInDoc(d, "world", "earth");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0]!;
    const content = (para.content ?? []) as TipTapTextNode[];
    // Expect: text("hello"), hardBreak, text("earth")
    expect(content).toHaveLength(3);
    expect(content[0]!.type).toBe("text");
    expect(content[0]!.text).toBe("hello");
    expect((content[1] as unknown as { type: string }).type).toBe("hardBreak");
    expect(content[2]!.type).toBe("text");
    expect(content[2]!.text).toBe("earth");
  });

  it("does not match across a hardBreak boundary", () => {
    const hardBreak = { type: "hardBreak" } as unknown as TipTapTextNode;
    const d = doc(paragraph(text("foo"), hardBreak, text("bar")));
    // "foobar" would only appear if the two runs were concatenated.
    const result = replaceInDoc(d, "foobar", "baz");
    expect(result.count).toBe(0);
  });

  it("whole-word respects Unicode letter boundaries", () => {
    // "café" inside "cafés" must not match whole-word, but "café." should.
    const d1 = doc(paragraph(text("I saw cafés here")));
    expect(searchInDoc(d1, "café", { whole_word: true })).toHaveLength(0);

    const d2 = doc(paragraph(text("I saw café. Here.")));
    expect(searchInDoc(d2, "café", { whole_word: true })).toHaveLength(1);
  });

  it("whole-word + regex respects boundaries across top-level alternation", () => {
    // Regex `foo|bar` with whole_word must NOT match `xbar` or `fooy` — the
    // boundary wrappers must apply to every alternative. Without grouping,
    // `(?<!W)foo|bar(?!W)` silently matches `bar` after `x`.
    const d = doc(paragraph(text("xbar fooy foo bar")));
    const results = searchInDoc(d, "foo|bar", { regex: true, whole_word: true });
    expect(results).toHaveLength(2);
    expect(results[0]!.offset).toBe(10); // "foo" standalone
    expect(results[1]!.offset).toBe(14); // "bar" standalone
  });

  it("replace leaves empty runs around hardBreak untouched", () => {
    // First run empty, second run has the match. Exercises the empty-run
    // branch in splitBlockRuns.
    const hardBreak = { type: "hardBreak" } as unknown as TipTapTextNode;
    const d = doc(paragraph(hardBreak, text("world")));
    const result = replaceInDoc(d, "world", "earth");
    expect(result.count).toBe(1);
    const para = contentOf(result.doc)[0]!;
    const content = (para.content ?? []) as TipTapTextNode[];
    // [hardBreak, text("earth")]
    expect((content[0] as unknown as { type: string }).type).toBe("hardBreak");
    expect(content[1]!.text).toBe("earth");
  });

  it("searchInDoc does not match across a hardBreak boundary", () => {
    const hardBreak = { type: "hardBreak" } as unknown as TipTapTextNode;
    const d = doc(paragraph(text("foo"), hardBreak, text("bar")));
    expect(searchInDoc(d, "foobar")).toHaveLength(0);
    expect(searchInDoc(d, "foo")).toHaveLength(1);
    expect(searchInDoc(d, "bar")).toHaveLength(1);
  });
});

describe("assertSafeRegexPattern", () => {
  it("rejects flat nested quantifiers", () => {
    expect(() => assertSafeRegexPattern("(a+)+b")).toThrow(/nested quantifier/i);
    expect(() => assertSafeRegexPattern("(a*)*b")).toThrow(/nested quantifier/i);
    expect(() => assertSafeRegexPattern("(.?)+x")).toThrow(/nested quantifier/i);
  });

  it("rejects nested groups under outer quantifier", () => {
    expect(() => assertSafeRegexPattern("((a+))+b")).toThrow(/nested quantifier/i);
    expect(() => assertSafeRegexPattern("(?:(a+))+b")).toThrow(/nested quantifier/i);
    expect(() => assertSafeRegexPattern("((a|b)+)+c")).toThrow(/nested quantifier/i);
  });

  it("rejects adjacent unbounded quantifiers (polynomial backtracking)", () => {
    expect(() => assertSafeRegexPattern("a+a+b")).toThrow(/adjacent unbounded quantifier/i);
    expect(() => assertSafeRegexPattern("\\w*\\w*x")).toThrow(/adjacent unbounded quantifier/i);
    expect(() => assertSafeRegexPattern(".*.*y")).toThrow(/adjacent unbounded quantifier/i);
  });

  it("does not reject quantifiers inside character classes", () => {
    expect(() => assertSafeRegexPattern("[a+]")).not.toThrow();
    expect(() => assertSafeRegexPattern("[a+b*]")).not.toThrow();
  });

  it("rejects overlapping alternation under quantifier", () => {
    expect(() => assertSafeRegexPattern("(a|a)+b")).toThrow(/overlapping alternation/i);
    expect(() => assertSafeRegexPattern("(?:x|x)*y")).toThrow(/overlapping alternation/i);
  });

  it("accepts safe patterns", () => {
    expect(() => assertSafeRegexPattern("hello")).not.toThrow();
    expect(() => assertSafeRegexPattern("\\d+")).not.toThrow();
    expect(() => assertSafeRegexPattern("[abc]+")).not.toThrow();
    expect(() => assertSafeRegexPattern("(foo|bar)")).not.toThrow();
    expect(() => assertSafeRegexPattern("a{1,5}")).not.toThrow();
  });
});

describe("replaceInDoc match_index bypasses match cap (I3)", () => {
  it("replaces a single match even when total matches would exceed cap", async () => {
    // Build a paragraph with MAX_MATCHES_PER_REQUEST + 5 single-letter words.
    // Without the fix, a broad regex /a/ would trip the cap before resolving
    // match_index=0 and throw, breaking "Replace this one" on long chapters.
    const { MAX_MATCHES_PER_REQUEST } = await import("../tiptap-text");
    const bigText = "a".repeat(MAX_MATCHES_PER_REQUEST + 5);
    const d = doc(paragraph(text(bigText)));
    const result = replaceInDoc(d, "a", "b", { regex: true, match_index: 0 });
    expect(result.count).toBe(1);
    // Only the first character replaced.
    const para = (result.doc as unknown as TipTapDoc).content[0] as TipTapBlock;
    const flat = para.content!.map((n) => (n as TipTapTextNode).text ?? "").join("");
    expect(flat[0]).toBe("b");
    expect(flat[1]).toBe("a");
  });

  it("does not double-replace if match_index target is found mid-document", () => {
    const d = doc(
      paragraph(text("one two three")),
      paragraph(text("one two three")),
      paragraph(text("one two three")),
    );
    // "one" appears 3 times globally. Request match_index=1 → only second.
    const result = replaceInDoc(d, "one", "X", { match_index: 1 });
    expect(result.count).toBe(1);
    const paras = (result.doc as unknown as TipTapDoc).content as TipTapBlock[];
    expect((paras[0]!.content![0] as TipTapTextNode).text).toBe("one two three");
    expect((paras[1]!.content![0] as TipTapTextNode).text).toBe("X two three");
    expect((paras[2]!.content![0] as TipTapTextNode).text).toBe("one two three");
  });
});

describe("match cap and misc edges", () => {
  it("searchInDoc throws MatchCapExceededError when run is dense", async () => {
    const { searchInDoc, MAX_MATCHES_PER_REQUEST, MatchCapExceededError } =
      await import("../tiptap-text");
    const d = doc(paragraph(text("a".repeat(MAX_MATCHES_PER_REQUEST + 5))));
    expect(() => searchInDoc(d, "a")).toThrow(MatchCapExceededError);
  });
});

describe("deadline / RegExpTimeoutError (I9/I10)", () => {
  it("searchInDoc aborts when deadline has passed", async () => {
    const { searchInDoc, RegExpTimeoutError } = await import("../tiptap-text");
    const d = doc(paragraph(text("aaa aaa aaa")));
    expect(() => searchInDoc(d, "a", { deadline: Date.now() - 1 })).toThrow(RegExpTimeoutError);
  });

  it("replaceInDoc aborts when deadline has passed", async () => {
    const { replaceInDoc, RegExpTimeoutError } = await import("../tiptap-text");
    const d = doc(paragraph(text("aaa aaa aaa")));
    expect(() => replaceInDoc(d, "a", "b", { deadline: Date.now() - 1 })).toThrow(
      RegExpTimeoutError,
    );
  });
});

describe("replaceInDoc running output-size cap (I2 amplification)", () => {
  it("throws ReplacementTooLargeError when $' expansion exceeds max_output_chars", async () => {
    const { replaceInDoc, ReplacementTooLargeError } = await import("../tiptap-text");
    // Replacement "$'" splices the right-of-match into each output, so output
    // chars grow quadratically. A short input with moderate matches blows well
    // past a tight budget before JSON.stringify even starts.
    const d = doc(paragraph(text("a".repeat(500))));
    expect(() => replaceInDoc(d, "a", "$'", { regex: true, max_output_chars: 10_000 })).toThrow(
      ReplacementTooLargeError,
    );
  });

  it("does not throw when output stays within max_output_chars", async () => {
    const { replaceInDoc } = await import("../tiptap-text");
    const d = doc(paragraph(text("abc def")));
    expect(() => replaceInDoc(d, "abc", "ABC", { max_output_chars: 10_000 })).not.toThrow();
  });
});

describe("replaceInDoc mark canonicalization (I2)", () => {
  it("merges adjacent text nodes when marks have the same attrs in different key order", () => {
    // Two link marks with same attrs but different key insertion order —
    // should still be treated as equal so cleanupTextNodes merges.
    const d = doc(
      paragraph(
        text("foo", [{ type: "link", attrs: { href: "x", target: "_blank" } }]),
        text("bar", [{ type: "link", attrs: { target: "_blank", href: "x" } }]),
      ),
    );
    const result = replaceInDoc(d, "oob", "OOB");
    expect(result.count).toBe(1);
    const para = (result.doc as unknown as TipTapDoc).content[0] as TipTapBlock;
    // With canonical mark compare, the three pieces ("f", "OOB", "ar") all
    // carry the same link and should merge into a single text node.
    expect(para.content).toHaveLength(1);
    expect((para.content![0] as TipTapTextNode).text).toBe("fOOBar");
  });
});
