#!/usr/bin/env bash
cd ~/fahh-ide
echo "=== loader.config / MonacoEnvironment / monaco-editor refs in src ==="
grep -rn 'loader.config\|MonacoEnvironment\|@monaco-editor/loader\|from "monaco-editor"\|monaco-editor' src/ 2>/dev/null || echo NONE_FOUND
echo ""
echo "=== monaco-editor installed as a package? ==="
if [ -f node_modules/monaco-editor/package.json ]; then
  node -p "'monaco-editor '+require('./node_modules/monaco-editor/package.json').version"
else
  echo NOT_INSTALLED
fi
echo "=== @monaco-editor/react version ==="
node -p "require('./node_modules/@monaco-editor/react/package.json').version"
echo "=== @monaco-editor/loader default CDN path ==="
grep -rn 'cdn.jsdelivr\|CDN\|unpkg\|paths' node_modules/@monaco-editor/loader/lib/es/config/index.js 2>/dev/null | head
echo "=== tauri.conf.json security/csp ==="
grep -n -A3 -i 'security\|csp' src-tauri/tauri.conf.json
echo "=== FileTree open-file handler ==="
grep -n 'readFile\|openTab\|setContent\|open_document\|handleOpen\|onClick' src/components/FileTree/FileTree.tsx | head -20
