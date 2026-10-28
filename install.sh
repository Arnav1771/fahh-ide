#!/usr/bin/env bash
# Fahh Editor one-line installer for Linux and macOS
# Usage:
#   curl -fsSL https://fahhide.duckdns.org/install.sh | bash
# Windows (PowerShell):
#   irm https://fahhide.duckdns.org/install.ps1 | iex

set -euo pipefail

REPO="Arnav1771/fahh-ide"
OS="$(uname -s)"
ARCH="$(uname -m)"

echo "=== Fahh Editor installer ==="
TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep -m1 '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' || true)"
TAG="${TAG:-v0.6.7}"
VER="${TAG#v}"
BASE="https://github.com/$REPO/releases/download/$TAG"
echo "Installing Fahh Editor $TAG for $OS ($ARCH)..."

if [ "$OS" = "Linux" ]; then
  if [ "$ARCH" != "x86_64" ]; then
    echo "Fahh Editor ships for x86_64 Linux only for now (this machine is $ARCH)." >&2
    exit 1
  fi
  BIN="$HOME/.local/bin"
  mkdir -p "$BIN" "$HOME/.local/share/applications"
  curl -fL --progress-bar "$BASE/Fahh.Editor_${VER}_amd64.AppImage" -o "$BIN/fahh.part"
  mv "$BIN/fahh.part" "$BIN/fahh"
  chmod +x "$BIN/fahh"
  cat > "$HOME/.local/share/applications/fahh-editor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Fahh Editor
Comment=Code editor with a spatial canvas and the fahh
Exec=$BIN/fahh %F
Terminal=false
Categories=Development;IDE;TextEditor;
EOF
  echo "[OK] Installed to $BIN/fahh (and the app menu)."
  case ":$PATH:" in *":$BIN:"*) ;; *) echo "Add it to your PATH:  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc" ;; esac
  if ! ldconfig -p 2>/dev/null | grep -q 'libfuse.so.2'; then
    echo "AppImages need FUSE 2. On Ubuntu/Debian:  sudo apt install libfuse2   (Fedora: sudo dnf install fuse-libs)"
  fi
  echo "Run it with:  fahh"
elif [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then DMG="Fahh.Editor_${VER}_aarch64.dmg"; else DMG="Fahh.Editor_${VER}_x64.dmg"; fi
  TMP="$(mktemp -d)"
  trap 'hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true; rm -rf "$TMP"' EXIT
  curl -fL --progress-bar "$BASE/$DMG" -o "$TMP/fahh.dmg"
  mkdir "$TMP/mnt"
  hdiutil attach "$TMP/fahh.dmg" -mountpoint "$TMP/mnt" -nobrowse -quiet
  APP="$(find "$TMP/mnt" -maxdepth 1 -name '*.app' | head -n1)"
  NAME="$(basename "$APP")"
  rm -rf "/Applications/$NAME"
  cp -R "$APP" /Applications/
  # Downloaded with curl, so not quarantined; clear it anyway so an unsigned build opens.
  xattr -dr com.apple.quarantine "/Applications/$NAME" 2>/dev/null || true
  echo "[OK] Installed /Applications/$NAME"
  echo "Open it with:  open -a \"${NAME%.app}\""
else
  echo "Unsupported OS: $OS. On Windows, in PowerShell:" >&2
  echo "  irm https://fahhide.duckdns.org/install.ps1 | iex" >&2
  exit 1
fi
echo "Done."
