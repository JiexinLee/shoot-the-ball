import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl as _getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "../config/env";
import { logger } from "../config/logger";

/**
 * S3 兼容对象存储封装（Cloudflare R2 / AWS S3 / MinIO / 本地 LocalStack 都能跑）。
 *
 * 本层只做：
 *   ① 单例 S3Client（懒初始化 + 配置兼容）
 *   ② 预签名上传/下载 URL
 *   ③ 对某个 key 做 HeadObject（用于 /videos/:id/complete 校验文件是否真的被客户端传上去了，防止伪造）
 *
 * TODO(Storage): 后续需要「服务端上传 / 服务端复制 / 生命周期 / 预签名 POST (multipart 大文件分片上传)」时，
 *               继续在这个文件里加方法，不要散落到各 modules 里。
 */
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    if (!env.STORAGE_ACCESS_KEY_ID || !env.STORAGE_SECRET_ACCESS_KEY) {
      logger.warn(
        { provider: env.STORAGE_PROVIDER },
        "Storage credentials not set; presigned URLs will fail at runtime.",
      );
    }
    s3Client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT || undefined,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      },
      /**
       * Cloudflare R2 / MinIO / LocalStack 这类 S3 兼容产品都要 forcePathStyle=true，
       * AWS 官方 S3 默认会走 virtual-hosted-style，两种都兼容。
       */
      forcePathStyle: !!env.STORAGE_ENDPOINT,
    });
  }
  return s3Client;
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
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: env.STORAGE_BUCKET_SOURCE,
    Key: key,
    ContentType: contentType,
    // 强烈建议客户端带上 Content-Length，防止故意传超大文件填满 bucket。
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
  const client = getS3Client();
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
  const client = getS3Client();
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
