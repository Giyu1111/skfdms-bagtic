// ============================================================
// backend/controllers/ContactMessageController.js
// Public contact messages and admin inbox notifications
// ============================================================

const db = require('../config/database');

function cleanString(value, fallback = '') {
  return String(value || fallback).trim();
}

function scopeClause(req, startIndex = 1) {
  if (req.user.role === 'admin') return { clause: '', params: [] };
  return { clause: `WHERE cm.barangay_id = $${startIndex}`, params: [req.user.barangay_id] };
}

async function create(req, res) {
  const firstName = cleanString(req.body.first_name).slice(0, 80);
  const lastName = cleanString(req.body.last_name).slice(0, 80);
  const email = cleanString(req.body.email).toLowerCase().slice(0, 180);
  const subject = cleanString(req.body.subject).slice(0, 160);
  const message = cleanString(req.body.message);
  const barangayId = Number.parseInt(req.body.barangay_id, 10);

  if (!firstName || !email || !subject || !message || !Number.isInteger(barangayId)) {
    return res.status(400).json({ success: false, message: 'Please complete all required fields.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  if (message.length > 3000) {
    return res.status(400).json({ success: false, message: 'Message must be 3000 characters or less.' });
  }

  try {
    const barangay = await db.query('SELECT id FROM barangays WHERE id = $1 LIMIT 1', [barangayId]);
    if (!barangay.rows.length) {
      return res.status(400).json({ success: false, message: 'Please select a valid barangay.' });
    }

    const { rows } = await db.query(
      `INSERT INTO contact_messages
        (barangay_id, first_name, last_name, email, subject, message, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, barangay_id, first_name, last_name, email, subject, message, is_read, created_at`,
      [barangayId, firstName, lastName, email, subject, message, req.ip, req.get('user-agent') || null]
    );

    return res.status(201).json({
      success: true,
      message: 'Message sent. The SK office has been notified.',
      data: rows[0],
    });
  } catch (err) {
    console.error('contact create error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function listAdmin(req, res) {
  try {
    const scope = scopeClause(req);
    const { rows } = await db.query(
      `SELECT cm.id, cm.barangay_id, b.name AS barangay_name, cm.first_name, cm.last_name,
              cm.email, cm.subject, cm.message, cm.is_read, cm.read_at, cm.created_at
         FROM contact_messages cm
         JOIN barangays b ON b.id = cm.barangay_id
         ${scope.clause}
        ORDER BY cm.is_read ASC, cm.created_at DESC
        LIMIT 100`,
      scope.params
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('contact listAdmin error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function unreadCount(req, res) {
  try {
    const scope = scopeClause(req);
    const where = scope.clause ? `${scope.clause} AND cm.is_read = false` : 'WHERE cm.is_read = false';
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM contact_messages cm ${where}`,
      scope.params
    );

    return res.json({ success: true, count: rows[0]?.count || 0 });
  } catch (err) {
    console.error('contact unreadCount error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function markRead(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ success: false, message: 'Invalid message id.' });
  }

  try {
    const params = [id];
    const scope = scopeClause(req, 2);
    const { rows } = await db.query(
      `UPDATE contact_messages cm
          SET is_read = true, read_at = NOW()
        WHERE cm.id = $1 ${scope.clause ? `AND cm.barangay_id = $2` : ''}
        RETURNING cm.id`,
      params.concat(scope.params)
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Message not found.' });
    return res.json({ success: true, message: 'Message marked as read.' });
  } catch (err) {
    console.error('contact markRead error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function remove(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ success: false, message: 'Invalid message id.' });
  }

  try {
    const scope = scopeClause(req, 2);
    const { rows } = await db.query(
      `DELETE FROM contact_messages cm
        WHERE cm.id = $1 ${scope.clause ? `AND cm.barangay_id = $2` : ''}
        RETURNING cm.id`,
      [id].concat(scope.params)
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Message not found.' });
    return res.json({ success: true, message: 'Message deleted.' });
  } catch (err) {
    console.error('contact remove error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { create, listAdmin, unreadCount, markRead, remove };
