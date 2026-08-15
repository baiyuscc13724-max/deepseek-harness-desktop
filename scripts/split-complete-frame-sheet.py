from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def split_sheet(source: Path, output_dir: Path, frame_count: int = 8) -> None:
    image = Image.open(source).convert("RGBA")
    output_dir.mkdir(parents=True, exist_ok=True)
    for index in range(frame_count):
        left = round(index * image.width / frame_count)
        right = round((index + 1) * image.width / frame_count)
        frame = image.crop((left, 0, right, image.height))
        frame.save(output_dir / f"{index}.png", optimize=True)


if __name__ == "__main__":
    split_sheet(Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 8)
