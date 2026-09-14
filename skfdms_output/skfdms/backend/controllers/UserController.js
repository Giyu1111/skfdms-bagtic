const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db     = require('../config/database');
const { logActivity } = require('../utils/logger');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');
const { getUploadDir, getPrivateUploadDir } = require('../config/uploadPath');

let userOptionalColumnsReady = false;
let userOptionalColumnsPromise = null;

async function ensureUserOptionalColumns() {
  if (userOptionalColumnsReady) return;
  if (!userOptionalColumnsPromise) {
    userOptionalColumnsPromise = db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS profile_image VARCHAR(500),
      ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
      ADD COLUMN IF NOT EXISTS contact VARCHAR(100),
      ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
      ADD COLUMN IF NOT EXISTS birth_date DATE,
      ADD COLUMN IF NOT EXISTS residential_address TEXT,
      ADD COLUMN IF NOT EXISTS appointment_basis VARCHAR(40),
      ADD COLUMN IF NOT EXISTS term_start DATE,
      ADD COLUMN IF NOT EXISTS term_end DATE,
      ADD COLUMN IF NOT EXISTS supporting_document_path VARCHAR(500),
      ADD COLUMN IF NOT EXISTS supporting_document_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      , ADD COLUMN IF NOT EXISTS password_setup_token_hash VARCHAR(128)
      , ADD COLUMN IF NOT EXISTS password_setup_expires_at TIMESTAMPTZ
      , ADD COLUMN IF NOT EXISTS password_setup_used_at TIMESTAMPTZ
    `).then(async () => {
      // Password hashes remain valid; this removes legacy plaintext temporary passwords.
      await db.query('UPDATE users SET temp_password = NULL WHERE temp_password IS NOT NULL');
      userOptionalColumnsReady = true;
    }).finally(() => {
      userOptionalColumnsPromise = null;
    });
  }
  await userOptionalColumnsPromise;
}

function normalizeGender(value) {
  const gender = String(value || '').trim().toLowerCase();
  if (!gender) return '';
  const valid = ['male', 'female'];
  return valid.includes(gender) ? gender : '';
}

// GET /api/admin/users
async function list(req, res) {
  try {
    await ensureUserOptionalColumns();
    const barangayId = getEffectiveBarangayId(req);
    let queryText = `
      SELECT u.id, u.barangay_id, u.name, u.email, u.gender, u.contact, u.role, u.is_active, u.approval_status, u.last_login, u.created_at,
             u.birth_date, u.residential_address, u.appointment_basis, u.term_start, u.term_end, u.supporting_document_name,
             u.profile_image,
             b.name AS barangay_name
         FROM users u JOIN barangays b ON b.id = u.barangay_id
    `;
    const params = [];

    if (barangayId !== 'all') {
      queryText += ' WHERE u.barangay_id = $1 AND COALESCE(u.is_archived, false) = false';
      params.push(barangayId);
    } else {
      queryText += ' WHERE COALESCE(u.is_archived, false) = false';
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
    await ensureUserOptionalColumns();
    const { rows } = await db.query(
      `SELECT u.id, u.barangay_id, u.name, u.email, u.gender, u.role, u.profile_image, b.name AS barangay_name
          FROM users u
          JOIN barangays b ON b.id = u.barangay_id
         WHERE u.barangay_id = $1
           AND u.is_active = true
           AND COALESCE(u.is_archived, false) = false
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
  const gender = normalizeGender(req.body.gender);
  const contact = req.body.contact ? String(req.body.contact).trim() : null;
  if (!name || !email || !password || !role || !gender) {
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
    await ensureUserOptionalColumns();
    const barangayId = getEffectiveBarangayId(req);   // will get from req.body.barangay_id for admin
    const { rows: existing } = await db.query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already exists.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (barangay_id, name, email, password_hash, role, gender, contact)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [barangayId, name.trim(), email.toLowerCase().trim(), hash, role, gender, contact]
    );

    await logActivity({
      userId:     req.user.id,
      action:     'CREATE_USER',
      entityType: 'user',
      entityId:   rows[0].id,
      details:    `Created user "${name}" with role "${role}"`,
      barangayId,
      ip:         req.ip,
    });

    return res.status(201).json({
      success: true,
      message: `User "${name}" created successfully.`,
      id: rows[0].id,
      barangay_id: barangayId,
    });

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
    let rows;
    if (barangayId === 'all') {
      ({ rows } = await db.query(
        `SELECT id, name, barangay_id, is_active FROM users WHERE id = $1`,
        [id]
      ));
    } else {
      ({ rows } = await db.query(
        `SELECT id, name, barangay_id, is_active FROM users WHERE id = $1 AND barangay_id = $2`,
        [id, barangayId]
      ));
    }
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
      barangayId: user.barangay_id,
      ip: req.ip,
    });

    return res.json({ success: true, message: `User "${user.name}" ${newStatus ? 'activated' : 'deactivated'}.`, is_active: newStatus });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('toggleActive error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── POST /api/admin/users/:id/approve ────────────────────────────
// Approves a pending registration request and creates the login account
async function approveRequest(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'User ID required.' });

  try {
    await ensureUserOptionalColumns();
    const { rows: targetRows } = await db.query(
      `SELECT id, name, email, barangay_id, approval_status FROM users WHERE id = $1`,
      [parseInt(id, 10)]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const target = targetRows[0];
    if (target.approval_status === 'approved') {
      return res.status(400).json({ success: false, message: 'This user is already approved.' });
    }

    // The SKFED admin sends this password directly to the approved
    // chairperson. Store only its bcrypt hash; the plain value is returned
    // once in this approval response and is never persisted.
    const temporaryPassword = crypto.randomBytes(6).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

     await db.query(
       `UPDATE users
           SET approval_status = 'approved', is_active = true, password_hash = $1, temp_password = NULL,
               password_setup_token_hash = NULL, password_setup_expires_at = NULL, password_setup_used_at = NULL,
               reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
       [passwordHash, req.user.id, target.id]
     );

    await logActivity({
      userId:     req.user.id,
      action:     'APPROVE_USER',
      entityType: 'user',
      entityId:   target.id,
      details:    `Approved registration request for "${target.name}" (email: ${target.email})`,
      barangayId: target.barangay_id,
      ip:         req.ip,
    });

    return res.json({
      success: true,
      message: `Registration request for "${target.name}" approved. Share the temporary password with them manually.`,
      email: target.email,
      role: 'chairperson',
      barangay_id: target.barangay_id,
      temp_password: temporaryPassword,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('approveRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── POST /api/admin/users/:id/reject ─────────────────────────────
async function rejectRequest(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'User ID required.' });

  try {
    await ensureUserOptionalColumns();
    const { rows: targetRows } = await db.query(
      `SELECT id, name, email, barangay_id, approval_status, supporting_document_path FROM users WHERE id = $1`,
      [parseInt(id, 10)]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const target = targetRows[0];
    if (target.approval_status === 'approved') {
      return res.status(400).json({ success: false, message: 'This user is already approved. Deactivate the account instead.' });
    }

    const { rows: deletedRows } = await db.query(
      `DELETE FROM users
        WHERE id = $1
          AND approval_status = 'pending'
        RETURNING id`,
      [target.id]
    );
    if (deletedRows.length === 0) {
      return res.status(409).json({ success: false, message: 'This registration request was already processed.' });
    }

    removeRegistrationDocument(target.supporting_document_path);

    await logActivity({
      userId:     req.user.id,
      action:     'REJECT_AND_DELETE_USER',
      entityType: 'user',
      entityId:   target.id,
      details:    `Rejected and permanently deleted registration request for "${target.name}" (email: ${target.email})`,
      barangayId: target.barangay_id,
      ip:         req.ip,
    });

    return res.json({
      success: true,
      message: `Registration request for "${target.name}" was rejected and permanently removed.`,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('rejectRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── POST /api/admin/users/:id/reset-password ─────────────────────
// Generates a new temporary password for a user (used by admin to reset/show password)
function removeRegistrationDocument(relativePath) {
  if (!relativePath) return;

  const roots = [getPrivateUploadDir(), getUploadDir()].map((root) => path.resolve(root));
  for (const root of roots) {
    const documentPath = path.resolve(root, relativePath);
    if (!documentPath.startsWith(root + path.sep) || !fs.existsSync(documentPath)) continue;

    try {
      fs.unlinkSync(documentPath);
    } catch (err) {
      // The registration record has already been removed. Keep the request
      // successful while flagging an orphaned file for the server operator.
      console.warn(`Unable to remove rejected registration document: ${err.message}`);
    }
    return;
  }
}

async function resetPassword(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'User ID required.' });

  try {
    await ensureUserOptionalColumns();
    const { rows: targetRows } = await db.query(
      `SELECT id, name, email, barangay_id FROM users WHERE id = $1`,
      [parseInt(id, 10)]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const target = targetRows[0];
    const tempPassword = crypto.randomBytes(6).toString('hex');
    const hash = await bcrypt.hash(tempPassword, 12);

     await db.query(
       `UPDATE users SET password_hash = $1, temp_password = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
       [hash, target.id]
     );

    await logActivity({
      userId:     req.user.id,
      action:     'RESET_PASSWORD',
      entityType: 'user',
      entityId:   target.id,
      details:    `Reset password for "${target.name}" (email: ${target.email})`,
      barangayId: target.barangay_id,
      ip:         req.ip,
    });

    return res.json({
      success: true,
      message: `New temporary password generated for "${target.name}".`,
      temp_password: tempPassword,
      email: target.email,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('resetPassword error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/admin/users/:id/password ─────────────────────
// Retrieves the stored temporary password for display in the admin users list
// ── PATCH /api/admin/users/:id/password ─────────────────────
// Sets a specific password for a user (used by admin in the users list)
async function updatePassword(req, res) {
  const { id } = req.params;
  const { password } = req.body;

  if (!password) return res.status(400).json({ success: false, message: 'Password is required.' });
  if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });

  try {
    await ensureUserOptionalColumns();
    const { rows: targetRows } = await db.query(
      `SELECT id, name, email, barangay_id FROM users WHERE id = $1`,
      [parseInt(id, 10)]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const target = targetRows[0];
    const hash = await bcrypt.hash(password, 12);

    await db.query(
      `UPDATE users SET password_hash = $1, temp_password = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [hash, target.id]
     );

    await logActivity({
      userId:     req.user.id,
      action:     'UPDATE_PASSWORD',
      entityType: 'user',
      entityId:   target.id,
      details:    `Updated password for "${target.name}"`,
      barangayId: target.barangay_id,
      ip:         req.ip,
    });

    return res.json({
      success: true,
      message: `Password updated for "${target.name}".`,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('updatePassword error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── PUT /api/admin/users/:id
async function update(req, res) {
  const { id } = req.params;
  const { name, email, role, password } = req.body;
  const gender = normalizeGender(req.body.gender);

  if (parseInt(id, 10) === req.user.id && role && role !== req.user.role) {
    return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
  }

  if (!name || !email || !role || !gender) {
    return res.status(400).json({ success: false, message: 'Name, email, gender, and role are required.' });
  }

  const validRoles = ['chairperson'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role.' });
  }

  if (password && password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  try {
    await ensureUserOptionalColumns();
    const barangayId = getEffectiveBarangayId(req);
    let targetRows;
    if (barangayId === 'all') {
      ({ rows: targetRows } = await db.query(
        `SELECT id, name, email, role, barangay_id FROM users WHERE id = $1`,
        [id]
      ));
    } else {
      ({ rows: targetRows } = await db.query(
        `SELECT id, name, email, role, barangay_id FROM users WHERE id = $1 AND barangay_id = $2`,
        [id, barangayId]
      ));
    }
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
      if (barangayId === 'all') {
        await db.query(
          `UPDATE users
              SET name = $1, email = $2, role = $3, gender = $4, password_hash = $5, updated_at = CURRENT_TIMESTAMP
           WHERE id = $6`,
          [name.trim(), normalizedEmail, role, gender, hash, id]
        );
      } else {
        await db.query(
          `UPDATE users
              SET name = $1, email = $2, role = $3, gender = $4, password_hash = $5, updated_at = CURRENT_TIMESTAMP
           WHERE id = $6 AND barangay_id = $7`,
          [name.trim(), normalizedEmail, role, gender, hash, id, barangayId]
        );
      }
    } else {
      if (barangayId === 'all') {
        await db.query(
          `UPDATE users
              SET name = $1, email = $2, role = $3, gender = $4, updated_at = CURRENT_TIMESTAMP
           WHERE id = $5`,
          [name.trim(), normalizedEmail, role, gender, id]
        );
      } else {
        await db.query(
          `UPDATE users
              SET name = $1, email = $2, role = $3, gender = $4, updated_at = CURRENT_TIMESTAMP
           WHERE id = $5 AND barangay_id = $6`,
          [name.trim(), normalizedEmail, role, gender, id, barangayId]
        );
      }
    }

    await logActivity({
      userId: req.user.id,
      action: 'UPDATE_USER',
      entityType: 'user',
      entityId: parseInt(id, 10),
      details: `Updated user "${targetRows[0].name}"`,
      barangayId: targetRows[0].barangay_id,
      ip: req.ip,
    });

    return res.json({ success: true, message: `User "${name}" updated successfully.` });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('user update error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// PATCH /api/admin/users/:id/archive
async function archive(req, res) {
  const { id } = req.params;
  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot archive your own account.' });
  }

  try {
    await ensureUserOptionalColumns();
    const barangayId = getEffectiveBarangayId(req);
    let rows;
    if (barangayId === 'all') {
      ({ rows } = await db.query(
        `SELECT id, name, barangay_id FROM users WHERE id = $1 AND COALESCE(is_archived, false) = false`,
        [id]
      ));
    } else {
      ({ rows } = await db.query(
        `SELECT id, name, barangay_id FROM users WHERE id = $1 AND barangay_id = $2 AND COALESCE(is_archived, false) = false`,
        [id, barangayId]
      ));
    }
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found or already archived.' });

    await db.query(
      `UPDATE users
          SET is_archived = true, archived_at = CURRENT_TIMESTAMP, archived_by = $1, is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [req.user.id, id]
    );

    await logActivity({
      userId: req.user.id,
      action: 'ARCHIVE_USER',
      entityType: 'user',
      entityId: parseInt(id, 10),
      details: `Archived user "${rows[0].name}"`,
      barangayId: rows[0].barangay_id,
      ip: req.ip,
    });

    return res.json({ success: true, message: `User "${rows[0].name}" archived successfully.` });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('user archive error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// PATCH /api/admin/users/:id/restore
async function restore(req, res) {
  const { id } = req.params;
  try {
    await ensureUserOptionalColumns();
    const barangayId = getEffectiveBarangayId(req);
    const params = barangayId === 'all' ? [id] : [id, barangayId];
    const scope = barangayId === 'all' ? '' : ' AND barangay_id = $2';
    const { rows } = await db.query(
      `SELECT id, name, barangay_id FROM users WHERE id = $1${scope} AND COALESCE(is_archived, false) = true`,
      params
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Archived user not found.' });

    await db.query(
      `UPDATE users SET is_archived = false, archived_at = NULL, archived_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
    await logActivity({ userId: req.user.id, action: 'RESTORE_USER', entityType: 'user', entityId: parseInt(id, 10), details: `Restored user "${rows[0].name}" from archive`, barangayId: rows[0].barangay_id, ip: req.ip });
    return res.json({ success: true, message: `User "${rows[0].name}" restored successfully.` });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('user restore error:', err);
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
    await ensureUserOptionalColumns();
    const barangayId = getEffectiveBarangayId(req);
    let rows;
    if (barangayId === 'all') {
      ({ rows } = await db.query(`SELECT id, name, barangay_id FROM users WHERE id = $1 AND COALESCE(is_archived, false) = true`, [id]));
      if (rows.length) await db.query(`DELETE FROM users WHERE id = $1`, [id]);
    } else {
      ({ rows } = await db.query(`SELECT id, name, barangay_id FROM users WHERE id = $1 AND barangay_id = $2 AND COALESCE(is_archived, false) = true`, [id, barangayId]));
      if (rows.length) await db.query(`DELETE FROM users WHERE id = $1 AND barangay_id = $2`, [id, barangayId]);
    }
    if (!rows.length) return res.status(404).json({ success: false, message: 'Archived user not found.' });

    await logActivity({ userId: req.user.id, action: 'DELETE_USER', entityType: 'user', entityId: parseInt(id, 10), details: `Permanently deleted archived user "${rows[0].name}"`, barangayId: rows[0].barangay_id, ip: req.ip });
    return res.json({ success: true, message: `User "${rows[0].name}" permanently deleted.` });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    if (err.code === '23503') return res.status(409).json({ success: false, message: 'This user has linked records and cannot be deleted permanently.' });
    console.error('user permanent delete error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── POST /api/admin/users/:id/profile-image ─────────────────────
const PROFILE_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const PROFILE_IMAGE_MIN_WIDTH = 256;
const PROFILE_IMAGE_MIN_HEIGHT = 256;

function relativeUploadPath(filePath) {
  return path.relative(getUploadDir(), filePath).split(path.sep).join('/');
}

// GET /api/admin/users/archived
async function listArchived(req, res) {
  try {
    await ensureUserOptionalColumns();
    const barangayId = getEffectiveBarangayId(req);
    let queryText = `
      SELECT u.id, u.barangay_id, u.name, u.email, u.gender, u.contact, u.role, u.is_active,
             u.approval_status, u.created_at, u.archived_at, b.name AS barangay_name,
             archived_by.name AS archived_by_name
        FROM users u
        LEFT JOIN barangays b ON b.id = u.barangay_id
        LEFT JOIN users archived_by ON archived_by.id = u.archived_by
       WHERE COALESCE(u.is_archived, false) = true
    `;
    const params = [];

    if (barangayId !== 'all') {
      params.push(barangayId);
      queryText += ` AND u.barangay_id = $${params.length}`;
    }

    queryText += ' ORDER BY u.archived_at DESC, u.name ASC';
    const { rows } = await db.query(queryText, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('archived user list error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// GET /api/admin/users/:id/registration-document
async function registrationDocument(req, res) {
  try {
    await ensureUserOptionalColumns();
    const { rows } = await db.query(
      `SELECT supporting_document_path, supporting_document_name FROM users WHERE id = $1 LIMIT 1`,
      [parseInt(req.params.id, 10)]
    );
    const user = rows[0];
    if (!user || !user.supporting_document_path) {
      return res.status(404).json({ success: false, message: 'No supporting document was submitted.' });
    }
    const privateRoot = path.resolve(getPrivateUploadDir());
    const legacyPublicRoot = path.resolve(getUploadDir());
    const privatePath = path.resolve(privateRoot, user.supporting_document_path);
    const legacyPublicPath = path.resolve(legacyPublicRoot, user.supporting_document_path);
    const documentPath = privatePath.startsWith(privateRoot + path.sep) && fs.existsSync(privatePath)
      ? privatePath
      : legacyPublicPath;
    if ((!documentPath.startsWith(legacyPublicRoot + path.sep) && !documentPath.startsWith(privateRoot + path.sep)) || !fs.existsSync(documentPath)) {
      return res.status(404).json({ success: false, message: 'Supporting document file was not found.' });
    }
    if (req.query.preview === '1') return res.sendFile(documentPath);
    return res.download(documentPath, user.supporting_document_name || path.basename(documentPath));
  } catch (err) {
    console.error('registrationDocument error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function readJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xC0 && marker <= 0xC3) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function getImageDimensions(filePath, ext) {
  const buffer = fs.readFileSync(filePath);

  if (ext === 'png' && buffer.length >= 24 && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if ((ext === 'jpg' || ext === 'jpeg') && buffer[0] === 0xFF && buffer[1] === 0xD8) {
    return readJpegSize(buffer);
  }

  if (ext === 'gif' && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  if (ext === 'webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const type = buffer.toString('ascii', 12, 16);
    if (type === 'VP8X' && buffer.length >= 30) {
      return { width: readUInt24LE(buffer, 24) + 1, height: readUInt24LE(buffer, 27) + 1 };
    }
    if (type === 'VP8 ' && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3FFF, height: buffer.readUInt16LE(28) & 0x3FFF };
    }
    if (type === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
    }
  }

  return null;
}

async function uploadProfileImage(req, res) {
  const { id } = req.params;
  const barangayId = getEffectiveBarangayId(req);

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image file provided.' });
  }

  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  if (!PROFILE_IMAGE_EXTS.includes(ext)) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ success: false, message: `Only image files (${PROFILE_IMAGE_EXTS.join(', ')}) are allowed.` });
  }

  let dimensions = null;
  try {
    dimensions = getImageDimensions(req.file.path, ext);
  } catch (err) {
    dimensions = null;
  }

  if (!dimensions || dimensions.width < PROFILE_IMAGE_MIN_WIDTH || dimensions.height < PROFILE_IMAGE_MIN_HEIGHT) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({
      success: false,
      message: `Logo image must be at least ${PROFILE_IMAGE_MIN_WIDTH} x ${PROFILE_IMAGE_MIN_HEIGHT} pixels.`,
    });
  }

  try {
    await ensureUserOptionalColumns();
    const { rows: targetRows } = await db.query(
      `SELECT id, name, barangay_id, profile_image FROM users WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
    );
    if (targetRows.length === 0) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const target = targetRows[0];
    const newRelative = relativeUploadPath(req.file.path);

    if (target.profile_image) {
      const oldAbs = path.join(getUploadDir(), target.profile_image);
      if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
    }

    const { rows } = await db.query(
      `UPDATE users SET profile_image = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND barangay_id = $3 RETURNING id`,
      [newRelative, id, barangayId]
    );

    if (rows.length === 0) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await logActivity({
      userId:     req.user.id,
      action:     'UPDATE_USER_PROFILE_IMAGE',
      entityType: 'user',
      entityId:   parseInt(id, 10),
      details:    `Updated profile image for "${target.name}"`,
      barangayId: target.barangay_id,
      ip:         req.ip,
    });

    return res.json({ success: true, message: 'Profile image updated successfully.', profile_image: newRelative });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('uploadProfileImage error:', err);
    return res.status(500).json({ success: false, message: 'Server error during image upload.' });
  }
}

// ── DELETE /api/admin/users/:id/profile-image ───────────────────
async function removeProfileImage(req, res) {
  const { id } = req.params;
  const barangayId = getEffectiveBarangayId(req);

  try {
    await ensureUserOptionalColumns();
    const { rows: targetRows } = await db.query(
      `SELECT id, name, barangay_id, profile_image FROM users WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const target = targetRows[0];
    if (target.profile_image) {
      const absPath = path.join(getUploadDir(), target.profile_image);
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    }

    await db.query(
      `UPDATE users SET profile_image = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
    );

    await logActivity({
      userId:     req.user.id,
      action:     'REMOVE_USER_PROFILE_IMAGE',
      entityType: 'user',
      entityId:   parseInt(id, 10),
      details:    `Removed profile image for "${target.name}"`,
      barangayId: target.barangay_id,
      ip:         req.ip,
    });

    return res.json({ success: true, message: 'Profile image removed successfully.' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('removeProfileImage error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { list, listArchived, listPublicOfficials, create, toggleActive, update, updatePassword, archive, restore, remove, uploadProfileImage, removeProfileImage, approveRequest, rejectRequest, resetPassword, registrationDocument };
