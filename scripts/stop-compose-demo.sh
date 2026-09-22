#!/usr/bin/env bash
set -eu

podman compose down --remove-orphans >/dev/null 2>&1 || true
