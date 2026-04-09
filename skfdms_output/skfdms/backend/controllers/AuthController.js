// ============================================================
// backend/controllers/AuthController.js
// Handles login, logout, session check for SK officials
// PostgreSQL (Supabase) version
// ============================================================

const db = require('../config/database');
const { logActivity } = require('../utils/logger');

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
        WHERE u.email = $1 AND u.is_active = true
        LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = rows[0];

    // Plain text password comparison (Note: in production, use bcrypt)
    const passwordMatch = (password === user.password_hash);

    if (!passwordMatch) {
      await logActivity({ action: 'LOGIN_FAILED', details: `Failed login attempt for ${email}`, ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Store session
    req.session.user = {
      id:          user.id,
      name:        user.name,
      email:       user.email,
      role:        user.role,
      barangay_id: user.barangay_id,
      barangay:    user.barangay_name,
    };

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
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

// ── POST /api/auth/logout ───────────────────────────────────
async function logout(req, res) {
  if (req.session.user) {
    try {
      await logActivity({
        userId:  req.session.user.id,
        action:  'LOGOUT',
        details: `${req.session.user.name} logged out`,
        ip:      req.ip,
      });
    } catch (logErr) {
      console.error('Logout logging error:', logErr);
    }
  }
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully.' });
  });
}

// ── GET /api/auth/me ────────────────────────────────────────
function me(req, res) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }
  return res.json({ success: true, user: req.session.user });
}

module.exports = { login, logout, me };