import { asyncHandler } from "../asyncHandler";
import { BadRequestError, NotFoundError } from "../errors/appError";
import * as VelocityService from "./velocity.service";

export const velocityHandler = asyncHandler(async (req, res) => {
  const slug = req.params.slug;
  if (!slug) {
    throw new BadRequestError("Missing project slug.", "BAD_REQUEST");
  }
  const result = await VelocityService.getVelocityBySlug(slug);
  if (!result) {
    throw new NotFoundError("Project not found.");
  }
  res.json(result);
});
