import { logger } from "../../../config/logger";
import { createPresignedDownload } from "../../../storage/object-storage";
import { serializeBigInts } from "../../../utils/serialize";
import { videosRepository } from "../repositories/videos.repository";
import type { ServiceResult } from "./upload.service";

type GetVideoByIdOutput = {
  video: ReturnType<typeof serializeBigInts>;
  downloadUrl: string | null;
};

/**
 * Get video detail: metadata + latest processingJob + short-lived source download URL.
 */
export async function getVideoById(
  userId: string,
  videoId: string,
): Promise<ServiceResult<GetVideoByIdOutput>> {
  const video = await videosRepository.findByIdWithProcessingJob(
    videoId,
    userId,
  );
  if (!video) {
    return { error: { code: 404, message: "Video not found" } };
  }

  let downloadUrl: string | null = null;
  try {
    const d = await createPresignedDownload("source", video.storageKey);
    downloadUrl = d.url;
  } catch (err) {
    logger.warn(
      { err, videoId },
      "Failed to generate presigned download for source video",
    );
  }

  return {
    ok: { video: serializeBigInts(video), downloadUrl },
  };
}

export const videosService = {
  getVideoById,
};
