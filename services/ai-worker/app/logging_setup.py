from loguru import logger
import sys

from app.config import get_settings

settings = get_settings()

logger.remove()
logger.add(
    sys.stderr,
    level="DEBUG" if settings.app_env == "development" else "INFO",
    colorize=True,
    format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
           "<level>{level: <8}</level> | "
           "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
           "<level>{message}</level>",
)
logger.add(
    "logs/worker_{time:YYYY-MM-DD}.log",
    level="INFO",
    rotation="1 day",
    retention="30 days",
    compression="gzip",
    enqueue=True,
)

__all__ = ["logger"]
