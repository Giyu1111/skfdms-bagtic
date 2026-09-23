// ============================================================
// backend/config/database.js
// PostgreSQL (Supabase) connection pool for SK-FDMS Bagtic
// ============================================================

const { Pool } = require('pg');
require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL;
// Supabase pooler URLs share a small, database-wide session allowance.  A
// separate Pool is created for each local process/serverless instance, so a
// default of five here can exhaust that allowance very quickly.  Keep pooled
// connections deliberately small; a Pool queues concurrent queries safely.
const usesSupabasePooler = /\.pooler\.supabase\.com(?::\d+)?/i.test(databaseUrl || '');
const defaultPoolMax = usesSupabasePooler ? 1 : 5;
const maxClients = Math.max(
  1,
  Math.min(Number.parseInt(process.env.DB_POOL_MAX, 10) || defaultPoolMax, usesSupabasePooler ? 2 : 15)
);
const connectionTimeoutMillis = Math.max(
  5000,
  Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 15000
);
const safeQueryRetries = Math.max(
  0,
  Math.min(Number.parseInt(process.env.DB_SAFE_QUERY_RETRIES, 10) || 2, 3)
);

// Use the connection string from your .env file or Vercel Environment Variables.
const pool = new Pool(databaseUrl ? {
  connectionString: databaseUrl,
  max: maxClients,
  // Release an idle session quickly so nodemon restarts and quiet Vercel
  // functions do not keep Supabase session-pool capacity occupied.
  idleTimeoutMillis: usesSupabasePooler ? 5000 : 20000,
  connectionTimeoutMillis,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  // Recycle connections before hosted PostgreSQL providers retire them.
  maxLifetimeSeconds: 240,
  ssl: {
    rejectUnauthorized: false // Required for Supabase connections
  }
} : {
  max: maxClients,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  maxLifetimeSeconds: 240,
});

const connectionErrorCodes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  '08000', '08001', '08003', '08006', '08007', '08P01',
  '57P01', '57P02', '57P03',
]);

function isRetryableQuery(text) {
  const statement = String(text || '').trim().toUpperCase();
  return /^(SELECT|WITH|SHOW)\b/.test(statement);
}

function isRetryableConnectionError(err) {
  let current = err;

  // pg-pool sometimes wraps an ECONNRESET/timeout without copying its code
  // onto the outer error, so inspect both the error and its cause.
  while (current) {
    if (connectionErrorCodes.has(current.code)) return true;

    const message = String(current.message || '');
    if (/connection terminated|connection timeout|socket hang up|network error/i.test(message)) {
      return true;
    }
    current = current.cause;
  }

  return false;
}

function waitForConnectionRetry(attempt) {
  // Small capped backoff lets the pool discard a bad socket before reconnecting.
  const delay = Math.min(1000, 250 * (2 ** attempt));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// A hosted database can occasionally close an idle socket. Retry only safe
// read queries, never mutations, so a dropped connection cannot duplicate data.
const originalQuery = pool.query.bind(pool);
pool.query = async function queryWithConnectionRetry(text, values) {
  const canRetry = isRetryableQuery(text);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalQuery(text, values);
    } catch (err) {
      if (!canRetry || !isRetryableConnectionError(err) || attempt >= safeQueryRetries) {
        throw err;
      }

      console.warn(
        `[WARN] PostgreSQL connection dropped; retrying safe query (${attempt + 1}/${safeQueryRetries}).`
      );
      await waitForConnectionRetry(attempt);
    }
  }
};

// Prevent an idle client error from becoming an unhandled EventEmitter error.
pool.on('error', (err) => {
  console.warn('[WARN] PostgreSQL pool client error:', err.code || err.message);
});

if (!databaseUrl) {
  console.warn('[WARN] DATABASE_URL is not set. API routes that use the database will fail until it is configured.');
} else {
  // Test the connection without crashing serverless deployments.
  (async () => {
    let client;
    try {
      client = await pool.connect();
      console.log(`[OK] Database connected: Supabase PostgreSQL`);
    } catch (err) {
      console.error('[ERROR] Database connection failed:', err.message);
      console.log('Tip: Check if DATABASE_URL in your .env or Vercel Environment Variables is correct.');
    } finally {
      if (client) client.release();
    }
  })();
}

module.exports = pool;
