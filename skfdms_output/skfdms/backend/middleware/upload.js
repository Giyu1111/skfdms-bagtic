// ============================================================
// backend/middleware/upload.js
// Multer file upload configuration with validation
// ============================================================

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { getUploadDir, getPrivateUploadDir } = require('../config/uploadPath');
require('dotenv').config();

const UPLOAD_DIR      = getUploadDir();
const PRIVATE_UPLOAD_DIR = getPrivateUploadDir();
const MAX_SIZE_MB     = parseInt(process.env.MAX_FILE_SIZE_MB) || 10;
const MAX_DOCUMENT_SIZE_MB = parseInt(process.env.MAX_DOCUMENT_FILE_SIZE_MB) || 50;
const ALLOWED_TYPES   = (process.env.ALLOWED_FILE_TYPES || 'pdf,jpg,jpeg,png,gif,webp,doc,docx,zip')
                          .split(',').map(t => t.trim().toLowerCase());

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });

// ── Storage Engine ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Organise by year: uploads/2024/
    const year = new Date().getFullYear();
    const dir  = path.join(UPLOAD_DIR, String(year));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Pattern: category_timestamp_originalname
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const uniqueName   = `${Date.now()}_${safeOriginal}`;
    cb(null, uniqueName);
  },
});

const privateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(PRIVATE_UPLOAD_DIR, 'registration-documents');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}_${safeOriginal}`);
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
function createUploader(maxSizeMb, selectedStorage = storage) {
  return multer({
    storage: selectedStorage,
    fileFilter,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
  });
}

const upload = createUploader(MAX_SIZE_MB);
const documentUpload = createUploader(MAX_DOCUMENT_SIZE_MB);
const registrationUpload = createUploader(MAX_SIZE_MB, privateStorage);

module.exports = { upload, documentUpload, registrationUpload };
