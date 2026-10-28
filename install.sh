#!/usr/bin/env bash
# Fahh Editor One-Line Installer for Linux & macOS
# Usage:
#   curl -fsSL https://fahhide.duckdns.org/install.sh | bash

set -e

echo "=== Fahh Editor Installer ==="
OS="$(uname -s)"
ARCH="$(uname -m)"

REPO="Arnav1771/fahh-ide"
LATEST_RELEASE=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null || true)
TAG=$(echo "$LATEST_RELEASE" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' || true)

if [ -z "$TAG" ]; then
  TAG="v0.6.5"
fi

echo "Installing Fahh Editor $TAG for $OS ($ARCH)..."

if [ "$OS" = "Linux" ]; then
  APPIMAGE_URL="https://github.com/$REPO/releases/download/$TAG/Fahh.Editor_${TAG#v}_amd64.AppImage"
  mkdir -p "$HOME/.local/bin"
  curl -fsSL "$APPIMAGE_URL" -o "$HOME/.local/bin/fahh"
  chmod +x "$HOME/.local/bin/fahh"
  echo "[OK] Installed Fahh Editor to $HOME/.local/bin/fahh"
  echo "Make sure $HOME/.local/bin is in your PATH."
elif [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    DMG_URL="https://github.com/$REPO/releases/download/$TAG/Fahh.Editor_${TAG#v}_aarch64.dmg"
  else
    DMG_URL="https://github.com/$REPO/releases/download/$TAG/Fahh.Editor_${TAG#v}_x64.dmg"
  fi
  curl -fsSL "$DMG_URL" -o "/tmp/fahh.dmg"
  hdiutil attach "/tmp/fahh.dmg" -mountpoint "/Volumes/Fahh" -nobrowse -quiet
  cp -R "/Volumes/Fahh/Fahh Editor.app" /Applications/
  hdiutil detach "/Volumes/Fahh" -quiet
  rm -f "/tmp/fahh.dmg"
  echo "[OK] Installed Fahh Editor to /Applications/Fahh Editor.app"
else
  echo "Unsupported OS: $OS. On Windows, please run:"
  echo "  irm https://fahhide.duckdns.org/install.ps1 | iex"
  exit 1
fi

echo "Installation complete!"
