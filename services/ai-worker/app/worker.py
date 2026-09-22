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

settings = get_settings()


def _redis_conn() -> redis.Redis:
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
            headers["Authorization"] = f"Bearer {settings.api_internal_token}"
        httpx.patch(
            f"{settings.api_base_url}/jobs/{job_id}",
            json=payload,
            headers=headers,
            timeout=5.0,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not PATCH job {job_id}: {exc}")


def process_video(video_id: str, project_id: str, user_id: str) -> dict:
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
                headers["Authorization"] = f"Bearer {settings.api_internal_token}"
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
    parser = argparse.ArgumentParser(prog="stb-worker", description="Shoot The Ball AI Worker")
    parser.add_argument("--once", action="store_true", help="Run one job and exit")
    parser.add_argument("--local-video", help="Dev: run pipeline on a local video path")
    parser.add_argument("--video-id", default="dev-video", help="Dev: override video id")
    parser.add_argument("--project-id", default="dev-project", help="Dev: override project id")
    parser.add_argument("--user-id", default="dev-user", help="Dev: override user id")
    args = parser.parse_args()

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
