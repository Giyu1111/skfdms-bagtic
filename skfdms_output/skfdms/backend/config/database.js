// ============================================================
// backend/config/database.js
// PostgreSQL (Supabase) connection pool for SK-FDMS Bagtic
// ============================================================

const { Pool } = require('pg');
require('dotenv').config();

// Use the connection string from your .env file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Supabase connections
  }
});

// Test connection on startup
(async () => {
  try {
    const client = await pool.connect();
    console.log(`✅  Database connected: Supabase PostgreSQL`);
    client.release();
  } catch (err) {
    console.error('❌  Database connection failed:', err.message);
    // Suggesting the likely fix
    console.log('👉 Tip: Check if DATABASE_URL in your .env is correct.');
    process.exit(1);
  }
})();

module.exports = pool;