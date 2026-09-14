// ============================================================
// backend/utils/logger.js
// Activity log utility — records all admin actions to DB
// PostgreSQL (Supabase) version
// ============================================================

const db = require('../config/database');
let ensuredActivityLogBarangayColumn = false;

async function ensureActivityLogBarangayColumn() {
  if (ensuredActivityLogBarangayColumn) return;
  await db.query(`ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS barangay_id INTEGER`);
  ensuredActivityLogBarangayColumn = true;
}

/**
 * logActivity
 * @param {Object} params
 * @param {number|null} params.userId     - ID of acting user (null = system)
 * @param {string}      params.action     - Short action label e.g. 'UPLOAD_DOCUMENT'
 * @param {string}      [params.entityType] - 'document','user','announcement', etc.
 * @param {number}      [params.entityId]
 * @param {string}      [params.details]  - Human-readable description
 * @param {number|null} [params.barangayId] - Barangay affected by the action
 * @param {string}      [params.ip]       - Client IP address
 */
async function logActivity({ userId = null, action, entityType = null, entityId = null, details = '', barangayId = null, ip = '' }) {
  try {
    await ensureActivityLogBarangayColumn();
    // 1. Changed .execute() to .query()
    // 2. Changed '?' placeholders to '$1, $2, etc.' for PostgreSQL compatibility
    await db.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, barangay_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, action, entityType, entityId, details, barangayId, ip]
    );
  } catch (err) {
    // Non-fatal — log to console but don't crash the request
    console.error('[WARN] Failed to write activity log:', err.message);
  }
}

module.exports = { logActivity };
