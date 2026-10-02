// ==========================================================================
// lib/api/videos.ts
//   Domain: 视频上传 + 处理 + calibration + highlights 查询
//   对应后端: services/api/src/modules/videos/videos.routes.ts
// ==========================================================================

import type {
  UploadSessionRequest,
  UploadSessionResponse,
  CompleteUploadRequest,
  Video,
  Highlight,
  ProcessingJob,
  ProcessVideoResponse,
} from "@shoot-the-ball/contracts";
import { http } from "./core";

export type RoiRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CalibrationInput = {
  hoopRoi: RoiRect;
  courtRoi?: RoiRect | null;
};

export const videos = {
  /** POST /videos/upload-session — 创建 Video 记录 + 返回预签名 PUT URL */
  createUploadSession: (body: UploadSessionRequest) =>
    http.post<UploadSessionResponse>("/videos/upload-session", { body }),

  /** POST /videos/:id/complete — 通知 API 云端文件已落盘 + 写入 metadata */
  completeUpload: (videoId: string, body: CompleteUploadRequest) =>
    http.post<{ video: Video }>(`/videos/${videoId}/complete`, { body }),

  /** POST /videos/:id/calibration — 保存 hoop / court ROI 标注（用户手动或 AI auto 之后微调） */
  saveCalibration: (videoId: string, body: CalibrationInput) =>
    http.post<{ video: Video }>(`/videos/${videoId}/calibration`, { body }),

  /** POST /videos/:id/process — 创建 ProcessingJob + 入 BullMQ 队列，返回 jobId */
  triggerProcess: (videoId: string) =>
    http.post<ProcessVideoResponse>(`/videos/${videoId}/process`),

  /** GET /videos/:id — 视频详情 + 当前 processingJob + 源视频签名下载 URL */
  getVideo: (videoId: string) =>
    http.get<{
      video: Video & { processingJob?: ProcessingJob | null };
      downloadUrl?: string | null;
    }>(`/videos/${videoId}`),

  /** GET /videos/:id/highlights — Review 页面拉 highlights 列表（eventTime 升序）
   *  可选 durationHint: 前端本地 probe 到的视频真实秒数，DEV mock 生成 highlights 时如果 DB Video.duration 为空，
   *  就用这个 hint 作为时长基准，防止 fallback=20 把 clips 挤在前 17s。
   */
  listHighlights: (videoId: string, opts?: { durationHint?: number }) => {
    const qs = new URLSearchParams();
    if (
      typeof opts?.durationHint === "number" &&
      Number.isFinite(opts.durationHint) &&
      opts.durationHint > 0
    ) {
      qs.set("durationHint", String(opts.durationHint));
    }
    const qsStr = qs.toString();
    const url = qsStr
      ? `/videos/${videoId}/highlights?${qsStr}`
      : `/videos/${videoId}/highlights`;
    return http.get<{ highlights: Highlight[] }>(url);
  },
};

export type {
  UploadSessionRequest,
  UploadSessionResponse,
  CompleteUploadRequest,
  Video,
  Highlight,
  ProcessingJob,
  ProcessVideoResponse,
};
