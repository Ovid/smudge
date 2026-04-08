import { Router } from "express";
import { UpdateSettingsSchema } from "@smudge/shared";
import { asyncHandler } from "../app";
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
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" },
        });
        return;
      }

      const result = await SettingsService.update(parsed.data.settings);
      if (result) {
        const messages = Object.values(result.errors).join("; ");
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid settings: ${messages}`,
          },
        });
        return;
      }

      res.json({ message: "Settings updated" });
    }),
  );

  return router;
}
