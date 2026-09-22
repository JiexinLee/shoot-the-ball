from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from app.logging_setup import logger


def concat_clips(clips: list[str], output: str, reencode: bool = True) -> str:
    """
    Concatenate multiple clips into one output.
    Uses demuxer concat (fast) for compatible inputs, or re-encoding concat filter.
    """
    if not clips:
        raise ValueError("No clips provided for concat")
    if len(clips) == 1:
        return clips[0]
    Path(output).parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        for c in clips:
            f.write(f"file '{Path(c).resolve()}'\n")
        manifest = f.name

    try:
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            manifest,
        ]
        if reencode:
            cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac"]
        else:
            cmd += ["-c", "copy"]
        cmd += [output]
        logger.info(f"Concatenating {len(clips)} clips -> {output}")
        subprocess.run(cmd, check=True)
        return output
    finally:
        try:
            Path(manifest).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
