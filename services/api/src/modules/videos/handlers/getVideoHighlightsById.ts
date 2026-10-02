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

    type HighlightQuery = Record<string, unknown>;
    const query = req.query as unknown as HighlightQuery;
    const durationHintRaw = query.durationHint;
    let durationHint: number | undefined;
    if (typeof durationHintRaw === "string" && durationHintRaw.length > 0) {
      const n = Number(durationHintRaw);
      if (Number.isFinite(n) && n > 0) durationHint = n;
    } else if (typeof durationHintRaw === "number" && durationHintRaw > 0) {
      durationHint = durationHintRaw;
    }

    const result = await highlightsService.getVideoHighlights(
      userId,
      id,
      durationHint,
    );
    if (result.error) {
      res.status(result.error.code).json({ error: result.error.message });
      return;
    }
    res.status(200).json(result.ok);
  });
}
