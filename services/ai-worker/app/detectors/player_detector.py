from __future__ import annotations

from typing import Callable, Optional

from app.types import Detection, PipelineContext, Roi
from app.logging_setup import logger


# ==============================================================================
# 【MVP 最小可用版 · YOLOv8 推理封装】
# ------------------------------------------------------------------------------
# 设计决策：
#   1. 用 ultralytics YOLOv8 预训练权重 (yolov8n.pt, 6MB)
#      - person (class=0)                → PlayerDetector
#      - sports ball (class=32 in COCO)  → BallDetector
#      - 篮筐不在 COCO 80 类里，暂时用 HoopDetector 的 warm_up 行为
#        1) 用户手动给了 hoop_roi → 直接用 ROI 生成固定 bbox
#        2) 用户没给 → 先尝试用 person bbox 中心 + 球场中心启发式估一个篮筐位置
#        等 MVP v0.2 再训练专门的篮球场景 YOLO 模型替换。
#   2. 全局单例 _YOLOManager：所有 3 个 Detector 共享同一份模型权重内存，
#      不会出现 Player / Ball / Hoop 每个 Detector 都加载一份 yolov8n.pt 浪费 18MB 的情况。
#   3. 设备选择：优先 MPS (Apple Silicon) → 次选 CPU → CUDA 留给云端 GPU 实例。
#      根据 env AI_TORCH_BACKEND 控制，默认 auto。
#   4. 首次调用才懒加载：如果 AI_DEMO_MODE=true，直接跳过加载，pipeline 阶段会由
#      DEMO mode 自己生成 highlights，不会触发模型下载/加载。
# ==============================================================================

class _YOLOManager:
    """模块级 YOLO 单例：懒加载 + 共享权重内存。"""

    _instance: Optional["_YOLOManager"] = None
    _initialized = False

    def __new__(cls):  # singleton
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        self._model = None
        self._device: Optional[str] = None

    # ------------------------------------------------------------------
    def _resolve_device(self) -> str:
        """根据 env AI_TORCH_BACKEND + 实际硬件能力，选择推理 device。"""
        from app.config import get_settings
        backend = get_settings().ai_torch_backend or "auto"
        if backend in ("mps", "cpu", "cuda"):
            return backend

        # auto：按优先级 MPS → CUDA → CPU 顺序探测
        try:
            import torch  # type: ignore
            if torch.backends.mps.is_available() and torch.backends.mps.is_built():
                return "mps"
            if torch.cuda.is_available():
                return "cuda"
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"torch not importable when resolving device: {exc}")
        return "cpu"

    # ------------------------------------------------------------------
    def ensure_loaded(self) -> object:
        """懒加载 yolov8n.pt（首次调用才会下模型/编译 MPS kernel，之后直接复用）。"""
        if self._model is not None:
            return self._model
        # 只有真的需要推理才 import ultralytics，避免 demo mode 白白占 500MB 内存
        try:
            from ultralytics import YOLO  # type: ignore
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Cannot import ultralytics — run `poetry add ultralytics` (or `pip install ultralytics`). "
                f"Falling back to empty detections. Error: {exc}"
            )
            self._model = False  # sentinel = 不可用，所有 detect 返回 []
            return None

        self._device = self._resolve_device()
        logger.info(f"[YOLO] Loading yolov8n pretrained weights onto device={self._device} ...")
        try:
            # ultralytics 会自动从 GitHub 下载到 ~/.cache/ultralytics；
            # 断网时可以手动 curl -L -o ~/.cache/ultralytics/yolov8n.pt URL
            self._model = YOLO("yolov8n.pt")
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[YOLO] Failed to load yolov8n.pt: {exc}. Falling back to empty detections.")
            self._model = False
            return None
        return self._model

    # ------------------------------------------------------------------
    @property
    def device(self) -> str:
        return self._device or "cpu"


_YOLO_SINGLETON = _YOLOManager()


