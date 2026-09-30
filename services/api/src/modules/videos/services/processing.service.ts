import type { ProcessingJobPayload } from "../../../jobs/handlers";
import { enqueueProcessingJob } from "../../../jobs/queue";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { videosRepository } from "../repositories/videos.repository";
import { processingJobsRepository } from "../repositories/processingJobs.repository";
import {
  highlightsRepository,
  type HighlightCreateManyInput,
} from "../repositories/highlights.repository";
import type { ServiceResult } from "./upload.service";

type StartProcessingOutput = {
  jobId: string;
  mock: boolean;
  status?: string;
};

/**
 * Start AI analysis for a video.
 *
 *  - DEV_MOCK_PROCESSING + development: fast-path, in-request marks ProcessingJob ready + seeds 3 mock highlights,
 *    so frontend SSE subscription sees READY immediately without polling.
 *  - Otherwise: enqueue real BullMQ job for Python ai-worker.
 */
export async function startProcessing(
  userId: string,
  videoId: string,
): Promise<ServiceResult<StartProcessingOutput>> {
  const video = await videosRepository.findByIdAndUserId(videoId, userId);
  if (!video) {
    return { error: { code: 404, message: "Video not found" } };
  }
  if (video.status !== "UPLOADED" && video.status !== "FAILED") {
    return {
      error: {
        code: 409,
        message: `Video is in status ${video.status}, cannot start processing`,
      },
    };
  }

  const useMock = env.APP_ENV === "development" && env.DEV_MOCK_PROCESSING;

  const payload: ProcessingJobPayload = {
    videoId: String(videoId),
    projectId: String(video.projectId),
    userId: String(userId),
  };

  if (useMock) {
    const existing = await processingJobsRepository.findRunningJobByVideoId(
      payload.videoId,
    );
    const jobId =
      existing?.id ??
      (
        await processingJobsRepository.createProcessingJob({
          videoId: payload.videoId,
          projectId: payload.projectId,
          userId: payload.userId,
          status: "UPLOADED",
          progress: 0,
        })
      ).id;

    const now = new Date();
    const done = await processingJobsRepository.updateProcessingJob(jobId, {
      status: "READY",
      stage: "Ready",
      progress: 1,
      startedAt: now,
      completedAt: now,
    });

    const duration = (video.duration ?? 60) as number;
    const pre =
      Number(process.env.AI_DEFAULT_HIGHLIGHT_PRE_SECONDS ?? "5") || 5;
    const post =
      Number(process.env.AI_DEFAULT_HIGHLIGHT_POST_SECONDS ?? "3") || 3;

    type FakeEvent = {
      eventTime: number;
      score: 2 | 3;
      teamSide: "HOME" | "AWAY";
      confidence: number;
      startTime: number;
      endTime: number;
    };
    const baseEvents: Omit<FakeEvent, "startTime" | "endTime">[] = [
      {
        eventTime: Math.max(pre, Math.floor(duration * 0.25)),
        score: 2,
        teamSide: "HOME",
        confidence: 0.92,
      },
      {
        eventTime: Math.max(pre + 1, Math.floor(duration * 0.5)),
        score: 3,
        teamSide: "HOME",
        confidence: 0.86,
      },
      {
        eventTime: Math.max(pre + 2, Math.floor(duration * 0.78)),
        score: 2,
        teamSide: "AWAY",
        confidence: 0.79,
      },
    ];
    const evList: FakeEvent[] = baseEvents.map((ev) => ({
      ...ev,
      startTime: Math.max(0, ev.eventTime - pre),
      endTime: Math.min(duration, ev.eventTime + post),
    }));

    const existHl = await highlightsRepository.countByVideoId(videoId);
    if (existHl === 0) {
      const inserts: Omit<HighlightCreateManyInput, "videoId">[] = evList.map(
        (ev) => ({
          startTime: ev.startTime,
          endTime: ev.endTime,
          eventTime: ev.eventTime,
          confidence: ev.confidence,
          type: "MADE_BASKET",
          metadata: {
            processingJobId: jobId,
            mock: true,
            score: ev.score,
            teamSide: ev.teamSide,
            label: `Mock ${ev.score}PT ${ev.teamSide}`,
          },
        }),
      );
      await highlightsRepository.createInTransaction(videoId, inserts);
    }

    await videosRepository.updateVideo(videoId, { status: "PROCESSED" });

    logger.info(
      {
        videoId,
        jobId,
        highlights: existHl === 0 ? evList.length : `reuse=${existHl}`,
      },
      "videos.process_mock_ready (DEV_MOCK_PROCESSING=true)",
    );

    return { ok: { jobId, mock: true, status: done.status } };
  }

  try {
    const jobId = await enqueueProcessingJob(payload);
    logger.info({ videoId, jobId }, "videos.process_enqueued");
    return { ok: { jobId, mock: false } };
  } catch {
    return {
      error: { code: 500, message: "Failed to enqueue processing job" },
    };
  }
}

export const processingService = {
  startProcessing,
};
