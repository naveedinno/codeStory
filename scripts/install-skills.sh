#!/usr/bin/env bash
#
# Install the codeStory storyteller skill into an agent's
# skills directory, so any SKILL.md-aware agent (Zed Agent, Codex, Cursor, Claude Code, …) can
# drive the review loop. Run it from a clone of the codeStory repo.
#
#   ./scripts/install-skills.sh            Install to ~/.agents/skills, and refresh any existing
#                                          copy in ~/.claude/skills or ~/.codex/skills
#   ./scripts/install-skills.sh --claude   Also install to ~/.claude/skills (Claude Code)
#   ./scripts/install-skills.sh --codex    Also install to ~/.codex/skills (Codex CLI)
#   ./scripts/install-skills.sh --dir DIR  Install to a directory you choose
#   ./scripts/install-skills.sh --help     Show this help
#
# (Claude Code users normally use the plugin instead: /plugin install codestory@codestory)
set -eo pipefail

usage() { sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)/skills"
SKILLS="codestory-storyteller"
# Earlier names of the storyteller, oldest first: review-tour, then
# diffstory-storyteller until the app was renamed to codeStory.
RETIRED_STORYTELLERS="review-tour diffstory-storyteller"

CLAUDE=0
CODEX=0
CUSTOM_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --claude) CLAUDE=1 ;;
    --codex) CODEX=1 ;;
    --dir) shift; CUSTOM_DIR="${1:-}"; [ -n "$CUSTOM_DIR" ] || { echo "--dir needs a path" >&2; exit 2; } ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

[ -d "$SRC" ] || { echo "error: can't find skills/ at $SRC — run this from a clone of the codeStory repo." >&2; exit 1; }

install_into() {
  dest="$1"
  mkdir -p "$dest"
  # Remove retired names so updates cannot leave two storyteller skills installed.
  for retired in $RETIRED_STORYTELLERS address-review; do
    rm -rf "${dest:?}/$retired"
  done
  for s in $SKILLS; do
    rm -rf "$dest/$s"
    cp -R "$SRC/$s" "$dest/$s"
    echo "  installed $s -> $dest/$s"
  done
}

# True when an agent's skills dir holds the storyteller under its current or a
# retired name, so a copy from before a rename is replaced too.
has_storyteller() {
  for name in $SKILLS $RETIRED_STORYTELLERS; do
    [ -d "$1/$name" ] && return 0
  done
  return 1
}

if [ -n "$CUSTOM_DIR" ]; then
  install_into "$CUSTOM_DIR"
else
  install_into "$HOME/.agents/skills"
  # Refresh every existing copy too: an agent reads only its own directory, so a
  # stale copy left behind there keeps teaching the old skill.
  if [ "$CLAUDE" = "1" ] || has_storyteller "$HOME/.claude/skills"; then
    install_into "$HOME/.claude/skills"
  fi
  if [ "$CODEX" = "1" ] || has_storyteller "$HOME/.codex/skills"; then
    install_into "$HOME/.codex/skills"
  fi
fi

echo
echo "Done. Skills are live for agents that read those directories:"
echo "  ~/.agents/skills  ->  Zed Agent (/codestory-storyteller), Codex (\$codestory-storyteller), Cursor, etc."
echo "  ~/.claude/skills  ->  Claude Code (or just use the plugin)"
echo "  ~/.codex/skills   ->  Codex CLI"
echo
echo "Open the installed codeStory app to review changes."
