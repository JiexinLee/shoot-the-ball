import { spawn } from "node:child_process";
import {
  createWriteStream,
  mkdtempSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MONOREPO_ROOT = resolve(__dirname, "../../../../..");
const AI_WORKER_DIR = resolve(MONOREPO_ROOT, "services/ai-worker");
const DETECT_PY = resolve(AI_WORKER_DIR, "detect.py");

type DetectParams = {
  classes: string;
  conf: number;
  sampleEvery: number;
  model: string;
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const fileField = formData.get("video");
  if (!fileField || !(fileField instanceof File)) {
    return Response.json(
      { error: "Missing 'video' file field" },
      { status: 400 },
    );
  }
  const videoFile = fileField as File;

  const params = parseParams(formData);
  if (params instanceof Response) return params;

  const tmpDir = mkdtempSync(join(tmpdir(), "stb-detect-"));
  const tmpVideoPath = join(tmpDir, `input${extFromName(videoFile.name)}`);
  const tmpOutputPath = join(tmpDir, "detections.json");

  try {
    const nodeStream = Readable.fromWeb(
      videoFile.stream() as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    await pipeline(nodeStream, createWriteStream(tmpVideoPath));

    const result = await runDetect({
      videoPath: tmpVideoPath,
      outputPath: tmpOutputPath,
      params,
    });

    return Response.json({
      ok: true,
      detections: result.detections,
      meta: result.meta,
    });
  } catch (error) {
    console.error("[detect API] failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  } finally {
    if (existsSync(tmpDir)) {
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function parseParams(formData: FormData): DetectParams | Response {
  const classes = (formData.get("classes") as string | null) ?? "person";
  const confRaw = formData.get("conf") as string | null;
  const sampleEveryRaw = formData.get("sampleEvery") as string | null;
  const model = (formData.get("model") as string | null) ?? "yolov8n.pt";

  const conf = confRaw ? Number(confRaw) : 0.25;
  const sampleEvery = sampleEveryRaw ? Number(sampleEveryRaw) : 5;

  if (!Number.isFinite(conf) || conf < 0.001 || conf > 1) {
    return Response.json(
      { error: "conf must be between 0.001 and 1" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(sampleEvery) || sampleEvery < 1 || sampleEvery > 1000) {
    return Response.json(
      { error: "sampleEvery must be integer 1..1000" },
      { status: 400 },
    );
  }

  return { classes, conf, sampleEvery, model };
}

function extFromName(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx) : ".mp4";
}

type RunResult = {
  detections: Array<{
    time: number;
    x: number;
    y: number;
    w: number;
    h: number;
    class: number;
    label: string;
    confidence: number;
  }>;
  meta: {
    stderr: string;
  };
};

function runDetect(opts: {
  videoPath: string;
  outputPath: string;
  params: DetectParams;
}): Promise<RunResult> {
  const { videoPath, outputPath, params } = opts;

  if (!existsSync(DETECT_PY)) {
    return Promise.reject(new Error(`detect.py not found at ${DETECT_PY}`));
  }

  const args = [
    "run",
    "python",
    DETECT_PY,
    "-i",
    videoPath,
    "--classes",
    params.classes,
    "--conf",
    String(params.conf),
    "--sample-every",
    String(params.sampleEvery),
    "--model",
    params.model,
    "-o",
    outputPath,
  ];

  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`[detect API] spawning: poetry ${args.join(" ")}`);

    const child = spawn("poetry", args, {
      cwd: AI_WORKER_DIR,
      env: { ...process.env },
    });

    let stderrBuf = "";
    child.stderr.on("data", (chunk) => {
      const s = String(chunk);
      stderrBuf += s;
      process.stderr.write(s);
    });
    let stdoutBuf = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuf += String(chunk);
    });

    child.on("error", (err) => {
      rejectPromise(
        new Error(
          `Failed to spawn poetry: ${err.message}. stderr=${stderrBuf}`,
        ),
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        return rejectPromise(
          new Error(
            `detect.py exited with code ${code}. Last stderr tail:\n` +
              tail(stderrBuf, 3000) +
              (stdoutBuf ? `\nstdout tail:\n${tail(stdoutBuf, 1500)}` : ""),
          ),
        );
      }
      try {
        if (!existsSync(outputPath)) {
          return rejectPromise(
            new Error(
              `detect.py did not produce output file at ${outputPath}. stderr tail:\n` +
                tail(stderrBuf, 3000),
            ),
          );
        }
        const raw = readFileSync(outputPath, "utf-8");
        const detections = JSON.parse(raw);
        resolvePromise({ detections, meta: { stderr: stderrBuf } });
      } catch (err) {
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

function tail(s: string, n: number): string {
  return s.length > n ? s.slice(s.length - n) : s;
}
