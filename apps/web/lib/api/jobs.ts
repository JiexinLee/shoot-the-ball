// ==========================================================================
// lib/api/jobs.ts
//   Domain: AI 处理任务（ProcessingJob）
//   对应后端: services/api/src/modules/jobs/jobs.routes.ts
//   - getJob: 一次性拉 job 状态快照
//   - subscribeJobEvents: SSE 长连接订阅进度；EventSource 自带自动重连（~3s）；
//     返回 unsubscribe()，组件 unmount / 页面切换时必须调。
// ==========================================================================

import type { ProcessingJob } from "@shoot-the-ball/contracts";
import { DEFAULT_BASE_URL, http, getAuthToken } from "./core";

export type JobProgressEvent = {
  jobId: string;
  stage: string;
  progress: number;
};

export type JobCompletedEvent = {
  jobId: string;
  status: "READY" | "EXPORTED" | string;
};

export type JobFailedEvent = {
  jobId: string;
  error: string;
};

export type JobEventHandlers = {
  onProgress?: (evt: JobProgressEvent) => void;
  onCompleted?: (evt: JobCompletedEvent) => void;
  onFailed?: (evt: JobFailedEvent) => void;
};

export const jobs = {
  /** GET /jobs/:id — 一次性拉 job 状态快照 */
  getJob: (jobId: string) => http.get<{ job: ProcessingJob }>(`/jobs/${jobId}`),

  /**
   * GET /jobs/:id/events — SSE 长连接订阅进度。
   * 返回 unsubscribe 函数，组件 useEffect cleanup 调它即可 EventSource.close() 防内存泄漏。
   */
  subscribeJobEvents: (
    jobId: string,
    handlers: JobEventHandlers,
  ): (() => void) => {
    const base = DEFAULT_BASE_URL.startsWith("/")
      ? DEFAULT_BASE_URL
      : DEFAULT_BASE_URL;
    const url = new URL(
      `${base}/jobs/${encodeURIComponent(jobId)}/events`,
      typeof window === "undefined"
        ? "http://127.0.0.1"
        : window.location.origin,
    );
    const token = getAuthToken();
    if (token) {
      url.searchParams.set("token", token);
    }
    const es = new EventSource(url.toString(), { withCredentials: true });

    es.addEventListener("progress", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as JobProgressEvent;
        handlers.onProgress?.(data);
      } catch {
        /* ignore parse error */
      }
    });

    es.addEventListener("completed", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as JobCompletedEvent;
        handlers.onCompleted?.(data);
      } catch {
        /* ignore */
      } finally {
        es.close();
      }
    });

    es.addEventListener("failed", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as JobFailedEvent;
        handlers.onFailed?.(data);
      } catch {
        /* ignore */
      } finally {
        es.close();
      }
    });

    es.addEventListener("heartbeat", () => {
      /* keep-alive; no-op */
    });

    return () => {
      es.close();
    };
  },
};

export type { ProcessingJob };
