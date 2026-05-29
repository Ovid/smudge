import { Router } from "express";
import { UpdateSettingsSchema } from "@smudge/shared";
import { asyncHandler } from "../asyncHandler";
import { BadRequestError } from "../errors/appError";
import * as SettingsService from "./settings.service";

export function settingsRouter(): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const settings = await SettingsService.getAll();
      res.json(settings);
    }),
  );

  router.patch(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = UpdateSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid input");
      }

      const result = await SettingsService.update(parsed.data.settings);
      if (result) {
        const messages = Object.values(result.errors).join("; ");
        throw new BadRequestError(`Invalid settings: ${messages}`);
      }

      res.json({ message: "Settings updated" });
    }),
  );

  return router;
}
