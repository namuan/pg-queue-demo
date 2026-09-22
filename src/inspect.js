const { pool, closePool } = require('./queue');

async function main() {
  const result = await pool.query(`
    SELECT status, count(*)::integer AS count
    FROM jobs
    GROUP BY status
    ORDER BY status
  `);
  console.table(result.rows);

  const recent = await pool.query(`
    SELECT id, status, attempts, max_attempts, payload, last_error
    FROM jobs
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(recent.rows);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
