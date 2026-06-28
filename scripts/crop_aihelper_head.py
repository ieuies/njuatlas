"""Crop chat avatar (whale + face) from image/aihelper.png (does not modify source)."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "image" / "aihelper.png"
OUT = ROOT / "image" / "aihelper-head.png"

# Square centered on face: whale hat on top + eyes/smile
CENTER_Y_RATIO = 0.46
SIDE_RATIO = 0.60


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        raise SystemExit(f"no content in {SRC}")

    left, top, right, bottom = bbox
    content_w = right - left + 1
    content_h = bottom - top + 1

    side = int(content_h * SIDE_RATIO)
    cx = left + content_w // 2
    cy = top + int(content_h * CENTER_Y_RATIO)

    crop_left = max(left, cx - side // 2)
    crop_top = max(top, cy - side // 2)
    crop_right = min(right + 1, crop_left + side)
    crop_bottom = min(bottom + 1, crop_top + side)

    crop_w = crop_right - crop_left
    crop_h = crop_bottom - crop_top
    side = min(crop_w, crop_h)
    crop_right = crop_left + side
    crop_bottom = crop_top + side

    head = im.crop((crop_left, crop_top, crop_right, crop_bottom))
    head.save(OUT, optimize=True)
    print(f"saved {OUT} size={head.size} crop=({crop_left},{crop_top},{crop_right},{crop_bottom})")


if __name__ == "__main__":
    main()
