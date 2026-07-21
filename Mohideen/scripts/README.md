# Mohideen Android Icon Generator

## Setup (one-time)
```
pip install Pillow
```

## How to update icons

1. Place your source files in this folder:
   - `AppIcon.png` — full-color app icon (1024×1024 recommended, square, transparent or solid bg)
   - `NotificationIcon.png` — notification silhouette source (any size, will be auto-converted to white-on-transparent)

2. Run:
   ```
   python generate_icons.py
   ```

3. Rebuild the app:
   ```
   cd ../android && ./gradlew assembleRelease
   ```

## What gets generated

| Output | Source |
|--------|--------|
| `mipmap-*/ic_launcher.png` | AppIcon.png resized |
| `mipmap-*/ic_launcher_round.png` | AppIcon.png clipped to circle |
| `mipmap-*/ic_launcher_foreground.png` | AppIcon.png padded to 72% safe zone (adaptive icon layer) |
| `drawable-*/ic_notification.png` | NotificationIcon.png → white silhouette |

Adaptive icon XMLs (`mipmap-anydpi-v26/`) are pre-configured and do not need regenerating.
