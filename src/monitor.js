const http = require('node:http');
const { pool, closePool } = require('./queue');

const port = Number(process.env.MONITOR_PORT || 8090);

async function getState() {
  const [summaryResult, workersResult, jobsResult] = await Promise.all([
    pool.query(`
      SELECT
        count(*)::integer AS total,
        count(*) FILTER (WHERE status = 'pending')::integer AS pending,
        count(*) FILTER (WHERE status = 'processing')::integer AS processing,
        count(*) FILTER (WHERE status = 'completed')::integer AS completed,
        count(*) FILTER (WHERE status = 'failed')::integer AS failed,
        now() AS observed_at
      FROM jobs
    `),
    pool.query(`
      SELECT worker_id, pid, hostname, status, current_job_id, started_at,
             last_seen, completed_jobs, failed_jobs,
             CASE
               WHEN status = 'online' AND last_seen > now() - interval '6 seconds' THEN 'healthy'
               ELSE 'stale'
             END AS health
      FROM workers
      ORDER BY last_seen DESC
    `),
    pool.query(`
      SELECT id, status, attempts, max_attempts, payload, created_at,
             locked_at, lease_until, completed_at, last_error
      FROM jobs
      ORDER BY created_at DESC
      LIMIT 50
    `)
  ]);

  return {
    summary: summaryResult.rows[0],
    workers: workersResult.rows,
    jobs: jobsResult.rows
  };
}

function metrics(state) {
  const summary = state.summary;
  const healthyWorkers = state.workers.filter((worker) => worker.health === 'healthy').length;
  const lines = [
    '# HELP pg_queue_jobs Number of jobs by queue state.',
    '# TYPE pg_queue_jobs gauge',
    `pg_queue_jobs{status="pending"} ${summary.pending}`,
    `pg_queue_jobs{status="processing"} ${summary.processing}`,
    `pg_queue_jobs{status="completed"} ${summary.completed}`,
    `pg_queue_jobs{status="failed"} ${summary.failed}`,
    '# HELP pg_queue_workers Number of registered workers by health state.',
    '# TYPE pg_queue_workers gauge',
    `pg_queue_workers{health="healthy"} ${healthyWorkers}`,
    `pg_queue_workers{health="stale"} ${state.workers.length - healthyWorkers}`
  ];
  return `${lines.join('\n')}\n`;
}

function dashboard() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PostgreSQL Queue Monitor</title>
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
body { margin: 0; background: #111827; color: #e5e7eb; }
main { max-width: 1400px; margin: 0 auto; padding: 24px; }
h1 { margin: 0 0 4px; }
h2 { margin-top: 32px; }
small { color: #9ca3af; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 24px; }
.card { background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 16px; }
.card strong { display: block; font-size: 30px; margin-top: 4px; }
.table-wrap { overflow-x: auto; background: #1f2937; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; min-width: 800px; }
th, td { padding: 10px 12px; border-bottom: 1px solid #374151; text-align: left; white-space: nowrap; }
th { color: #9ca3af; font-size: 12px; text-transform: uppercase; }
.good { color: #34d399; }
.warn { color: #fbbf24; }
.bad { color: #f87171; }
pre { margin: 0; white-space: pre-wrap; max-width: 320px; }
</style>
</head>
<body>
<main>
<h1>PostgreSQL Queue Monitor</h1>
<small id="updated">Loading...</small>
<div class="cards" id="cards"></div>
<h2>Workers</h2>
<div class="table-wrap"><table><thead><tr><th>Worker</th><th>Process</th><th>State</th><th>Current job</th><th>Last seen</th><th>Completed</th><th>Failed</th></tr></thead><tbody id="workers"></tbody></table></div>
<h2>Recent jobs</h2>
<div class="table-wrap"><table><thead><tr><th>ID</th><th>Status</th><th>Attempts</th><th>Payload</th><th>Created</th><th>Lease until</th><th>Error</th></tr></thead><tbody id="jobs"></tbody></table></div>
</main>
<script>
const statuses = ['total', 'pending', 'processing', 'completed', 'failed'];
function addCell(row, value, className) {
  const cell = document.createElement('td');
  cell.textContent = value ?? '';
  if (className) cell.className = className;
  row.appendChild(cell);
}
function date(value) {
  return value ? new Date(value).toLocaleString() : '';
}
function render(state) {
  document.getElementById('updated').textContent = 'Updated ' + date(state.summary.observed_at) + ' · refreshes every 2 seconds';
  const cards = document.getElementById('cards');
  cards.replaceChildren();
  statuses.forEach((status) => {
    const card = document.createElement('div');
    card.className = 'card';
    const label = document.createElement('small');
    label.textContent = status;
    const value = document.createElement('strong');
    value.textContent = state.summary[status];
    card.append(label, value);
  });
  const workers = document.getElementById('workers');
  workers.replaceChildren();
  state.workers.forEach((worker) => {
    const row = document.createElement('tr');
    addCell(row, worker.worker_id);
    addCell(row, worker.hostname + ' / pid ' + worker.pid);
    addCell(row, worker.status + ' / ' + worker.health, worker.health === 'healthy' ? 'good' : 'warn');
    addCell(row, worker.current_job_id || 'idle');
    addCell(row, date(worker.last_seen));
    addCell(row, worker.completed_jobs);
    addCell(row, worker.failed_jobs, worker.failed_jobs > 0 ? 'bad' : '');
    workers.appendChild(row);
  });
  const jobs = document.getElementById('jobs');
  jobs.replaceChildren();
  state.jobs.forEach((job) => {
    const row = document.createElement('tr');
    addCell(row, job.id);
    addCell(row, job.status, job.status === 'failed' ? 'bad' : job.status === 'completed' ? 'good' : '');
    addCell(row, job.attempts + ' / ' + job.max_attempts);
    addCell(row, JSON.stringify(job.payload));
    addCell(row, date(job.created_at));
    addCell(row, date(job.lease_until));
    addCell(row, job.last_error || '');
    jobs.appendChild(row);
  });
}
async function refresh() {
  try {
    const response = await fetch('/api/state');
    render(await response.json());
  } catch (error) {
    document.getElementById('updated').textContent = 'Monitor unavailable: ' + error.message;
  }
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}

async function requestHandler(request, response) {
  if (request.url === '/' || request.url === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(dashboard());
    return;
  }
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok\n');
    return;
  }
  if (request.url === '/metrics') {
    const state = await getState();
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    response.end(metrics(state));
    return;
  }
  if (request.url === '/api/state') {
    const state = await getState();
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(state));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('not found\n');
}

const server = http.createServer((request, response) => {
  requestHandler(request, response).catch((error) => {
    response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error.message }));
  });
});

server.listen(port, () => {
  process.stdout.write(`Queue monitor listening on http://127.0.0.1:${port}\n`);
});

async function shutdown() {
  server.close(async () => {
    await closePool();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
