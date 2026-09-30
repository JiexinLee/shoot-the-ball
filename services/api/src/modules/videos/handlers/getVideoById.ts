import type { Request, Response } from "express";
import type { Router } from "express";
import type { VideoIdParams } from "./createUploadSession";
import { videosService } from "../services/videos.service";

/**
 * ⑦ 视频详情：metadata + 当前 processingJob + 可下载的临时源视频 URL
 * GET /videos/:id
 */
export function registerGetVideoById(router: Router): void {
  router.get("/:id", async (req: Request, res: Response) => {
    const userId = req.currentUser!.id ?? "";
    const { id } = req.params as VideoIdParams;

    const result = await videosService.getVideoById(userId, id);
    if (result.error) {
      res.status(result.error.code).json({ error: result.error.message });
      return;
    }
    res.status(200).json(result.ok);
  });
}
