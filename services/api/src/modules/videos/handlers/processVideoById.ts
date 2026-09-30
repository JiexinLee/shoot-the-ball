import type { Request, Response } from "express";
import type { Router } from "express";
import type { VideoIdParams } from "./createUploadSession";
import { processingService } from "../services/processing.service";

/**
 * ④ 让视频进入 AI 分析：创建 ProcessingJob + 入 BullMQ 队列，Python Worker 会消费它。
 *
 *  MVP 早期简化开关 DEV_MOCK_PROCESSING：
 *    true（默认）= 不 enqueue，直接在本请求里把 ProcessingJob 置 READY + 插 3 条假 highlights，
 *                 好处是 API+Web 就跑通全链路，前端 SSE 订阅时立刻 READY 不轮询刷 DB。
 *    false        = 走正常 BullMQ enqueueProcessingJob，需要你手动起 Python ai-worker。
 *  Hard Safety：仅 APP_ENV=development 允许 mock；生产即便开关 true 也强制走真实入队。
 * POST /videos/:id/process
 */
export function registerProcessVideoById(router: Router): void {
  router.post("/:id/process", async (req: Request, res: Response) => {
    const userId = req.currentUser!.id ?? "";
    const { id } = req.params as VideoIdParams;

    const result = await processingService.startProcessing(userId, id);
    if (result.error) {
      res.status(result.error.code).json({ error: result.error.message });
      return;
    }
    const { jobId, mock, status } = result.ok!;
    const body: Record<string, unknown> = { jobId, mock };
    if (status !== undefined) body.status = status;
    res.status(202).json(body);
  });
}
