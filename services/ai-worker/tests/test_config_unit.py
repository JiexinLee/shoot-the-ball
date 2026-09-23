from __future__ import annotations

import os

from app.config import get_settings


def test_settings_defaults(monkeypatch) -> None:
    # Avoid pollution from existing .env by zeroing relevant env vars before get_settings
    for key in [
        "AI_COARSE_FPS",
        "AI_FINE_FPS",
        "AI_DEFAULT_HIGHLIGHT_PRE_SECONDS",
        "AI_DEFAULT_HIGHLIGHT_POST_SECONDS",
    ]:
        monkeypatch.delenv(key, raising=False)
    from app import config

    config.get_settings.cache_clear()
    s = get_settings()
    assert s.ai_coarse_fps == 2
    assert s.ai_fine_fps == 8
    assert s.ai_default_highlight_pre_seconds == 5.0
    assert s.ai_default_highlight_post_seconds == 3.0


def test_settings_env_override(monkeypatch) -> None:
    monkeypatch.setenv("AI_COARSE_FPS", "1")
    monkeypatch.setenv("AI_FINE_FPS", "16")
    monkeypatch.setenv("AI_DEFAULT_HIGHLIGHT_PRE_SECONDS", "8")
    monkeypatch.setenv("AI_DEFAULT_HIGHLIGHT_POST_SECONDS", "7")
    from app import config

    config.get_settings.cache_clear()
    s = get_settings()
    assert s.ai_coarse_fps == 1
    assert s.ai_fine_fps == 16
    assert s.ai_default_highlight_pre_seconds == 8.0
    assert s.ai_default_highlight_post_seconds == 7.0
