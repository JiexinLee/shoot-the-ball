#!/usr/bin/env python3
"""Generate a small synthetic test video for CI (no copyright concerns).

Usage:
    poetry run python tests/scripts/make_synthetic_fixture.py [--duration N] [--size 1280x720]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=int, default=10)
    parser.add_argument("--size", default="1280x720")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "videos" / "synthetic_10s.mp4",
    )
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        print("ERROR: ffmpeg not on PATH", file=sys.stderr)
        return 2

    out: Path = args.output
    out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi",
        "-i", f"testsrc=duration={args.duration}:size={args.size}:rate={args.fps}",
        "-f", "lavfi",
        "-i", f"sine=frequency=1000:duration={args.duration}:sample_rate=44100",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest",
        str(out),
    ]
    print("+ ", " ".join(cmd))
    subprocess.run(cmd, check=True)
    size_kb = out.stat().st_size / 1024
    print(f"Wrote {out} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
