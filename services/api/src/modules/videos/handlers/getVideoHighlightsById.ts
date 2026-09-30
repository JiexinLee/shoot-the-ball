import type { Request, Response } from "express";
import type { Router } from "express";
import type { VideoIdParams } from "./createUploadSession";
import { highlightsService } from "../services/highlights.service";

/**
 * ⑥ 前端拉 highlights 列表（Review 页面用）
 * GET /videos/:id/highlights
 */
export function registerGetVideoHighlightsById(router: Router): void {
  router.get("/:id/highlights", async (req: Request, res: Response) => {
    const userId = req.currentUser!.id ?? "";
    const { id } = req.params as VideoIdParams;

    const result = await highlightsService.getVideoHighlights(userId, id);
    if (result.error) {
      res.status(result.error.code).json({ error: result.error.message });
      return;
    }
    res.status(200).json(result.ok);
  });
}
