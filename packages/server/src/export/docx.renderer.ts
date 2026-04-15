import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  TableOfContents,
  LevelFormat,
  ShadingType,
} from "docx";
import type { ExportProjectInfo, ExportChapter, RenderOptions } from "./export.renderers";
import { resolveImage } from "./image-resolver";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Heading‐level mapping: TipTap H3→Word H2, H4→H3, H5→H4
// Chapter titles are Heading 1; body headings start at Heading 2.
// Only H3-H5 are mapped because the editor restricts body headings to those
// levels (H1-H2 are reserved for page structure). If pasted content introduces
// an H1 or H2, it falls through to a plain paragraph with a logger warning.
// ---------------------------------------------------------------------------

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  3: HeadingLevel.HEADING_2,
  4: HeadingLevel.HEADING_3,
  5: HeadingLevel.HEADING_4,
};

// ---------------------------------------------------------------------------
// Inline mark → TextRun properties
// ---------------------------------------------------------------------------

interface MarkInfo {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  font?: { name: string };
}

function marksToProps(marks?: Array<{ type: string }>): MarkInfo {
  const props: MarkInfo = {};
  if (!marks) return props;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        props.bold = true;
        break;
      case "italic":
        props.italics = true;
        break;
      case "strike":
        props.strike = true;
        break;
      case "code":
        props.font = { name: "Courier New" };
        break;
    }
  }
  return props;
}

// ---------------------------------------------------------------------------
// Convert inline content (text nodes, hardBreak) → TextRun[]
// ---------------------------------------------------------------------------

