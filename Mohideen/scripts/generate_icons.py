#!/usr/bin/env python3
"""
Mohideen Android Icon Generator
================================
Place AppIcon.png and NotificationIcon.png in this folder, then run:
    python generate_icons.py

Requires Pillow:
    pip install Pillow

What it generates
-----------------
Launcher icons (ic_launcher.png + ic_launcher_round.png):
    mipmap-mdpi      48 x 48
    mipmap-hdpi      72 x 72
    mipmap-xhdpi     96 x 96
    mipmap-xxhdpi   144 x 144
    mipmap-xxxhdpi  192 x 192

Adaptive-icon foreground (ic_launcher_foreground.png, 108dp padded to 72% safe zone):
    mipmap-mdpi     108 x 108
    mipmap-hdpi     162 x 162
    mipmap-xhdpi    216 x 216
    mipmap-xxhdpi   324 x 324
    mipmap-xxxhdpi  432 x 432

Notification icon (white silhouette on transparent bg, ic_notification.png):
    drawable-mdpi    24 x 24
    drawable-hdpi    36 x 36
    drawable-xhdpi   48 x 48
    drawable-xxhdpi  72 x 72
    drawable-xxxhdpi 96 x 96
"""

import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("ERROR: Pillow is not installed. Run:  pip install Pillow")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
RES_DIR    = SCRIPT_DIR.parent / "android" / "app" / "src" / "main" / "res"

APP_ICON_SRC  = SCRIPT_DIR / "AppIcon.png"
NOTIF_ICON_SRC = SCRIPT_DIR / "NotificationIcon.png"

# ── Launcher sizes ──────────────────────────────────────────────────────────
LAUNCHER_SIZES = {
    "mipmap-mdpi":     48,
    "mipmap-hdpi":     72,
    "mipmap-xhdpi":    96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
}

# Adaptive foreground sizes (108dp grid at each density)
FOREGROUND_SIZES = {
    "mipmap-mdpi":     108,
    "mipmap-hdpi":     162,
    "mipmap-xhdpi":    216,
    "mipmap-xxhdpi":   324,
    "mipmap-xxxhdpi":  432,
}

# Notification drawable sizes
NOTIF_SIZES = {
    "drawable-mdpi":     24,
    "drawable-hdpi":     36,
    "drawable-xhdpi":    48,
    "drawable-xxhdpi":   72,
    "drawable-xxxhdpi":  96,
}

PRIMARY_GREEN = (27, 94, 32)   # #1B5E20  (used as adaptive background tint check)


def ensure_rgba(img: Image.Image) -> Image.Image:
    return img.convert("RGBA")


def resize_square(img: Image.Image, size: int, resample=Image.LANCZOS) -> Image.Image:
    return img.resize((size, size), resample)


def make_circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    from PIL import ImageDraw
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def apply_round_mask(img: Image.Image) -> Image.Image:
    """Clip image into a circle."""
    size = img.size[0]
    mask = make_circle_mask(size)
    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    result.paste(img, (0, 0), mask=mask)
    return result


def make_foreground(img: Image.Image, canvas_size: int) -> Image.Image:
    """
    Place the icon centered in an adaptive-icon canvas (108dp grid).
    Content should occupy ~72% of the canvas (safe zone) so it is not
    clipped on any launcher shape.
    """
    safe = int(canvas_size * 0.72)
    icon = resize_square(img, safe)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    offset = (canvas_size - safe) // 2
    canvas.paste(icon, (offset, offset), mask=icon)
    return canvas


def to_notification_icon(img: Image.Image, size: int) -> Image.Image:
    """
    Convert any source image into a proper Android notification icon:
    white pixels + transparent background, Material-compliant.
    """
    img = ensure_rgba(img)
    img = resize_square(img, size)

    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels_src = img.load()
    pixels_dst = result.load()

    for y in range(size):
        for x in range(size):
            r, g, b, a = pixels_src[x, y]
            if a > 30:          # treat pixels with any meaningful opacity as "content"
                pixels_dst[x, y] = (255, 255, 255, a)
            else:               # transparent
                pixels_dst[x, y] = (0, 0, 0, 0)

    return result


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(path), "PNG", optimize=True)
    print(f"  ✓  {path.relative_to(SCRIPT_DIR.parent)}")


def generate_launcher_icons():
    if not APP_ICON_SRC.exists():
        print(f"ERROR: {APP_ICON_SRC} not found. Place AppIcon.png in scripts/")
        return False

    print("\n── Launcher icons ─────────────────────────────────────────────")
    src = ensure_rgba(Image.open(APP_ICON_SRC))

    for folder, size in LAUNCHER_SIZES.items():
        icon = resize_square(src, size)
        save(icon, RES_DIR / folder / "ic_launcher.png")
        save(apply_round_mask(resize_square(src, size)), RES_DIR / folder / "ic_launcher_round.png")

    print("\n── Adaptive foreground layer ───────────────────────────────────")
    for folder, size in FOREGROUND_SIZES.items():
        fg = make_foreground(src, size)
        save(fg, RES_DIR / folder / "ic_launcher_foreground.png")

    return True


def generate_notification_icons():
    if not NOTIF_ICON_SRC.exists():
        print(f"ERROR: {NOTIF_ICON_SRC} not found. Place NotificationIcon.png in scripts/")
        return False

    print("\n── Notification icons ──────────────────────────────────────────")
    src = Image.open(NOTIF_ICON_SRC)

    for folder, size in NOTIF_SIZES.items():
        icon = to_notification_icon(src, size)
        save(icon, RES_DIR / folder / "ic_notification.png")

    return True


if __name__ == "__main__":
    print("Mohideen Android Icon Generator")
    print("=" * 40)

    ok1 = generate_launcher_icons()
    ok2 = generate_notification_icons()

    if ok1 and ok2:
        print("\n✅ All icons generated successfully.")
        print("   Next: rebuild the app with  cd android && ./gradlew assembleRelease")
    else:
        print("\n⚠️  Some icons were skipped — check the errors above.")
