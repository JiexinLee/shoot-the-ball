import type { Request, Response } from "express";
import type { Router } from "express";
import type { VideoIdParams } from "./createUploadSession";
import {
  completeUploadSchema,
  uploadService,
} from "../services/upload.service";

/**
 * ② 客户端传完了 → 校验文件真实存在 → 写入 metadata → status=UPLOADED
 * POST /videos/:id/complete
 */
export function registerCompleteUploadById(router: Router): void {
  router.post("/:id/complete", async (req: Request, res: Response) => {
    const userId = req.currentUser!.id ?? "";
    const { id } = req.params as VideoIdParams;
    const parsed = completeUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }

    const result = await uploadService.completeUpload(userId, id, parsed.data);
    if (result.error) {
      res.status(result.error.code).json({ error: result.error.message });
      return;
    }
    res.status(200).json(result.ok);
  });
}
