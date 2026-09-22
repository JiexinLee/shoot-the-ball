from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------- Pipeline domain types ----------

class Roi(BaseModel):
    x: float
    y: float
    width: float
    height: float


class VideoMetadata(BaseModel):
    path: str
    duration_sec: float = 0.0
    fps: float = 0.0
    width: int = 0
    height: int = 0
    total_frames: int = 0
    codec: str = ""


class Detection(BaseModel):
    frame_idx: int
    timestamp_sec: float
    bbox: tuple[float, float, float, float]  # x1,y1,x2,y2
    score: float
    label: str
    tracker_id: Optional[int] = None


class BallState(BaseModel):
    frame_idx: int
    timestamp_sec: float
    bbox: tuple[float, float, float, float]
    centroid: tuple[float, float]
    tracker_id: int
    velocity_px_per_sec: tuple[float, float] = (0.0, 0.0)


class ShotCandidate(BaseModel):
    start_sec: float
    peak_sec: float
    end_sec: float
    score: float
    ball_trajectory: list[BallState] = Field(default_factory=list)
    reason: str = ""


class HighlightCandidate(BaseModel):
    event_time_sec: float
    start_sec: float
    end_sec: float
    confidence: float
    type: Literal[
        "MADE_BASKET",
        "THREE_POINTER",
        "ASSIST",
        "STEAL",
        "BLOCK",
        "REBOUND",
        "OTHER",
    ] = "MADE_BASKET"
    components: dict[str, float] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


@dataclass
class PipelineContext:
    video_id: str
    project_id: str
    user_id: str
    metadata: VideoMetadata = field(default_factory=lambda: VideoMetadata(path=""))
    hoop_roi: Optional[Roi] = None
    court_roi: Optional[Roi] = None
    coarse_detections: list[Detection] = field(default_factory=list)
    fine_detections: list[Detection] = field(default_factory=list)
    ball_track: list[BallState] = field(default_factory=list)
    shot_candidates: list[ShotCandidate] = field(default_factory=list)
    made_baskets: list[HighlightCandidate] = field(default_factory=list)
    highlights: list[HighlightCandidate] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)
