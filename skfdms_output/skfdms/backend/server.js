// ============================================================
// backend/server.js
// SK-FDMS Express Server — Barangay Bagtic
// Ready for Railway Deployment 🚀
// ============================================================

require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const apiRoutes = require('./routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ─────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
}));

// ── CORS (FIXED for deployment) ──────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
}));

// ── Rate limiting ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts.' },
});

app.use('/api/', limiter);
app.use('/api/auth/login', loginLimiter);

// ── Body parsers ─────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session (FIXED for HTTPS) ────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'skfdms_bagtic_secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production', // IMPORTANT
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
}));

// ── Serve uploaded files ─────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API Routes ───────────────────────────────────────────────
app.use('/api', apiRoutes);

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    system:   'SK-FDMS',
    barangay: 'Bagtic, Balilihan, Bohol',
    time:     new Date().toISOString(),
  });
});

// ── Serve Frontend (UPDATED for build) ───────────────────────
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Fallback — serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ── Global error handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large. Maximum 10MB.',
    });
  }

  return res.status(500).json({
    success: false,
    message: err.message || 'Internal server error.',
  });
});

// ── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏛️  SK-FDMS — Barangay Bagtic`);
  console.log(`✅  Server running on port ${PORT}`);
  console.log(`🌐  Deployment ready`);
  console.log(`📁  Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;