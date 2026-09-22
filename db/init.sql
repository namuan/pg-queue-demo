CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  completed_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS jobs_pending_idx
  ON jobs (created_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS jobs_lease_idx
  ON jobs (lease_until)
  WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS workers (
  worker_id text PRIMARY KEY,
  pid integer NOT NULL,
  hostname text NOT NULL,
  status text NOT NULL CHECK (status IN ('online', 'stopped')),
  current_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  completed_jobs integer NOT NULL DEFAULT 0,
  failed_jobs integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS workers_heartbeat_idx
  ON workers (last_seen);
