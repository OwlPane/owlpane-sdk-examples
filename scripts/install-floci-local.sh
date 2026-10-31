#!/usr/bin/env bash
# Install Floci CLI to ~/.local/bin (no sudo). Add to PATH: export PATH="$HOME/.local/bin:$PATH"
set -euo pipefail
INSTALL_DIR="${FLOCI_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"
export FLOCI_INSTALL_DIR="$INSTALL_DIR"
curl -fsSL https://floci.io/install.sh | sh
echo ""
echo "Installed: $(command -v floci || echo "$INSTALL_DIR/floci")"
echo 'Add to shell profile: export PATH="$HOME/.local/bin:$PATH"'
floci doctor 2>/dev/null || true
