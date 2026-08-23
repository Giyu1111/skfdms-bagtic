// ============================================================
// backend/config/database.js
// PostgreSQL (Supabase) connection pool for SK-FDMS Bagtic
// ============================================================

const { Pool } = require('pg');
require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL;

// Use the connection string from your .env file or Vercel Environment Variables.
const pool = new Pool(databaseUrl ? {
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false // Required for Supabase connections
  }
} : {});

if (!databaseUrl) {
  console.warn('[WARN] DATABASE_URL is not set. API routes that use the database will fail until it is configured.');
} else {
  // Test the connection without crashing serverless deployments.
  (async () => {
    try {
      const client = await pool.connect();
      console.log(`[OK] Database connected: Supabase PostgreSQL`);
      client.release();
    } catch (err) {
      console.error('[ERROR] Database connection failed:', err.message);
      console.log('Tip: Check if DATABASE_URL in your .env or Vercel Environment Variables is correct.');
    }
  })();
}

module.exports = pool;
