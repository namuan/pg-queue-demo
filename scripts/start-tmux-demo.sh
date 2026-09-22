#!/usr/bin/env bash
set -eu

session=${TMUX_SESSION:-pg-queue-demo}
worker_count=${WORKER_COUNT:-3}
attach=${TMUX_ATTACH:-1}
project=pg-queue-demo
shell=${SHELL:-/bin/bash}

if ! command -v tmux >/dev/null 2>&1; then
  printf '%s\n' 'tmux is required' >&2
  exit 1
fi

if tmux has-session -t "$session" 2>/dev/null; then
  printf 'tmux session already exists: %s\n' "$session" >&2
  exit 1
fi

podman machine start >/dev/null 2>&1 || true
podman compose up -d --build --scale worker="$worker_count" db monitor worker

worker_names=$(podman ps \
  --filter "label=io.podman.compose.project=$project" \
  --filter 'label=io.podman.compose.service=worker' \
  --format '{{.Names}}' | sort)

if [ -z "$worker_names" ]; then
  printf '%s\n' 'No worker containers were found' >&2
  exit 1
fi

tmux new-session -d -s "$session" -n demo "podman compose run -T --rm producer; printf '\nProducer finished. This pane is available for commands.\n'; exec $shell"
tmux split-window -t "$session:0" -h "podman compose logs -f monitor"
for worker_name in $worker_names; do
  tmux split-window -t "$session:0" -h "podman logs -f $worker_name"
done
tmux split-window -t "$session:0" -h "while true; do clear; date; curl -fsS http://127.0.0.1:8090/metrics || true; sleep 2; done"
tmux select-layout -t "$session:0" tiled
tmux select-pane -t "$session:0.0"

printf 'Started tmux session %s with %s workers\n' "$session" "$worker_count"
printf '%s\n' 'Dashboard: http://127.0.0.1:8090'
printf 'Attach with: tmux attach -t %s\n' "$session"

if [ "$attach" = '1' ]; then
  if [ -n "${TMUX:-}" ]; then
    tmux switch-client -t "$session"
  else
    exec tmux attach-session -t "$session"
  fi
fi
