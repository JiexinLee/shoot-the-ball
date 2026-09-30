import { z } from "zod";
import { logger } from "../../../config/logger";
import { serializeBigInts } from "../../../utils/serialize";
import { videosRepository } from "../repositories/videos.repository";
import type { ServiceResult } from "./upload.service";

export const calibrationSchema = z.object({
  hoopRoi: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  courtRoi: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .nullable(),
});

type SaveCalibrationOutput = {
  video: ReturnType<typeof serializeBigInts>;
};

/**
 * Save hoop / court ROI calibration for a video.
 * TODO(Calibration): feed calibration into ProcessingJob input so Pipeline.prepare can skip auto hoop detect.
 */
export async function saveCalibration(
  userId: string,
  videoId: string,
  input: z.infer<typeof calibrationSchema>,
): Promise<ServiceResult<SaveCalibrationOutput>> {
  const video = await videosRepository.findByIdAndUserId(videoId, userId);
  if (!video) {
    return { error: { code: 404, message: "Video not found" } };
  }

  const updated = await videosRepository.updateVideo(videoId, {
    calibration: {
      hoopRoi: input.hoopRoi,
      courtRoi: input.courtRoi ?? null,
    },
  });

  logger.info({ videoId }, "videos.calibration_saved");
  return { ok: { video: serializeBigInts(updated) } };
}

export const calibrationService = {
  saveCalibration,
};
