#!/usr/bin/env sh
# DumpVault install script.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ahmedtahir2311/dumpvault/main/scripts/install.sh | sh
#
# Override the install dir:
#   curl -fsSL ... | INSTALL_DIR="$HOME/.local/bin" sh
#
# Pin a version:
#   curl -fsSL ... | DUMPVAULT_VERSION="v0.6.0" sh

set -eu

REPO="ahmedtahir2311/dumpvault"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
VERSION="${DUMPVAULT_VERSION:-latest}"

err() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
info() { printf '%s\n' "$*"; }

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) err "unsupported architecture: $ARCH" ;;
esac
case "$OS" in
  darwin|linux) ;;
  *) err "unsupported OS: $OS — Windows users: download the binary directly from https://github.com/$REPO/releases" ;;
esac

# Required tools
command -v curl >/dev/null 2>&1 || err "curl is required"
if command -v shasum >/dev/null 2>&1; then
  SHA_TOOL="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL="sha256sum"
else
  err "neither 'shasum' nor 'sha256sum' is on PATH"
fi

# Resolve URLs
ASSET="dumpvault-${OS}-${ARCH}"
if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
else
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
fi
SHA_URL="${URL}.sha256"

# Determine sudo policy
if [ ! -w "$INSTALL_DIR" ] && [ ! -w "$(dirname "$INSTALL_DIR")" ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
    info "$INSTALL_DIR is not writable — using sudo to install"
  else
    err "$INSTALL_DIR is not writable and sudo is not available — set INSTALL_DIR to a writable path"
  fi
else
  SUDO=""
fi

# Make sure parent dir exists
mkdir -p "$INSTALL_DIR" 2>/dev/null || $SUDO mkdir -p "$INSTALL_DIR"

TMP=$(mktemp -t dumpvault.XXXXXXXX)
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

info "downloading $URL"
curl -fsSL "$URL" -o "$TMP" || err "download failed"

info "fetching sha256 sidecar"
EXPECTED=$(curl -fsSL "$SHA_URL" | awk '{print $1}')
[ -n "$EXPECTED" ] || err "could not fetch checksum from $SHA_URL"

info "verifying integrity"
ACTUAL=$($SHA_TOOL "$TMP" | awk '{print $1}')
if [ "$EXPECTED" != "$ACTUAL" ]; then
  err "sha256 mismatch (expected $EXPECTED, got $ACTUAL)"
fi

chmod +x "$TMP"
$SUDO mv "$TMP" "$INSTALL_DIR/dumpvault"
trap - EXIT

info ""
"$INSTALL_DIR/dumpvault" --version
info ""
info "installed to $INSTALL_DIR/dumpvault"
info ""

# pg_dump check (warn, don't fail)
if ! command -v pg_dump >/dev/null 2>&1; then
  info "note: pg_dump is not on your PATH — install Postgres client tools before dumping a Postgres DB:"
  info "  macOS:  brew install libpq && brew link --force libpq"
  info "  Debian: sudo apt install postgresql-client"
fi

info "next: dumpvault init && \$EDITOR ./dumpvault.yaml"
