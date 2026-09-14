const db = require('../config/database');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');
let ensuredActivityLogBarangayColumn = false;

async function ensureActivityLogBarangayColumn() {
  if (ensuredActivityLogBarangayColumn) return;
  await db.query(`ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS barangay_id INTEGER`);
  ensuredActivityLogBarangayColumn = true;
}

async function list(req, res) {
  try {
    await ensureActivityLogBarangayColumn();
    // Determine if we should filter by barangay or show all.
    // Admin can view all logs by not sending barangay_id or sending barangay_id=all.
    const isAdmin = req.user && req.user.role === 'admin';
    const ownLogsOnly = req.user && req.user.role === 'chairperson';
    const requestedBarangay = req.query.barangay_id;
    const showAll = isAdmin && (!requestedBarangay || requestedBarangay === 'all');

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    let logsResult, countResult;

    if (ownLogsOnly) {
      // A chairperson's audit view is personal: never expose other users'
      // activity, including actions made by colleagues in the same barangay.
      [logsResult, countResult] = await Promise.all([
        db.query(
          `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details,
                  l.barangay_id, l.ip_address, l.created_at, u.name AS user_name, u.role,
                  b.name AS barangay_name
             FROM activity_logs l
             LEFT JOIN users u ON u.id = l.user_id
             LEFT JOIN barangays b ON b.id = COALESCE(l.barangay_id, u.barangay_id)
            WHERE l.user_id = $1
            ORDER BY l.created_at DESC
            LIMIT $2 OFFSET $3`,
          [req.user.id, limit, offset]
        ),
        db.query(
          `SELECT COUNT(*) FROM activity_logs WHERE user_id = $1`,
          [req.user.id]
        )
      ]);
    } else if (showAll) {
      // Admin sees every log from every barangay
      [logsResult, countResult] = await Promise.all([
        db.query(
          `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details,
                  l.barangay_id, l.ip_address, l.created_at, u.name AS user_name, u.role,
                  COALESCE(lb.name, ub.name, dbgy.name, abgy.name, fbgy.name) AS barangay_name
           FROM activity_logs l
           LEFT JOIN users u ON u.id = l.user_id
           LEFT JOIN barangays lb ON lb.id = l.barangay_id
           LEFT JOIN users eu ON l.entity_type = 'user' AND eu.id = l.entity_id
           LEFT JOIN barangays ub ON ub.id = eu.barangay_id
           LEFT JOIN documents d ON l.entity_type = 'document' AND d.id = l.entity_id
           LEFT JOIN barangays dbgy ON dbgy.id = d.barangay_id
           LEFT JOIN announcements a ON l.entity_type = 'announcement' AND a.id = l.entity_id
           LEFT JOIN barangays abgy ON abgy.id = a.barangay_id
           LEFT JOIN fund_proofs fp ON l.entity_type = 'fund_proof' AND fp.id = l.entity_id
           LEFT JOIN barangays fbgy ON fbgy.id = fp.barangay_id
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
                  COALESCE(l.barangay_id, eu.barangay_id, d.barangay_id, a.barangay_id, fp.barangay_id, u.barangay_id) AS barangay_id,
                  l.ip_address, l.created_at, u.name AS user_name, u.role,
                  COALESCE(lb.name, ub.name, dbgy.name, abgy.name, fbgy.name) AS barangay_name
           FROM activity_logs l
           LEFT JOIN users u ON u.id = l.user_id
           LEFT JOIN barangays lb ON lb.id = l.barangay_id
           LEFT JOIN users eu ON l.entity_type = 'user' AND eu.id = l.entity_id
           LEFT JOIN barangays ub ON ub.id = eu.barangay_id
           LEFT JOIN documents d ON l.entity_type = 'document' AND d.id = l.entity_id
           LEFT JOIN barangays dbgy ON dbgy.id = d.barangay_id
           LEFT JOIN announcements a ON l.entity_type = 'announcement' AND a.id = l.entity_id
           LEFT JOIN barangays abgy ON abgy.id = a.barangay_id
           LEFT JOIN fund_proofs fp ON l.entity_type = 'fund_proof' AND fp.id = l.entity_id
           LEFT JOIN barangays fbgy ON fbgy.id = fp.barangay_id
           WHERE (
             l.barangay_id = $1
             OR u.barangay_id = $1
             OR eu.barangay_id = $1
             OR d.barangay_id = $1
             OR a.barangay_id = $1
             OR fp.barangay_id = $1
           )
           ORDER BY l.created_at DESC
           LIMIT $2 OFFSET $3`,
          [barangayId, limit, offset]
        ),
        db.query(
          `SELECT COUNT(*) 
           FROM activity_logs l
           LEFT JOIN users u ON u.id = l.user_id
           LEFT JOIN users eu ON l.entity_type = 'user' AND eu.id = l.entity_id
           LEFT JOIN documents d ON l.entity_type = 'document' AND d.id = l.entity_id
           LEFT JOIN announcements a ON l.entity_type = 'announcement' AND a.id = l.entity_id
           LEFT JOIN fund_proofs fp ON l.entity_type = 'fund_proof' AND fp.id = l.entity_id
           WHERE (
             l.barangay_id = $1
             OR u.barangay_id = $1
             OR eu.barangay_id = $1
             OR d.barangay_id = $1
             OR a.barangay_id = $1
             OR fp.barangay_id = $1
           )`,
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
