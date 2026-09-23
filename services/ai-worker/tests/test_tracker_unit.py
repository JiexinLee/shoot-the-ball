from __future__ import annotations

import math

import pytest

from app.detectors.player_detector import Detection
from app.tracking.ball_tracker import BallTracker


def _ball(frame: int, t: float, x: float, y: float, score: float = 0.9) -> Detection:
    size = 40
    return Detection(
        frame_idx=frame,
        timestamp_sec=t,
        bbox=(x - size / 2, y - size / 2, x + size / 2, y + size / 2),
        score=score,
        label="ball",
    )


def test_ball_tracker_linear_motion() -> None:
    """Ball moves right at 100 px/s, 10 fps sample for 1s -> track 10 points, vx≈100 vy≈0."""
    fps = 10
    frames = [i for i in range(10)]
    times = [f / fps for f in frames]
    # Start at x=100, vx=100
    detections = [_ball(f, t, 100 + 100 * t, 200) for f, t in zip(frames, times)]

    tracker = BallTracker()
    track = tracker.track(detections)

    assert len(track) == 10
    assert all(s.tracker_id == track[0].tracker_id for s in track)
    # Last ~5 velocity estimates should be consistent ~100 px/s horizontally
    last_vx = [s.velocity_px_per_sec[0] for s in track[3:]]
    for vx in last_vx:
        assert math.isclose(vx, 100.0, abs_tol=5), f"expected ~100 vx, got {vx}"


def test_ball_tracker_small_gap() -> None:
    """Missing frames 3,4,5 should still reuse tracker_id (gap=3 <= max_gap_frames=5)."""
    fps = 10
    keep = [0, 1, 2, 6, 7, 8, 9]
    detections = [_ball(f, f / fps, 100 + 50 * (f / fps), 200) for f in keep]

    tracker = BallTracker(max_gap_frames=5)
    track = tracker.track(detections)

    assert len(track) == len(keep)
    assert all(s.tracker_id == track[0].tracker_id for s in track), (
        "Tracker id should not change on small gaps"
    )


def test_ball_tracker_empty_input() -> None:
    tracker = BallTracker()
    assert tracker.track([]) == []
