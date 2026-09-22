#!/usr/bin/env bash
set -eu

podman machine start >/dev/null 2>&1 || true
podman compose up -d --build --scale worker=3 db monitor worker
podman compose run -T --rm producer
printf '%s\n' 'Demo started with three workers'
printf '%s\n' 'Dashboard: http://127.0.0.1:8090'
printf '%s\n' 'Logs: podman compose logs -f worker monitor'
