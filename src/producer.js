const { randomUUID } = require('node:crypto');
const { pool, closePool } = require('./queue');

function option(name, fallback) {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : fallback;
}

async function main() {
  const count = Number(option('count', '10'));
  const failFirst = Number(option('fail-first', '0'));
  const maxAttempts = Number(option('max-attempts', '3'));

  if (!Number.isInteger(count) || count < 1) {
    throw new Error('--count must be a positive integer');
  }

  for (let sequence = 1; sequence <= count; sequence += 1) {
    const id = randomUUID();
    const payload = {
      sequence,
      message: `job-${sequence}`,
      failFirst
    };
    await pool.query(`
      INSERT INTO jobs (id, payload, status, max_attempts)
      VALUES ($1, $2, 'pending', $3)
    `, [id, payload, maxAttempts]);
    process.stdout.write(`enqueued ${id} ${payload.message}\n`);
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
