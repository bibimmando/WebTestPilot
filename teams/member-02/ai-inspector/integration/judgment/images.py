"""Load bounded actual PNG/JPEG images strictly inside the explicit run root."""
import base64
from pathlib import Path


def load_images(payload, run_root, *, max_bytes=5_000_000, max_total_bytes=15_000_000):
    blocks, records, total = [], {}, 0
    root = Path(run_root).resolve() if run_root is not None else None
    for scenario in payload["scenarios"]:
        identifier = scenario["scenario_id"]
        image = scenario.get("image")
        records[identifier] = {"status": "missing", "reason": "image_not_provided"}
        if not image:
            continue
        if root is None:
            records[identifier]["reason"] = "run_root_required"
            continue
        raw_path = image.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            continue
        candidate = (root / raw_path).resolve()
        if not candidate.is_relative_to(root):
            records[identifier]["reason"] = "image_outside_run_root"
            continue
        try:
            if candidate.stat().st_size > max_bytes:
                records[identifier]["reason"] = "image_size_limit"
                continue
            with candidate.open("rb") as stream:
                data = stream.read(max_bytes + 1)
            if len(data) > max_bytes or total + len(data) > max_total_bytes:
                records[identifier]["reason"] = "image_size_limit"
                continue
            media = "image/png" if data.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if data.startswith(b"\xff\xd8\xff") else None
            if media is None:
                records[identifier]["reason"] = "unsupported_image"
                continue
        except OSError:
            records[identifier]["reason"] = "image_unreadable"
            continue
        total += len(data)
        records[identifier] = {"status": "available", "snapshot_id": image["snapshot_id"],
                               "path": str(candidate), "media_type": media, "bytes": len(data)}
        blocks.extend([{"type": "text", "text": f"Image evidence: scenario_id={identifier}, snapshot_id={image['snapshot_id']}"},
                       {"type": "image", "source": {"type": "base64", "media_type": media,
                                                        "data": base64.b64encode(data).decode("ascii")}}])
    return blocks, records
