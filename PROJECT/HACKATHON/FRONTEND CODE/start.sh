#!/bin/bash
# ==============================================================================
# Linux Process Tree Visualizer - One-Click Launcher
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================================"
echo "          LINUX PROCESS TREE VISUALIZER                 "
echo "========================================================"

# Compile C core if compiler is available
if command -v gcc >/dev/null 2>&1; then
    echo "[+] Compiling C core binaries (ptree, ptree_json)..."
    make -C c_core >/dev/null 2>&1 || true
    echo "[✓] C core binaries compiled successfully in c_core/"
fi

# Launch backend server
echo "[+] Starting telemetry web server on http://localhost:8080..."

# Auto-open browser in background
(
    sleep 1
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:8080" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
        open "http://localhost:8080" >/dev/null 2>&1 || true
    fi
) &

python3 server.py
