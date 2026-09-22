from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterator

from app.logging_setup import logger


def sample_frames(
    video_path: str,
    output_dir: str,
    fps: float,
    prefix: str = "frame",
) -> int:
    """
    Extract frames from video at `fps` frames/sec into `output_dir`.
    Returns number of frames written.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    pattern = str(out / f"{prefix}_%08d.jpg")
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        video_path,
        "-vf",
        f"fps={fps}",
        "-q:v",
        "3",
        pattern,
    ]
    logger.info(f"Sampling frames fps={fps} -> {output_dir}")
    subprocess.run(cmd, check=True)
    return len(list(out.glob(f"{prefix}_*.jpg")))


def iter_frame_files(output_dir: str, prefix: str = "frame") -> Iterator[Path]:
    out = Path(output_dir)
    yield from sorted(out.glob(f"{prefix}_*.jpg"))
