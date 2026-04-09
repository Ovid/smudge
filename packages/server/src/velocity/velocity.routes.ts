import { asyncHandler } from "../app";
import * as VelocityService from "./velocity.service";

export const velocityHandler = asyncHandler(async (req, res) => {
  const slug = req.params.slug;
  if (!slug) {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Missing project slug." },
    });
    return;
  }
  const result = await VelocityService.getVelocityBySlug(slug);
  if (!result) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Project not found." },
    });
    return;
  }
  res.json(result);
});
