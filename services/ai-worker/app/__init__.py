__all__ = ["process_video", "export_highlights"]


def __getattr__(name):
    if name in __all__:
        from app.worker import process_video, export_highlights
        return {"process_video": process_video, "export_highlights": export_highlights}[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

