const db = require('../config/database');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');

async function list(req, res) {
  try {
    // Determine if we should filter by barangay or show all.
    // Admin can view all logs by not sending barangay_id or sending barangay_id=all.
    const isAdmin = req.user && req.user.role === 'admin';
    const requestedBarangay = req.query.barangay_id;
    const showAll = isAdmin && (!requestedBarangay || requestedBarangay === 'all');

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    let logsResult, countResult;

    if (showAll) {
      // Admin sees every log from every barangay
      [logsResult, countResult] = await Promise.all([
        db.query(
          `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details,
                  l.ip_address, l.created_at, u.name AS user_name, u.role
           FROM activity_logs l
           LEFT JOIN users u ON u.id = l.user_id
           ORDER BY l.created_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
        db.query(`SELECT COUNT(*) FROM activity_logs`)
      ]);
    } else {
      // Restricted to a specific barangay (chairman or admin that selected a barangay)
      const barangayId = getEffectiveBarangayId(req);

      [logsResult, countResult] = await Promise.all([
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
    }

    const total = parseInt(countResult.rows[0].count);

    return res.json({
      success: true,
      data: logsResult.rows,
      pagination: { total, limit, offset, hasMore: offset + logsResult.rows.length < total }
    });

  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('Activity Log Error:', { message: err.message, stack: err.stack, user: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to retrieve activity logs.' });
  }
}

module.exports = { list };