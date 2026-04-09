// ============================================================
// backend/controllers/ActivityLogController.js
// Returns audit trail of all SK admin actions
// ============================================================

const db = require('../config/database');

/**
 * GET /api/admin/activity-logs
 * Returns paginated logs filtered by the user's barangay
 */
async function list(req, res) {
  // 1. Sanitize and validate pagination inputs
  const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Cap at 100 for safety
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);   // Ensure not negative
  const barangayId = req.user?.barangay_id;

  if (!barangayId) {
    return res.status(403).json({ success: false, message: 'Unauthorized: Barangay ID missing.' });
  }

  try {
    // 2. Execute count and data queries in parallel for better performance
    const [logsResult, countResult] = await Promise.all([
      db.query(
        `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details,
                l.ip_address, l.created_at, u.name AS user_name, u.role
         FROM activity_logs l
         LEFT JOIN users u ON u.id = l.user_id
         WHERE (u.barangay_id = $1 OR l.user_id IS NULL)
         ORDER BY l.created_at DESC
         LIMIT $2 OFFSET $3`,
        [barangayId, limit, offset]
      ),
      db.query(
        `SELECT COUNT(*) 
         FROM activity_logs l
         LEFT JOIN users u ON u.id = l.user_id
         WHERE u.barangay_id = $1 OR l.user_id IS NULL`,
        [barangayId]
      )
    ]);

    // 3. Return data with pagination metadata
    const total = parseInt(countResult.rows[0].count);

    return res.json({
      success: true,
      data: logsResult.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + logsResult.rows.length < total
      }
    });

  } catch (err) {
    console.error('Activity Log Error:', {
      message: err.message,
      stack: err.stack,
      user: req.user?.id
    });
    
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve activity logs.' 
    });
  }
}

module.exports = { list };