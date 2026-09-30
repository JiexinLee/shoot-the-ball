import { env } from "../../config/env";

/**
 * 构建最终的 sourceUrl。
 *   - 如果已经有 STORAGE_ENDPOINT（比如 R2）则拼完整 URL 方便直接下载/调试；
 *   - 否则就用 s3://bucket/key 这种协议路径，后续 worker 自己按 s3 client 去解析。
 */
export function buildSourceUrl(bucket: string, key: string): string {
  if (env.STORAGE_ENDPOINT) {
    const ep = env.STORAGE_ENDPOINT.replace(/\/$/, "");
    return `${ep}/${bucket}/${key}`;
  }
  return `s3://${bucket}/${key}`;
}
