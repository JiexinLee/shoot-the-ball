#!/usr/bin/env python3
"""Accuracy benchmark runner — compares pipeline output to ground truth annotations.

Annotation JSON schema:
{
  "video": "real_1min_hoop_view.mp4",
  "duration_sec": 62.3,
  "made_baskets": [ { "event_time_sec": 12.4, "type": "MADE_BASKET" } ],
  "tolerance_sec": 1.5
}

Usage:
    poetry run python tests/scripts/benchmark.py \
        --annotations tests/fixtures/annotations/*.json \
        --output report.json
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path


def _run_pipeline(video_path: Path) -> list[dict]:
    """Invoke worker in local-video mode, parse the final JSON array from stdout."""
    proc = subprocess.run(
        [
            sys.executable, "-m", "app.worker",
            "--local-video", str(video_path),
            "--video-id", video_path.stem,
            "--project-id", "benchmark",
            "--user-id", "benchmark",
        ],
        cwd=str(Path(__file__).resolve().parents[1]),
        capture_output=True,
        text=True,
        timeout=3 * 3600,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"worker failed rc={proc.returncode}\nSTDERR:\n{proc.stderr[-2000:]}"
        )
    # JSON array is the last non-empty block — find '[' and match brackets
    out = proc.stdout
    start = out.rfind("[")
    if start < 0:
        return []
    depth = 0
    end = start
    for i in range(start, len(out)):
        c = out[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    return json.loads(out[start:end])


def _match(pred: list[dict], gt: list[dict], tol: float) -> tuple[int, int, int, list[int], list[int]]:
    """Return TP, FP, FN, matched_pred_idx, matched_gt_idx."""
    used_gt = set()
    matched_pred = set()
    tp = 0
    preds_sorted = sorted(
        enumerate(pred), key=lambda x: -x[1].get("confidence", 0.0)
    )
    for pi, p in preds_sorted:
        p_ev = p.get("event_time")
        if p_ev is None:
            continue
        best_gi = -1
        best_d = float("inf")
        for gi, g in enumerate(gt):
            if gi in used_gt:
                continue
            d = abs(p_ev - g["event_time_sec"])
            if d <= tol and d < best_d:
                best_d = d
                best_gi = gi
        if best_gi >= 0:
            used_gt.add(best_gi)
            matched_pred.add(pi)
            tp += 1
    fp = len(pred) - tp
    fn = len(gt) - tp
    return tp, fp, fn, sorted(matched_pred), sorted(used_gt)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--annotations",
        nargs="+",
        type=Path,
        required=True,
        help="Annotation JSON files matching videos/*.json schema",
    )
    ap.add_argument("--output", type=Path, help="Write detailed report JSON")
    args = ap.parse_args()

    reports = []
    total_gt = total_pred = 0
    total_tp = total_fp = total_fn = 0

    for ann_path in args.annotations:
        ann = json.loads(ann_path.read_text(encoding="utf-8"))
        video_name = ann["video"]
        video_path = ann_path.parents[1] / "videos" / video_name
        if not video_path.exists():
            print(f"[SKIP] {ann_path.name}: video not found at {video_path}", file=sys.stderr)
            continue

        tol = float(ann.get("tolerance_sec", 1.5))
        gt = ann.get("made_baskets", [])

        print(f"[RUN] {video_path} — GT={len(gt)} events")
        pred = _run_pipeline(video_path)
        print(f"      pred highlights: {len(pred)}")

        tp, fp, fn, matched_p, matched_g = _match(pred, gt, tol)
        recall = tp / (tp + fn) if (tp + fn) else 1.0
        prec = tp / (tp + fp) if (tp + fp) else 1.0
        f1 = (
            2 * recall * prec / (recall + prec)
            if (recall + prec)
            else 0.0
        )

        reports.append({
            "annotation": str(ann_path),
            "video": str(video_path),
            "tolerance_sec": tol,
            "gt_count": len(gt),
            "pred_count": len(pred),
            "tp": tp, "fp": fp, "fn": fn,
            "recall": recall, "precision": prec, "f1": f1,
            "matched_pred_idx": matched_p,
            "matched_gt_idx": matched_g,
        })
        total_gt += len(gt)
        total_pred += len(pred)
        total_tp += tp
        total_fp += fp
        total_fn += fn

    if not reports:
        print("ERROR: no annotation/video pairs were processed", file=sys.stderr)
        return 2

    r = total_tp / (total_tp + total_fn) if (total_tp + total_fn) else 1.0
    p = total_tp / (total_tp + total_fp) if (total_tp + total_fp) else 1.0
    f1 = 2 * r * p / (r + p) if (r + p) else 0.0

    print()
    print("=== Shoot The Ball AI Benchmark ===")
    print(f"Videos tested:       {len(reports)}")
    print(f"GT Made Baskets:     {total_gt}")
    print(f"Predicted Highlights:{total_pred}")
    print(f"True Positives (TP): {total_tp}")
    print(f"False Positives (FP):{total_fp}")
    print(f"False Negatives (FN):{total_fn}")
    print()
    print(f"Recall    = {total_tp} / {total_tp + total_fn} = {r*100:.2f}%")
    print(f"Precision = {total_tp} / {total_tp + total_fp} = {p*100:.2f}%")
    print(f"F1        = {f1*100:.2f}%")

    report = {
        "totals": {
            "videos": len(reports),
            "gt": total_gt, "pred": total_pred,
            "tp": total_tp, "fp": total_fp, "fn": total_fn,
            "recall": r, "precision": p, "f1": f1,
        },
        "per_video": reports,
    }
    if args.output:
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nDetailed report written to {args.output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
