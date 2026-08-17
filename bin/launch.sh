#!/usr/bin/env bash
# Launch the swarm: ONE interactive Claude session, owned by tmux, with Remote
# Control enabled (visible and steerable from the Claude mobile app). The runner
# is self-monitoring — there is no external nudger process:
#
#   - The Workflow tool runs in the background and fires a task-notification on
#     completion, so drain-resume is event-driven.
#   - The runner arms a persistent Monitor heartbeat (one stdout line every
#     HEARTBEAT_S seconds -> one notification -> one runner turn). This is the
#     retry path through usage-limit saturation: a heartbeat-triggered turn that
#     fails for lack of tokens is simply retried by the next heartbeat; the
#     monitor is a local bash process and needs no tokens to keep emitting.
#   - On genuine convergence the runner stops the monitor (TaskStop) and touches
#     .swarm-complete as the on-disk completion record.
#
# Config comes from ./.env (see .env.example); CLI args override.
# Usage: bin/launch.sh [session-name] [workflow-name]
set -euo pipefail
PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[ -f "$PROJ/.env" ] && set -a && . "$PROJ/.env" && set +a

TARGET="${TARGET:?set TARGET (absolute path to the target repo) in $PROJ/.env}"
SESSION="${1:-${SESSION:-swarm}}"
WORKFLOW="${2:-${WORKFLOW:-swarm-build}}"
REMOTE_NAME="${REMOTE_NAME:-${SESSION}-swarm}"
RUNNER_MODEL="${RUNNER_MODEL:-sonnet}"
TAG_PREFIX="${TAG_PREFIX:-round-}"
HEARTBEAT_S="${HEARTBEAT_S:-1800}"
CLAUDE="${CLAUDE_BIN:-$(command -v claude)}"
TMUX="${TMUX_BIN:-$(command -v tmux)}"
[ -x "$CLAUDE" ] || { echo "claude binary not found; set CLAUDE_BIN in .env" >&2; exit 1; }
[ -x "$TMUX" ] || { echo "tmux not found; set TMUX_BIN in .env" >&2; exit 1; }
[ -d "$TARGET/.git" ] || { echo "TARGET is not a git repo: $TARGET" >&2; exit 1; }

# The workflow's CONFIG.target is the authority for the agents; .env's TARGET is
# the authority for this script. They must agree or resume computes wrong waves.
WF_FILE="$PROJ/.claude/workflows/$WORKFLOW.js"
if [ -f "$WF_FILE" ] && ! grep -q "target: *'$TARGET'" "$WF_FILE"; then
  echo "FATAL: .env TARGET ($TARGET) does not match CONFIG.target in $WF_FILE" >&2
  exit 1
fi

LASTWAVE=$(git -C "$TARGET" tag -l "${TAG_PREFIX}*" | sed "s/^${TAG_PREFIX}//" | grep -E '^[0-9]+$' | sort -n | tail -1)
LASTWAVE=${LASTWAVE:-0}
rm -f "$PROJ/.swarm-complete"

# --dangerously-skip-permissions is REQUIRED for unattended runs: hook temp
# scripts and /tmp reads otherwise raise interactive permission prompts that
# silently stall the whole swarm for hours.
cat > "$PROJ/.swarm-runner.sh" <<EOF
#!/usr/bin/env bash
cd "$PROJ"
exec $CLAUDE --remote-control=$REMOTE_NAME --model $RUNNER_MODEL --permission-mode acceptEdits --dangerously-skip-permissions \
  --settings "$PROJ/.claude/settings.json" \
  "You are the runner for a long swarm build. Follow these rules exactly. (1) SETUP, in order: call ToolSearch with query 'select:Monitor,TaskStop' to load those tools; then arm a heartbeat with Monitor({command: \\"while true; do sleep $HEARTBEAT_S; echo heartbeat; done\\", description: 'swarm resume heartbeat', persistent: true, timeout_ms: 3600000}); print HEARTBEAT-ARMED; then invoke the Workflow tool with exactly {name: '$WORKFLOW', args: {startWave: $LASTWAVE}} — no other arguments. It runs in the background for many hours; its completion arrives as a task notification. Do not interfere with its agents and do not edit any files. (2) ON WORKFLOW COMPLETION: print WORKFLOW_RESULT: followed by the exact result JSON. If convergedReason is 'goal' or 'empty-replans': run Bash: touch $PROJ/.swarm-complete — then TaskStop the heartbeat monitor, print SWARM-COMPLETE, and stop. For ANY other convergedReason (drained, replan-failures, budget, max-waves) or an errored/vanished workflow: compute the last completed wave with Bash: git -C $TARGET tag -l '${TAG_PREFIX}*' | sed 's/^${TAG_PREFIX}//' | sort -n | tail -1 — and re-invoke the Workflow tool with {name: '$WORKFLOW', args: {startWave: <that number>}}. (3) ON EACH heartbeat NOTIFICATION: this is your retry-and-status tick, not a user message. If a workflow run is currently in progress, reply with ONE line of status (latest commit subject from git -C $TARGET log --oneline -1) and nothing else. If no workflow is running and .swarm-complete does not exist, apply rule 2's resume path now — this recovers from crashes and from turns that failed during usage-limit saturation. (4) On a Workflow tool error, print it verbatim prefixed GATE: and wait; a later heartbeat retries per rule 3. (5) Messages from the user (mobile or terminal) may arrive at any time: answer them, and treat any user request to resume/stop as overriding these rules."
EOF
chmod +x "$PROJ/.swarm-runner.sh"

# env -u TMUX: if you launch from inside a tmux session, an inherited \$TMUX makes
# tmux refuse to nest ("sessions should be nested with care") and the swarm never
# starts. Unsetting it for the tmux invocation only is the fix — do not drop it.
env -u TMUX "$TMUX" kill-session -t "$SESSION" 2>/dev/null || true
env -u TMUX "$TMUX" new-session -d -s "$SESSION" -n runner -x 200 -y 50 -c "$PROJ" "bash $PROJ/.swarm-runner.sh"
echo "launched tmux session '$SESSION' (interactive, Remote Control '$REMOTE_NAME', startWave=$LASTWAVE)"
echo "mobile: Claude app -> Code -> session '$REMOTE_NAME' (green dot when online)"
echo "attach: $TMUX attach -t $SESSION"
echo "NOTE: watch the pane for ~90s — dismiss any startup dialog with Esc, and confirm you see"
echo "      HEARTBEAT-ARMED followed by the Workflow invocation before walking away."
