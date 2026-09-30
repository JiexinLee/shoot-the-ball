import path from "node:path";
import { z } from "zod";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import {
  createPresignedUpload,
  headObject,
} from "../../../storage/object-storage";
import { serializeBigInts } from "../../../utils/serialize";
import { projectsRepository } from "../repositories/projects.repository";
import { videosRepository } from "../repositories/videos.repository";
import { buildSourceUrl } from "../videos.utils";

export type ServiceResult<T> = {
  ok?: T;
  error?: { code: number; message: string };
};

// =============== request schemas ===============
export const uploadSessionSchema = z.object({
  projectId: z.string().min(1).max(64),
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((s) => {
      const ext = path.extname(s).toLowerCase();
      return [".mp4", ".mov", ".mkv", ".m4v", ".webm", ".avi"].includes(ext);
    }, "Unsupported video extension (allowed: mp4 / mov / mkv / m4v / webm / avi)"),
  contentType: z
    .string()
    .min(1)
    .refine(
      (s) => s.startsWith("video/"),
      "Content-Type must start with video/",
    ),
  size: z
    .number()
    .int()
    .positive()
    .max(16 * 1024 * 1024 * 1024, "单个视频最大 16 GB"),
});

export const completeUploadSchema = z.object({
  duration: z
    .number()
    .positive()
    .max(12 * 60 * 60)
    .optional(),
  width: z.number().int().positive().max(8192).optional(),
  height: z.number().int().positive().max(8192).optional(),
  fps: z.number().positive().max(240).optional(),
});

// =============== service methods ===============

type UploadSessionOutput = {
  videoId: string;
  storageKey: string;
  uploadUrl: string;
  uploadMethod: string;
  uploadExpiresInSec: number;
};

/**
 * Create upload session: validate project, generate storage key + presigned PUT URL (or mock),
 * create UPLOADING video row.
 */
export async function createUploadSession(
  userId: string,
  input: z.infer<typeof uploadSessionSchema>,
): Promise<ServiceResult<UploadSessionOutput>> {
  const { projectId, filename, contentType, size } = input;

  const project = await projectsRepository.findByIdAndUserId(projectId, userId);
  if (!project) {
    return { error: { code: 404, message: "Project not found" } };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeFilename = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const storageKey = `videos/${projectId}/${ts}-${Math.random().toString(36).slice(2, 8)}-${safeFilename}`;

  let uploadUrl: string;
  let uploadMethod = "PUT";
  let uploadExpiresInSec: number;

  if (env.DEV_MOCK_STORAGE) {
    uploadUrl = `mock://dev-storage/${storageKey}`;
    uploadExpiresInSec = Number.MAX_SAFE_INTEGER;
    logger.warn(
      { videoId: "pending", key: storageKey },
      "DEV_MOCK_STORAGE=true: returning mock uploadUrl (no real R2 call)",
    );
  } else {
    const signed = await createPresignedUpload(storageKey, contentType, {
      contentLength: size,
    });
    uploadUrl = signed.url;
    uploadMethod = signed.method;
    uploadExpiresInSec = signed.expiresInSec;
  }

  const video = await videosRepository.createVideo({
    projectId,
    userId,
    title: safeFilename,
    filename: safeFilename,
    storageKey,
    contentType,
    sizeBytes: BigInt(size),
    status: "UPLOADING",
  });

  logger.info(
    {
      videoId: video.id,
      projectId,
      sizeBytes: size,
      key: storageKey,
      mock: env.DEV_MOCK_STORAGE,
    },
    "videos.upload_session_created",
  );

  return {
    ok: {
      videoId: video.id,
      storageKey,
      uploadUrl,
      uploadMethod,
      uploadExpiresInSec,
    },
  };
}

type CompleteUploadOutput = {
  video: ReturnType<typeof serializeBigInts>;
};

/**
 * Complete upload: headObject (or mock) to confirm file exists, write metadata, transition to UPLOADED.
 */
export async function completeUpload(
  userId: string,
  videoId: string,
  input: z.infer<typeof completeUploadSchema>,
): Promise<ServiceResult<CompleteUploadOutput>> {
  const video = await videosRepository.findByIdAndUserId(videoId, userId);
  if (!video) {
    return { error: { code: 404, message: "Video not found" } };
  }

  let realSizeBytes: bigint;
  if (env.DEV_MOCK_STORAGE) {
    realSizeBytes = video.sizeBytes;
    logger.warn(
      { videoId, declaredSizeBytes: video.sizeBytes.toString() },
      "DEV_MOCK_STORAGE=true: skipping headObject check, trusting declared sizeBytes",
    );
  } else {
    const obj = await headObject("source", video.storageKey);
    if (!obj) {
      return {
        error: {
          code: 409,
          message:
            "Object not found in storage. Upload to presigned URL first.",
        },
      };
    }
    realSizeBytes = BigInt(obj.sizeBytes);
  }

  const updated = await videosRepository.updateVideo(videoId, {
    status: "UPLOADED",
    duration: input.duration,
    width: input.width,
    height: input.height,
    fps: input.fps,
    sizeBytes: realSizeBytes,
    sourceUrl: buildSourceUrl(env.STORAGE_BUCKET_SOURCE, video.storageKey),
  });

  logger.info(
    {
      videoId,
      sizeBytes: realSizeBytes.toString(),
      duration: input.duration,
      mock: env.DEV_MOCK_STORAGE,
    },
    "videos.upload_completed",
  );

  return { ok: { video: serializeBigInts(updated) } };
}

export const uploadService = {
  createUploadSession,
  completeUpload,
};
