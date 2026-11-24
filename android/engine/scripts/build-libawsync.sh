#!/usr/bin/env bash
# Builds the Android sync engine libawsync.so for arm64-v8a and x86_64 from the pinned Syncthing
# source tag (docs/tech-stack.md 1.2, docs/phase-1.md 6.7). The recipe is the one of
# researchxxl/syncthing-android: `go run build.go -goos android -goarch <arch> -cc <ndk clang>
# -no-upgrade build` with CGO_ENABLED=1 and EXTRA_LDFLAGS=-checklinkname=0. No fork code is used.
#
# Usage:
#   build-libawsync.sh <work dir> <out dir> [abi ...]
#     <work dir>  Go, the source and the Go caches (remove it after the build to free the disk)
#     <out dir>   gets <abi>/libawsync.so (the jniLibs layout)
#     abi         arm64-v8a and/or x86_64 (default: both)
# Environment:
#   ANDROID_NDK_HOME  the NDK folder; else $ANDROID_HOME/ndk/<NDK_VERSION> (or ANDROID_SDK_ROOT)
#
# The pins are in ../engine-version.properties. The script fails when a download, the NDK version
# or a built file differs from its pin. An empty sha256 pin of a built file prints the value.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../engine-version.properties
. "$HERE/../engine-version.properties"

die() {
  echo "build-libawsync: $*" >&2
  exit 1
}

[ $# -ge 2 ] || die "usage: build-libawsync.sh <work dir> <out dir> [arm64-v8a|x86_64 ...]"
mkdir -p "$1" "$2"
WORK="$(cd "$1" && pwd)"
OUT="$(cd "$2" && pwd)"
shift 2
ABIS=("$@")
[ ${#ABIS[@]} -gt 0 ] || ABIS=(arm64-v8a x86_64)

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Downloads a file once and checks its sha256. A file with another sha256 is removed.
fetch() {
  local url="$1" file="$2" want="$3"
  [ -n "$want" ] || die "no sha256 pin for $url"
  if [ ! -f "$file" ]; then
    curl --fail --location --silent --show-error --output "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  local got
  got="$(sha256_of "$file")"
  if [ "$got" != "$want" ]; then
    rm -f "$file"
    die "sha256 of $(basename "$file") is $got, expected $want"
  fi
}

# 1. The host: the Go archive and the NDK prebuilt folder.
case "$(uname -s)" in
  Linux) GO_OS=linux NDK_HOST=linux-x86_64 ;;
  Darwin) GO_OS=darwin NDK_HOST=darwin-x86_64 ;;
  *) die "unsupported host $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) GO_ARCH=amd64 ;;
  arm64 | aarch64) GO_ARCH=arm64 ;;
  *) die "unsupported host architecture $(uname -m)" ;;
esac
GO_PIN_NAME="GO_SHA256_$(echo "${GO_OS}_${GO_ARCH}" | tr '[:lower:]' '[:upper:]')"
GO_PIN="${!GO_PIN_NAME:-}"

# 2. The NDK of the pinned version.
NDK="${ANDROID_NDK_HOME:-}"
if [ -z "$NDK" ]; then
  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  [ -n "$SDK" ] || die "set ANDROID_NDK_HOME or ANDROID_HOME (NDK $NDK_VERSION)"
  NDK="$SDK/ndk/$NDK_VERSION"
fi
[ -f "$NDK/source.properties" ] || die "no NDK at $NDK (install the SDK package ndk;$NDK_VERSION)"
NDK_FOUND="$(sed -n 's/^Pkg\.Revision *= *//p' "$NDK/source.properties" | tr -d '[:space:]')"
[ "$NDK_FOUND" = "$NDK_VERSION" ] || die "NDK at $NDK is $NDK_FOUND, expected $NDK_VERSION"
CLANG_DIR="$NDK/toolchains/llvm/prebuilt/$NDK_HOST/bin"
[ -d "$CLANG_DIR" ] || die "no NDK clang folder $CLANG_DIR"

# 3. Go and the Syncthing source, each checked against its pin.
GO_ARCHIVE="go$GO_VERSION.$GO_OS-$GO_ARCH.tar.gz"
fetch "https://go.dev/dl/$GO_ARCHIVE" "$WORK/$GO_ARCHIVE" "$GO_PIN"
SOURCE_ARCHIVE="syncthing-source-$SYNCTHING_TAG.tar.gz"
fetch "$SYNCTHING_SOURCE_URL" "$WORK/$SOURCE_ARCHIVE" "$SYNCTHING_SOURCE_SHA256"
rm -rf "$WORK/go" "$WORK/syncthing"
tar -xzf "$WORK/$GO_ARCHIVE" -C "$WORK"
tar -xzf "$WORK/$SOURCE_ARCHIVE" -C "$WORK"
[ "$(cat "$WORK/syncthing/RELEASE")" = "$SYNCTHING_TAG" ] || die "the source RELEASE file is not $SYNCTHING_TAG"

# 4. One build per ABI. The Go caches stay in the work folder; the vendored modules need no network.
export PATH="$WORK/go/bin:$PATH"
export GOROOT="$WORK/go"
export GOPATH="$WORK/gopath"
export GOCACHE="$WORK/gocache"
export GOMODCACHE="$WORK/gopath/pkg/mod"
export GOTOOLCHAIN=local
export GOPROXY=off
export GOFLAGS=-mod=vendor
export CGO_ENABLED=1
export EXTRA_LDFLAGS=-checklinkname=0
export SOURCE_DATE_EPOCH="$SYNCTHING_SOURCE_DATE_EPOCH"
export BUILD_USER=aw
export BUILD_HOST=aw

status=0
for abi in "${ABIS[@]}"; do
  case "$abi" in
    arm64-v8a) GOARCH_ABI=arm64 TRIPLE=aarch64-linux-android PIN_NAME=LIBAWSYNC_SHA256_ARM64_V8A ;;
    x86_64) GOARCH_ABI=amd64 TRIPLE=x86_64-linux-android PIN_NAME=LIBAWSYNC_SHA256_X86_64 ;;
    *) die "unsupported ABI $abi (arm64-v8a, x86_64)" ;;
  esac
  CC="$CLANG_DIR/$TRIPLE$ANDROID_API-clang"
  [ -x "$CC" ] || die "no NDK clang $CC"
  mkdir -p "$OUT/$abi"
  target="$OUT/$abi/libawsync.so"
  (
    cd "$WORK/syncthing"
    go run build.go -goos android -goarch "$GOARCH_ABI" -cc "$CC" -no-upgrade \
      -build-out "$target.part" build syncthing
  )
  mv "$target.part" "$target"
  got="$(sha256_of "$target")"
  want="${!PIN_NAME:-}"
  if [ -z "$want" ]; then
    echo "build-libawsync: $abi sha256 $got (not pinned: record $PIN_NAME=$got)"
  elif [ "$got" != "$want" ]; then
    echo "build-libawsync: $abi sha256 is $got, expected $want" >&2
    rm -f "$target"
    status=1
  else
    echo "build-libawsync: $abi sha256 $got (pin matches)"
  fi
done
exit "$status"
