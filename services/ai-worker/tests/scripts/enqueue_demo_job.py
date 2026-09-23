#!/usr/bin/env python3
"""Manually enqueue a demo process_video job to verify worker consumption."""
from __future__ import annotations

import argparse
import os
import sys

from redis import Redis
from rq import Queue


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="demo-video-001")
    parser.add_argument("--project-id", default="demo-project")
    parser.add_argument("--user-id", default="demo-user")
    parser.add_argument(
        "--queue", default=os.environ.get("BULLMQ_PROCESSING_QUEUE", "video-processing")
    )
    args = parser.parse_args()

    redis_url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
    conn = Redis.from_url(redis_url)
    try:
        conn.ping()
    except Exception as exc:  # noqa: BLE001
        print(f"Cannot connect Redis at {redis_url}: {exc}", file=sys.stderr)
        return 2

    q = Queue(args.queue, connection=conn)

    # Late import inside process so `from app.worker import process_video` doesn't
    # run when we only want to enqueue.
    from app.worker import process_video

    job = q.enqueue(
        process_video,
        args.video_id,
        args.project_id,
        args.user_id,
        job_timeout="3h",
        result_ttl=86400,
    )
    print(f"Enqueued job id={job.id} video_id={args.video_id} queue={args.queue}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
