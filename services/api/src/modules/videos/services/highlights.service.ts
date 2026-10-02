import { z } from "zod";
import type { Highlight, Video } from "@prisma/client";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { serializeBigInts } from "../../../utils/serialize";
import { createPresignedDownload } from "../../../storage/object-storage";
import { trimAndUploadClip } from "../../../media/clip-trimmer";
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
 * [DEV/MOCK] 私有工具方法：根据 boolean flag 决定是否给视频生成 2-3 条随机位置的假进球切片。
 *
 *   本函数将来会被 **ai-worker** 替换：未来 ai-worker 跑完真实 YOLO / 事件 /
 *   动作识别（进球/三分/助攻/抢断/盖帽），把识别到的每一条真实 eventTime /
 *   startTime / endTime / confidence / metadata 写进 highlights 表，到时候这里
 *   的 mock 逻辑就不会再运行了。
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
  // ② 状态还没到能看 Review 的程度（还在 UPLOADING / ARCHIVED 之类）也不生成
  const statusOk =
    video.status === "UPLOADED" ||
    video.status === "PROCESSING" ||
    video.status === "PROCESSED" ||
    video.status === "FAILED";
  if (!statusOk) return false;

  const videoId = video.id;
  const rawDuration = (video.duration ?? 0) as number;
  const pre = Number(process.env.AI_DEFAULT_HIGHLIGHT_PRE_SECONDS ?? "2") || 2;
  const post =
    Number(process.env.AI_DEFAULT_HIGHLIGHT_POST_SECONDS ?? "2") || 2;
  const minClipDuration = pre + post;
  // rawDuration 可能 null → 用 min(20, 合理最小值) 的 fallback，但永远不要超 20，更不要之前的 60
  const duration =
    rawDuration > 0 ? rawDuration : Math.max(20, minClipDuration + 1);

  type FakeEvent = {
    eventTime: number;
    score: 2 | 3;
    teamSide: "HOME" | "AWAY";
    confidence: number;
    startTime: number;
    endTime: number;
    type: HighlightType;
  };
  const maxEventTime = Math.max(pre + 0.1, duration - post - 0.1);

  // 3 个互不重叠的随机"进球点"：均匀分 3 段，每段内 Math.random()
  // 避免以前固定系数 0.25/0.55/0.8 导致 3 条位置总一样
  function pickBetween(
    minRatio: number,
    maxRatio: number,
    minAbs: number,
    maxAbs: number,
  ): number {
    const lo = Math.max(minAbs, pre + 0.2, duration * minRatio);
    const hi = Math.min(maxAbs, maxEventTime, duration * maxRatio);
    if (hi <= lo) return (lo + hi) / 2;
    return lo + Math.random() * (hi - lo);
  }
  const slot1 = pickBetween(0.08, 0.4, pre + 0.3, duration * 0.4);
  const slot2 = pickBetween(0.42, 0.7, duration * 0.42, duration * 0.7);
  const slot3Enabled = duration > minClipDuration * 3 + 2;
  const slot3 = slot3Enabled
    ? pickBetween(0.72, 0.96, duration * 0.72, maxEventTime)
    : -1;

  const scoreRoll = (): 2 | 3 => (Math.random() < 0.35 ? 3 : 2);
  const teamRoll = (): "HOME" | "AWAY" =>
    Math.random() < 0.5 ? "HOME" : "AWAY";
  const conf = () => 0.75 + Math.random() * 0.2;

  const buildBase = (
    slot: number,
    scoreOverride?: 2 | 3,
    teamOverride?: "HOME" | "AWAY",
  ): Omit<FakeEvent, "startTime" | "endTime"> => {
    const score = scoreOverride ?? scoreRoll();
    const teamSide = teamOverride ?? teamRoll();
    return {
      eventTime: slot,
      score,
      teamSide,
      confidence: conf(),
      type: score === 3 ? "THREE_POINTER" : "MADE_BASKET",
    };
  };

  const base: Omit<FakeEvent, "startTime" | "endTime">[] = [
    buildBase(slot1, 2, "HOME"),
    buildBase(slot2),
  ];
  if (slot3Enabled) base.push(buildBase(slot3));

  const evList: FakeEvent[] = base
    .map((ev) => {
      const startTime = Math.max(0, ev.eventTime - pre);
      const endTime = Math.min(duration, ev.eventTime + post);
      return { ...ev, startTime, endTime };
    })
    .filter((ev) => ev.endTime - ev.startTime >= 0.5);

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

