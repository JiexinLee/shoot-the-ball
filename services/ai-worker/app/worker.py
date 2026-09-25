from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from pathlib import Path

import httpx
import redis
from rq import Queue, Worker, get_current_job

from app.config import get_settings
from app.ffmpeg.concat import concat_clips
from app.ffmpeg.trim import trim_clip
from app.logging_setup import logger
from app.pipeline.pipeline import HighlightPipeline
from app.types import HighlightCandidate, PipelineContext

# ==========================================================================
# 模块级单例：加载环境变量 / 配置
# ==========================================================================
settings = get_settings()


def _redis_conn() -> redis.Redis:
    """
    【基础设施】根据配置建立 Redis 连接。
    - 如果有 REDIS_URL 就直接用 URL 连（线上常见方式）
    - 否则拆成 host/port/password/db 单独连（本地开发用）
    这里 Redis 是 Worker ↔ API 之间的"消息队列"的底层存储。
    API 侧用 BullMQ 写任务，Python 侧用 RQ 取任务（协议兼容同一条 Redis stream）。
    """
    if settings.redis_url:
        return redis.Redis.from_url(settings.redis_url)
    return redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        password=settings.redis_password or None,
        db=settings.redis_db,
    )


def _update_api_job(job_id: str, status: str, progress: float, stage: str | None = None,
                    error_message: str | None = None) -> None:
    """
    【基础设施】把当前任务进度/状态 HTTP PATCH 回 Node.js API，
    这样前端用户就能看到"15% / 正在检测"这种进度条。
    失败只记 warning，不中断主流程（因为 API 挂了也不应该影响视频本身的处理）。

    调用方的典型状态机：
      PREPARING (0-5%) → DETECTING (5-55%) → VERIFYING (55-85%)
      → GENERATING_CLIPS (85-95%) → READY (100%)
      任何阶段抛异常 → FAILED
    """
    payload = {
        "status": status,
        "progress": progress,
    }
    if stage:
        payload["stage"] = stage  # type: ignore[assignment]
    if error_message:
        payload["error_message"] = error_message  # type: ignore[assignment]
    try:
        headers = {}
        if settings.api_internal_token:
            headers["X-Internal-Token"] = settings.api_internal_token
        httpx.patch(
            f"{settings.api_base_url}/jobs/{job_id}",
            json=payload,
            headers=headers,
            timeout=5.0,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not PATCH job {job_id}: {exc}")


def process_video(video_id: str, project_id: str, user_id: str) -> dict:
    """
    【Worker 消费函数 - 视频处理任务】
    这是队列里 video-processing 任务真正被消费时调用的函数。
    BullMQ 那边入队时塞的 payload 格式是：
      { videoId, projectId, userId }，对应这里三个位置参数。

    完整步骤：
    1. 从 RQ 当前 job 拿 job_id（或本地 fallback 时间戳）
    2. 构建 PipelineContext（贯穿整个 pipeline 的上下文数据袋）
    3. 报告 PREPARING → 跑 HighlightPipeline（里面含 prepare/coarse/fine/generate 4 个 stage）
    4. 报告 GENERATING_CLIPS → 把 ctx.highlights 批量 POST 回 API 的 /videos/:id/highlights/bulk
    5. 报告 READY → 返回结果给 RQ（存在 Redis 里供外部查询）
    6. 任何异常：记错误日志 + 回写 FAILED 状态 + 重新抛出（RQ 会按策略重试）
    """
    job = get_current_job()
    job_id = job.id if job else f"local-{int(time.time())}"
    logger.info(f"[{job_id}] process_video start video_id={video_id} project={project_id}")

    ctx = PipelineContext(video_id=video_id, project_id=project_id, user_id=user_id)

    try:
        _update_api_job(job_id, "PREPARING", 0.02, "Preparing")
        pipeline = HighlightPipeline()
        pipeline.run(ctx)
        _update_api_job(job_id, "GENERATING_CLIPS", 0.95, "Generating Clips")

        highlights_payload = [
            {
                "video_id": h.video_id if hasattr(h, "video_id") else video_id,
                "start_time": h.start_sec,
                "end_time": h.end_sec,
                "event_time": h.event_time_sec,
                "confidence": h.confidence,
                "type": h.type,
                "components": h.components,
                "metadata": h.metadata,
            }
            for h in ctx.highlights
        ]
        try:
            headers = {}
            if settings.api_internal_token:
                headers["X-Internal-Token"] = settings.api_internal_token
            httpx.post(
                f"{settings.api_base_url}/videos/{video_id}/highlights/bulk",
                json={"highlights": highlights_payload},
                headers=headers,
                timeout=30.0,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Could not POST highlights for video {video_id}: {exc}")

        _update_api_job(job_id, "READY", 1.0, "Ready")
        logger.info(f"[{job_id}] process_video done: {len(highlights_payload)} highlights")
        return {"video_id": video_id, "highlights": len(highlights_payload), "status": "ready"}

    except Exception as exc:  # noqa: BLE001
        logger.exception(f"[{job_id}] process_video failed: {exc}")
        _update_api_job(job_id, "FAILED", 0.0, error_message=str(exc))
        raise


def export_highlights(export_id: str, project_id: str, user_id: str,
                      items: list[dict], type_name: str, format_name: str) -> dict:
    """
    【Worker 消费函数 - 导出任务】
    这是队列里 video-export 任务真正被消费时调用的函数。
    负责把前端用户选好的若干 highlight（item = {start_time, end_time}）
    按用户指定的格式（MP4_HD / MP4_FULL_HD / MP4_4K）和类型：
      - SINGLE：单 clip 直接导出
      - MERGE：多个 clip 合成一个集锦 mp4

    注意：当前这版 source_path = tmp/source.mp4 还是 TODO，
    没有从 S3 下原视频（真实线上需要先从 storage 下载到本地）。
    本地跑脚本的话可以用 tests/scripts/export_local_highlights.py，
    它直接从用户指定的本地视频去切，不依赖 S3 下载。
    """
    job = get_current_job()
    job_id = job.id if job else f"local-export-{int(time.time())}"
    logger.info(f"[{job_id}] export_highlights export_id={export_id} items={len(items)} type={type_name}")

    tmp = Path(settings.ai_worker_tmp_dir) / "exports" / export_id
    tmp.mkdir(parents=True, exist_ok=True)

    heights = {"MP4_HD": 720, "MP4_FULL_HD": 1080, "MP4_4K": 2160}
    target_height = heights.get(format_name, 1080)

    source_path = tmp / "source.mp4"  # TODO: download source from storage

    clips: list[str] = []
    for idx, item in enumerate(items):
        clip_path = tmp / f"clip_{idx:04d}.mp4"
        if source_path.exists():
            trim_clip(
                str(source_path),
                float(item["start_time"]),
                float(item["end_time"]),
                str(clip_path),
                reencode=True,
                height=target_height,
            )
        else:
            clip_path.touch()
        clips.append(str(clip_path))

    output_path = tmp / f"export_{export_id}.mp4"
    if type_name == "MERGE":
        concat_clips(clips, str(output_path))
    else:
        if clips:
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            if Path(clips[0]).exists():
                subprocess_args = ["cp", clips[0], str(output_path)]
                import subprocess
                subprocess.run(subprocess_args, check=False)

    logger.info(f"[{job_id}] export_highlights done -> {output_path}")
    return {"export_id": export_id, "status": "exported", "path": str(output_path)}


def main() -> None:
    """
    【Worker 入口】
    运行模式分 3 种：

    A. 本地调试模式（--local-video）
       不走 Redis/RQ，直接在当前进程内跑 pipeline 并把 highlights JSON 打印到 stdout。
       常用于：
         - 快速测 detector/pipeline 效果（比如 benchmark.py 就是调这个）
         - 跟 tests/scripts/export_local_highlights.py 搭配做端到端剪辑测试

    B. 队列常驻模式（默认，不带 --once）
       连 Redis，监听 BULLMQ_PROCESSING_QUEUE + BULLMQ_EXPORT_QUEUE 两条队列（可通过
       AI_WORKER_MODE=processing|export|all 过滤）。
       收到任务就调用 process_video() 或 export_highlights()，一直阻塞到收到 SIGINT/SIGTERM。

    C. 队列单次模式（--once）
       跟 B 一样连队列，但处理完 1 条就退出（burst=True），一般给 CI/脚本调度用。
    """
    parser = argparse.ArgumentParser(prog="stb-worker", description="Shoot The Ball AI Worker")
    parser.add_argument("--once", action="store_true", help="Run one job and exit")
    parser.add_argument("--local-video", help="Dev: run pipeline on a local video path")
    parser.add_argument("--video-id", default="dev-video", help="Dev: override video id")
    parser.add_argument("--project-id", default="dev-project", help="Dev: override project id")
    parser.add_argument("--user-id", default="dev-user", help="Dev: override user id")
    args = parser.parse_args()

    # ================ Mode A: Local debug, run pipeline on a local file ================
    if args.local_video:
        logger.info(f"Running local pipeline on {args.local_video}")
        ctx = PipelineContext(
            video_id=args.video_id, project_id=args.project_id, user_id=args.user_id,
        )
        ctx.metadata.path = args.local_video
        from app.ffmpeg.metadata import probe_video
        try:
            p = probe_video(args.local_video)
            from app.types import VideoMetadata
            ctx.metadata = VideoMetadata(
                path=args.local_video,
                duration_sec=float(p["duration_sec"]),
                fps=float(p["fps"]),
                width=int(p["width"]),
                height=int(p["height"]),
                total_frames=int(p["total_frames"]),
                codec=str(p["codec"]),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Could not probe local video: {exc}")
        pipeline = HighlightPipeline()
        pipeline.run(ctx)
        out = [
            {
                "event_time": h.event_time_sec,
                "start": h.start_sec,
                "end": h.end_sec,
                "confidence": h.confidence,
                "type": h.type,
            }
            for h in ctx.highlights
        ]
        print(json.dumps(out, indent=2))
        return

    # ================ Mode B / C: Run RQ worker, consume queues ================
    conn = _redis_conn()
    queues: list[Queue] = []
    if settings.ai_worker_mode in ("all", "processing"):
        queues.append(Queue(settings.bullmq_processing_queue, connection=conn))
    if settings.ai_worker_mode in ("all", "export"):
        queues.append(Queue(settings.bullmq_export_queue, connection=conn))

    if not queues:
        logger.error("No queues configured, check AI_WORKER_MODE")
        sys.exit(2)

    logger.info(f"Starting AI Worker, listening to {[q.name for q in queues]}")
    worker = Worker(queues=[q.name for q in queues], connection=conn)

    def _shutdown(sig, frame):  # noqa: ARG001
        """Receive Ctrl+C / docker stop; finish the in-flight job, then exit cleanly."""
        logger.info(f"Signal {sig} received, shutting down worker")
        worker.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    if args.once:
        worker.work(burst=True)
    else:
        worker.work()


if __name__ == "__main__":
    main()
