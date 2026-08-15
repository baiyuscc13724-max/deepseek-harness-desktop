from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image


def is_background_candidate(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, _alpha = pixel
    return min(red, green, blue) >= 225 and max(red, green, blue) - min(red, green, blue) <= 10


def remove_background(source: Path, destination: Path) -> None:
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        offset = y * width + x
        if visited[offset] or not is_background_candidate(pixels[x, y]):
            return
        visited[offset] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    output = image.copy()
    output_pixels = output.load()
    for y in range(height):
        for x in range(width):
            if visited[y * width + x]:
                red, green, blue, _alpha = output_pixels[x, y]
                output_pixels[x, y] = (red, green, blue, 0)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination)


if __name__ == "__main__":
    remove_background(Path(sys.argv[1]), Path(sys.argv[2]))
