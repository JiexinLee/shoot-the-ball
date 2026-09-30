import { z } from "zod";
import { env } from "../../../config/env";
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

type MockableVideo = {
  id: string;
  duration: number | null | undefined;
  status:
    | "UPLOADING"
    | "UPLOADED"
    | "PROCESSING"
    | "ARCHIVED"
    | "PROCESSED"
    | "FAILED";
};

/**
 * 私有工具方法：根据 boolean flag 决定是否给「DB highlights 为空」的视频生成 2-3 条均匀切片假数据。
 *
 *   本方法内部不读取任何 env 配置，开关完全由调用方传入的 useMock: boolean 控制。
 *   → 调用侧（例如 getVideoHighlights）可以根据 env / query 参数 / 业务规则自行计算 useMock。
 *
 * @param video  video 对象（只用 id / duration / status 三个字段）
 * @param currentHighlightCount  调用侧已经查好的 DB 当前 highlights 数量；传 0 才可能触发 mock
 * @param useMock  boolean flag：true 才会做「条件满足就写 DB」，false 直接 return false 跳过
 * @returns true 表示写入了 mock highlights（调用侧应该 re-query DB 再返回给前端），false 表示什么都没做
 */
async function maybeGenerateAndSaveMockHighlights(
  video: MockableVideo,
  currentHighlightCount: number,
  useMock: boolean,
): Promise<boolean> {
  // ① flag 关了 → 立刻跳过，不做任何事
  if (!useMock) return false;
  // ② DB 里已经有 highlights → 不该覆盖，跳过
  if (currentHighlightCount > 0) return false;
  // ③ 状态还没到能看 Review 的程度（还在 UPLOADING / ARCHIVED 之类）也不生成
  const statusOk =
    video.status === "UPLOADED" ||
    video.status === "PROCESSING" ||
    video.status === "PROCESSED" ||
    video.status === "FAILED";
  if (!statusOk) return false;

  const videoId = video.id;
  const duration = (video.duration ?? 60) as number;
  const pre = Number(process.env.AI_DEFAULT_HIGHLIGHT_PRE_SECONDS ?? "5") || 5;
  const post =
    Number(process.env.AI_DEFAULT_HIGHLIGHT_POST_SECONDS ?? "3") || 3;

  type FakeEvent = {
    eventTime: number;
    score: 2 | 3;
    teamSide: "HOME" | "AWAY";
    confidence: number;
    startTime: number;
    endTime: number;
    type: HighlightType;
  };
  const base: Omit<FakeEvent, "startTime" | "endTime">[] = [
    {
      eventTime: Math.max(pre, Math.floor(duration * 0.25)),
      score: 2,
      teamSide: "HOME",
      confidence: 0.9,
      type: "MADE_BASKET",
    },
    {
      eventTime: Math.max(pre + 1, Math.floor(duration * 0.5)),
      score: 3,
      teamSide: "HOME",
      confidence: 0.85,
      type: "THREE_POINTER",
    },
  ];
  // 视频够长（>30s）再加一条客场进球
  if (duration > 30) {
    base.push({
      eventTime: Math.max(pre + 2, Math.floor(duration * 0.78)),
      score: 2,
      teamSide: "AWAY",
      confidence: 0.78,
      type: "MADE_BASKET",
    });
  }
  const evList: FakeEvent[] = base.map((ev) => ({
    ...ev,
    startTime: Math.max(0, ev.eventTime - pre),
    endTime: Math.min(duration, ev.eventTime + post),
  }));

  const inserts: HighlightCreateManyInput[] = evList.map((ev) => ({
    videoId,
    startTime: ev.startTime,
    endTime: ev.endTime,
    eventTime: ev.eventTime,
    confidence: ev.confidence,
    type: ev.type,
    metadata: {
      source: "maybeGenerateAndSaveMockHighlights",
      mock: true,
      score: ev.score,
      teamSide: ev.teamSide,
      label: `Mock ${ev.score}PT ${ev.teamSide} (${Math.round(ev.eventTime)}s)`,
    } as HighlightCreateManyInput["metadata"],
    clipUrl: null,
    clipStorageKey: null,
    thumbnailUrl: null,
  }));

  if (inserts.length === 0) return false;
  await highlightsRepository.softDeleteAndCreateMany(videoId, inserts);
  logger.info(
    { videoId, count: inserts.length, duration, useMock },
    "highlights.generate_mock_saved: wrote fallback highlights",
  );
  return true;
}

/**
 * Fetch active (non-deleted) highlights for a video ordered by eventTime ASC.
 *
 * 是否允许走 mock fallback 由调用侧传入的 useMock boolean 决定（这里我们按 env 计算）。
 * 具体的「生成 + 写 DB」逻辑已经抽到 maybeGenerateAndSaveMockHighlights()，
 * 方便单测 / 其它调用方复用（例如未来按 query 参数 ?mock=1 临时生成）。
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

  // 「env 开关」只在调用侧这里计算，不污染抽离出来的纯逻辑方法
  const useMock: boolean =
    env.APP_ENV === "development" && env.DEV_MOCK_PROCESSING;

  const wroteMock = await maybeGenerateAndSaveMockHighlights(
    video,
    highlights.length,
    useMock,
  );
  if (wroteMock) {
    const after = await highlightsRepository.listActiveByVideoId(videoId);
    return { ok: { highlights: serializeBigInts(after) } };
  }

  return { ok: { highlights: serializeBigInts(highlights) } };
}

export const highlightsService = {
  bulkWriteHighlights,
  getVideoHighlights,
};
