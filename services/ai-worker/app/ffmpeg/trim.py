from __future__ import annotations

import subprocess
from pathlib import Path

from app.logging_setup import logger


def trim_clip(
    source: str,
    start_sec: float,
    end_sec: float,
    output: str,
    reencode: bool = False,
    height: int | None = None,
) -> str:
    """
    Trim video [start_sec, end_sec] and write to output.
    Defaults to stream copy (fast) for speed; set reencode=True for accurate cuts.
    If height is given, rescale to that height preserving aspect ratio.
    """
    duration = max(0.0, end_sec - start_sec)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    cmd += ["-ss", f"{start_sec:.3f}", "-i", source, "-t", f"{duration:.3f}"]
    vf_parts: list[str] = []
    if height is not None:
        vf_parts.append(f"scale=-2:{height}")
    if reencode:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac"]
    else:
        cmd += ["-c", "copy"]
    if vf_parts:
        cmd += ["-vf", ",".join(vf_parts)]
    cmd += [output]
    logger.info(f"Trimming clip {start_sec:.2f}-{end_sec:.2f} -> {output}")
    subprocess.run(cmd, check=True)
    return output
