// ============================================================
// backend/controllers/AnnouncementController.js
// Public notices posted by SK officials
// PostgreSQL (Supabase) version
// ============================================================

const db = require('../config/database');
const { logActivity } = require('../utils/logger');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');   // <-- ADDED

// ── GET /api/announcements  (public) ────────────────────────
async function listPublic(req, res) {
  try {
    const params = [];
    const where = ['a.is_active = true'];

    if (req.query.barangay_id && req.query.barangay_id !== 'all') {
      const barangayId = parseInt(req.query.barangay_id, 10);
      if (!Number.isInteger(barangayId) || barangayId <= 0) {
        return res.status(400).json({ success: false, message: 'Please select a valid barangay.' });
      }
      params.push(barangayId);
      where.push(`a.barangay_id = $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT a.id, a.barangay_id, a.title, a.body, a.created_at,
              b.name AS barangay_name, u.name AS created_by
         FROM announcements a
         JOIN users u ON u.id = a.created_by
         JOIN barangays b ON b.id = a.barangay_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC
        LIMIT 24`,
      params
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
    const barangayId = getEffectiveBarangayId(req);   // uses the helper
    const allBarangays = barangayId === 'all';
    const { rows } = await db.query(
      `SELECT a.*, u.name AS created_by_name, b.name AS barangay_name
         FROM announcements a
         JOIN users u ON u.id = a.created_by
         JOIN barangays b ON b.id = a.barangay_id
        ${allBarangays ? '' : 'WHERE a.barangay_id = $1'}
        ORDER BY a.created_at DESC`,
      allBarangays ? [] : [barangayId]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
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
    const barangayId = getEffectiveBarangayId(req);   // uses helper to get barangay_id (admin sends in body)
    const { rows } = await db.query(
      `INSERT INTO announcements (barangay_id, created_by, title, body) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id`,
      [barangayId, req.user.id, title.trim(), body.trim()]
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
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('create error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── DELETE /api/admin/announcements/:id ─────────────────────
async function remove(req, res) {
  const { id } = req.params;
  try {
    const barangayId = getEffectiveBarangayId(req);   // enforce barangay scope
    const allBarangays = barangayId === 'all';
    const { rowCount } = await db.query(
      `DELETE FROM announcements WHERE id = $1${allBarangays ? '' : ' AND barangay_id = $2'}`,
      allBarangays ? [id] : [id, barangayId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }
    
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
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('remove error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { listPublic, listAdmin, create, remove };
