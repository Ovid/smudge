import { ExportSchema, EXPORT_FILE_EXTENSIONS, EXPORT_CONTENT_TYPES } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import {
  renderHtml,
  renderMarkdown,
  renderPlainText,
  type ExportProjectInfo,
  type ExportChapter,
} from "./export.renderers";
import { renderDocx } from "./docx.renderer";
import { renderEpub } from "./epub.renderer";

interface ExportResult {
  content: string | Buffer;
  contentType: string;
  filename: string;
}

export async function exportProject(
  slug: string,
  body: unknown,
): Promise<
  | { result: ExportResult }
  | { validationError: string }
  | { notFound: true }
  | { noChapters: true }
  | { invalidChapterIds: string[] }
> {
  const parsed = ExportSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { format, include_toc, chapter_ids } = parsed.data;

  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return { notFound: true };

  let chapters = await store.listChaptersByProject(project.id);

  if (chapter_ids) {
    const validIds = await store.listChapterIdsByProject(project.id);
    const validIdSet = new Set(validIds);
    const invalid = chapter_ids.filter((id) => !validIdSet.has(id));
    if (invalid.length > 0) {
      return { invalidChapterIds: invalid };
    }

    const idSet = new Set(chapter_ids);
    chapters = chapters.filter((ch) => idSet.has(ch.id));

    if (chapters.length === 0) {
      return { noChapters: true };
    }
  }

  const projectInfo: ExportProjectInfo = {
    title: project.title,
    author_name: project.author_name,
  };

  const exportChapters: ExportChapter[] = chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    content: ch.content,
    sort_order: ch.sort_order,
  }));

  const options = { includeToc: include_toc };

  let content: string | Buffer;
  switch (format) {
    case "html":
      content = renderHtml(projectInfo, exportChapters, options);
      break;
    case "markdown":
      content = renderMarkdown(projectInfo, exportChapters, options);
      break;
    case "plaintext":
      content = renderPlainText(projectInfo, exportChapters, options);
      break;
    case "docx":
      content = await renderDocx(projectInfo, exportChapters, options);
      break;
    case "epub":
      content = await renderEpub(projectInfo, exportChapters, options);
      break;
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unhandled export format: ${_exhaustive}`);
    }
  }

  const ext = EXPORT_FILE_EXTENSIONS[format];
  const safeSlug = (project.slug || "export").replace(/["\\\r\n]/g, "_");
  const filename = `${safeSlug}.${ext}`;

  return {
    result: { content, contentType: EXPORT_CONTENT_TYPES[format], filename },
  };
}
