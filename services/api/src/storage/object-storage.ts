import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl as _getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { env } from "../config/env";
import { logger } from "../config/logger";

/**
 * 对象存储抽象层（Object Storage Abstraction）。
 *
 * ⚠️ 重要设计说明 —— 为什么用 @aws-sdk/client-s3 连 Cloudflare R2：
 *    Cloudflare R2 官方文档明确支持「S3-compatible REST API / XML API」，
 *    也就是说 R2 的 HTTP 接口 + 签名算法（SigV4）+ URL 结构和 AWS S3 是二进制兼容的。
 *    所以业界（rclone / Cyberduck / Prefect / Airflow 等主流工具）统一做法就是复用
 *    AWS S3 SDK，只需要覆盖 endpoint 和 region 两个字段。
 *
 *    为什么不写一个原生 R2 Client？
 *    R2 自身并没有单独的 JS SDK，Cloudflare 官方推荐的就是用 AWS SDK v3，
 *    单独封装 R2-specific client = 重复造轮子，没有任何收益。
 *
 * 本层只做：
 *   ① 单例存储客户端（懒初始化 + 配置分支）
 *   ② 预签名上传/下载 URL
 *   ③ 对某个 key 做 HeadObject（用于 /videos/:id/complete 校验文件是否真的被客户端传上去了，防止伪造）
 *
 * 支持的后端（由 STORAGE_PROVIDER / STORAGE_ENDPOINT 两个 env 自动切换）：
 *   ✅ Cloudflare R2（STORAGE_PROVIDER=r2，生产默认）
 *   ✅ AWS S3（STORAGE_PROVIDER=s3，STORAGE_ENDPOINT 留空，留作未来大规模迁移备选）
 *   ✅ MinIO / LocalStack（本地离线开发，STORAGE_ENDPOINT=http://127.0.0.1:9000）
 *
 * TODO(Storage): 后续需要「服务端上传 / 服务端复制 / 生命周期 / 预签名 POST (multipart 大文件分片上传)」时，
 *                继续在这个文件里加方法，不要散落到各 modules 里。
 */
let storageClient: S3Client | null = null;

export function getStorageClient(): S3Client {
  if (!storageClient) {
    const missing: string[] = [];
    if (!env.STORAGE_ACCESS_KEY_ID) missing.push("STORAGE_ACCESS_KEY_ID");
    if (!env.STORAGE_SECRET_ACCESS_KEY)
      missing.push("STORAGE_SECRET_ACCESS_KEY");
    if (!env.STORAGE_BUCKET_SOURCE) missing.push("STORAGE_BUCKET_SOURCE");
    if (missing.length > 0) {
      logger.warn(
        { provider: env.STORAGE_PROVIDER, missingEnv: missing },
        "Storage credentials not set; presigned URLs will fail at runtime.",
      );
    }

    storageClient = new S3Client({
      region: env.STORAGE_REGION || "auto",
      endpoint: env.STORAGE_ENDPOINT || undefined,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID || "",
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY || "",
      },
      forcePathStyle: !!env.STORAGE_ENDPOINT,
    });
  }
  return storageClient;
}

export interface PresignedUpload {
  url: string;
  key: string;
  method: "PUT";
  expiresInSec: number;
}

/**
 * 给前端/客户端返回一个短期 PUT 预签名 URL。
 * 客户端直接把文件 PUT 到这个 URL，文件完全不经过 Node API，节省带宽和内存。
 * 这就是 requirement.md 第 7 节要求的「Direct Upload」。
 */
export async function createPresignedUpload(
  key: string,
  contentType: string,
  opts?: { contentLength?: number },
): Promise<PresignedUpload> {
  const missing: string[] = [];
  if (!env.STORAGE_ACCESS_KEY_ID) missing.push("STORAGE_ACCESS_KEY_ID");
  if (!env.STORAGE_SECRET_ACCESS_KEY) missing.push("STORAGE_SECRET_ACCESS_KEY");
  if (!env.STORAGE_BUCKET_SOURCE) missing.push("STORAGE_BUCKET_SOURCE");
  if (missing.length > 0) {
    const err = new Error(
      `Storage misconfigured: missing required env ${missing.join(", ")}`,
    ) as Error & { status?: number; expose?: boolean };
    err.status = 500;
    err.expose = true;
    throw err;
  }

  const client = getStorageClient();
  const command = new PutObjectCommand({
    Bucket: env.STORAGE_BUCKET_SOURCE,
    Key: key,
    ContentType: contentType,
    ContentLength: opts?.contentLength,
  });
  const url = await _getSignedUrl(client, command, {
    expiresIn: env.STORAGE_PRESIGNED_UPLOAD_TTL,
  });
  return {
    url,
    key,
    method: "PUT",
    expiresInSec: env.STORAGE_PRESIGNED_UPLOAD_TTL,
  };
}

export interface PresignedDownload {
  url: string;
  key: string;
  expiresInSec: number;
}

export async function createPresignedDownload(
  bucket: "source" | "exports",
  key: string,
): Promise<PresignedDownload> {
  const client = getStorageClient();
  const bucketName =
    bucket === "source"
      ? env.STORAGE_BUCKET_SOURCE
      : env.STORAGE_BUCKET_EXPORTS;
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  const url = await _getSignedUrl(client, command, {
    expiresIn: env.STORAGE_PRESIGNED_DOWNLOAD_TTL,
  });
  return { url, key, expiresInSec: env.STORAGE_PRESIGNED_DOWNLOAD_TTL };
}

/**
 * 检查文件是否真实存在于对象存储里。
 * 用于 POST /videos/:id/complete 防止客户端瞎调接口 / 没传完就 complete。
 * 返回 null 表示文件不存在；返回 object 含 sizeBytes / contentType。
 */
export async function headObject(
  bucket: "source" | "exports",
  key: string,
): Promise<{ sizeBytes: number; contentType: string; etag?: string } | null> {
  const client = getStorageClient();
  const bucketName =
    bucket === "source"
      ? env.STORAGE_BUCKET_SOURCE
      : env.STORAGE_BUCKET_EXPORTS;
  try {
    const cmd = new HeadObjectCommand({ Bucket: bucketName, Key: key });
    const res = await client.send(cmd);
    return {
      sizeBytes: res.ContentLength ?? 0,
      contentType: res.ContentType ?? "application/octet-stream",
      etag: res.ETag,
    };
  } catch (err) {
    const code =
      err && typeof err === "object" && "$metadata" in err
        ? (err as { name?: string }).name
        : String(err);
    if (String(code).includes("NotFound") || String(code).includes("404")) {
      return null;
    }
    logger.error({ err, bucket, key }, "headObject failed");
    throw err;
  }
}

/**
 * 服务端直接把 Buffer / Readable Stream 写进 R2（不走前端 presigned PUT）。
 * 用于 API 本地 trim 完 clip 后直接存到 exports bucket。
 */
export async function putObject(
  bucket: "source" | "exports",
  key: string,
  body: Buffer | Uint8Array | Readable | ReadableStream | string,
  opts?: { contentType?: string; contentLength?: number },
): Promise<{ key: string; etag?: string }> {
  const client = getStorageClient();
  const bucketName =
    bucket === "source"
      ? env.STORAGE_BUCKET_SOURCE
      : env.STORAGE_BUCKET_EXPORTS;
  const cmd = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: opts?.contentType ?? "application/octet-stream",
    ContentLength: opts?.contentLength,
  });
  const res = await client.send(cmd);
  return { key, etag: res.ETag };
}
