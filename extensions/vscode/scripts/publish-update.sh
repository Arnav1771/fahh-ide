#!/usr/bin/env bash
# Package this extension and publish it for self-update:
# writes vscode/<name>-<version>.vsix and vscode/latest.json into the Pages branch (via a temp worktree) and pushes.
# Usage: scripts/publish-update.sh ["release notes"]
set -euo pipefail

PAGES_BRANCH=gh-pages
PAGES_DIR=vscode
BASE_URL=https://fahhide.duckdns.org/vscode   # must match LATEST_URL / HOSTS in src/selfUpdate.ts

cd "$(dirname "$0")/.."
NAME=$(node -p 'require("./package.json").name')
VERSION=$(node -p 'require("./package.json").version')
NOTES=${1:-"$NAME $VERSION"}
VSIX="$NAME-$VERSION.vsix"

npm run compile
npx --yes @vscode/vsce package --no-dependencies -o "$VSIX"

WT="$HOME/.publish-$NAME-$$"
trap 'git worktree remove --force "$WT" 2>/dev/null || true' EXIT
git fetch -q origin "$PAGES_BRANCH"
git worktree add -q --detach "$WT" "origin/$PAGES_BRANCH"
mkdir -p "$WT/$PAGES_DIR"
cp "$VSIX" "$WT/$PAGES_DIR/"
node -e 'const [v,u,n]=process.argv.slice(1);console.log(JSON.stringify({version:v,url:u,notes:n},null,2))' \
  "$VERSION" "$BASE_URL/$VSIX" "$NOTES" > "$WT/$PAGES_DIR/latest.json"
git -C "$WT" add "$PAGES_DIR"
git -C "$WT" commit -q -m "Publish $NAME $VERSION for self-update"
git -C "$WT" push -q origin "HEAD:$PAGES_BRANCH"
echo "published $BASE_URL/latest.json -> $VERSION"
