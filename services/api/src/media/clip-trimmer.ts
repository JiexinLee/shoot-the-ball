import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import {
  createPresignedDownload,
  putObject,
} from "../storage/object-storage";
import { logger } from "../config/logger";

export interface TrimResult {
  ok: true;
  clipStorageKey: string;
  sizeBytes: number;
}

export interface TrimError {
  ok: false;
  error: string;
}

function unlinkSafe(p: string): void {
  try {
    void fsPromises.unlink(p);
  } catch {
    /* ignore */
  }
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) {
    throw new Error(
      `downloadToFile failed: HTTP ${resp.status} ${resp.statusText}`,
    );
  }
  const writeStream = fs.createWriteStream(destPath);
  // fetch() 的 ReadableStream 与 node stream.Writeable 兼容（Node 18+）；as any 兜底老版类型
  await pipeline(resp.body as unknown as NodeJS.ReadableStream, writeStream);
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.on("error", (err) => {
      resolve({
        code: -1,
        stderr: `spawn ffmpeg error: ${err.message}`,
      });
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

/**
 * 拉取 source bucket 里的完整原视频 → ffmpeg -c copy 截 [start,end] 短 clip
 * → 存到 exports bucket `clips/<videoId>/<highlightId>.mp4` → 返回 TrimResult。
 *
 * 用 -c copy（无重编码）+ -movflags +faststart（moov atom 前置便于浏览器渐进播放），
 * 一个 4 秒 10MB 原视频 MP4 处理时间 <300ms，几乎瞬间完成。
 */
export async function trimAndUploadClip(opts: {
  videoId: string;
  highlightId: string;
  sourceStorageKey: string;
  startSec: number;
  endSec: number;
}): Promise<TrimResult | TrimError> {
  const { videoId, highlightId, sourceStorageKey, startSec, endSec } = opts;

  if (endSec <= startSec || startSec < 0) {
    return { ok: false, error: `invalid range [${startSec}, ${endSec}]` };
  }

  let srcLocal: string | null = null;
  let outLocal: string | null = null;

  try {
    // 1. 拉源视频 presigned GET URL
    const srcPresigned = await createPresignedDownload(
      "source",
      sourceStorageKey,
    );

    const tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), "stb-clip-"));
    srcLocal = path.join(tmp, `source-${videoId}.mp4`);
    outLocal = path.join(tmp, `clip-${highlightId}.mp4`);
    try {
      await fsPromises.access(tmp);
    } catch {
      await fsPromises.mkdir(tmp, { recursive: true });
    }

    // 2. 下载原视频到本地临时文件
    await downloadToFile(srcPresigned.url, srcLocal);

    // 3. ffmpeg -c copy 截取 [start, end]，faststart 让浏览器马上能播
    const duration = endSec - startSec;
    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(startSec.toFixed(3)),
      "-i",
      srcLocal,
      "-t",
      String(duration.toFixed(3)),
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      "-movflags",
      "+faststart",
      outLocal,
    ];
    const { code, stderr } = await runFfmpeg(ffmpegArgs);
    if (code !== 0) {
      return {
        ok: false,
        error: `ffmpeg exit ${code}: ${(stderr || "").slice(0, 500)}`,
      };
    }
    const stat = await fsPromises.stat(outLocal);
    if (!stat.isFile() || stat.size <= 0) {
      return { ok: false, error: "ffmpeg produced empty output file" };
    }

    // 4. 上传到 exports bucket clips/<videoId>/<hlId>.mp4
    const clipStorageKey = `clips/${videoId}/${highlightId}.mp4`;
    const bodyBuf = await fsPromises.readFile(outLocal);
    await putObject("exports", clipStorageKey, bodyBuf, {
      contentType: "video/mp4",
      contentLength: bodyBuf.length,
    });

    return {
      ok: true,
      clipStorageKey,
      sizeBytes: bodyBuf.length,
    };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : e && typeof e === "object" ? String(e) : "unknown";
    logger.error(
      {
        videoId,
        highlightId,
        startSec,
        endSec,
        err: msg,
      },
      "trimAndUploadClip failed",
    );
    return { ok: false, error: msg };
  } finally {
    if (srcLocal) unlinkSafe(srcLocal);
    if (outLocal) unlinkSafe(outLocal);
  }
}
