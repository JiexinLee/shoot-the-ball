import type { Request, Response } from "express";
import type { Router } from "express";
import { uploadSessionSchema, uploadService } from "../services/upload.service";

type VideoIdParams = { id: string };

/**
 * ① 申请上传 session：拿预签名 PUT URL，同时在 DB 里建一条 UPLOADING 状态的 Video 记录
 * POST /videos/upload-session
 */
export function registerCreateUploadSession(router: Router): void {
  router.post("/upload-session", async (req: Request, res: Response) => {
    const userId = req.currentUser!.id ?? "";
    const parsed = uploadSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }

    const result = await uploadService.createUploadSession(userId, parsed.data);
    if (result.error) {
      res.status(result.error.code).json({ error: result.error.message });
      return;
    }
    res.status(201).json(result.ok);
  });
}

export type { VideoIdParams };
