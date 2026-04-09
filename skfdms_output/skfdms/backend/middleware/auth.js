// ============================================================
// backend/middleware/auth.js
// Session-based authentication middleware
// ============================================================

/**
 * requireAuth — blocks unauthenticated requests
 * Returns 401 JSON if not logged in
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized. Please log in.',
    });
  }
  // Attach user shorthand
  req.user = req.session.user;
  next();
}

/**
 * requireRole — restricts endpoint to specific roles
 * Usage: requireRole('admin') or requireRole(['admin','chairperson'])
 */
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }
    if (!allowed.includes(req.session.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowed.join(' or ')}.`,
      });
    }
    req.user = req.session.user;
    next();
  };
}

module.exports = { requireAuth, requireRole };
