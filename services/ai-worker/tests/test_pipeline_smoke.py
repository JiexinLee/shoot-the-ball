def test_imports_work() -> None:
    from app.config import get_settings
    from app.pipeline.pipeline import HighlightPipeline
    from app.types import PipelineContext

    settings = get_settings()
    assert settings.ai_pipeline_version

    ctx = PipelineContext(video_id="x", project_id="y", user_id="z")
    _ = HighlightPipeline()
    assert ctx.video_id == "x"


def test_deduplication() -> None:
    from app.events.deduplication import deduplicate_highlights
    from app.types import HighlightCandidate

    a = HighlightCandidate(event_time_sec=10.0, start_sec=5, end_sec=13, confidence=0.8)
    b = HighlightCandidate(event_time_sec=10.5, start_sec=5.5, end_sec=13.5, confidence=0.9)
    c = HighlightCandidate(event_time_sec=42.0, start_sec=37, end_sec=45, confidence=0.7)
    result = deduplicate_highlights([a, b, c])
    assert len(result) == 2
    assert result[0].confidence == 0.9
    assert result[1].event_time_sec == 42.0
