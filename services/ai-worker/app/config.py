from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=["../../.env", ".env", ".env.local"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "staging", "production"] = "development"

    redis_host: str = "127.0.0.1"
    redis_port: int = 6379
    redis_password: str = ""
    redis_db: int = 0
    redis_url: str = ""

    api_base_url: str = "http://127.0.0.1:4000/v1"
    api_internal_token: str = ""

    storage_provider: str = "s3"
    storage_endpoint: str = ""
    storage_region: str = "ap-southeast-1"
    storage_access_key_id: str = ""
    storage_secret_access_key: str = ""
    storage_bucket_source: str = "shoot-the-ball-source"
    storage_bucket_exports: str = "shoot-the-ball-exports"

    bullmq_processing_queue: str = "video-processing"
    bullmq_export_queue: str = "video-export"
    bullmq_concurrency: int = 2

    ai_worker_mode: Literal["all", "processing", "export"] = "all"
    ai_model_version: str = "0.1.0"
    ai_pipeline_version: str = "0.1.0"
    
    # TODO: to be changed to the local tmp dir
    # e.g. /Users/jiexinli/MyProjects/shoot-the-ball/assets/clips-out
    ai_worker_tmp_dir: str = "" 

    ai_default_highlight_pre_seconds: float = 5.0
    ai_default_highlight_post_seconds: float = 3.0

    ai_coarse_fps: float = 2.0
    ai_fine_fps: float = 8.0
    ai_confidence_threshold: float = 0.55

    ai_demo_mode: bool = False
    ai_demo_highlight_count: int = 0
    ai_demo_seed: int = 20260922


@lru_cache
def get_settings() -> Settings:
    return Settings()
