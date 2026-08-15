from __future__ import annotations

import io
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


def frame_bbox(frame: Image.Image) -> tuple[int, int, int, int] | None:
    return frame.getchannel("A").getbbox()


def analyze_gif(data: bytes) -> tuple[dict, list[Image.Image]]:
    image = Image.open(io.BytesIO(data))
    frames: list[Image.Image] = []
    durations: list[int] = []
    bboxes: list[tuple[int, int, int, int] | None] = []
    changed_bboxes: list[tuple[int, int, int, int] | None] = []
    disposals: list[int | None] = []
    previous: Image.Image | None = None
    for index in range(image.n_frames):
        image.seek(index)
        frame = image.convert("RGBA")
        frames.append(frame.copy())
        durations.append(int(image.info.get("duration", 0)))
        bboxes.append(frame_bbox(frame))
        changed_bboxes.append(ImageChops.difference(previous, frame).getbbox() if previous else None)
        disposals.append(getattr(image, "disposal_method", None))
        previous = frame

    centers = []
    for bbox in bboxes:
        if bbox:
            centers.append(((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2))
    center_range = {
        "x": round(max(x for x, _ in centers) - min(x for x, _ in centers), 2) if centers else 0,
        "y": round(max(y for _, y in centers) - min(y for _, y in centers), 2) if centers else 0,
    }
    duration_counts = Counter(durations)
    return {
        "size": list(image.size),
        "frames": image.n_frames,
        "durationMs": sum(durations),
        "fpsEquivalent": round(image.n_frames / max(0.001, sum(durations) / 1000), 2),
        "frameDurationsMs": durations,
        "durationDistribution": dict(sorted(duration_counts.items())),
        "loop": image.info.get("loop"),
        "transparencyIndex": image.info.get("transparency"),
        "disposalMethods": sorted(set(disposals), key=lambda value: -1 if value is None else value),
        "opaqueBounds": [list(bbox) if bbox else None for bbox in bboxes],
        "changedBounds": [list(bbox) if bbox else None for bbox in changed_bboxes],
        "centerMovementPixels": center_range,
    }, frames


def save_contact_sheet(frames: list[Image.Image], output: Path) -> None:
    max_frames = 40
    selected = frames if len(frames) <= max_frames else [
        frames[round(index * (len(frames) - 1) / (max_frames - 1))] for index in range(max_frames)
    ]
    cell_height = 180
    scale = cell_height / max(1, max(frame.height for frame in selected))
    cell_width = max(80, round(max(frame.width for frame in selected) * scale))
    columns = min(10, len(selected))
    rows = (len(selected) + columns - 1) // columns
    sheet = Image.new("RGBA", (cell_width * columns, (cell_height + 24) * rows), (30, 34, 42, 255))
    draw = ImageDraw.Draw(sheet)
    for index, frame in enumerate(selected):
        resized = frame.resize((round(frame.width * scale), round(frame.height * scale)), Image.Resampling.LANCZOS)
        x = (index % columns) * cell_width + (cell_width - resized.width) // 2
        y = (index // columns) * (cell_height + 24)
        sheet.alpha_composite(resized, (x, y))
        draw.text((index % columns * cell_width + 4, y + cell_height + 3), str(index), fill=(255, 255, 255, 255))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def main() -> None:
    archive = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, dict] = {}
    with zipfile.ZipFile(archive) as package:
        candidates = [
            name for name in package.namelist()
            if name.lower().endswith(".gif") and " (1).gif" not in name
        ]
        for name in candidates:
            try:
                display_name = name.encode("cp437").decode("gbk")
            except (UnicodeEncodeError, UnicodeDecodeError):
                display_name = name
            action = Path(display_name).stem
            metrics, frames = analyze_gif(package.read(name))
            metrics["archivePath"] = display_name
            report[action] = metrics
            save_contact_sheet(frames, output_dir / "contact-sheets" / f"{action}.png")
    (output_dir / "animation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
