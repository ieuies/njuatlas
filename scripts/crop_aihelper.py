"""Crop AI welcome avatar to upper body (to arm bottom) and save transparent PNG."""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(
    r"C:\Users\28274\.cursor\projects\d-njuatlas\assets"
    r"\c__Users_28274_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_"
    r"images_image-7544ff10-a6f4-4198-b2fe-09944dc15232.png"
)
FALLBACK = ROOT / "image" / "bot" / "害羞.png"
OUT = ROOT / "image" / "aihelper.png"
# 托脸姿势：裁到前臂/胸口蝴蝶结下沿（约为内容区高度的 54%）
BUST_HEIGHT_RATIO = 0.54


def load_source() -> Image.Image:
    path = SRC if SRC.exists() else FALLBACK
    return Image.open(path).convert("RGBA")


def remove_black_background(im: Image.Image) -> Image.Image:
    arr = np.array(im)
    rgb = arr[:, :, :3]
    black = (rgb[:, :, 0] < 35) & (rgb[:, :, 1] < 35) & (rgb[:, :, 2] < 35)
    arr[black, 3] = 0
    return Image.fromarray(arr)


def find_arm_bottom_y(im: Image.Image) -> int:
    bbox = im.getbbox()
    if not bbox:
        _h = im.height
        return int(_h * BUST_HEIGHT_RATIO)

    _left, top, _right, bottom = bbox
    content_h = bottom - top + 1
    return min(im.height - 1, top + int(content_h * BUST_HEIGHT_RATIO))


def main() -> None:
    im = remove_black_background(load_source())
    cut_y = find_arm_bottom_y(im)
    cropped = im.crop((0, 0, im.width, cut_y + 1))
    bbox = cropped.getbbox()
    if bbox:
        cropped = cropped.crop(bbox)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(OUT, optimize=True)
    print(f"saved {OUT} size={cropped.size} cut_y={cut_y}")


if __name__ == "__main__":
    main()
