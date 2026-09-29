import { z } from 'zod';

export const VideoStatusSchema = z.enum([
  'UPLOADING',
  'UPLOADED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'ARCHIVED',
]);
export type VideoStatus = z.infer<typeof VideoStatusSchema>;

export const RoiSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Roi = z.infer<typeof RoiSchema>;

export const VideoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  title: z.string(),
  filename: z.string(),
  storageKey: z.string(),
  contentType: z.string(),
  sizeBytes: z.bigint().or(z.number()),
  duration: z.number().optional().nullable(),
  width: z.number().int().optional().nullable(),
  height: z.number().int().optional().nullable(),
  fps: z.number().optional().nullable(),
  status: VideoStatusSchema,
  sourceUrl: z.string().optional().nullable(),
  calibration: z
    .object({
      hoopRoi: RoiSchema,
      courtRoi: RoiSchema.optional().nullable(),
    })
    .optional()
    .nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Video = z.infer<typeof VideoSchema>;

export const UploadSessionRequestSchema = z.object({
  projectId: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
});
export type UploadSessionRequest = z.infer<typeof UploadSessionRequestSchema>;

export const UploadSessionResponseSchema = z.object({
  videoId: z.string(),
  storageKey: z.string(),
  uploadUrl: z.string(),
  /** 预签名 URL 的 HTTP 方法（绝大多数 S3/R2 都是 PUT） */
  uploadMethod: z.enum(["PUT", "POST"]).default("PUT"),
  /** 预签名 URL 失效秒数，前端可以在卡上传超时时提示重新生成 session */
  uploadExpiresInSec: z.number().int().positive(),
});
export type UploadSessionResponse = z.infer<typeof UploadSessionResponseSchema>;

export const CompleteUploadRequestSchema = z.object({
  duration: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

export const CalibrationRequestSchema = z.object({
  hoopRoi: RoiSchema,
  courtRoi: RoiSchema.optional().nullable(),
});
export type CalibrationRequest = z.infer<typeof CalibrationRequestSchema>;

export const VideoResponseSchema = z.object({ video: VideoSchema });
export const HighlightsListResponseSchema = z.object({
  highlights: z.array(z.unknown()),
});
