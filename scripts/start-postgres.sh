#!/usr/bin/env bash
set -eu

container_name=pg-queue-postgres
volume_name=pg-queue-data
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if ! podman volume exists "$volume_name"; then
  podman volume create "$volume_name" >/dev/null
fi

if podman container exists "$container_name"; then
  podman start "$container_name" >/dev/null || true
else
  podman run --name "$container_name" \
    --detach \
    --publish 5432:5432 \
    --env POSTGRES_DB=queue_demo \
    --env POSTGRES_USER=queue \
    --env POSTGRES_PASSWORD=queue \
    --volume "$volume_name:/var/lib/postgresql/data" \
    --volume "$root_dir/db/init.sql:/docker-entrypoint-initdb.d/001-init.sql:ro" \
    docker.io/library/postgres:16 >/dev/null
fi

until podman exec "$container_name" pg_isready -U queue -d queue_demo >/dev/null 2>&1; do
  sleep 1
done

podman exec -i "$container_name" psql -U queue -d queue_demo < "$root_dir/db/init.sql" >/dev/null
printf '%s\n' 'PostgreSQL is ready on 127.0.0.1:5432'
