#!/usr/bin/env bash
# Install Floci CLI to ~/.local/bin (no sudo). Add to PATH: export PATH="$HOME/.local/bin:$PATH"
#
# The installer is downloaded, checked against a pinned SHA-256 and only then run (it used to be piped
# straight into sh). The CLI version is pinned too; the installer verifies the binary against the release's
# sha256sums.txt. To upgrade: read the new install.sh, then update FLOCI_INSTALLER_SHA256 and FLOCI_CLI_VERSION.
set -euo pipefail

FLOCI_CLI_VERSION="${FLOCI_CLI_VERSION:-0.4.0}"
FLOCI_INSTALLER_SHA256="${FLOCI_INSTALLER_SHA256:-d2564a85bf07d389691987807e58d32a9904105e07dd20ede3ffb7bce9de056d}"
INSTALL_DIR="${FLOCI_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL --max-time 60 https://floci.io/install.sh -o "$tmp"

actual="$(sha256sum "$tmp" | awk '{print $1}')"
if [ "$actual" != "$FLOCI_INSTALLER_SHA256" ]; then
  echo "Refusing to run https://floci.io/install.sh: its SHA-256 changed." >&2
  echo "  expected: $FLOCI_INSTALLER_SHA256" >&2
  echo "  actual:   $actual" >&2
  echo "Review the new installer, then update FLOCI_INSTALLER_SHA256 (and FLOCI_CLI_VERSION) in this script." >&2
  exit 1
fi

FLOCI_CLI_VERSION="$FLOCI_CLI_VERSION" FLOCI_INSTALL_DIR="$INSTALL_DIR" sh "$tmp"
echo ""
echo "Installed: $(command -v floci || echo "$INSTALL_DIR/floci")"
echo 'Add to shell profile: export PATH="$HOME/.local/bin:$PATH"'
floci doctor 2>/dev/null || true
