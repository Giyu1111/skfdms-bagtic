// ============================================================
// backend/middleware/upload.js
// Multer file upload configuration with validation
// ============================================================

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
require('dotenv').config();

const UPLOAD_DIR      = process.env.UPLOAD_DIR || './uploads';
const MAX_SIZE_MB     = parseInt(process.env.MAX_FILE_SIZE_MB) || 10;
const ALLOWED_TYPES   = (process.env.ALLOWED_FILE_TYPES || 'pdf,jpg,jpeg,png,doc,docx')
                          .split(',').map(t => t.trim().toLowerCase());

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Storage Engine ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Organise by year: uploads/2024/
    const year = new Date().getFullYear();
    const dir  = path.join(UPLOAD_DIR, String(year));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Pattern: category_timestamp_originalname
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const uniqueName   = `${Date.now()}_${safeOriginal}`;
    cb(null, uniqueName);
  },
});

// ── File Type Filter ────────────────────────────────────────
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).replace('.', '').toLowerCase();
  if (ALLOWED_TYPES.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type .${ext} is not allowed. Allowed: ${ALLOWED_TYPES.join(', ')}`), false);
  }
}

// ── Export configured multer instance ───────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});

module.exports = upload;