type HighlightWithVideo = Highlight & {
  video: Pick<Video, "id" | "storageKey">;
};

async function ensureClipArtifactsForHighlights(
  video: { id: string; storageKey: string | null },
  rows: Array<{
    id: string;
    startTime: number;
    endTime: number;
    clipStorageKey: string | null;
    clipUrl: string | null;
  }>,
): Promise<void> {
  if (!video.storageKey) return;
  const sourceKey = video.storageKey;
  const needTrims = rows.filter((r) => !r.clipStorageKey);
  // 串行执行，避免 spawn 太多 ffmpeg 子进程打爆 CPU / 带宽
  for (const row of needTrims) {
    const res = await trimAndUploadClip({
      videoId: video.id,
      highlightId: row.id,
      sourceStorageKey: sourceKey,
      startSec: row.startTime,
      endSec: row.endTime,
    });
    if (res.ok) {
      try {
        await highlightsRepository.updateClipArtifacts(row.id, {
          clipStorageKey: res.clipStorageKey,
        });
      } catch (e) {
        logger.error(
          { highlightId: row.id, err: e },
          "ensureClipArtifacts: update clipStorageKey failed",
        );
      }
    } else {
      logger.warn(
        { highlightId: row.id, err: res.error },
        "ensureClipArtifacts: trim failed, skip and will fallback to full video clamp",
      );
    }
  }
}

async function attachPresignedClipUrls(
  rows: HighlightWithVideo[],
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const r: Record<string, unknown> = { ...row };
    if (row.clipStorageKey && !row.clipUrl) {
      try {
        const signed = await createPresignedDownload(
          "exports",
          row.clipStorageKey,
        );
        r.clipUrl = signed.url;
      } catch (e) {
        logger.warn(
          { highlightId: row.id, err: e },
          "attachPresignedClipUrls: sign clipUrl failed, keep null fallback",
        );
        r.clipUrl = row.clipUrl;
      }
    }
    out.push(r);
  }
  return out;
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
  durationHint?: number,
): Promise<ServiceResult<GetVideoHighlightsOutput>> {
  const video = await videosRepository.findByIdAndUserId(videoId, userId);
  if (!video) {
    return { error: { code: 404, message: "Video not found" } };
  }
  // TODO(Review): cursor / limit pagination when highlights >500
  let highlights =
    await highlightsRepository.listActiveWithStorageByVideoId(videoId);

  // 「env 开关」只在调用侧这里计算，不污染抽离出来的纯逻辑方法
  const useMock: boolean =
    env.APP_ENV === "development" && env.DEV_MOCK_PROCESSING;

  // 用户要求 L125-132 原代码保持不动。如果 DB video.duration 是 null/0，
  // 就用前端 probe 传上来的 durationHint 覆盖成真值，
  // 这样 mock 生成比例是按真时长 spread 的，不会 fallback=20 导致 clips 挤在前17秒。
  let mockableVideo: MockableVideo = video;
  if (useMock) {
    const dur: number | null | undefined = video.duration;
    const needsHint = !dur || Number(dur) <= 0 || !Number.isFinite(Number(dur));
    if (
      needsHint &&
      typeof durationHint === "number" &&
      Number.isFinite(durationHint) &&
      durationHint > 0
    ) {
      mockableVideo = { ...video, duration: durationHint };
    }
  }

  const wroteMock = await maybeGenerateAndSaveMockHighlights(
    mockableVideo,
    highlights.length,
    useMock,
  );
  if (wroteMock) {
    highlights =
      await highlightsRepository.listActiveWithStorageByVideoId(videoId);
  }

  try {
    await ensureClipArtifactsForHighlights(
      { id: video.id, storageKey: video.storageKey ?? null },
      highlights.map((h) => ({
        id: h.id,
        startTime: h.startTime,
        endTime: h.endTime,
        clipStorageKey: h.clipStorageKey,
        clipUrl: h.clipUrl,
      })),
    );
    // 重新拿一次 DB 最新 clipStorageKey
    highlights =
      await highlightsRepository.listActiveWithStorageByVideoId(videoId);
  } catch (e) {
    logger.error(
      { videoId, err: e },
      "getVideoHighlights: ensureClipArtifacts failed, continue without clip artifacts",
    );
  }

  const withUrls = await attachPresignedClipUrls(
    highlights as HighlightWithVideo[],
  );
  return { ok: { highlights: serializeBigInts(withUrls) } };
}

export const highlightsService = {
  bulkWriteHighlights,
  getVideoHighlights,
};
