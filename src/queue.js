const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'queue_demo',
  user: process.env.PGUSER || 'queue',
  password: process.env.PGPASSWORD || 'queue'
});

const leaseMs = Number(process.env.QUEUE_LEASE_MS || 30000);

async function claimJob() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE jobs
      SET status = 'failed',
          last_error = 'lease expired after maximum attempts',
          lease_until = NULL,
          lease_token = NULL
      WHERE status = 'processing'
        AND lease_until <= now()
        AND attempts >= max_attempts
    `);

    const leaseToken = randomUUID();
    const result = await client.query(`
      WITH next_job AS (
        SELECT id
        FROM jobs
        WHERE (status = 'pending' AND attempts < max_attempts)
           OR (status = 'processing' AND lease_until <= now() AND attempts < max_attempts)
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs
      SET status = 'processing',
          attempts = attempts + 1,
          locked_at = now(),
          lease_until = now() + ($1 * interval '1 millisecond'),
          lease_token = $2
      FROM next_job
      WHERE jobs.id = next_job.id
      RETURNING jobs.*
    `, [leaseMs, leaseToken]);

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completeJob(jobId, leaseToken) {
  const result = await pool.query(`
    UPDATE jobs
    SET status = 'completed',
        completed_at = now(),
        lease_until = NULL,
        lease_token = NULL,
        last_error = NULL
    WHERE id = $1 AND status = 'processing' AND lease_token = $2
    RETURNING id
  `, [jobId, leaseToken]);
  return result.rowCount === 1;
}

async function failJob(jobId, leaseToken, errorMessage) {
  const result = await pool.query(`
    UPDATE jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        lease_until = NULL,
        lease_token = NULL,
        last_error = $3
    WHERE id = $1 AND status = 'processing' AND lease_token = $2
    RETURNING status
  `, [jobId, leaseToken, errorMessage]);
  return result.rows[0] || null;
}

async function registerWorker(workerId, pid, hostname) {
  await pool.query(`
    INSERT INTO workers (worker_id, pid, hostname, status, current_job_id, started_at, last_seen)
    VALUES ($1, $2, $3, 'online', NULL, now(), now())
    ON CONFLICT (worker_id) DO UPDATE
    SET pid = EXCLUDED.pid,
        hostname = EXCLUDED.hostname,
        status = 'online',
        current_job_id = NULL,
        started_at = now(),
        last_seen = now()
  `, [workerId, pid, hostname]);
}

async function heartbeatWorker(workerId) {
  await pool.query(`
    UPDATE workers
    SET status = 'online', last_seen = now()
    WHERE worker_id = $1
  `, [workerId]);
}

async function updateWorkerJob(workerId, jobId) {
  await pool.query(`
    UPDATE workers
    SET current_job_id = $2, last_seen = now()
    WHERE worker_id = $1
  `, [workerId, jobId]);
}

async function recordWorkerResult(workerId, status) {
  await pool.query(`
    UPDATE workers
    SET current_job_id = NULL,
        last_seen = now(),
        completed_jobs = completed_jobs + CASE WHEN $2 = 'completed' THEN 1 ELSE 0 END,
        failed_jobs = failed_jobs + CASE WHEN $2 = 'failed' THEN 1 ELSE 0 END
    WHERE worker_id = $1
  `, [workerId, status]);
}

async function stopWorker(workerId) {
  await pool.query(`
    UPDATE workers
    SET status = 'stopped', current_job_id = NULL, last_seen = now()
    WHERE worker_id = $1
  `, [workerId]);
}

function closePool() {
  return pool.end();
}

module.exports = {
  claimJob,
  completeJob,
  failJob,
  registerWorker,
  heartbeatWorker,
  updateWorkerJob,
  recordWorkerResult,
  stopWorker,
  closePool,
  pool
};
