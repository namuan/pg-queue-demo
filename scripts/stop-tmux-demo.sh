#!/usr/bin/env bash
set -eu

session=${TMUX_SESSION:-pg-queue-demo}
stop_machine=${STOP_PODMAN_MACHINE:-1}

if tmux has-session -t "$session" 2>/dev/null; then
  tmux kill-session -t "$session"
fi

podman compose down --remove-orphans >/dev/null 2>&1 || true

if [ "$stop_machine" = '1' ]; then
  podman machine stop >/dev/null 2>&1 || true
fi

printf 'Stopped tmux session and compose demo: %s\n' "$session"
