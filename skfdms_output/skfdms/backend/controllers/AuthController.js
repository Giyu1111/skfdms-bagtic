// ============================================================
// backend/controllers/AuthController.js
// Handles login, logout, session check for SK officials
// PostgreSQL (Supabase) version
// ============================================================

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { logActivity } = require('../utils/logger');
const { clearAuthCookie, getCurrentUser, setAuthCookie } = require('../utils/authCookie');
const { getPrivateUploadDir } = require('../config/uploadPath');
const { createPasswordSetupToken } = require('../utils/passwordSetup');

let userOptionalColumnsReady = false;

async function ensureUserOptionalColumns() {
  if (userOptionalColumnsReady) return;
  await db.query(`
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
  `);
  userOptionalColumnsReady = true;
}

function normalizeGender(value) {
  const gender = String(value || '').trim().toLowerCase();
  if (!gender) return '';
  const valid = ['male', 'female'];
  return valid.includes(gender) ? gender : '';
}

function removeRegistrationUpload(file) {
  if (file && file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
}

// ── POST /api/auth/login ────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  try {
    await ensureUserOptionalColumns();
    // UPDATED: Used $1 placeholder and { rows } destructuring for Postgres
    const { rows } = await db.query(
      `SELECT u.*, b.name AS barangay_name
         FROM users u
         JOIN barangays b ON b.id = u.barangay_id
        WHERE u.email = $1
          AND COALESCE(u.is_archived, false) = false
        LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = rows[0];

    const looksHashed = typeof user.password_hash === 'string' && user.password_hash.startsWith('$2');
    const passwordMatch = looksHashed
      ? await bcrypt.compare(password, user.password_hash)
      : password === user.password_hash;

    if (!passwordMatch) {
      await logActivity({ action: 'LOGIN_FAILED', details: `Failed login attempt for ${email}`, ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.approval_status && user.approval_status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: user.approval_status === 'pending'
          ? 'Your account is still pending SK Federated approval.'
          : 'Your account request was declined. Please contact SK Federated.',
      });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Your account is inactive. Please contact SK Federated.' });
    }

    // Store auth both in the Express session and in a signed cookie for serverless deployments.
    const sessionUser = {
      id:          user.id,
      name:        user.name,
      email:       user.email,
      role:        user.role,
      barangay_id: user.barangay_id,
      barangay:    user.barangay_name,
      profile_image: user.profile_image || null,
    };
    req.session.user = sessionUser;
    const authToken = setAuthCookie(res, sessionUser);

    // Update last login (UPDATED: $1 placeholder and NOW())
    await db.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

    await logActivity({
      userId:  user.id,
      action:  'LOGIN_SUCCESS',
      details: `${user.name} (${user.role}) logged in`,
      ip:      req.ip,
    });

    return res.json({
      success: true,
      message: `Welcome, ${user.name}!`,
      user: {
        id:       user.id,
        name:     user.name,
        email:    user.email,
        role:     user.role,
        barangay: user.barangay_name,
        profile_image: user.profile_image || null,
      },
      token: authToken,
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

// ── POST /api/auth/logout ───────────────────────────────────
async function logout(req, res) {
  const currentUser = getCurrentUser(req);
  if (currentUser) {
    try {
      await logActivity({
        userId:  currentUser.id,
        action:  'LOGOUT',
        details: `${currentUser.name} logged out`,
        ip:      req.ip,
      });
    } catch (logErr) {
      console.error('Logout logging error:', logErr);
    }
  }
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    clearAuthCookie(res);
    return res.json({ success: true, message: 'Logged out successfully.' });
  });
}

// ── GET /api/auth/me ────────────────────────────────────────
async function me(req, res) {
  const currentUser = getCurrentUser(req);
  if (!currentUser) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }

  try {
    await ensureUserOptionalColumns();
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.barangay_id, u.profile_image, b.name AS barangay_name
         FROM users u
         JOIN barangays b ON b.id = u.barangay_id
        WHERE u.id = $1
          AND COALESCE(u.is_archived, false) = false
        LIMIT 1`,
      [currentUser.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    const freshUser = {
      id: rows[0].id,
      name: rows[0].name,
      email: rows[0].email,
      role: rows[0].role,
      barangay_id: rows[0].barangay_id,
      barangay: rows[0].barangay_name,
      profile_image: rows[0].profile_image || null,
    };

    if (req.session) req.session.user = freshUser;
    setAuthCookie(res, freshUser);
    return res.json({ success: true, user: freshUser });
  } catch (err) {
    console.error('Session check error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

// ── PATCH /api/auth/account/name ────────────────────────────────
async function changeName(req, res) {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) {
    return res.status(400).json({ success: false, message: 'Please enter a name between 2 and 120 characters.' });
  }

  try {
    await ensureUserOptionalColumns();
    await db.query('UPDATE users SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [name, req.user.id]);
    const updatedUser = Object.assign({}, req.user, { name });
    if (req.session) req.session.user = updatedUser;
    setAuthCookie(res, updatedUser);
    await logActivity({ userId: req.user.id, action: 'CHANGE_ACCOUNT_NAME', entityType: 'user', entityId: req.user.id, details: 'Changed account name.', barangayId: req.user.barangay_id, ip: req.ip });
    return res.json({ success: true, message: 'Name updated successfully.', user: updatedUser });
  } catch (err) {
    console.error('changeName error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

// ── PATCH /api/auth/account/email ───────────────────────────────
async function changeEmail(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  try {
    await ensureUserOptionalColumns();
    const { rows: duplicateRows } = await db.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, req.user.id]);
    if (duplicateRows.length) {
      return res.status(409).json({ success: false, message: 'That email address is already in use.' });
    }

    await db.query('UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [email, req.user.id]);
    const updatedUser = Object.assign({}, req.user, { email });
    if (req.session) req.session.user = updatedUser;
    setAuthCookie(res, updatedUser);
    await logActivity({ userId: req.user.id, action: 'CHANGE_ACCOUNT_EMAIL', entityType: 'user', entityId: req.user.id, details: 'Changed account email address.', barangayId: req.user.barangay_id, ip: req.ip });
    return res.json({ success: true, message: 'Email address updated successfully.', user: updatedUser });
  } catch (err) {
    console.error('changeEmail error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

// ── PATCH /api/auth/account/password ────────────────────────────
async function changePassword(req, res) {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Current and new passwords are required.' });
  if (newPassword.length < 8) return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });

  try {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found.' });
    const storedPassword = rows[0].password_hash || '';
    const valid = storedPassword.startsWith('$2')
      ? await bcrypt.compare(currentPassword, storedPassword)
      : currentPassword === storedPassword;
    if (!valid) return res.status(400).json({ success: false, message: 'Your current password is incorrect.' });

    await db.query('UPDATE users SET password_hash = $1, temp_password = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [await bcrypt.hash(newPassword, 12), req.user.id]);
    await logActivity({ userId: req.user.id, action: 'CHANGE_ACCOUNT_PASSWORD', entityType: 'user', entityId: req.user.id, details: 'Changed account password.', barangayId: req.user.barangay_id, ip: req.ip });
    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

async function validatePasswordSetup(req, res) {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ success: false, message: 'Password setup link is missing.' });

  try {
    await ensureUserOptionalColumns();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await db.query(
      `SELECT id, name FROM users
        WHERE password_setup_token_hash = $1
          AND password_setup_used_at IS NULL
          AND password_setup_expires_at > CURRENT_TIMESTAMP
        LIMIT 1`,
      [tokenHash]
    );
    if (!rows.length) return res.status(400).json({ success: false, message: 'This password setup link is invalid or has expired.' });
    return res.json({ success: true, name: rows[0].name });
  } catch (err) {
    console.error('validate password setup error:', err);
    return res.status(500).json({ success: false, message: 'Unable to validate this password setup link.' });
  }
}

async function completePasswordSetup(req, res) {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!token || !password) return res.status(400).json({ success: false, message: 'Password setup token and password are required.' });
  if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });

  try {
    await ensureUserOptionalColumns();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await db.query(
      `SELECT id, name, barangay_id FROM users
        WHERE password_setup_token_hash = $1
          AND password_setup_used_at IS NULL
          AND password_setup_expires_at > CURRENT_TIMESTAMP
        LIMIT 1`,
      [tokenHash]
    );
    if (!rows.length) return res.status(400).json({ success: false, message: 'This password setup link is invalid or has expired.' });

    const user = rows[0];
    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(
      `UPDATE users
          SET password_hash = $1, is_active = true,
              password_setup_token_hash = NULL, password_setup_expires_at = NULL,
              password_setup_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [passwordHash, user.id]
    );
    await logActivity({ action: 'SETUP_PASSWORD', entityType: 'user', entityId: user.id, details: `Password created for "${user.name}"`, barangayId: user.barangay_id, ip: req.ip });
    return res.json({ success: true, message: 'Your password has been created. You can now sign in.' });
  } catch (err) {
    console.error('complete password setup error:', err);
    return res.status(500).json({ success: false, message: 'Unable to create password. Please try again.' });
  }
}

// ── POST /api/auth/register-request ─────────────────────────────
// Public registration request (chairman self-registers, pending SK Fed approval)
async function registerRequest(req, res) {
  const { full_name, name, email, gender, barangay_id, contact, birth_date, residential_address, appointment_basis, term_start, term_end } = req.body;

  const fn = full_name || name;
  if (!fn || !email || !gender || !barangay_id || !contact || !birth_date || !residential_address || !appointment_basis || !term_start || !term_end || !req.file) {
    removeRegistrationUpload(req.file);
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  try {
    await ensureUserOptionalColumns();

    const normalizedEmail = email.toLowerCase().trim();
    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE email = $1`,
      [normalizedEmail]
    );
    if (existing.length > 0) {
      removeRegistrationUpload(req.file);
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Validate barangay exists
    const { rows: barRows } = await db.query(
      `SELECT id FROM barangays WHERE id = $1`,
      [parseInt(barangay_id, 10)]
    );
    if (barRows.length === 0) {
      removeRegistrationUpload(req.file);
      return res.status(400).json({ success: false, message: 'Invalid barangay selected.' });
    }

    const { rows } = await db.query(
      `INSERT INTO users
         (barangay_id, name, email, password_hash, role, gender, contact, birth_date, residential_address, appointment_basis, term_start, term_end, supporting_document_path, supporting_document_name, approval_status, is_active)
       VALUES ($1, $2, $3, $4, 'chairperson', $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', false)
       RETURNING id`,
      [parseInt(barangay_id, 10), fn.trim(), normalizedEmail, crypto.randomBytes(32).toString('hex'), normalizeGender(gender), contact.trim(), birth_date, residential_address.trim(), appointment_basis.trim(), term_start, term_end, path.relative(getPrivateUploadDir(), req.file.path).split(path.sep).join('/'), req.file.originalname]
    );

    await logActivity({
      action: 'REGISTER_REQUEST',
      entityType: 'user',
      entityId: rows[0].id,
      details: `Chairperson registration request submitted by ${fn} (${normalizedEmail})`,
      ip: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: 'Registration request submitted. It is now pending SK Federated Admin review.',
      id: rows[0].id,
    });
  } catch (err) {
    removeRegistrationUpload(req.file);
    console.error('registerRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

module.exports = { login, logout, me, changeName, changeEmail, changePassword, registerRequest, validatePasswordSetup, completePasswordSetup };
