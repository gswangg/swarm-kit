#!/usr/bin/env bash
# Disk janitor for long swarm runs. Every INTERVAL seconds:
#  - strips build artifacts from worker worktrees idle >15 min (they rebuild)
#  - removes worktrees+branches already merged into main
# Worktree build dirs are the dominant disk leak on long runs (one Rust campaign
# hit 100GB). Run it alongside the swarm, backgrounded.
#
# Args override .env (TARGET, WT, JANITOR_INTERVAL, BUILD_DIR, BRANCH_PREFIX).
# Usage: bin/janitor.sh [target-repo] [wt-dir] [interval-seconds] [build-dir-name]
set -uo pipefail
PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[ -f "$PROJ/.env" ] && set -a && . "$PROJ/.env" && set +a

T="${1:-${TARGET:-}}"
WT="${2:-${WT:-}}"
INTERVAL="${3:-${JANITOR_INTERVAL:-900}}"
# cargo: target | node: node_modules | python: .venv | go: (leave empty to skip)
BUILD_DIR="${4:-${BUILD_DIR:-node_modules}}"
PREFIX="${BRANCH_PREFIX:-task}"
[ -n "$T" ] && [ -n "$WT" ] || { echo "usage: janitor.sh <target-repo> <wt-dir> [interval] [build-dir]" >&2; exit 1; }

while true; do
  if [ -n "$BUILD_DIR" ]; then
    for w in "$WT"/"$PREFIX"-*; do
      [ -d "$w/$BUILD_DIR" ] || continue
      if [ -z "$(find "$w" -maxdepth 2 -name '*.*' -newermt '-15 minutes' 2>/dev/null | head -1)" ]; then
        rm -rf "${w:?}/$BUILD_DIR"
      fi
    done
  fi
  git -C "$T" branch --merged main --list "$PREFIX-*" --format='%(refname:short)' 2>/dev/null | while IFS= read -r b; do
    [ -z "$b" ] && continue
    git -C "$T" worktree remove --force "$WT/$b" 2>/dev/null
    rm -rf "${WT:?}/$b"
    git -C "$T" branch -D "$b" >/dev/null 2>&1
  done
  git -C "$T" worktree prune 2>/dev/null
  sleep "$INTERVAL"
done
