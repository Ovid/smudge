import type { Request } from "express";
import { z } from "zod";
import { BadRequestError } from "./errors/appError";

const UuidSchema = z.string().uuid();

/**
 * Validate the `:id` route param as a UUID, returning it or throwing a 400.
 * The optional label names the entity in the message ("Invalid chapter id.");
 * omit it for a generic "Invalid id." Shared by every route whose trust
 * boundary is a UUID path param so the check cannot drift per endpoint.
 */
export function validateUuidParam(req: Request, label?: string): string {
  const parsed = UuidSchema.safeParse(req.params.id);
  if (!parsed.success) {
    throw new BadRequestError(label ? `Invalid ${label} id.` : "Invalid id.");
  }
  return parsed.data;
}
