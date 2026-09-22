const os = require('node:os');
const {
  claimJob,
  completeJob,
  failJob,
  registerWorker,
  heartbeatWorker,
  updateWorkerJob,
  recordWorkerResult,
  stopWorker,
  closePool
} = require('./queue');

const workerId = process.env.WORKER_ID || `worker-${os.hostname()}-${process.pid}`;
const pollMs = Number(process.env.QUEUE_POLL_MS || 500);
const workMs = Number(process.env.JOB_WORK_MS || 1000);
const heartbeatMs = Number(process.env.WORKER_HEARTBEAT_MS || 2000);
const once = process.argv.includes('--once');
const maxJobs = Number(process.env.MAX_JOBS || 0);
let shutdownRequested = false;
let heartbeatTimer;

function sleep(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function processJob(job) {
  await sleep(workMs);
  const failFirst = Number(job.payload.failFirst || 0);
  if (job.attempts <= failFirst) {
    throw new Error(`requested failure on attempt ${job.attempts}`);
  }
}

async function main() {
  let processed = 0;
  await registerWorker(workerId, process.pid, os.hostname());
  heartbeatTimer = setInterval(() => {
    heartbeatWorker(workerId).catch(() => {});
  }, heartbeatMs);
  process.stdout.write(`${workerId} started\n`);

  while (!shutdownRequested) {
    const job = await claimJob();
    if (!job) {
      await updateWorkerJob(workerId, null);
      if (once || maxJobs > 0) {
        break;
      }
      await sleep(pollMs);
      continue;
    }

    await updateWorkerJob(workerId, job.id);
    process.stdout.write(`${workerId} claimed ${job.id} attempt=${job.attempts}\n`);
    try {
      await processJob(job);
      const completed = await completeJob(job.id, job.lease_token);
      await recordWorkerResult(workerId, completed ? 'completed' : 'lost');
      process.stdout.write(`${workerId} ${completed ? 'completed' : 'lost lease for'} ${job.id}\n`);
    } catch (error) {
      const result = await failJob(job.id, job.lease_token, error.message);
      await recordWorkerResult(workerId, result ? result.status : 'lost');
      const status = result ? result.status : 'lost lease';
      process.stdout.write(`${workerId} ${status} ${job.id}: ${error.message}\n`);
    }

    processed += 1;
    if (maxJobs > 0 && processed >= maxJobs) {
      break;
    }
  }
}

function requestShutdown() {
  shutdownRequested = true;
}

process.on('SIGINT', requestShutdown);
process.on('SIGTERM', requestShutdown);

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    await stopWorker(workerId).catch(() => {});
    await closePool();
  });
