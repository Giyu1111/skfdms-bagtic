// ============================================================
// backend/controllers/AuthController.js
// Handles login, logout, session check for SK officials
// PostgreSQL (Supabase) version
// ============================================================

const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { logActivity } = require('../utils/logger');
const { clearAuthCookie, getCurrentUser, setAuthCookie } = require('../utils/authCookie');

// ── POST /api/auth/login ────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  try {
    // UPDATED: Used $1 placeholder and { rows } destructuring for Postgres
    const { rows } = await db.query(
      `SELECT u.*, b.name AS barangay_name
         FROM users u
         JOIN barangays b ON b.id = u.barangay_id
        WHERE u.email = $1
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
function me(req, res) {
  const currentUser = getCurrentUser(req);
  if (!currentUser) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }
  if (req.session && !req.session.user) req.session.user = currentUser;
  return res.json({ success: true, user: currentUser });
}

module.exports = { login, logout, me };
