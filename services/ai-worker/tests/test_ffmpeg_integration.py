from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

import pytest

from app.ffmpeg.metadata import probe_video
from app.ffmpeg.sampling import sample_frames, iter_frame_files
from app.ffmpeg.trim import trim_clip
from app.ffmpeg.concat import concat_clips


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "videos"
FIXTURE = FIXTURE_DIR / "synthetic_10s.mp4"


def _has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


skip_no_ffmpeg = pytest.mark.skipif(
    not _has_ffmpeg(), reason="ffmpeg/ffprobe not installed"
)


@skip_no_ffmpeg
class TestFFmpegIntegration:
    @pytest.fixture(scope="class")
    def ensure_fixture(self, tmp_path_factory) -> Path:
        FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
        if FIXTURE.exists() and FIXTURE.stat().st_size > 10_000:
            return FIXTURE
        out = str(FIXTURE)
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=10:size=1280x720:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=10:sample_rate=44100",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            out,
        ]
        subprocess.run(cmd, check=True)
        return FIXTURE

    def test_probe_synthetic_video(self, ensure_fixture) -> None:
        m = probe_video(str(ensure_fixture))
        # 10s, 30fps, 1280x720, h264
        assert math.isclose(m["duration_sec"], 10.0, abs_tol=0.5), m
        assert math.isclose(m["fps"], 30.0, abs_tol=0.5), m
        assert m["width"] == 1280
        assert m["height"] == 720
        assert "264" in m["codec"].lower() or "h264" in m["codec"].lower()
        assert m["total_frames"] >= 290

    def test_sampling_frames_outputs_files(self, ensure_fixture, tmp_path) -> None:
        out_dir = tmp_path / "frames"
        n = sample_frames(str(ensure_fixture), str(out_dir), fps=2, prefix="f")
        # 10s * 2fps = ~20 frames (allow ±3 for off-by-one)
        assert 15 <= n <= 25, f"expected ~20 sampled frames, got {n}"
        files = list(iter_frame_files(str(out_dir), prefix="f"))
        assert len(files) == n
        assert all(f.suffix.lower() in (".jpg", ".jpeg") for f in files)

    def test_trim_clip_has_expected_duration(self, ensure_fixture, tmp_path) -> None:
        out = tmp_path / "clip_2_6.mp4"
        trim_clip(str(ensure_fixture), start_sec=2.0, end_sec=6.0, output=str(out), reencode=True)
        assert out.exists() and out.stat().st_size > 10_000
        m = probe_video(str(out))
        assert math.isclose(m["duration_sec"], 4.0, abs_tol=0.25), m

    def test_concat_two_clips(self, ensure_fixture, tmp_path) -> None:
        c1 = tmp_path / "c1.mp4"
        c2 = tmp_path / "c2.mp4"
        trim_clip(str(ensure_fixture), 0, 2, str(c1), reencode=True)
        trim_clip(str(ensure_fixture), 5, 8, str(c2), reencode=True)

        merged = tmp_path / "merged.mp4"
        concat_clips([str(c1), str(c2)], str(merged), reencode=True)

        assert merged.exists() and merged.stat().st_size > 10_000
        m = probe_video(str(merged))
        # 2s + 3s = 5s
        assert math.isclose(m["duration_sec"], 5.0, abs_tol=0.4), m
