const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');

function isPostgresIncompatible(sql) {
  return /\bCREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\b/i.test(sql) || /\bUSE\s+\w+/i.test(sql);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from backend/.env');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').trim();

      if (!sql) {
        continue;
      }

      if (isPostgresIncompatible(sql)) {
        console.log(`Skipping ${file}: not a PostgreSQL migration.`);
        continue;
      }

      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );

      if (applied.rowCount > 0) {
        console.log(`Already applied ${file}`);
        continue;
      }

      console.log(`Applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('Migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message || err);
  if (err.code || err.cause) {
    console.error({ code: err.code, cause: err.cause });
  }
  process.exit(1);
});
