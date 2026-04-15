import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  TableOfContents,
  LevelFormat,
  ShadingType,
} from "docx";
import type { ExportProjectInfo, ExportChapter, RenderOptions } from "./export.renderers";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Heading‐level mapping: TipTap H3→Word H2, H4→H3, H5→H4
// Chapter titles are Heading 1; body headings start at Heading 2.
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
        const markProps = marksToProps(node.marks as Array<{ type: string }> | undefined);
        runs.push(
          new TextRun({
            text: node.text as string,
            ...markProps,
            ...extraProps,
          }),
        );
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

function allocateOrderedListRef(state: DocxBuildState): string {
  const ref = `ordered-list-${state.nextListId++}`;
  state.numberingConfigs.push({
    reference: ref,
    levels: [
      {
        level: 0,
        format: LevelFormat.DECIMAL,
        text: "%1.",
        alignment: AlignmentType.START,
      },
    ],
  });
  return ref;
}

// ---------------------------------------------------------------------------
// Convert a single TipTap block node → Paragraph[]
// ---------------------------------------------------------------------------

function blockToParagraphs(node: Record<string, unknown>, state: DocxBuildState): Paragraph[] {
  try {
    const type = node.type as string;
    const content = node.content as Array<Record<string, unknown>> | undefined;
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;

    switch (type) {
      case "paragraph":
        return [new Paragraph({ children: inlineToRuns(content) })];

      case "heading": {
        const level = attrs.level as number;
        const heading = HEADING_MAP[level];
        if (heading) {
          return [new Paragraph({ heading, children: inlineToRuns(content) })];
        }
        // Unmapped heading level → normal paragraph with warning
        logger.warn({ level }, "Unmapped TipTap heading level in docx export, rendering as paragraph");
        return [new Paragraph({ children: inlineToRuns(content) })];
      }

      case "blockquote": {
        // Each child block in a blockquote becomes an indented italic paragraph
        if (!content) return [];
        const paragraphs: Paragraph[] = [];
        for (const child of content) {
          const childContent = child.content as Array<Record<string, unknown>> | undefined;
          paragraphs.push(
            new Paragraph({
              indent: { left: 720 },
              children: inlineToRuns(childContent, { italics: true }),
            }),
          );
        }
        return paragraphs;
      }

      case "bulletList": {
        if (!content) return [];
        const items: Paragraph[] = [];
        for (const listItem of content) {
          const liContent = listItem.content as Array<Record<string, unknown>> | undefined;
          if (liContent) {
            for (const block of liContent) {
              const blockContent = block.content as Array<Record<string, unknown>> | undefined;
              items.push(
                new Paragraph({
                  bullet: { level: 0 },
                  children: inlineToRuns(blockContent),
                }),
              );
            }
          }
        }
        return items;
      }

      case "orderedList": {
        if (!content) return [];
        const listRef = allocateOrderedListRef(state);
        const items: Paragraph[] = [];
        for (const listItem of content) {
          const liContent = listItem.content as Array<Record<string, unknown>> | undefined;
          if (liContent) {
            for (const block of liContent) {
              const blockContent = block.content as Array<Record<string, unknown>> | undefined;
              items.push(
                new Paragraph({
                  numbering: { reference: listRef, level: 0 },
                  children: inlineToRuns(blockContent),
                }),
              );
            }
          }
        }
        return items;
      }

      case "codeBlock": {
        const runs = inlineToRuns(content, { font: { name: "Courier New" } });
        return [
          new Paragraph({
            children: runs,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "F0F0F0" },
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

function tipTapToParagraphs(
  content: Record<string, unknown> | null,
  state: DocxBuildState,
): Paragraph[] {
  if (!content) return [];
  const docContent = content.content as Array<Record<string, unknown>> | undefined;
  if (!docContent) return [];
  const paragraphs: Paragraph[] = [];
  for (const node of docContent) {
    paragraphs.push(...blockToParagraphs(node, state));
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
    children.push(...tipTapToParagraphs(chapter.content, state));
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
