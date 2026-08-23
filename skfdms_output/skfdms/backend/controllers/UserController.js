const bcrypt = require('bcryptjs');
const db     = require('../config/database');
const { logActivity } = require('../utils/logger');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');

// GET /api/admin/users
async function list(req, res) {
  try {
    const barangayId = getEffectiveBarangayId(req);
    let queryText = `
      SELECT u.id, u.barangay_id, u.name, u.email, u.role, u.is_active, u.last_login, u.created_at,
             b.name AS barangay_name
        FROM users u JOIN barangays b ON b.id = u.barangay_id
    `;
    const params = [];

    if (barangayId !== 'all') {
      queryText += ' WHERE u.barangay_id = $1';
      params.push(barangayId);
    } else {
      queryText += ' WHERE 1=1';
    }

    queryText += ' ORDER BY u.created_at DESC';

    const { rows } = await db.query(queryText, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('user list error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// GET /api/officials?barangay_id=1
async function listPublicOfficials(req, res) {
  const barangayId = Number.parseInt(req.query.barangay_id, 10);

  if (!Number.isInteger(barangayId) || barangayId <= 0) {
    return res.status(400).json({ success: false, message: 'Please select a valid barangay.' });
  }

  try {
    const { rows } = await db.query(
      `SELECT u.id, u.barangay_id, u.name, u.email, u.role, b.name AS barangay_name
         FROM users u
         JOIN barangays b ON b.id = u.barangay_id
        WHERE u.barangay_id = $1
          AND u.is_active = true
          AND u.role = 'chairperson'
        ORDER BY u.name ASC`,
      [barangayId]
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('public officials list error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// POST /api/admin/users
async function create(req, res) {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const validRoles = ['chairperson'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  try {
    const barangayId = getEffectiveBarangayId(req);   // will get from req.body.barangay_id for admin
    const { rows: existing } = await db.query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already exists.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (barangay_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [barangayId, name.trim(), email.toLowerCase().trim(), hash, role]
    );

    await logActivity({
      userId:     req.user.id,
      action:     'CREATE_USER',
      entityType: 'user',
      entityId:   rows[0].id,
      details:    `Created user "${name}" with role "${role}"`,
      ip:         req.ip,
    });

    return res.status(201).json({ success: true, message: `User "${name}" created successfully.` });

  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('user create error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// PATCH /api/admin/users/:id/toggle
async function toggleActive(req, res) {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
  }

  try {
    const barangayId = getEffectiveBarangayId(req);
    const { rows } = await db.query(
      `SELECT id, name, is_active FROM users WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = rows[0];
    const newStatus = !user.is_active;
    await db.query(`UPDATE users SET is_active = $1 WHERE id = $2`, [newStatus, id]);

    await logActivity({
      userId: req.user.id,
      action: newStatus ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      entityType: 'user',
      entityId: parseInt(id),
      details: `User "${user.name}" ${newStatus ? 'activated' : 'deactivated'}`,
      ip: req.ip,
    });

    return res.json({ success: true, message: `User "${user.name}" ${newStatus ? 'activated' : 'deactivated'}.`, is_active: newStatus });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('toggleActive error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// PUT /api/admin/users/:id
async function update(req, res) {
  const { id } = req.params;
  const { name, email, role, password } = req.body;

  if (parseInt(id, 10) === req.user.id && role && role !== req.user.role) {
    return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
  }

  if (!name || !email || !role) {
    return res.status(400).json({ success: false, message: 'Name, email, and role are required.' });
  }

  const validRoles = ['chairperson'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role.' });
  }

  if (password && password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  try {
    const barangayId = getEffectiveBarangayId(req);
    const { rows: targetRows } = await db.query(
      `SELECT id, name, email, role FROM users WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE email = $1 AND id <> $2`,
      [normalizedEmail, id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already exists.' });
    }

    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await db.query(
        `UPDATE users
            SET name = $1, email = $2, role = $3, password_hash = $4, updated_at = CURRENT_TIMESTAMP
          WHERE id = $5 AND barangay_id = $6`,
        [name.trim(), normalizedEmail, role, hash, id, barangayId]
      );
    } else {
      await db.query(
        `UPDATE users
            SET name = $1, email = $2, role = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4 AND barangay_id = $5`,
        [name.trim(), normalizedEmail, role, id, barangayId]
      );
    }

    await logActivity({
      userId: req.user.id,
      action: 'UPDATE_USER',
      entityType: 'user',
      entityId: parseInt(id, 10),
      details: `Updated user "${targetRows[0].name}"`,
      ip: req.ip,
    });

    return res.json({ success: true, message: `User "${name}" updated successfully.` });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('user update error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// DELETE /api/admin/users/:id
async function remove(req, res) {
  const { id } = req.params;
  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
  }

  try {
    const barangayId = getEffectiveBarangayId(req);
    const { rows } = await db.query(
      `SELECT id, name FROM users WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await db.query(`DELETE FROM users WHERE id = $1 AND barangay_id = $2`, [id, barangayId]);

    await logActivity({
      userId: req.user.id,
      action: 'DELETE_USER',
      entityType: 'user',
      entityId: parseInt(id, 10),
      details: `Deleted user "${rows[0].name}"`,
      ip: req.ip,
    });

    return res.json({ success: true, message: `User "${rows[0].name}" deleted successfully.` });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    if (err.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'This user has linked records and cannot be deleted. Deactivate the account instead.',
      });
    }
    console.error('user delete error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { list, listPublicOfficials, create, toggleActive, update, remove };
