// ==========================================================================
// lib/api-client.ts — 兼容 bridge（不要新增代码在这里，统一写到 lib/api/* 里）
//   VideoUploader / DropZone 等旧组件从 "@/lib/api-client" import，
//   所以这里直接 re-export 新的 lib/api/* 全部导出，不用改现有组件代码。
//   新代码请直接从 "@/lib/api" import。
// ==========================================================================

export * from "./api";
export { default } from "./api";
