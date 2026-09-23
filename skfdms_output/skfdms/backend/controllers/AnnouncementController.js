// ============================================================
// backend/controllers/AnnouncementController.js
// Public notices posted by SK officials
// PostgreSQL (Supabase) version
// ============================================================

const db = require('../config/database');
const { logActivity } = require('../utils/logger');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');   // <-- ADDED

let announcementColumnsPromise = null;
function ensureAnnouncementColumns() {
  if (!announcementColumnsPromise) {
    announcementColumnsPromise = db.query(`
      ALTER TABLE announcements
        ADD COLUMN IF NOT EXISTS announcement_type VARCHAR(30) NOT NULL DEFAULT 'general',
        ADD COLUMN IF NOT EXISTS event_date DATE,
        ADD COLUMN IF NOT EXISTS start_time TIME,
        ADD COLUMN IF NOT EXISTS end_time TIME,
        ADD COLUMN IF NOT EXISTS location TEXT,
        ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved',
        ADD COLUMN IF NOT EXISTS approved_by INTEGER,
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
    `).catch((err) => {
      announcementColumnsPromise = null;
      throw err;
    });
  }
  return announcementColumnsPromise;
}

// ── GET /api/announcements  (public) ────────────────────────
async function listPublic(req, res) {
  try {
    await ensureAnnouncementColumns();
    const params = [];
    // Older announcements predate the review workflow.  Their default status is
    // approved, while new chairperson submissions stay private until reviewed.
    const where = ["a.is_active = true", "COALESCE(a.is_archived, false) = false", "COALESCE(a.approval_status, 'approved') = 'approved'"];

    if (req.query.barangay_id && req.query.barangay_id !== 'all') {
      const barangayId = parseInt(req.query.barangay_id, 10);
      if (!Number.isInteger(barangayId) || barangayId <= 0) {
        return res.status(400).json({ success: false, message: 'Please select a valid barangay.' });
      }
      params.push(barangayId);
      where.push(`a.barangay_id = $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT a.id, a.barangay_id, a.title, a.body, a.created_at, a.announcement_type,
              a.event_date, a.start_time, a.end_time, a.location, a.priority,
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
    await ensureAnnouncementColumns();
    const barangayId = getEffectiveBarangayId(req);   // uses the helper
    const allBarangays = barangayId === 'all';
    const archived = String(req.query.archived || '').toLowerCase() === 'true';
    const status = String(req.query.approval_status || '').toLowerCase();
    const validStatuses = ['pending', 'approved', 'rejected'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid approval status.' });
    }
    const where = [];
    const params = [];
    where.push(`COALESCE(a.is_archived, false) = ${archived ? 'true' : 'false'}`);
    if (!allBarangays) {
      params.push(barangayId);
      where.push(`a.barangay_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`COALESCE(a.approval_status, 'approved') = $${params.length}`);
    }
    const { rows } = await db.query(
      `SELECT a.*, u.name AS created_by_name, b.name AS barangay_name
         FROM announcements a
         JOIN users u ON u.id = a.created_by
         JOIN barangays b ON b.id = a.barangay_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY a.created_at DESC`,
      params
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
  const { title, body, announcement_type, event_date, start_time, end_time, location, priority } = req.body;
  if (!title || !body) {
    return res.status(400).json({ success: false, message: 'Title and body are required.' });
  }
  try {
    await ensureAnnouncementColumns();
    const barangayId = getEffectiveBarangayId(req);   // uses helper to get barangay_id (admin sends in body)
    const validTypes = ['general', 'event', 'meeting', 'deadline'];
    const validPriorities = ['normal', 'important', 'urgent'];
    const type = validTypes.includes(announcement_type) ? announcement_type : 'general';
    const level = validPriorities.includes(priority) ? priority : 'normal';
    const { rows } = await db.query(
      `INSERT INTO announcements (barangay_id, created_by, title, body, announcement_type, event_date, start_time, end_time, location, priority, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING id`,
      [barangayId, req.user.id, title.trim(), body.trim(), type, event_date || null, start_time || null, end_time || null, location?.trim() || null, level]
    );

    const newAnnouncementId = rows[0].id;

    await logActivity({
      userId: req.user.id, 
      action: 'CREATE_ANNOUNCEMENT',
      entityType: 'announcement', 
      entityId: newAnnouncementId,
      details: `Posted announcement: "${title}"`, 
      barangayId,
      ip: req.ip,
    });
    return res.status(201).json({ success: true, message: 'Announcement submitted for SK Federation approval.' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('create error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── PATCH /api/admin/announcements/:id/review ───────────────
async function review(req, res) {
  const { id } = req.params;
  const status = String(req.body.status || '').toLowerCase();
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Choose approved or rejected.' });
  }
  try {
    await ensureAnnouncementColumns();
    const barangayId = getEffectiveBarangayId(req);
    const allBarangays = barangayId === 'all';
    const result = await db.query(
      `UPDATE announcements
          SET approval_status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP
        WHERE id = $3${allBarangays ? '' : ' AND barangay_id = $4'}
        RETURNING id, title, barangay_id`,
      allBarangays ? [status, req.user.id, id] : [status, req.user.id, id, barangayId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Announcement not found.' });
    const announcement = result.rows[0];
    await logActivity({
      userId: req.user.id, action: status === 'approved' ? 'APPROVE_ANNOUNCEMENT' : 'REJECT_ANNOUNCEMENT',
      entityType: 'announcement', entityId: announcement.id,
      details: `${status === 'approved' ? 'Approved' : 'Rejected'} announcement: "${announcement.title}"`,
      barangayId: announcement.barangay_id, ip: req.ip,
    });
    return res.json({ success: true, message: `Announcement ${status}.` });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('review announcement error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── PATCH /api/admin/announcements/:id/archive ──────────────
async function archive(req, res) {
  try {
    await ensureAnnouncementColumns();
    const barangayId = getEffectiveBarangayId(req);
    const allBarangays = barangayId === 'all';
    const isAdmin = req.user.role === 'admin';
    const params = [req.params.id];
    const where = ['id = $1', 'COALESCE(is_archived, false) = false'];
    if (!allBarangays) { params.push(barangayId); where.push(`barangay_id = $${params.length}`); }
    // Federation admins may archive only items currently awaiting their review.
    if (isAdmin) where.push("COALESCE(approval_status, 'approved') = 'pending'");
    else { params.push(req.user.id); where.push(`created_by = $${params.length}`); }
    const result = await db.query(`UPDATE announcements SET is_archived = true, archived_at = CURRENT_TIMESTAMP WHERE ${where.join(' AND ')} RETURNING id, title, barangay_id`, params);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Announcement cannot be archived.' });
    const announcement = result.rows[0];
    await logActivity({ userId:req.user.id, action:'ARCHIVE_ANNOUNCEMENT', entityType:'announcement', entityId:announcement.id, details:`Archived announcement: "${announcement.title}"`, barangayId:announcement.barangay_id, ip:req.ip });
    return res.json({ success:true, message:'Announcement archived.' });
  } catch (err) { if (err.statusCode) return res.status(err.statusCode).json({ success:false, message:err.message }); console.error('archive announcement error:',err); return res.status(500).json({ success:false, message:'Server error.' }); }
}

// ── PATCH /api/admin/announcements/:id/restore ──────────────
async function restore(req, res) {
  try {
    await ensureAnnouncementColumns();
    const barangayId = getEffectiveBarangayId(req);
    const allBarangays = barangayId === 'all';
    const params = [req.params.id];
    const where = ['id = $1', 'COALESCE(is_archived, false) = true'];
    if (!allBarangays) { params.push(barangayId); where.push(`barangay_id = $${params.length}`); }
    if (req.user.role !== 'admin') { params.push(req.user.id); where.push(`created_by = $${params.length}`); }
    const result = await db.query(`UPDATE announcements SET is_archived = false, archived_at = NULL, approval_status = 'pending', approved_by = NULL, approved_at = NULL WHERE ${where.join(' AND ')} RETURNING id, title, barangay_id`, params);
    if (!result.rows.length) return res.status(404).json({ success:false, message:'Archived announcement not found.' });
    const announcement=result.rows[0];
    await logActivity({ userId:req.user.id, action:'RESTORE_ANNOUNCEMENT', entityType:'announcement', entityId:announcement.id, details:`Restored announcement for review: "${announcement.title}"`, barangayId:announcement.barangay_id, ip:req.ip });
    return res.json({ success:true, message:'Announcement restored as pending for approval.' });
  } catch (err) { if (err.statusCode) return res.status(err.statusCode).json({ success:false, message:err.message }); console.error('restore announcement error:',err); return res.status(500).json({ success:false, message:'Server error.' }); }
}

// ── DELETE /api/admin/announcements/:id ─────────────────────
async function remove(req, res) {
  const { id } = req.params;
  try {
    const barangayId = getEffectiveBarangayId(req);   // enforce barangay scope
    const allBarangays = barangayId === 'all';
    const existing = await db.query(
      `SELECT id, barangay_id FROM announcements WHERE id = $1${allBarangays ? '' : ' AND barangay_id = $2'}`,
      allBarangays ? [id] : [id, barangayId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }

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
      barangayId: existing.rows[0].barangay_id,
      ip: req.ip,
    });
    return res.json({ success: true, message: 'Announcement deleted.' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('remove error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { listPublic, listAdmin, create, review, archive, restore, remove };
