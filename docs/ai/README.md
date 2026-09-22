# AI Pipeline Documentation

## Overview

The AI Worker runs an 8-stage pipeline:

1. **Prepare** - Download source video; FFmpeg probe metadata.
2. **Coarse sampling** - Low FPS (default 2fps) frame sampling, prefer hoop ROI.
3. **Candidate detection** - Detect players / ball / hoop; track ball.
4. **Shot candidate** - Form shot windows from possession + motion.
5. **Fine verification** - Re-run at higher FPS only around candidates; classify Made Basket.
6. **Confidence** - Combine sub-scores (trajectory, hoop interaction, consistency).
7. **Deduplication** - Cluster overlapping events, keep best.
8. **Clip generation + persist** - Compute default start/end clip ranges and write back to DB.

## Modules

| Module | Path |
| ------ | ---- |
| Pipeline orchestrator | `services/ai-worker/app/pipeline/pipeline.py` |
| Prepare stage | `services/ai-worker/app/pipeline/prepare.py` |
| Coarse stage | `services/ai-worker/app/pipeline/coarse.py` |
| Fine stage | `services/ai-worker/app/pipeline/fine.py` |
| Detectors (player/ball/hoop) | `services/ai-worker/app/detectors/` |
| Ball tracker | `services/ai-worker/app/tracking/ball_tracker.py` |
| Events (shot / made basket / dedup) | `services/ai-worker/app/events/` |
| Highlight ranges | `services/ai-worker/app/clips/highlight_generator.py` |
| FFmpeg helpers | `services/ai-worker/app/ffmpeg/` |

## Running locally

```bash
cd services/ai-worker
poetry install
poetry run python -m app.worker --local-video ~/path/to/game.mp4
```

Outputs a JSON array of highlights (event time, range, confidence, type).

## Configuration

All tunables are in `app/config.py` and overrideable via env vars:

- `AI_COARSE_FPS` (default 2)
- `AI_FINE_FPS` (default 8)
- `AI_DEFAULT_HIGHLIGHT_PRE_SECONDS` (default 5s before event)
- `AI_DEFAULT_HIGHLIGHT_POST_SECONDS` (default 3s after event)
- `AI_CONFIDENCE_THRESHOLD` (default 0.55)
