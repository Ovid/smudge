import type { ChapterStatusValue } from "@smudge/shared";

// Exhaustive: every ChapterStatusValue must have a color, or this fails to
// compile. A future status added to the enum forces a color here.
export const STATUS_COLORS: Record<ChapterStatusValue, string> = {
  outline: "#8B9E7C",
  rough_draft: "#C07850",
  revised: "#B8973E",
  edited: "#6B7F94",
  final: "#6B4E3D",
};
