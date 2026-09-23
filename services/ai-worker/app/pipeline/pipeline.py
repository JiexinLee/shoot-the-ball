from app.pipeline.prepare import prepare_source
from app.pipeline.coarse import coarse_sampling
from app.pipeline.fine import fine_verification
from app.detectors.player_detector import PlayerDetector
from app.detectors.ball_detector import BallDetector
from app.detectors.hoop_detector import HoopDetector
from app.tracking.ball_tracker import BallTracker
from app.events.shot_candidate import build_shot_candidates
from app.events.made_basket import verify_made_basket
from app.events.confidence import compute_confidence
from app.events.deduplication import deduplicate_highlights
from app.events.demo_highlights import generate_demo_highlights
from app.clips.highlight_generator import build_clip_ranges
from app.config import get_settings
from app.types import PipelineContext
from app.logging_setup import logger


class HighlightPipeline:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.player_det = PlayerDetector()
        self.ball_det = BallDetector()
        self.hoop_det = HoopDetector()
        self.ball_tracker = BallTracker()

    def progress_callback(self, stage: str, progress: float) -> None:
        logger.info(f"[progress] stage={stage} progress={progress:.2%}")

    def run(self, ctx: PipelineContext) -> PipelineContext:
        if self.settings.ai_demo_mode:
            logger.warning(
                "AI_DEMO_MODE=1 enabled — generating demo highlights, "
                "not running real detection/tracking/classification. "
                "Remove AI_DEMO_MODE env var once vision models are plugged in."
            )
            stages = [
                ("prepare", 0.0, 0.10, self._stage_prepare),
                ("detecting", 0.10, 0.60, self._stage_coarse_demo),
                ("verifying", 0.60, 0.90, self._stage_fine_demo),
                ("generating_clips", 0.90, 1.0, self._stage_generate),
            ]
        else:
            stages = [
                ("prepare", 0.0, 0.05, self._stage_prepare),
                ("detecting", 0.05, 0.55, self._stage_coarse),
                ("verifying", 0.55, 0.85, self._stage_fine),
                ("generating_clips", 0.85, 1.0, self._stage_generate),
            ]

        logger.info(f"Starting pipeline for video_id={ctx.video_id}")
        for name, start, end, func in stages:
            try:
                self.progress_callback(name, start)
                func(ctx, start, end)
                self.progress_callback(name, end)
            except Exception as exc:  # noqa: BLE001
                logger.exception(f"Pipeline stage '{name}' failed: {exc}")
                ctx.errors.append(f"{name}: {exc}")
                raise
        logger.info(f"Pipeline finished: {len(ctx.highlights)} highlights")
        return ctx

    def _stage_prepare(self, ctx: PipelineContext, _s: float, _e: float) -> None:
        prepare_source(ctx)
        self.hoop_det.warm_up(ctx)

    def _stage_coarse(self, ctx: PipelineContext, start: float, end: float) -> None:
        frames, frame_times = coarse_sampling(ctx)

        def _on_progress(i: int, total: int) -> None:
            p = start + (i / max(1, total)) * (end - start)
            self.progress_callback("detecting", p)

        hoop_dets = self.hoop_det.detect_batch(frames, frame_times, _on_progress)
        ball_dets = self.ball_det.detect_batch(frames, frame_times)
        player_dets = self.player_det.detect_batch(frames, frame_times)
        ctx.coarse_detections = hoop_dets + ball_dets + player_dets
        ctx.ball_track = self.ball_tracker.track(ball_dets)
        ctx.shot_candidates = build_shot_candidates(ctx)

    def _stage_fine(self, ctx: PipelineContext, start: float, end: float) -> None:
        fine_windows = fine_verification(ctx, self.ball_det, self.hoop_det)
        for i, window in enumerate(fine_windows):
            p = start + (i / max(1, len(fine_windows))) * (end - start)
            self.progress_callback("verifying", p)
            made = verify_made_basket(ctx, window)
            compute_confidence(ctx, made)
            if made is not None:
                ctx.made_baskets.append(made)
        ctx.highlights = deduplicate_highlights(ctx.made_baskets)

    def _stage_coarse_demo(self, ctx: PipelineContext, start: float, end: float) -> None:
        """Demo coarse: still run probe & coarse_sampling so real frame counts show up
        in logs, then swap out real detections for synthetic shot_candidates."""
        frames, frame_times = coarse_sampling(ctx)
        total = max(1, len(frames))
        for i in [0, total // 4, total // 2, (3 * total) // 4, total - 1]:
            p = start + (i / total) * (end - start)
            self.progress_callback("detecting", p)
        ctx.coarse_detections = []
        ctx.ball_track = []
        ctx.shot_candidates = []

    def _stage_fine_demo(self, ctx: PipelineContext, start: float, end: float) -> None:
        """Demo fine: inject deterministic pseudo-highlights."""
        steps = 5
        for i in range(1, steps + 1):
            p = start + (i / steps) * (end - start)
            self.progress_callback("verifying", p)
        demo = generate_demo_highlights(ctx)
        ctx.made_baskets = demo
        ctx.highlights = deduplicate_highlights(ctx.made_baskets)

    def _stage_generate(self, ctx: PipelineContext, _s: float, _e: float) -> None:
        build_clip_ranges(ctx)
