import type { Request, Response } from "express";
import type { Router } from "express";
import { z } from "zod";
import type { VideoIdParams } from "./createUploadSession";
import {
  bulkHighlightItemSchema,
  highlightsService,
} from "../services/highlights.service";

/**
 * ⑤ [内部接口] ai-worker 批量写 highlights
 *
 * 要求：ai-worker 必须带 X-Internal-Token 头与 API_INTERNAL_TOKEN 一致，
 *      或者走 JWT 认证的用户本人请求。
 *
 * 注意：这里用 createMany 做批量 INSERT，避免循环一条一条写性能烂。
 * POST /videos/:id/highlights/bulk
 */
export function registerBulkWriteHighlightsById(router: Router): void {
  router.post("/:id/highlights/bulk", async (req: Request, res: Response) => {
    const userId = req.currentUser!.id ?? "";
    const { id } = req.params as VideoIdParams;
    const schema = z.object({
      highlights: z.array(bulkHighlightItemSchema).min(0).max(5000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }

    const result = await highlightsService.bulkWriteHighlights(
      userId,
      id,
      parsed.data.highlights,
    );
    if (result.error) {
      res.status(result.error.code).json({ error: result.error.message });
      return;
    }
    res.status(200).json(result.ok);
  });
}
