from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image


ALPHA_THRESHOLD = 32


def connected_components(alpha: Image.Image) -> list[dict]:
    width, height = alpha.size
    pixels = alpha.load()
    seen = bytearray(width * height)
    components = []
    for y in range(height):
        for x in range(width):
            key = y * width + x
            if seen[key] or pixels[x, y] < ALPHA_THRESHOLD:
                continue
            queue = deque([(x, y)])
            seen[key] = 1
            points = []
            while queue:
                current_x, current_y = queue.popleft()
                points.append((current_x, current_y))
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_key = next_y * width + next_x
                    if seen[next_key] or pixels[next_x, next_y] < ALPHA_THRESHOLD:
                        continue
                    seen[next_key] = 1
                    queue.append((next_x, next_y))
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            components.append({
                "area": len(points),
                "bbox": (min(xs), min(ys), max(xs) + 1, max(ys) + 1),
            })
    return components


def extract(
    source: Path,
    output_dir: Path,
    expected: int = 8,
    frame_width: int = 420,
    target_height: int = 520,
    bottom_margin: int = 40,
) -> None:
    sheet = Image.open(source).convert("RGBA")
    width, height = sheet.size
    minimum_area = max(2500, int(width * height * 0.008))
    characters = [item for item in connected_components(sheet.getchannel("A")) if item["area"] >= minimum_area]
    characters.sort(key=lambda item: (item["bbox"][0] + item["bbox"][2]) / 2)
    if len(characters) != expected:
        raise RuntimeError(f"expected {expected} isolated characters, found {len(characters)} in {source}")

    centers = [(item["bbox"][0] + item["bbox"][2]) / 2 for item in characters]
    boundaries = [0]
    boundaries.extend(round((centers[index] + centers[index + 1]) / 2) for index in range(expected - 1))
    boundaries.append(width)

    regions = []
    for index in range(expected):
        region = sheet.crop((boundaries[index], 0, boundaries[index + 1], height))
        content_box = region.getchannel("A").getbbox()
        if not content_box:
            raise RuntimeError(f"empty character region {index} in {source}")
        regions.append(region.crop(content_box))

    # One scale for the complete sheet is essential. Scaling every pose to the
    # same height makes seated/landing poses grow and standing poses shrink,
    # which looks like severe flicker in animation. The tallest pose is the
    # standing-size reference; shorter poses retain their real proportions.
    reference_height = max(content.height for content in regions)
    scale = min(
        target_height / reference_height,
        (height - bottom_margin - 16) / reference_height,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    for index, source_content in enumerate(regions):
        content = source_content.resize(
            (round(source_content.width * scale), round(source_content.height * scale)),
            Image.Resampling.LANCZOS,
        )
        frame = Image.new("RGBA", (frame_width, height), (0, 0, 0, 0))
        frame.alpha_composite(content, ((frame_width - content.width) // 2, height - bottom_margin - content.height))
        frame.save(output_dir / f"{index}.png", optimize=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: extract-complete-frame-characters.py SOURCE OUTPUT_DIR [FRAME_COUNT] [TARGET_HEIGHT]")
    extract(
        Path(sys.argv[1]),
        Path(sys.argv[2]),
        int(sys.argv[3]) if len(sys.argv) > 3 else 8,
        target_height=int(sys.argv[4]) if len(sys.argv) > 4 else 520,
        frame_width=int(sys.argv[5]) if len(sys.argv) > 5 else 420,
    )
