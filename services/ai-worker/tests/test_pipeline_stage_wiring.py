from __future__ import annotations

import shutil
import subprocess
import math
from pathlib import Path

import pytest

from app.pipeline.prepare import prepare_source
from app.pipeline.coarse import coarse_sampling
from app.pipeline.fine import fine_verification
from app.types import PipelineContext, ShotCandidate, VideoMetadata
from app.detectors.ball_detector import BallDetector
from app.detectors.hoop_detector import HoopDetector


FIXTURE = (
    Path(__file__).parent / "fixtures" / "videos" / "synthetic_10s.mp4"
)


def _has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


skip_no_ffmpeg = pytest.mark.skipif(not _has_ffmpeg(), reason="ffmpeg/ffprobe missing")


def _ensure_fixture() -> Path:
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    if FIXTURE.exists() and FIXTURE.stat().st_size > 10_000:
        return FIXTURE
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=10:size=1280x720:rate=30",
            "-f", "lavfi", "-i", "sine=frequency=1000:duration=10:sample_rate=44100",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(FIXTURE),
        ],
        check=True,
    )
    return FIXTURE


@skip_no_ffmpeg
def test_prepare_stage_fills_metadata(tmp_path, monkeypatch) -> None:
    # Redirect tmp dir to an isolated one
    monkeypatch.setenv("AI_WORKER_TMP_DIR", str(tmp_path))
    from app import config
    config.get_settings.cache_clear()

    fixture = _ensure_fixture()
    # Pre-copy fixture into prepare_source expected tmp location so it finds a "cached" file
    local = tmp_path / "demo-video"
    local.mkdir(parents=True, exist_ok=True)
    dst = local / "source.mp4"
    shutil.copy(fixture, dst)

    ctx = PipelineContext(video_id="demo-video", project_id="p", user_id="u")
    prepare_source(ctx)

    assert ctx.metadata.path == str(dst) or Path(ctx.metadata.path).name == "source.mp4"
    assert math.isclose(ctx.metadata.duration_sec, 10.0, abs_tol=0.5)
    assert ctx.metadata.width == 1280 and ctx.metadata.height == 720
    assert math.isclose(ctx.metadata.fps, 30.0, abs_tol=0.5)


def test_coarse_stage_frame_count() -> None:
    ctx = PipelineContext(video_id="x", project_id="p", user_id="u")
    ctx.metadata = VideoMetadata(
        path="x.mp4", duration_sec=10, fps=30, width=1280, height=720, total_frames=300,
    )
    frames, times = coarse_sampling(ctx)
    # 300 frames / step=15 (30fps / 2 coarse_fps) = 20 frames
    assert 18 <= len(frames) <= 22, f"expected ~20 coarse frames, got {len(frames)}"
    assert len(frames) == len(times)
    assert frames[0] == 0
    assert frames[-1] <= 299


def test_fine_stage_windows_cover_candidates() -> None:
    ctx = PipelineContext(video_id="x", project_id="p", user_id="u")
    ctx.metadata = VideoMetadata(
        path="x.mp4", duration_sec=60, fps=30, width=1280, height=720, total_frames=1800,
    )
    ctx.shot_candidates = [
        ShotCandidate(start_sec=8, peak_sec=10.5, end_sec=12, score=0.8),
        ShotCandidate(start_sec=40, peak_sec=42.0, end_sec=44, score=0.7),
    ]
    windows = fine_verification(ctx, BallDetector(), HoopDetector())
    assert len(windows) == 2

    # Window 0 covers peak-1 ~ peak+1: 9.5..11.5s
    w0 = windows[0]
    assert min(w0.timestamps) <= 9.5
    assert max(w0.timestamps) >= 11.5
    # Fine FPS = 8, so step ≈ 30/8 = 4 → ~34 frames in 2s window
    assert 15 <= len(w0.timestamps) <= 60
