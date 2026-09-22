#!/usr/bin/env bash
set -eu

podman stop pg-queue-postgres >/dev/null 2>&1 || true
printf '%s\n' 'PostgreSQL stopped'
