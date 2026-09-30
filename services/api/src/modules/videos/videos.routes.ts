import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware";
import { registerCreateUploadSession } from "./handlers/createUploadSession";
import { registerCompleteUploadById } from "./handlers/completeUploadById";
import { registerCalibrateVideoById } from "./handlers/calibrateVideoById";
import { registerProcessVideoById } from "./handlers/processVideoById";
import { registerBulkWriteHighlightsById } from "./handlers/bulkWriteHighlightsById";
import { registerGetVideoHighlightsById } from "./handlers/getVideoHighlightsById";
import { registerGetVideoById } from "./handlers/getVideoById";

/**
 * 视频上传 + 处理模块。
 *
 * 按 requirements/1.0/requirement.md 第 6 / 7 节的 API 约定实现：
 *   1) POST /videos/upload-session — 创建 Video 记录 + 返回预签名 PUT URL
 *   2) POST /videos/:id/complete     — 客户端传完了，通知 API 校验 + 写入 metadata
 *   3) POST /videos/:id/calibration  — （TODO 后续）用户在 UI 里框了 hoop ROI / court ROI
 *   4) POST /videos/:id/process      — 把视频扔进 Redis 队列，ai-worker 消费后会跑 pipeline
 *   5) POST /videos/:id/highlights/bulk — ai-worker 内部回调：批量写入识别出来的 highlights
 *   6) GET  /videos/:id/highlights   — 前端 Review 页面拉取 highlights 列表
 *   7) GET  /videos/:id              — 拉视频详情 + 当前 processingJob 状态 + 下载源视频签名 URL
 *
 * 本阶段（Phase 1 Backend Skeleton）只实现上面 1/2/4/5/6/7。
 * calibration、删除视频、分页列表等都打上 TODO 注释，后面 Phase 再补。
 */
export const videosRouter = Router();
videosRouter.use(requireAuth);

registerCreateUploadSession(videosRouter);
registerCompleteUploadById(videosRouter);
registerCalibrateVideoById(videosRouter);
registerProcessVideoById(videosRouter);
registerBulkWriteHighlightsById(videosRouter);
registerGetVideoHighlightsById(videosRouter);
registerGetVideoById(videosRouter);

// TODO(Videos):
//   - GET  /videos           — 项目下视频分页列表
//   - PATCH /videos/:id      — 修改 title / 等元信息
//   - DELETE /videos/:id     — 软删除（VideoStatus.ARCHIVED）+ 后续生命周期触发对象存储删文件
//   - POST  /videos/:id/reprocess — 手动重新跑一遍 AI 分析（同 /process，但允许 status=PROCESSED 时重跑）
