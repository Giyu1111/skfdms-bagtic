const { getCurrentUser } = require('../utils/authCookie');

// ============================================================
// backend/middleware/auth.js
// Session-based authentication middleware
// ============================================================

/**
 * requireAuth — blocks unauthenticated requests
 * Returns 401 JSON if not logged in
 */
function requireAuth(req, res, next) {
  const currentUser = getCurrentUser(req);
  if (!currentUser) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized. Please log in.',
    });
  }
  // Attach user shorthand
  if (req.session && !req.session.user) req.session.user = currentUser;
  req.user = currentUser;
  next();
}

/**
 * requireRole — restricts endpoint to specific roles
 * Usage: requireRole('admin') or requireRole(['admin','chairperson'])
 */
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }
    if (!allowed.includes(currentUser.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowed.join(' or ')}.`,
      });
    }
    if (req.session && !req.session.user) req.session.user = currentUser;
    req.user = currentUser;
    next();
  };
}

module.exports = { requireAuth, requireRole };
