// ==========================================================================
// lib/api/index.ts — 公共入口
//   两种用法二选一（推荐新代码用法 1，类型更清晰）：
//
//     用法 1 — facade（推荐）:
//       import { api } from '@/lib/api';
//       await api.videos.getVideo('v_xxx');
//       const unsub = api.jobs.subscribeJobEvents('job_xxx', { onProgress, onCompleted, onFailed });
//
//     用法 2 — 按需单独 import（或 VideoUploader 兼容旧命名）:
//       import { ACCEPTED_MIME, MAX_UPLOAD_BYTES, createUploadSession, uploadToPresignedUrl, ... } from '@/lib/api';
//
//   想加新领域模块（例如 projects、auth）：
//     1. 新建 lib/api/projects.ts，只 import { http } from './core'，单向依赖
//     2. 在这里 re-export + 加进 api 常量
//   所有模块之间禁止互相 import（除了 upload.ts 的兼容层可以 import videos/jobs），
//   避免出现领域模块循环依赖。
// ==========================================================================

export * from "./core";
export * from "./videos";
export * from "./jobs";
export * from "./highlights";
export * from "./exports";
export * from "./upload";

import { health } from "./core";
import { videos } from "./videos";
import { jobs } from "./jobs";
import { highlights } from "./highlights";
import { exports_ } from "./exports";
import { setAuthToken, ApiError } from "./core";

export const api = {
  health,
  videos,
  jobs,
  highlights,
  exports: exports_,
  setAuthToken,
  ApiError,
};

export default api;
