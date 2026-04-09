// ============================================================
// backend/utils/logger.js
// Activity log utility — records all admin actions to DB
// PostgreSQL (Supabase) version
// ============================================================

const db = require('../config/database');

/**
 * logActivity
 * @param {Object} params
 * @param {number|null} params.userId     - ID of acting user (null = system)
 * @param {string}      params.action     - Short action label e.g. 'UPLOAD_DOCUMENT'
 * @param {string}      [params.entityType] - 'document','user','announcement', etc.
 * @param {number}      [params.entityId]
 * @param {string}      [params.details]  - Human-readable description
 * @param {string}      [params.ip]       - Client IP address
 */
async function logActivity({ userId = null, action, entityType = null, entityId = null, details = '', ip = '' }) {
  try {
    // 1. Changed .execute() to .query()
    // 2. Changed '?' placeholders to '$1, $2, etc.' for PostgreSQL compatibility
    await db.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, action, entityType, entityId, details, ip]
    );
  } catch (err) {
    // Non-fatal — log to console but don't crash the request
    console.error('⚠️  Failed to write activity log:', err.message);
  }
}

module.exports = { logActivity };