function inlineToRuns(
  nodes: Array<Record<string, unknown>> | undefined,
  extraProps?: MarkInfo,
): TextRun[] {
  if (!nodes) return [];
  const runs: TextRun[] = [];
  for (const node of nodes) {
    try {
      if (node.type === "text") {
        const text = typeof node.text === "string" ? node.text : "";
        if (!text) continue;
        const markProps = marksToProps(node.marks as Array<{ type: string }> | undefined);
        // Split on newlines and interleave break runs so multi-line
        // content (especially code blocks) preserves line breaks in Word.
        const segments = text.split("\n");
        for (let si = 0; si < segments.length; si++) {
          if (si > 0) {
            runs.push(new TextRun({ break: 1, ...markProps, ...extraProps }));
          }
          if (segments[si]) {
            runs.push(
              new TextRun({
                text: segments[si],
                ...markProps,
                ...extraProps,
              }),
            );
          }
        }
      } else if (node.type === "hardBreak") {
        runs.push(new TextRun({ break: 1, ...extraProps }));
      }
    } catch (err) {
      logger.warn({ err, nodeType: node.type }, "Failed to convert inline node to docx TextRun");
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Build state — tracks per-document numbering for ordered lists
// ---------------------------------------------------------------------------

interface DocxBuildState {
  nextListId: number;
  numberingConfigs: Array<{
    reference: string;
    levels: Array<{
      level: number;
      format: (typeof LevelFormat)[keyof typeof LevelFormat];
      text: string;
      alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
    }>;
  }>;
}

function newBuildState(): DocxBuildState {
  return { nextListId: 0, numberingConfigs: [] };
}

const MAX_LIST_DEPTH = 9; // Word supports levels 0-8

function allocateOrderedListRef(state: DocxBuildState): string {
  const ref = `ordered-list-${state.nextListId++}`;
  const levels = [];
  for (let i = 0; i < MAX_LIST_DEPTH; i++) {
    levels.push({
      level: i,
      format: LevelFormat.DECIMAL,
      text: `%${i + 1}.`,
      alignment: AlignmentType.START,
    });
  }
  state.numberingConfigs.push({ reference: ref, levels });
  return ref;
}

// ---------------------------------------------------------------------------
// Blockquote context — propagated through recursion so nested content
// inherits indent and italic styling from enclosing blockquotes.
// ---------------------------------------------------------------------------

interface BlockContext {
  indent?: { left: number };
  extraRunProps?: MarkInfo;
  listDepth?: number;
}

// ---------------------------------------------------------------------------
// Shared list-item processing for bullet and ordered lists.
// The markerProps callback receives the current nesting level and returns the
// list-marker properties (bullet or numbering) for each paragraph item.
// ---------------------------------------------------------------------------

async function listItemsToParagraphs(
  listItems: Array<Record<string, unknown>>,
  markerProps: (level: number) => Record<string, unknown>,
  state: DocxBuildState,
  ctx?: BlockContext,
): Promise<Paragraph[]> {
  const level = Math.min(ctx?.listDepth ?? 0, MAX_LIST_DEPTH - 1);
  // Child blocks (e.g. nested lists) see an incremented depth so they
  // render at the next indentation level in Word.
  const childCtx: BlockContext = { ...ctx, listDepth: level + 1 };
  const items: Paragraph[] = [];
  for (const listItem of listItems) {
    const liContent = listItem.content as Array<Record<string, unknown>> | undefined;
    if (liContent) {
      for (const block of liContent) {
        if ((block.type as string) === "paragraph") {
          const blockContent = block.content as Array<Record<string, unknown>> | undefined;
          items.push(
            new Paragraph({
              ...markerProps(level),
              ...(ctx?.indent ? { indent: ctx.indent } : {}),
              children: inlineToRuns(blockContent, ctx?.extraRunProps),
            }),
          );
        } else {
          items.push(...(await blockToParagraphs(block, state, childCtx)));
        }
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Convert a single TipTap block node → Paragraph[]
// ---------------------------------------------------------------------------

// Default image dimensions in EMUs (English Metric Units).
// 1 inch = 914400 EMUs; these default to ~4in x ~3in.
const DEFAULT_IMAGE_WIDTH = 3657600;
const DEFAULT_IMAGE_HEIGHT = 2743200;

const MIME_TO_DOCX_TYPE: Record<string, "jpg" | "png" | "gif" | "bmp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

async function blockToParagraphs(
  node: Record<string, unknown>,
  state: DocxBuildState,
  ctx?: BlockContext,
): Promise<Paragraph[]> {
  try {
    const type = node.type as string;
    const content = node.content as Array<Record<string, unknown>> | undefined;
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;

    switch (type) {
      case "paragraph":
        return [
          new Paragraph({
            ...(ctx?.indent ? { indent: ctx.indent } : {}),
            children: inlineToRuns(content, ctx?.extraRunProps),
          }),
        ];

      case "heading": {
        const level = attrs.level as number;
        const heading = HEADING_MAP[level];
        if (heading) {
          return [
            new Paragraph({
              heading,
              ...(ctx?.indent ? { indent: ctx.indent } : {}),
              children: inlineToRuns(content, ctx?.extraRunProps),
            }),
          ];
        }
        // Unmapped heading level → normal paragraph with warning
        logger.warn(
          { level },
          "Unmapped TipTap heading level in docx export, rendering as paragraph",
        );
        return [
          new Paragraph({
            ...(ctx?.indent ? { indent: ctx.indent } : {}),
            children: inlineToRuns(content, ctx?.extraRunProps),
          }),
        ];
      }

      case "blockquote": {
        // All children inherit blockquote styling (indent + italic).
        // The context is propagated through recursion so nested headings,
        // lists, and other block types also receive the formatting.
        if (!content) return [];
        const bqCtx: BlockContext = {
          indent: { left: (ctx?.indent?.left ?? 0) + 720 },
          extraRunProps: { ...ctx?.extraRunProps, italics: true },
        };
        const paragraphs: Paragraph[] = [];
        for (const child of content) {
          paragraphs.push(...(await blockToParagraphs(child, state, bqCtx)));
        }
        return paragraphs;
      }

      case "bulletList": {
        if (!content) return [];
        return listItemsToParagraphs(content, (level) => ({ bullet: { level } }), state, ctx);
      }

      case "orderedList": {
        if (!content) return [];
        const listRef = allocateOrderedListRef(state);
        return listItemsToParagraphs(
          content,
          (level) => ({ numbering: { reference: listRef, level } }),
          state,
          ctx,
        );
      }

      case "codeBlock": {
        const runs = inlineToRuns(content, {
          font: { name: "Courier New" },
          ...ctx?.extraRunProps,
        });
        return [
          new Paragraph({
            children: runs,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "F0F0F0" },
            ...(ctx?.indent ? { indent: ctx.indent } : {}),
          }),
        ];
      }

      case "horizontalRule":
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "* * *" })],
          }),
        ];

      case "image": {
        const src = attrs.src as string | undefined;
        if (!src) return [];

        // Extract image ID from /api/images/{uuid} URL
        const idMatch = src.match(/\/api\/images\/([0-9a-f-]{36})/i);
        if (!idMatch?.[1]) {
          logger.warn({ src }, "Image src not a recognized /api/images/ URL in docx export");
          return [];
        }

        const resolved = await resolveImage(idMatch[1]);
        if (!resolved) {
          logger.warn({ imageId: idMatch[1] }, "Could not resolve image for docx export");
          return [];
        }

        const docxType = MIME_TO_DOCX_TYPE[resolved.mimeType];
        if (!docxType) {
          logger.warn(
            { mimeType: resolved.mimeType },
            "Unsupported image MIME type for docx export",
          );
          return [];
        }

        const paragraphs: Paragraph[] = [
          new Paragraph({
            ...(ctx?.indent ? { indent: ctx.indent } : {}),
            children: [
              new ImageRun({
                data: resolved.data,
                type: docxType,
                transformation: {
                  width: DEFAULT_IMAGE_WIDTH,
                  height: DEFAULT_IMAGE_HEIGHT,
                },
                altText: {
                  title: resolved.altText || "Image",
                  description: resolved.altText || "",
                  name: resolved.altText || "Image",
                },
              }),
            ],
          }),
        ];

        // Add caption as italic paragraph below the image
        if (resolved.caption) {
          paragraphs.push(
            new Paragraph({
              ...(ctx?.indent ? { indent: ctx.indent } : {}),
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: resolved.caption, italics: true })],
            }),
          );
        }

        return paragraphs;
      }

      default:
        logger.warn({ nodeType: type }, "Unknown TipTap node type in docx export, skipping");
        return [];
    }
  } catch (err) {
    logger.warn({ err, nodeType: node.type }, "Failed to convert TipTap node to docx paragraph");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Convert full TipTap doc JSON → Paragraph[]
// ---------------------------------------------------------------------------

async function tipTapToParagraphs(
  content: Record<string, unknown> | null,
  state: DocxBuildState,
): Promise<Paragraph[]> {
  if (!content) return [];
  const docContent = content.content as Array<Record<string, unknown>> | undefined;
  if (!docContent) return [];
  const paragraphs: Paragraph[] = [];
  for (const node of docContent) {
    paragraphs.push(...(await blockToParagraphs(node, state)));
  }
  return paragraphs;
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

export async function renderDocx(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
): Promise<Buffer> {
  const state = newBuildState();
  const children: (Paragraph | TableOfContents)[] = [];

  // 1. Title page
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: project.title,
          bold: true,
          size: 56, // 28pt
        }),
      ],
    }),
  );

  if (project.author_name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: project.author_name,
            italics: true,
            size: 28, // 14pt
          }),
        ],
      }),
    );
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // 2. TOC (if requested and chapters exist)
  if (options.includeToc && chapters.length > 0) {
    children.push(
      new TableOfContents("Table of Contents", {
        hyperlink: true,
        headingStyleRange: "1-4",
      }),
    );
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // 3. Chapters
  for (const [i, chapter] of chapters.entries()) {
    if (i > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Chapter heading
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: chapter.title })],
      }),
    );

    // Chapter content
    children.push(...(await tipTapToParagraphs(chapter.content, state)));
  }

  const doc = new Document({
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: {
            font: "Cambria",
            size: 24, // 12pt
          },
        },
      },
    },
    numbering: {
      config: state.numberingConfigs,
    },
    sections: [{ children }],
  });

  return await Packer.toBuffer(doc);
}
