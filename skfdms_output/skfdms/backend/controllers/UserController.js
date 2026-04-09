// ============================================================
// backend/controllers/UserController.js
// Manage SK official user accounts for Barangay Bagtic
// PostgreSQL (Supabase) version
// ============================================================

const bcrypt = require('bcryptjs');
const db     = require('../config/database');
const { logActivity } = require('../utils/logger');

// ── GET /api/admin/users ────────────────────────────────────
async function list(req, res) {
  try {
    // UPDATED: { rows } and $1 placeholder
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.last_login, u.created_at,
              b.name AS barangay_name
         FROM users u JOIN barangays b ON b.id = u.barangay_id
        WHERE u.barangay_id = $1
        ORDER BY u.created_at DESC`,
      [req.user.barangay_id]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('user list error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── POST /api/admin/users ───────────────────────────────────
async function create(req, res) {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const validRoles = ['chairperson', 'treasurer', 'secretary', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  try {
    const { rows: existing } = await db.query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already exists.' });
    }

    const hash = await bcrypt.hash(password, 12);

    // UPDATED: Postgres uses $1-5 and RETURNING id
    const { rows } = await db.query(
      `INSERT INTO users (barangay_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [req.user.barangay_id, name.trim(), email.toLowerCase().trim(), hash, role]
    );

    const newUserId = rows[0].id;

    await logActivity({
      userId:     req.user.id,
      action:     'CREATE_USER',
      entityType: 'user',
      entityId:   newUserId,
      details:    `Created user "${name}" with role "${role}"`,
      ip:         req.ip,
    });

    return res.status(201).json({ success: true, message: `User "${name}" created successfully.` });

  } catch (err) {
    console.error('user create error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── PATCH /api/admin/users/:id/toggle ───────────────────────
async function toggleActive(req, res) {
  const { id } = req.params;

  // Prevent self-deactivation
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
  }

  try {
    const { rows } = await db.query(
      `SELECT id, name, is_active FROM users WHERE id = $1 AND barangay_id = $2`,
      [id, req.user.barangay_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user      = rows[0];
    const newStatus = !user.is_active; // Toggles true to false or false to true

    await db.query(`UPDATE users SET is_active = $1 WHERE id = $2`, [newStatus, id]);

    await logActivity({
      userId:     req.user.id,
      action:     newStatus ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      entityType: 'user',
      entityId:   parseInt(id),
      details:    `User "${user.name}" ${newStatus ? 'activated' : 'deactivated'}`,
      ip:         req.ip,
    });

    return res.json({
      success:   true,
      message:   `User "${user.name}" ${newStatus ? 'activated' : 'deactivated'}.`,
      is_active: newStatus,
    });

  } catch (err) {
    console.error('toggleActive error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { list, create, toggleActive };