// ============================================================
// backend/controllers/CategoryController.js
// DILG document category management
// PostgreSQL (Supabase) version
// ============================================================

const db = require('../config/database');

// ── GET /api/categories  (public) ───────────────────────────
async function list(req, res) {
  try {
    // UPDATED: { rows } destructuring and .query() for Postgres
    const { rows } = await db.query(
      `SELECT id, code, name, description, is_required FROM categories ORDER BY name`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Category list error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { list };