# ==============================================================================
# BaseDetector（原本的 detect_batch 重写为 YOLO batch_infer 一次跑所有帧）
# ==============================================================================
class BaseDetector:
    label: str = "object"
    model_name: str = "noop"

    # COCO class_id → 本 Detector 关心的标签；子类覆盖即可
    coco_class_ids: tuple[int, ...] = ()

    def warm_up(self, ctx: PipelineContext) -> None:  # noqa: B027
        pass

    def detect(self, frame_idx: int, timestamp_sec: float, image=None) -> list[Detection]:
        """单帧 detect（兼容老接口，但推荐走 detect_batch 性能好 ~10 倍）。"""
        if image is None:
            return []
        detections = self.detect_batch([frame_idx], [timestamp_sec], frames=[image])
        return [d for d in detections if d.frame_idx == frame_idx]

    def detect_batch(
        self,
        frame_indices: list[int],
        timestamps: list[float],
        progress_cb: Optional[Callable[[int, int], None]] = None,
        *,
        frames: Optional[list] = None,
    ) -> list[Detection]:
        """
        MVP 版批量推理：把所有帧一次性 YOLO 推理。
         - frames=None（旧接口没传帧列表）时 → fallback 到单帧循环 detect
         - 有 frames → 直接 YOLO.predict(source=frames, stream=False)，一次出所有结果
        注意：这里为了 MVP 简单，所有 Detector 共享同一个 YOLO 权重，只是用 coco_class_ids 把自己要的类筛出来。
        """
        # AI_DEMO_MODE=true 就别跑真 YOLO 了，直接空列表，省时间省内存
        from app.config import get_settings
        if get_settings().ai_demo_mode:
            if progress_cb:
                progress_cb(len(frame_indices), len(frame_indices))
            return []

        model = _YOLO_SINGLETON.ensure_loaded()
        if model in (None, False):
            if progress_cb:
                progress_cb(len(frame_indices), len(frame_indices))
            return []

        if frames is None or len(frames) == 0:
            # 旧接口没传 frame 数据，只能空结果（后续 pipeline 阶段我们会把 frames 显式传进来）
            if progress_cb:
                progress_cb(len(frame_indices), len(frame_indices))
            return []

        try:
            results = model.predict(
                source=frames,
                device=_YOLO_SINGLETON.device,
                conf=get_settings().ai_confidence_threshold,
                iou=0.45,
                verbose=False,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"[YOLO] predict failed for {len(frames)} frames: {exc}")
            if progress_cb:
                progress_cb(len(frame_indices), len(frame_indices))
            return []

        out: list[Detection] = []
        for i, result in enumerate(results):
            if i >= len(frame_indices):
                break
            if progress_cb and (i % max(1, len(frame_indices) // 20) == 0 or i == len(frame_indices) - 1):
                progress_cb(i + 1, len(frame_indices))
            boxes = result.boxes
            if boxes is None:
                continue
            cls_list = boxes.cls.cpu().tolist() if hasattr(boxes, "cls") else []
            conf_list = boxes.conf.cpu().tolist() if hasattr(boxes, "conf") else []
            xyxy = boxes.xyxy.cpu().tolist() if hasattr(boxes, "xyxy") else []
            for j, cid in enumerate(cls_list):
                if int(cid) not in self.coco_class_ids:
                    continue
                x1, y1, x2, y2 = xyxy[j]
                out.append(Detection(
                    frame_idx=frame_indices[i],
                    timestamp_sec=timestamps[i],
                    bbox=(float(x1), float(y1), float(x2), float(y2)),
                    score=float(conf_list[j]),
                    label=self.label,
                ))
        if progress_cb:
            progress_cb(len(frame_indices), len(frame_indices))
        return out


# ==============================================================================
# PlayerDetector · COCO class 0 (person)
# ==============================================================================
class PlayerDetector(BaseDetector):
    label = "player"
    model_name = "yolov8n-person"
    coco_class_ids = (0,)


# ==============================================================================
# BallDetector · COCO class 32 (sports ball)
# ==============================================================================
class BallDetector(BaseDetector):
    label = "ball"
    model_name = "yolov8n-ball"
    coco_class_ids = (32,)


# ==============================================================================
# HoopDetector · COCO 没有篮筐类 → fallback 两种策略：
#   A. 用户手动提供 ctx.hoop_roi（比如校准页画的框）→ 每帧都把这个 ROI 当一次 detection
#      （相当于用户帮你标了篮筐位置，MVP 能跑得通）
#   B. 没给 hoop_roi → 返回空列表，后面的 pipeline 会跳过"篮筐命中验证"那步
#      MVP v0.2 再专门训 basketball-scene YOLO 来识别篮筐 class
# ==============================================================================
class HoopDetector(BaseDetector):
    label = "hoop"
    model_name = "yolov8n-hoop-fallback"
    coco_class_ids = ()   # COCO 里没篮筐，全 fallback 人工模式
    _last_ctx: Optional[PipelineContext] = None

    def warm_up(self, ctx: PipelineContext) -> None:
        """
        记住用户给的 hoop_roi（如果有的话），后面 detect 直接用它生成固定 bbox。
        """
        self._last_ctx = ctx
        if getattr(ctx, "hoop_roi", None) is not None:
            logger.info(f"[HoopDetector] Using user-provided hoop ROI: {ctx.hoop_roi}")

    def detect_batch(
        self,
        frame_indices: list[int],
        timestamps: list[float],
        progress_cb: Optional[Callable[[int, int], None]] = None,
        *,
        frames: Optional[list] = None,
    ) -> list[Detection]:
        """
        Hoop MVP fallback：
          - AI_DEMO_MODE=true → 空
          - 用户给了 hoop_roi → 每帧加一条固定 bbox，score=1.0（用户保证对的）
          - 没给 hoop_roi → 先不跑 YOLO，返回空，pipeline 按"没篮筐校准模式"跑
        """
        from app.config import get_settings
        if get_settings().ai_demo_mode:
            if progress_cb:
                progress_cb(len(frame_indices), len(frame_indices))
            return []

        roi: Optional[Roi] = getattr(self._last_ctx, "hoop_roi", None) if self._last_ctx else None
        total = len(frame_indices)
        if progress_cb:
            progress_cb(total, total)
        if roi is None:
            return []

        x2 = roi.x + roi.width
        y2 = roi.y + roi.height
        return [
            Detection(
                frame_idx=fi,
                timestamp_sec=ts,
                bbox=(float(roi.x), float(roi.y), float(x2), float(y2)),
                score=1.0,
                label=self.label,
            )
            for fi, ts in zip(frame_indices, timestamps)
        ]
