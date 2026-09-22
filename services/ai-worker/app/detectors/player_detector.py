from __future__ import annotations

from typing import Callable, Optional

from app.types import Detection, PipelineContext, Roi
from app.logging_setup import logger


class BaseDetector:
    label: str = "object"
    model_name: str = "noop"

    def warm_up(self, ctx: PipelineContext) -> None:  # noqa: B027
        pass

    def detect(self, frame_idx: int, timestamp_sec: float, image=None) -> list[Detection]:
        raise NotImplementedError

    def detect_batch(
        self,
        frame_indices: list[int],
        timestamps: list[float],
        progress_cb: Optional[Callable[[int, int], None]] = None,
    ) -> list[Detection]:
        out: list[Detection] = []
        total = len(frame_indices)
        for i, (f, t) in enumerate(zip(frame_indices, timestamps)):
            out.extend(self.detect(f, t))
            if progress_cb and (i % max(1, total // 20) == 0 or i == total - 1):
                progress_cb(i + 1, total)
        return out


class PlayerDetector(BaseDetector):
    label = "player"
    model_name = "yolov8-person"

    def detect(self, frame_idx: int, timestamp_sec: float, image=None) -> list[Detection]:
        return []


class BallDetector(BaseDetector):
    label = "ball"
    model_name = "yolov8-ball"

    def detect(self, frame_idx: int, timestamp_sec: float, image=None) -> list[Detection]:
        return []


class HoopDetector(BaseDetector):
    label = "hoop"
    model_name = "yolov8-hoop"

    def warm_up(self, ctx: PipelineContext) -> None:
        """
        If user provided a hoop ROI via calibration, use it directly as a fixed detection.
        """
        if ctx.hoop_roi is None:
            return
        logger.info(f"Using user-provided hoop ROI: {ctx.hoop_roi}")

    def detect(self, frame_idx: int, timestamp_sec: float, image=None) -> list[Detection]:
        return []
