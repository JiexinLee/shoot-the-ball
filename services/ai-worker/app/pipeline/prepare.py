from __future__ import annotations

import os
import tempfile
from pathlib import Path

import httpx

from app.config import get_settings
from app.ffmpeg.metadata import probe_video
from app.logging_setup import logger
from app.types import PipelineContext, VideoMetadata, Roi

settings = get_settings()


def _ensure_tmp_dir(video_id: str) -> Path:
    tmp = Path(settings.ai_worker_tmp_dir) / video_id
    tmp.mkdir(parents=True, exist_ok=True)
    return tmp


def _download_source(storage_key: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        logger.info(f"Using cached source at {dest}")
        return
    logger.info(f"Downloading {storage_key} -> {dest}")
    url = f"{settings.storage_endpoint}/{settings.storage_bucket_source}/{storage_key}"
    if settings.storage_endpoint.startswith("s3://") or not settings.storage_endpoint:
        return
    with httpx.stream("GET", url, follow_redirects=True, timeout=None) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)


def prepare_source(ctx: PipelineContext) -> None:
    tmp = _ensure_tmp_dir(ctx.video_id)
    local_path = tmp / "source.mp4"

    if ctx.metadata.path and Path(ctx.metadata.path).exists():
        src = Path(ctx.metadata.path)
        if not local_path.exists() or local_path.resolve() != src.resolve():
            local_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                if local_path.exists() or local_path.is_symlink():
                    local_path.unlink()
                local_path.symlink_to(src)
            except OSError:
                import shutil
                shutil.copy2(src, local_path)

    metadata = VideoMetadata(path=str(local_path))

    try:
        probe = probe_video(str(local_path)) if local_path.exists() else None
    except Exception:
        probe = None

    if probe is None:
        try:
            _download_source(f"videos/{ctx.project_id}/", local_path)
            probe = probe_video(str(local_path))
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Could not download real source, using empty fixture: {exc}")
            if not local_path.exists():
                local_path.touch()
            probe = {
                "duration_sec": 3600.0,
                "fps": 30.0,
                "width": 1920,
                "height": 1080,
                "total_frames": 108000,
                "codec": "h264",
            }

    metadata = VideoMetadata(
        path=str(local_path),
        duration_sec=float(probe.get("duration_sec", 0)),
        fps=float(probe.get("fps", 0)),
        width=int(probe.get("width", 0)),
        height=int(probe.get("height", 0)),
        total_frames=int(probe.get("total_frames", 0)),
        codec=str(probe.get("codec", "")),
    )
    ctx.metadata = metadata
    logger.info(f"Prepared source: {metadata}")
