// ============================================================
// backend/server.js
// SK-FDMS Express Server — Barangay Bagtic
// Ready for Deployment
// ============================================================

require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');

const apiRoutes = require('./routes/api');

const app  = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_RETRIES = process.env.NODE_ENV === 'production' ? 0 : 10;

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
  max: Number.parseInt(process.env.API_RATE_LIMIT_MAX, 10) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/auth/login',
  message: { success: false, message: 'Too many requests. Please wait a moment and try again.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please wait before trying again.' },
});

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
    status:   'GOOD',
    system:   'SK-FDMS',
    barangay: 'CATIGBIAN, BOHOL',
    time:     new Date().toISOString(),
  });
});

// ── Serve Frontend (UPDATED for build) ───────────────────────
const frontendPath = path.join(__dirname, '..', 'frontend');

function cleanFrontendPath(requestPath) {
  let cleanPath = requestPath.replace(/\/+$/, '') || '/';

  if (cleanPath === '/index.html' || cleanPath === '/index') return '/';
  if (cleanPath.endsWith('/index.html')) return cleanPath.slice(0, -'/index.html'.length) || '/';
  if (cleanPath.endsWith('.html')) return cleanPath.slice(0, -'.html'.length) || '/';
  return cleanPath;
}

function hasFileExtension(requestPath) {
  return path.extname(requestPath) !== '';
}

function frontendHtmlFile(requestPath) {
  if (requestPath.startsWith('/api') || requestPath.startsWith('/uploads')) return null;
  if (hasFileExtension(requestPath) && !requestPath.endsWith('.html')) return null;

  const cleanPath = cleanFrontendPath(requestPath);
  const htmlPath = cleanPath === '/' ? '/index.html' : `${cleanPath}.html`;
  const filePath = path.normalize(path.join(frontendPath, htmlPath));
  const frontendRoot = path.normalize(frontendPath + path.sep);

  if (!filePath.startsWith(frontendRoot)) return null;
  return fs.existsSync(filePath) ? filePath : null;
}

app.get('*', (req, res, next) => {
  if (!req.path.endsWith('.html')) return next();

  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, cleanFrontendPath(req.path) + query);
});

app.get('*', (req, res, next) => {
  const filePath = frontendHtmlFile(req.path);
  if (!filePath) return next();
  res.sendFile(filePath);
});

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
function logStartup(port) {
  console.log(`\nSK-FDMS — Barangay Bagtic`);
  console.log(`[OK] Server running on port ${port}`);
  console.log(`Deployment ready`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}\n`);
}

function startServer(port, retriesLeft = MAX_PORT_RETRIES) {
  const server = app.listen(port, () => logStartup(port));

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is already in use. Trying port ${nextPort}...`);
      startServer(nextPort, retriesLeft - 1);
      return;
    }

    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other server or set PORT to another value.`);
    } else {
      console.error('Failed to start server:', err);
    }

    process.exit(1);
  });

  return server;
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = app;
