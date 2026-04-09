// ============================================================
// backend/controllers/AnnouncementController.js
// Public notices posted by SK officials of Barangay Bagtic
// PostgreSQL (Supabase) version
// ============================================================

const db = require('../config/database');
const { logActivity } = require('../utils/logger');

// ── GET /api/announcements  (public) ────────────────────────
async function listPublic(req, res) {
  try {
    // UPDATED: { rows } and changed is_active check to true (boolean)
    const { rows } = await db.query(
      `SELECT a.id, a.title, a.body, a.created_at, u.name AS created_by
         FROM announcements a
         JOIN users u ON u.id = a.created_by
        WHERE a.is_active = true AND a.barangay_id = 1
        ORDER BY a.created_at DESC
        LIMIT 10`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listPublic error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/admin/announcements  (admin) ───────────────────
async function listAdmin(req, res) {
  try {
    // UPDATED: { rows } and $1 placeholder
    const { rows } = await db.query(
      `SELECT a.*, u.name AS created_by_name
         FROM announcements a JOIN users u ON u.id = a.created_by
        WHERE a.barangay_id = $1 ORDER BY a.created_at DESC`,
      [req.user.barangay_id]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listAdmin error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── POST /api/admin/announcements ───────────────────────────
async function create(req, res) {
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).json({ success: false, message: 'Title and body are required.' });
  }
  try {
    // UPDATED: $1-4 placeholders and RETURNING id
    const { rows } = await db.query(
      `INSERT INTO announcements (barangay_id, created_by, title, body) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id`,
      [req.user.barangay_id, req.user.id, title.trim(), body.trim()]
    );

    const newAnnouncementId = rows[0].id;

    await logActivity({
      userId: req.user.id, 
      action: 'CREATE_ANNOUNCEMENT',
      entityType: 'announcement', 
      entityId: newAnnouncementId,
      details: `Posted announcement: "${title}"`, 
      ip: req.ip,
    });
    return res.status(201).json({ success: true, message: 'Announcement posted.' });
  } catch (err) {
    console.error('create error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── DELETE /api/admin/announcements/:id ─────────────────────
async function remove(req, res) {
  const { id } = req.params;
  try {
    // UPDATED: $1 and $2 placeholders
    await db.query(
      `DELETE FROM announcements WHERE id = $1 AND barangay_id = $2`, 
      [id, req.user.barangay_id]
    );
    
    await logActivity({
      userId: req.user.id, 
      action: 'DELETE_ANNOUNCEMENT',
      entityType: 'announcement', 
      entityId: parseInt(id),
      details: `Deleted announcement #${id}`, 
      ip: req.ip,
    });
    return res.json({ success: true, message: 'Announcement deleted.' });
  } catch (err) {
    console.error('remove error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { listPublic, listAdmin, create, remove };