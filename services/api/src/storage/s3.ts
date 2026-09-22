import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as _getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { logger } from '../config/logger';

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT || undefined,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      },
      forcePathStyle: !!env.STORAGE_ENDPOINT,
    });
  }
  return s3Client;
}

export async function generateUploadUrl(
  key: string,
  contentType: string,
): Promise<{ url: string; key: string }> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: env.STORAGE_BUCKET_SOURCE,
    Key: key,
    ContentType: contentType,
  });
  const url = await _getSignedUrl(client, command, {
    expiresIn: env.STORAGE_PRESIGNED_UPLOAD_TTL,
  });
  logger.debug({ key }, 'Generated presigned upload URL');
  return { url, key };
}

export async function generateDownloadUrl(
  bucket: string,
  key: string,
): Promise<{ url: string; key: string }> {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  const url = await _getSignedUrl(client, command, {
    expiresIn: env.STORAGE_PRESIGNED_DOWNLOAD_TTL,
  });
  return { url, key };
}
