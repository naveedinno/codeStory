#!/usr/bin/env bash

set -euo pipefail

# Resolve the project root without depending on which shell was used to start
# this. `${0:A:h:h}` is zsh-only, so `bash scripts/install-macos-app.sh` failed
# with "A: unbound variable" before reaching any real work. dirname + `pwd -P`
# behaves the same in bash, zsh, and sh, and still resolves symlinks the way the
# zsh `:A` modifier did.
PROJECT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
SOURCE_DIR="$PROJECT_DIR/macos/CodeStoryApp"
INSTALL_DIR="$HOME/Applications"
APP_PATH="$INSTALL_DIR/codeStory.app"
# Default TMPDIR: it is normally set on macOS but absent under launchd and cron,
# where `set -u` would otherwise abort here for the same "depends on how you
# invoked it" reason. macOS sets it with a trailing slash, so strip that too.
TMP_ROOT="${TMPDIR:-/tmp}"
BUILD_DIR="$(mktemp -d "${TMP_ROOT%/}/codestory-macos.XXXXXX")"
BUILD_APP="$BUILD_DIR/codeStory.app"
CARGO_TARGET_DIR="$PROJECT_DIR/.macos-build/target"
INSTALLED_EXECUTABLE="$APP_PATH/Contents/MacOS/codeStory"
SERVER_ENTRY="$PROJECT_DIR/dist/app-server.js"
INTEL_SERVER_COMMAND="/usr/local/bin/node $SERVER_ENTRY --no-open --port 7787"
ARM_SERVER_COMMAND="/opt/homebrew/bin/node $SERVER_ENTRY --no-open --port 7787"
RELAUNCH_APP=0
# codeStory was named diffStory before its rename. That app is replaced, not
# kept beside the new one: it is closed before installing and removed after.
LEGACY_APPS=("$INSTALL_DIR/diffStory.app" "/Applications/diffStory.app")
LEGACY_APP_ID="local.diffstory.desktop"

trap '/bin/rm -rf "$BUILD_DIR"' EXIT

cd "$PROJECT_DIR"
npm run build

mkdir -p "$BUILD_APP/Contents/MacOS" "$BUILD_APP/Contents/Resources"
/usr/bin/ditto "$SOURCE_DIR/Info.plist" "$BUILD_APP/Contents/Info.plist"
CARGO_TARGET_DIR="$CARGO_TARGET_DIR" cargo build \
  --offline \
  --release \
  --manifest-path "$SOURCE_DIR/Cargo.toml"
/usr/bin/ditto "$CARGO_TARGET_DIR/release/codestory-macos" "$BUILD_APP/Contents/MacOS/codeStory"

ICON_SOURCE="$SOURCE_DIR/icons/icon.png"
ICONSET="$BUILD_DIR/codeStory.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  /usr/bin/sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double_size=$((size * 2))
  /usr/bin/sips -z "$double_size" "$double_size" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
node "$PROJECT_DIR/scripts/build-icns.mjs" "$ICONSET" "$BUILD_APP/Contents/Resources/codeStory.icns"

/usr/bin/codesign --force --deep --sign - "$BUILD_APP"
mkdir -p "$INSTALL_DIR"

if /usr/bin/pgrep -f -x "$INSTALLED_EXECUTABLE" >/dev/null 2>&1; then
  RELAUNCH_APP=1
  /usr/bin/osascript -e 'tell application id "local.codestory.desktop" to quit' >/dev/null 2>&1 || \
    /usr/bin/pkill -TERM -f -x "$INSTALLED_EXECUTABLE"
  for _attempt in {1..50}; do
    if ! /usr/bin/pgrep -f -x "$INSTALLED_EXECUTABLE" >/dev/null 2>&1; then
      break
    fi
    /bin/sleep 0.1
  done
  if /usr/bin/pgrep -f -x "$INSTALLED_EXECUTABLE" >/dev/null 2>&1; then
    echo "Could not close the running codeStory app. Quit it manually and run this installer again." >&2
    exit 1
  fi
fi

for _legacy_app in "${LEGACY_APPS[@]}"; do
  _legacy_executable="$_legacy_app/Contents/MacOS/diffStory"
  if /usr/bin/pgrep -f -x "$_legacy_executable" >/dev/null 2>&1; then
    RELAUNCH_APP=1
    /usr/bin/osascript -e "tell application id \"$LEGACY_APP_ID\" to quit" >/dev/null 2>&1 || \
      /usr/bin/pkill -TERM -f -x "$_legacy_executable"
    for _attempt in {1..50}; do
      if ! /usr/bin/pgrep -f -x "$_legacy_executable" >/dev/null 2>&1; then
        break
      fi
      /bin/sleep 0.1
    done
    if /usr/bin/pgrep -f -x "$_legacy_executable" >/dev/null 2>&1; then
      echo "Could not close the running diffStory app. Quit it manually and run this installer again." >&2
      exit 1
    fi
  fi
done

# A shell terminated by an older installer can leave the exact project-owned
# server orphaned. Stop only that known command; never kill an arbitrary owner
# of the port.
for _server_command in "$INTEL_SERVER_COMMAND" "$ARM_SERVER_COMMAND"; do
  if /usr/bin/pgrep -f -x "$_server_command" >/dev/null 2>&1; then
    /usr/bin/pkill -TERM -f -x "$_server_command"
  fi
done
for _attempt in {1..50}; do
  if ! /usr/bin/pgrep -f -x "$INTEL_SERVER_COMMAND" >/dev/null 2>&1 && \
    ! /usr/bin/pgrep -f -x "$ARM_SERVER_COMMAND" >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 0.1
done
if /usr/bin/pgrep -f -x "$INTEL_SERVER_COMMAND" >/dev/null 2>&1 || \
  /usr/bin/pgrep -f -x "$ARM_SERVER_COMMAND" >/dev/null 2>&1; then
  echo "Could not close the running codeStory server. Stop it manually and run this installer again." >&2
  exit 1
fi

/usr/bin/ditto "$BUILD_APP" "$APP_PATH"
# The new app is in place, so the old one goes. Only a bundle that really is the
# old app is removed; anything else that happens to share its name stays.
for _legacy_app in "${LEGACY_APPS[@]}"; do
  [ -d "$_legacy_app" ] || continue
  _legacy_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$_legacy_app/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$_legacy_id" != "$LEGACY_APP_ID" ]; then
    echo "Left $_legacy_app in place: it is not the old diffStory app."
    continue
  fi
  if /bin/rm -rf "$_legacy_app"; then
    echo "Removed the old diffStory app at $_legacy_app; codeStory replaces it."
  else
    echo "Could not remove the old diffStory app at $_legacy_app. Delete it yourself; codeStory replaces it." >&2
  fi
done
if (( RELAUNCH_APP )); then
  /usr/bin/open "$APP_PATH"
fi

echo "Installed or updated codeStory at $APP_PATH"
echo "Open it from Spotlight, Finder, or Launchpad."
