import type { Request, Response } from "express";
import type { Router } from "express";
import type { VideoIdParams } from "./createUploadSession";
import {
  calibrationSchema,
  calibrationService,
} from "../services/calibration.service";

/**
 * ③ 校准（用户画篮筐 ROI / 球场 ROI）—— 这里先打桩，后续 Phase 接 UI 再完善。
 * 总而言之就是利用ai 做一次检测 检测 人/球/框 在哪里
 * POST /videos/:id/calibration
 */
export function registerCalibrateVideoById(router: Router): void {
  router.post("/:id/calibration", async (req: Request, res: Response) => {
    const userId = req.currentUser!.id ?? "";
    const { id } = req.params as VideoIdParams;
    const parsed = calibrationSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }

    const result = await calibrationService.saveCalibration(
      userId,
      id,
      parsed.data,
    );
    if (result.error) {
      res.status(result.error.code).json({ error: result.error.message });
      return;
    }
    res.status(200).json(result.ok);
  });
}
