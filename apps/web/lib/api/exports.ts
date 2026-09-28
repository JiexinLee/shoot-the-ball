// ==========================================================================
// lib/api/exports.ts
//   Domain: 导出任务（把 highlights 导出为 mp4 下载）
//   对应后端: services/api/src/modules/exports/exports.routes.ts
//   - INDIVIDUAL: 每个 highlight 一个 mp4
//   - MERGE: 所有 highlight 按 eventTime 顺序合成一个 mp4
// ==========================================================================

import type {
  Export,
  CreateExportRequest,
} from "@shoot-the-ball/contracts";
import { http } from "./core";

export const exports_ = {
  /**
   * POST /exports — 创建导出任务，入 BullMQ export queue 异步处理。
   *   返回刚创建的 Export record（status=QUEUED），后续用 getExport 轮询 / SSE 拿状态。
   */
  createExport: (body: CreateExportRequest) =>
    http.post<{ export: Export }>("/exports", { body }),

  /**
   * GET /exports/:id — 导出详情。
   *   当 status === 'EXPORTED' 时 response.downloadUrl 里是预签名下载链接（有时效）。
   */
  getExport: (exportId: string) =>
    http.get<{ export: Export; downloadUrl?: string | null }>(
      `/exports/${exportId}`,
    ),
};

export type { Export, CreateExportRequest };
