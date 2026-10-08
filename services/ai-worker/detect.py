#!/usr/bin/env python3
"""
最简版 YOLOv8 篮球检测脚本。

【默认检测目标】
  COCO 数据集 class 32  -> "sports ball"（运动球大类，篮球/足球/排球都算这个类）
  篮筐 (hoop) 不在 COCO 80 类里，YOLOv8 原生权重识别不出来（项目里 HoopDetector
  本来就是 fallback 到用户手画 ROI 的）。
  用 --classes 参数切换目标：
    --classes person   只检测人（COCO class 0，用于验证 YOLO 本身能否跑通）
    --classes ball     只检测球（默认，COCO class 32）
    --classes all      不做类别过滤，YOLO 检出什么就输出什么

【返回空数组的常见原因】
  1. 我们用的是 yolov8n.pt（6 MB nano 最小模型）——它对「大且清晰」的 person/car
     这类目标极准，但对「小 / 模糊 / 快速移动」的 sports ball 非常弱。
  2. 置信度阈值太高。第一次跑 ball 建议先 --conf 0.05，有结果了再往上调。
  3. MPS / 模型加载静默失败。
     建议先跑 --classes person 确认整条链路（模型+MPS+视频读帧）都 OK，再碰球。

【使用步骤（强烈建议按顺序来）】
  cd services/ai-worker

  # Step 0：先验证 YOLO 真的能在你机器上工作（检测人 = 最稳妥的环境自测）
  # 如果这步返回 []，那是环境 / 模型 / 视频有问题，跟篮球没关系。
  poetry run python detect.py -i ../../assets/testing-video.MP4 \
    --classes person --conf 0.3 --sample-every 30 -o people.json

  # Step 1：环境 OK 后再测篮球，conf 一定要拉低（nano 模型需要）
  poetry run python detect.py -i ../../assets/testing-video.MP4 \
    --classes ball --conf 0.05 --sample-every 2 -o balls.json

  # Step 2：如果还是空，直接看 YOLO 到底认出了啥（不做类别过滤 + 每帧直方图）
  poetry run python detect.py -i ../../assets/testing-video.MP4 \
    --classes all --conf 0.05 --sample-every 30 --verbose -o all.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import torch
from tqdm import tqdm  # 进度条库；IDE 报 "Stubs for tqdm are bundled with Pyrefly ..."
                        # 这是静态类型检查器的 stub 提示，不影响运行时，可以忽略。


# COCO 80 类 数字 id -> 可读名称映射（yolov8n 用的就是这个表）
COCO_NAMES = {
    0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 4: "airplane",
    5: "bus", 6: "train", 7: "truck", 8: "boat", 9: "traffic light",
    10: "fire hydrant", 11: "stop sign", 12: "parking meter", 13: "bench",
    14: "bird", 15: "cat", 16: "dog", 17: "horse", 18: "sheep", 19: "cow",
    20: "elephant", 21: "bear", 22: "zebra", 23: "giraffe", 24: "backpack",
    25: "umbrella", 26: "handbag", 27: "tie", 28: "suitcase", 29: "frisbee",
    30: "skis", 31: "snowboard", 32: "sports ball", 33: "kite",
    34: "baseball bat", 35: "baseball glove", 36: "skateboard", 37: "surfboard",
    38: "tennis racket", 39: "bottle", 40: "wine glass", 41: "cup",
    42: "fork", 43: "knife", 44: "spoon", 45: "bowl", 46: "banana",
    47: "apple", 48: "sandwich", 49: "orange", 50: "broccoli", 51: "carrot",
    52: "hot dog", 53: "pizza", 54: "donut", 55: "cake", 56: "chair",
    57: "couch", 58: "potted plant", 59: "bed", 60: "dining table",
    61: "toilet", 62: "tv", 63: "laptop", 64: "mouse", 65: "remote",
    66: "keyboard", 67: "cell phone", 68: "microwave", 69: "oven",
    70: "toaster", 71: "sink", 72: "refrigerator", 73: "book", 74: "clock",
    75: "vase", 76: "scissors", 77: "teddy bear", 78: "hair drier",
    79: "toothbrush",
}

BALL_CLASS_ID = 32      # 运动球（包含篮球）
PERSON_CLASS_ID = 0     # 人

# --classes 参数预设值 -> 对应 COCO class id 集合
CLASS_PRESETS: dict[str, set[int]] = {
    "ball": {BALL_CLASS_ID},
    "person": {PERSON_CLASS_ID},
    "people": {PERSON_CLASS_ID},
    "player": {PERSON_CLASS_ID},
    "players": {PERSON_CLASS_ID},
    "all": set(COCO_NAMES.keys()),
}


def _resolve_device() -> str:
    """自动选择推理硬件：Mac MPS 优先 -> CUDA -> CPU。"""
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _parse_classes_arg(value: str) -> set[int]:
    """把 --classes 字符串解析为 COCO class id 集合。支持预设名或逗号分隔 id。"""
    v = value.strip().lower()
    if v in CLASS_PRESETS:
        return CLASS_PRESETS[v]
    raw = [p.strip() for p in v.split(",") if p.strip()]
    ids: set[int] = set()
    for r in raw:
        try:
            ids.add(int(r))
        except ValueError as exc:
            raise argparse.ArgumentTypeError(
                f"--classes 取值必须是 {sorted(CLASS_PRESETS.keys())} 之一，"
                f"或者用逗号分隔的 COCO class id，例如 '0,32'。当前值：{r!r}"
            ) from exc
    return ids


def detect(
    video_path: str,
    sample_every: int = 5,
    conf_threshold: float = 0.25,
    target_classes: set[int] | None = None,
    verbose: bool = False,
    model_name: str = "yolov8n.pt",
) -> list[dict]:
    """
    核心检测流程：
      1. 选择设备 + 加载 YOLO 权重（默认 yolov8n.pt，可传 yolov8s.pt / yolov8m.pt 等）
      2. OpenCV 打开视频，读 fps / 宽高 / 总帧数
      3. 按 sample_every 抽帧，每帧跑一次 YOLO.predict
      4. 只保留 target_classes 里的目标，输出 (time, x, y, w, h, class, label, confidence)
      5. stderr 打印全局类别统计，方便诊断到底是「模型没工作」还是「没认出球」
    """
    from ultralytics import YOLO

    if target_classes is None:
        target_classes = {BALL_CLASS_ID}

    device = _resolve_device()
    target_names = [COCO_NAMES.get(c, f"cls{c}") for c in sorted(target_classes)]
    print(
        f"[INFO] 模型={model_name}  推理设备={device}  "
        f"目标类别={sorted(target_classes)} ({target_names})  "
        f"置信度阈值={conf_threshold}  抽帧步长={sample_every}",
        file=sys.stderr,
    )

    print(
        f"[INFO] 正在加载 {model_name}（首次运行会自动下载权重到 ~/.cache/ultralytics/）...",
        file=sys.stderr,
    )
    model = YOLO(model_name)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"打开视频失败：{video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    print(
        f"[INFO] 视频信息：{width}x{height}，fps={fps:.2f}，"
        f"总帧数={total_frames}，时长≈{total_frames / fps:.1f} 秒",
        file=sys.stderr,
    )

    results: list[dict] = []           # 最终返回给 JSON 的结果
    frame_idx = 0                      # 当前读到第几帧
    sampled_count = 0                  # 真正送进 YOLO 推理的帧数
    yolo_empty_frames = 0              # 有多少采样帧 YOLO 一个框都没出
    global_class_counter: Counter = Counter()  # 全视频 YOLO 检测到的每个类别计数

    pbar = tqdm(total=total_frames, desc="进度", unit="帧", file=sys.stderr)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            # 每 sample_every 帧采 1 帧，减少计算量
            if frame_idx % sample_every == 0:
                sampled_count += 1
                timestamp = round(frame_idx / fps, 4)   # 当前帧对应的时间戳（秒）

                # 把单帧送进 YOLO 推理
                yolo_results = model.predict(
                    source=frame,
                    device=device,
                    conf=conf_threshold,
                    iou=0.45,
                    verbose=False,
                )

                frame_any_box_from_yolo = False   # 这帧 YOLO 有没有出任何框
                frame_class_counter: Counter = Counter()

                for r in yolo_results:
                    boxes = r.boxes
                    if boxes is None:
                        continue
                    cls_list = boxes.cls.cpu().tolist() if hasattr(boxes, "cls") else []
                    conf_list = boxes.conf.cpu().tolist() if hasattr(boxes, "conf") else []
                    xyxy = boxes.xyxy.cpu().tolist() if hasattr(boxes, "xyxy") else []

                    if cls_list:
                        frame_any_box_from_yolo = True

                    for j, cid in enumerate(cls_list):
                        cid_int = int(cid)
                        frame_class_counter[cid_int] += 1
                        global_class_counter[cid_int] += 1

                        # 类别过滤：只保留用户指定的目标类
                        if cid_int not in target_classes:
                            continue

                        x1, y1, x2, y2 = xyxy[j]
                        cx = int(round((x1 + x2) / 2.0))    # bbox 中心 X
                        cy = int(round((y1 + y2) / 2.0))    # bbox 中心 Y
                        bw = int(round(x2 - x1))            # bbox 宽
                        bh = int(round(y2 - y1))            # bbox 高
                        results.append(
                            {
                                "time": timestamp,
                                "x": cx,
                                "y": cy,
                                "w": bw,
                                "h": bh,
                                "class": cid_int,
                                "label": COCO_NAMES.get(cid_int, str(cid_int)),
                                "confidence": round(float(conf_list[j]), 4),
                            }
                        )

                if not frame_any_box_from_yolo:
                    yolo_empty_frames += 1
                elif verbose:
                    # verbose 模式：每采样帧把该帧检出的类别直方图打到 stderr
                    readable = {
                        COCO_NAMES.get(k, str(k)): v
                        for k, v in frame_class_counter.most_common()
                    }
                    print(
                        f"[DEBUG] 帧号={frame_idx} 时间={timestamp}s "
                        f"该帧类别分布={readable}",
                        file=sys.stderr,
                    )

            frame_idx += 1
            pbar.update(1)
    finally:
        cap.release()
        pbar.close()

    # 统计汇总
    sampled_with_any_yolo_box = sampled_count - yolo_empty_frames
    if global_class_counter:
        summary = {
            COCO_NAMES.get(k, f"cls{k}"): v
            for k, v in global_class_counter.most_common()
        }
    else:
        summary = "<空 —— 所有采样帧 YOLO 都一个框都没输出>"

    print(
        f"[INFO] 完成。采样总帧数={sampled_count}  "
        f"其中 YOLO 检出过框的帧数={sampled_with_any_yolo_box}  "
        f"YOLO 完全没检出框的帧数={yolo_empty_frames}\n"
        f"[INFO] YOLO 在全视频里一共检出过这些类别（按数量排序）：{summary}\n"
        f"[INFO] 本次保留的目标类别命中数：{len(results)}",
        file=sys.stderr,
    )

    # 空结果诊断：告诉用户到底是哪一层出了问题
    if len(results) == 0:
        if yolo_empty_frames == sampled_count:
            print(
                "[WARN] ⚠️  所有采样帧 YOLO 都没出任何框。"
                "常见原因：(a) 模型实际没加载成功；"
                "(b) 视频读不到有效帧；"
                "(c) --conf 设得离谱高。"
                "建议先跑：--classes all --conf 0.01 --verbose 排查。",
                file=sys.stderr,
            )
        else:
            kept_targets = [
                name for cid, name in COCO_NAMES.items() if cid in target_classes
            ]
            print(
                f"[WARN] ⚠️  YOLO 明明检出了别的东西（{summary}），"
                f"但没有一个命中你指定的目标类 {kept_targets}。"
                f"对于 yolov8n 这种 nano 小模型，检测不到小的 'sports ball' 是正常现象，"
                f"不是脚本 bug。建议：--conf 降到 0.05 再试，或者用 --classes all "
                f"看一眼 YOLO 到底在这个视频里能认出什么。",
                file=sys.stderr,
            )

    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="最简 YOLOv8 检测器——强烈建议先 --classes person 跑一遍确认环境，"
                    "再切回 --classes ball 测篮球。"
    )
    parser.add_argument("--input", "-i", required=True, help="输入视频文件路径（必填）")
    parser.add_argument(
        "--sample-every",
        "-s",
        type=int,
        default=5,
        help="每 N 帧采样 1 帧送 YOLO 推理，默认 5（30fps 视频约等于 6fps）",
    )
    parser.add_argument(
        "--conf",
        "-c",
        type=float,
        default=0.25,
        help="YOLO 置信度阈值，默认 0.25。测 ball 强烈建议先 0.05~0.1 起步。",
    )
    parser.add_argument(
        "--classes",
        default="ball",
        help="目标类别过滤（默认 'ball'）："
             "'ball' = COCO 32 (sports ball) / "
             "'person' = COCO 0 / "
             "'all' = 全部 80 类 / "
             "也可以手写逗号分隔 id，例如 '0,32'。",
    )
    parser.add_argument(
        "--model",
        "-m",
        type=str,
        default="yolov8n.pt",
        help="YOLOv8 权重文件名或本地路径（默认 yolov8n.pt）。"
             "常用值：yolov8n.pt (6MB, 最快) / yolov8s.pt (22MB) / yolov8m.pt (95MB)。"
             "不在本地的 ultralytics 会自动从官方下载。",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="输出 JSON 文件路径；不传则直接打印到 stdout",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="每采样帧额外打印该帧的 YOLO 类别直方图（调试用）",
    )
    args = parser.parse_args()

    try:
        target_classes = _parse_classes_arg(args.classes)
    except argparse.ArgumentTypeError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2

    video_path = Path(args.input)
    if not video_path.exists():
        print(f"[ERROR] 找不到视频文件：{video_path}", file=sys.stderr)
        return 1

    detections = detect(
        video_path=str(video_path),
        sample_every=max(1, int(args.sample_every)),
        conf_threshold=float(args.conf),
        target_classes=target_classes,
        verbose=bool(args.verbose),
        model_name=str(args.model),
    )

    payload = json.dumps(detections, indent=2, ensure_ascii=False)
    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload, encoding="utf-8")
        print(f"[INFO] 已写入 {len(detections)} 条检测结果到：{out_path}", file=sys.stderr)
    else:
        print(payload)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
