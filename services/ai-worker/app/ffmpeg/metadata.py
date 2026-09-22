from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from app.logging_setup import logger


def _require_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found in PATH")
    if shutil.which("ffprobe") is None:
        raise RuntimeError("ffprobe not found in PATH")


def probe_video(path: str) -> dict[str, Any]:
    _require_ffmpeg()
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-select_streams",
        "v:0",
        path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}

    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    fps = 0.0
    rate = stream.get("r_frame_rate") or "0/1"
    if isinstance(rate, str) and "/" in rate:
        num, den = rate.split("/", 1)
        try:
            if int(den) > 0:
                fps = float(int(num)) / float(int(den))
        except (ValueError, ZeroDivisionError):
            fps = 0.0
    duration = float(fmt.get("duration") or 0.0)
    nb_frames = int(stream.get("nb_frames") or 0)
    if nb_frames <= 0 and fps > 0 and duration > 0:
        nb_frames = int(round(fps * duration))

    return {
        "duration_sec": duration,
        "fps": fps,
        "width": width,
        "height": height,
        "total_frames": nb_frames,
        "codec": str(stream.get("codec_name") or ""),
    }
