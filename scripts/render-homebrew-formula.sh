#!/usr/bin/env bash
# Render the Homebrew formula for a published release.
#
# Usage:
#   ./scripts/render-homebrew-formula.sh v0.6.0 > /tmp/dumpvault.rb
#
# Then commit /tmp/dumpvault.rb as Formula/dumpvault.rb in the
# homebrew-dumpvault tap repo and push.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <tag>   (e.g. $0 v0.6.0)" >&2
  exit 2
fi

TAG="$1"
case "$TAG" in
  v*) VERSION="${TAG#v}" ;;
  *) echo "tag must start with 'v' (got: $TAG)" >&2; exit 2 ;;
esac

REPO="ahmedtahir2311/dumpvault"
BASE="https://github.com/${REPO}/releases/download/${TAG}"
TEMPLATE="$(dirname "$0")/../release/homebrew-formula-template.rb"

[ -f "$TEMPLATE" ] || { echo "template not found at $TEMPLATE" >&2; exit 1; }

fetch_sha() {
  local asset="$1"
  curl -fsSL "${BASE}/${asset}.sha256" | awk '{print $1}' \
    || { echo "failed to fetch sha for ${asset} from ${BASE}" >&2; exit 1; }
}

echo "fetching checksums for ${TAG}..." >&2
SHA_DARWIN_ARM64=$(fetch_sha "dumpvault-darwin-arm64")
SHA_DARWIN_X64=$(fetch_sha "dumpvault-darwin-x64")
SHA_LINUX_ARM64=$(fetch_sha "dumpvault-linux-arm64")
SHA_LINUX_X64=$(fetch_sha "dumpvault-linux-x64")

[ -n "$SHA_DARWIN_ARM64" ] || { echo "empty sha for darwin-arm64" >&2; exit 1; }
[ -n "$SHA_DARWIN_X64" ]   || { echo "empty sha for darwin-x64"   >&2; exit 1; }
[ -n "$SHA_LINUX_ARM64" ]  || { echo "empty sha for linux-arm64"  >&2; exit 1; }
[ -n "$SHA_LINUX_X64" ]    || { echo "empty sha for linux-x64"    >&2; exit 1; }

sed \
  -e "s|%VERSION%|${VERSION}|g" \
  -e "s|%SHA_DARWIN_ARM64%|${SHA_DARWIN_ARM64}|g" \
  -e "s|%SHA_DARWIN_X64%|${SHA_DARWIN_X64}|g" \
  -e "s|%SHA_LINUX_ARM64%|${SHA_LINUX_ARM64}|g" \
  -e "s|%SHA_LINUX_X64%|${SHA_LINUX_X64}|g" \
  "$TEMPLATE"
