# App icons

- `icon.icns` — macOS Dock / Finder (built with `iconutil`)
- `icon.png` — canonical square artwork for About, Electron and Windows/Linux packaging

## Update the app icon

1. Replace `icon.png` with the new square artwork.
2. From `client/desktop`:

```bash
RES="$(pwd)/resources"
SRC="$RES/icon.png"
ICONSET="$RES/Coloride.iconset"
mkdir -p "$ICONSET"
sips -z 1024 1024 "$SRC" --out /tmp/coloride-1024.png
for s in 16 32 128 256 512; do
  sips -z $s $s /tmp/coloride-1024.png --out "$ICONSET/icon_${s}x${s}.png"
done
sips -z 32 32 /tmp/coloride-1024.png --out "$ICONSET/icon_16x16@2x.png"
sips -z 64 64 /tmp/coloride-1024.png --out "$ICONSET/icon_32x32@2x.png"
sips -z 256 256 /tmp/coloride-1024.png --out "$ICONSET/icon_128x128@2x.png"
sips -z 512 512 /tmp/coloride-1024.png --out "$ICONSET/icon_256x256@2x.png"
sips -z 1024 1024 /tmp/coloride-1024.png --out "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$RES/icon.icns"
rm -rf "$ICONSET" /tmp/coloride-1024.png
```

3. Restart Electron (`Cmd+Q` then open again). Dock should show the new icon in dev via `app.dock.setIcon`.
