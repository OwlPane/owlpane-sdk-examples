#!/usr/bin/env bash
# Install Floci CLI to ~/.local/bin (no sudo). Add to PATH: export PATH="$HOME/.local/bin:$PATH"
# Pinned release + sha256 (from the release's sha256sums.txt); no remote installer script is executed.
# Bump: set FLOCI_CLI_VERSION and the four sums from https://github.com/floci-io/floci-cli/releases/download/<tag>/sha256sums.txt
set -euo pipefail
FLOCI_CLI_VERSION="${FLOCI_CLI_VERSION:-0.4.0}"
INSTALL_DIR="${FLOCI_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) PLATFORM=linux-amd64 ;;
  Linux-aarch64 | Linux-arm64) PLATFORM=linux-arm64 ;;
  Darwin-x86_64) PLATFORM=darwin-amd64 ;;
  Darwin-arm64) PLATFORM=darwin-arm64 ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

if [ "$FLOCI_CLI_VERSION" != "0.4.0" ]; then
  echo "Only Floci CLI 0.4.0 has pinned checksums in this script; update the table below to use ${FLOCI_CLI_VERSION}." >&2
  exit 1
fi
case "$PLATFORM" in
  linux-amd64) EXPECTED=cdf4603e169a030b57d18b2fff6ef3f6a4ad45a2bbf137992cb9cf691c4620f8 ;;
  linux-arm64) EXPECTED=62b2d1c202f5041d545e5ae681a38dc9dc148fb355a0b8b203dcae0b0951637b ;;
  darwin-amd64) EXPECTED=40ae8e34e6a82f2db79bfc8d529a287f5f2a38d6123ca8e6f422052e7e0d2366 ;;
  darwin-arm64) EXPECTED=3c0914c12f2dbfcd55eaa164ede3aaefba3ccf16ab520e8dd0c3bb44cd468080 ;;
esac

sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

mkdir -p "$INSTALL_DIR"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
curl -fsSL -o "$TMP" "https://github.com/floci-io/floci-cli/releases/download/${FLOCI_CLI_VERSION}/floci-${PLATFORM}"
ACTUAL="$(sha256_of "$TMP")"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Checksum mismatch for floci-${PLATFORM} ${FLOCI_CLI_VERSION}: expected ${EXPECTED}, got ${ACTUAL}" >&2
  exit 1
fi
chmod +x "$TMP"
mv "$TMP" "$INSTALL_DIR/floci"
trap - EXIT
echo ""
echo "Installed floci ${FLOCI_CLI_VERSION}: $(command -v floci || echo "$INSTALL_DIR/floci")"
echo 'Add to shell profile: export PATH="$HOME/.local/bin:$PATH"'
"$INSTALL_DIR/floci" doctor 2>/dev/null || true
