// ============================================================
// backend/controllers/ContactMessageController.js
// Public contact messages and admin inbox notifications
// ============================================================

const db = require('../config/database');

let messagingColumnsPromise = null;
function ensureMessagingColumns() {
  if (!messagingColumnsPromise) {
    messagingColumnsPromise = db.query(`
      ALTER TABLE contact_messages
        ADD COLUMN IF NOT EXISTS message_source VARCHAR(20) NOT NULL DEFAULT 'public',
        ADD COLUMN IF NOT EXISTS sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS recipient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    `).catch((err) => {
      messagingColumnsPromise = null;
      throw err;
    });
  }
  return messagingColumnsPromise;
}

function cleanString(value, fallback = '') {
  return String(value || fallback).trim();
}

function inboxScope(req, startIndex = 1) {
  if (req.user.role === 'admin') {
    return { clause: `WHERE COALESCE(cm.message_source, 'public') = 'public'`, params: [] };
  }
  return {
    clause: `WHERE COALESCE(cm.message_source, 'public') = 'fed_admin' AND cm.recipient_user_id = $${startIndex}`,
    params: [req.user.id]
  };
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
    await ensureMessagingColumns();
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
    await ensureMessagingColumns();
    const scope = inboxScope(req);
    const { rows } = await db.query(
      `SELECT cm.id, cm.barangay_id, b.name AS barangay_name, cm.first_name, cm.last_name,
              cm.email, cm.subject, cm.message, cm.is_read, cm.read_at, cm.created_at,
              COALESCE(cm.message_source, 'public') AS message_source
         FROM contact_messages cm
         LEFT JOIN barangays b ON b.id = cm.barangay_id
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
    await ensureMessagingColumns();
    const scope = inboxScope(req);
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
    await ensureMessagingColumns();
    const params = [id];
    const scope = inboxScope(req, 2);
    const { rows } = await db.query(
      `UPDATE contact_messages cm
          SET is_read = true, read_at = NOW()
        WHERE cm.id = $1 ${scope.clause ? `AND (${scope.clause.replace(/^WHERE /, '')})` : ''}
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
    await ensureMessagingColumns();
    const scope = inboxScope(req, 2);
    const { rows } = await db.query(
      `DELETE FROM contact_messages cm
        WHERE cm.id = $1 ${scope.clause ? `AND (${scope.clause.replace(/^WHERE /, '')})` : ''}
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

async function sendToChairperson(req, res) {
  const recipientUserId = Number.parseInt(req.body.recipient_user_id, 10);
  const subject = cleanString(req.body.subject).slice(0, 160);
  const message = cleanString(req.body.message);
  if (!Number.isInteger(recipientUserId) || !subject || !message) {
    return res.status(400).json({ success: false, message: 'Choose an SK Chairperson and complete the subject and message.' });
  }
  if (message.length > 3000) return res.status(400).json({ success: false, message: 'Message must be 3000 characters or less.' });

  try {
    await ensureMessagingColumns();
    const { rows: chairpersons } = await db.query(
      `SELECT id, name, barangay_id FROM users WHERE id = $1 AND role = 'chairperson' AND is_active = true LIMIT 1`,
      [recipientUserId]
    );
    if (!chairpersons.length) return res.status(404).json({ success: false, message: 'SK Chairperson not found.' });
    const chairperson = chairpersons[0];
    const { rows } = await db.query(
      `INSERT INTO contact_messages
        (barangay_id, first_name, email, subject, message, message_source, sender_user_id, recipient_user_id)
       VALUES ($1, $2, $3, $4, $5, 'fed_admin', $6, $7)
       RETURNING id, subject, message, created_at`,
      [chairperson.barangay_id, req.user.name || 'SK Fed Admin', '', subject, message, req.user.id, chairperson.id]
    );
    return res.status(201).json({ success: true, message: 'Message sent to the SK Chairperson.', data: rows[0] });
  } catch (err) {
    console.error('sendToChairperson error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { create, listAdmin, unreadCount, markRead, remove, sendToChairperson };
