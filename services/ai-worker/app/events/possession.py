from app.types import PipelineContext, ShotCandidate
from app.logging_setup import logger


def build_shot_candidates(ctx: PipelineContext) -> list[ShotCandidate]:
    """
    Build potential shot windows from coarse ball tracking + possession/hoop proximity.
    Placeholder implementation: returns empty list until real detectors are plugged in.
    """
    candidates: list[ShotCandidate] = []
    logger.info(f"Shot candidate builder: collected {len(candidates)} candidates")
    return candidates
