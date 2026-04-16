import type { ImageRow } from "@smudge/shared";
export type { ImageRow };

export interface CreateImageRow {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface UpdateImageData {
  alt_text?: string;
  caption?: string;
  source?: string;
  license?: string;
}

export interface ImageWithUsage extends ImageRow {
  used_in_chapters: Array<{ id: string; title: string }>;
}
