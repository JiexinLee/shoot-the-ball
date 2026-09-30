import { z } from "zod";
import { logger } from "../../../config/logger";
import { serializeBigInts } from "../../../utils/serialize";
import { videosRepository } from "../repositories/videos.repository";
import {
  highlightsRepository,
  type HighlightCreateManyInput,
} from "../repositories/highlights.repository";
import type { ServiceResult } from "./upload.service";

export const HIGHLIGHT_TYPES = [
  "MADE_BASKET",
  "THREE_POINTER",
  "ASSIST",
  "STEAL",
  "BLOCK",
  "REBOUND",
  "OTHER",
] as const;

export type HighlightType = (typeof HIGHLIGHT_TYPES)[number];

export const bulkHighlightItemSchema = z.object({
  startTime: z.number().min(0),
  endTime: z.number().positive(),
  eventTime: z.number().min(0),
  confidence: z.number().min(0).max(1),
  type: z.enum(HIGHLIGHT_TYPES),
  components: z.record(z.string(), z.number()).optional(),
  metadata: z.record(z.unknown()).optional(),
  clipUrl: z.string().optional().nullable(),
  clipStorageKey: z.string().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
});

const INTERNAL_USER_ID = "user_internal_ai_worker";

type BulkWriteHighlightsOutput = { inserted: number; videoId: string };

/**
 * Bulk write highlights from ai-worker (or owner user).
 * Performs soft-delete + createMany inside a txn.
 */
export async function bulkWriteHighlights(
  userId: string,
  videoId: string,
  items: z.infer<typeof bulkHighlightItemSchema>[],
): Promise<ServiceResult<BulkWriteHighlightsOutput>> {
  const isInternalCall = userId === INTERNAL_USER_ID;
  const video = isInternalCall
    ? await videosRepository.findById(videoId)
    : await videosRepository.findByIdAndUserId(videoId, userId);

  if (!video) {
    return { error: { code: 404, message: "Video not found" } };
  }

  const toInsert: HighlightCreateManyInput[] = items.map((h) => ({
    videoId: String(videoId),
    startTime: h.startTime,
    endTime: h.endTime,
    eventTime: h.eventTime,
    confidence: h.confidence,
    type: h.type as HighlightType,
    metadata: (h.metadata ??
      h.components) as HighlightCreateManyInput["metadata"],
    clipUrl: h.clipUrl ?? null,
    clipStorageKey: h.clipStorageKey ?? null,
    thumbnailUrl: h.thumbnailUrl ?? null,
  }));

  await highlightsRepository.softDeleteAndCreateMany(videoId, toInsert);

  logger.info(
    { videoId, count: toInsert.length, internal: isInternalCall },
    "videos.highlights_bulk_written",
  );
  return { ok: { inserted: toInsert.length, videoId } };
}

type GetVideoHighlightsOutput = {
  highlights: ReturnType<typeof serializeBigInts>;
};

/**
 * Fetch active (non-deleted) highlights for a video ordered by eventTime ASC.
 */
export async function getVideoHighlights(
  userId: string,
  videoId: string,
): Promise<ServiceResult<GetVideoHighlightsOutput>> {
  const video = await videosRepository.findByIdAndUserId(videoId, userId);
  if (!video) {
    return { error: { code: 404, message: "Video not found" } };
  }
  // TODO(Review): cursor / limit pagination when highlights >500
  const highlights = await highlightsRepository.listActiveByVideoId(videoId);
  return { ok: { highlights: serializeBigInts(highlights) } };
}

export const highlightsService = {
  bulkWriteHighlights,
  getVideoHighlights,
};
