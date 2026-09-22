from __future__ import annotations

import math

from app.types import BallState, Detection
from app.logging_setup import logger


class BallTracker:
    """
    Simple centroid + IoU tracker for the basketball.
    Produces a time-ordered list of BallState with velocity estimates.
    """

    def __init__(self, max_gap_frames: int = 5, max_distance_ratio: float = 0.15) -> None:
        self.max_gap_frames = max_gap_frames
        self.max_distance_ratio = max_distance_ratio

    def track(self, detections: list[Detection]) -> list[BallState]:
        ball_dets = sorted(
            [d for d in detections if d.label == "ball"],
            key=lambda d: (d.frame_idx, -d.score),
        )
        if not ball_dets:
            logger.warning("Ball tracker received no ball detections")
            return []

        track: list[BallState] = []
        next_id = 1
        for det in ball_dets:
            x1, y1, x2, y2 = det.bbox
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            prev = track[-1] if track else None
            tid = prev.tracker_id if prev else next_id
            vx, vy = 0.0, 0.0
            if prev is not None:
                dt = max(det.timestamp_sec - prev.timestamp_sec, 1e-6)
                vx = (cx - prev.centroid[0]) / dt
                vy = (cy - prev.centroid[1]) / dt
            track.append(
                BallState(
                    frame_idx=det.frame_idx,
                    timestamp_sec=det.timestamp_sec,
                    bbox=det.bbox,
                    centroid=(cx, cy),
                    tracker_id=tid,
                    velocity_px_per_sec=(vx, vy),
                )
            )
        logger.info(f"Ball track: {len(track)} points (tracker_id={next_id})")
        return track
