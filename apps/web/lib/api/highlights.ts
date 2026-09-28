// ==========================================================================
// lib/api/highlights.ts
//   Domain: 单个高光片段（Highlight）的编辑 + 软删除
//   对应后端: services/api/src/modules/highlights/highlights.routes.ts
// ==========================================================================

import type {
  Highlight,
  UpdateHighlightRequest,
} from "@shoot-the-ball/contracts";
import { http } from "./core";

export const highlights = {
  /** GET /highlights/:id — 拉单个 highlight（含 video 信息）；一般用 videos.listHighlights 批量即可 */
  getHighlight: (highlightId: string) =>
    http.get<{ highlight: Highlight }>(`/highlights/${highlightId}`),

  /**
   * PATCH /highlights/:id — 用户手动编辑：
   *   - startTime / endTime: 秒（裁剪 clip 范围）
   *   - userStatus: 'PENDING' | 'APPROVED' | 'REJECTED'（Review 页审核）
   */
  updateHighlight: (highlightId: string, body: UpdateHighlightRequest) =>
    http.patch<{ highlight: Highlight }>(`/highlights/${highlightId}`, {
      body,
    }),

  /**
   * DELETE /highlights/:id — 软删除（DB 里 deleted=true，不是真的删行）。
   *   后续 listHighlights 会自动过滤 deleted=true 的行。
   */
  deleteHighlight: (highlightId: string) =>
    http.delete<void>(`/highlights/${highlightId}`),
};

export type { Highlight, UpdateHighlightRequest };
