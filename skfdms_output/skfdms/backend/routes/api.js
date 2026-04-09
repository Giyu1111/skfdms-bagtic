// ============================================================
// backend/routes/api.js
// All SK-FDMS API route definitions
// ============================================================

const express     = require('express');
const router      = express.Router();

const AuthController         = require('../controllers/AuthController');
const DocumentController     = require('../controllers/DocumentController');
const UserController         = require('../controllers/UserController');
const AnnouncementController = require('../controllers/AnnouncementController');
const ActivityLogController  = require('../controllers/ActivityLogController');
const CategoryController     = require('../controllers/CategoryController');

const { requireAuth, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

// ─────────────────────────────────────────────────────────────
// AUTH routes
// ─────────────────────────────────────────────────────────────
router.post('/auth/login',  AuthController.login);
router.post('/auth/logout', AuthController.logout);
router.get ('/auth/me',     AuthController.me);

// ─────────────────────────────────────────────────────────────
// PUBLIC routes (no auth required)
// ─────────────────────────────────────────────────────────────
router.get('/categories',                CategoryController.list);
router.get('/documents',                 DocumentController.listPublic);
router.get('/documents/:id/download',    DocumentController.download);
router.get('/announcements',             AnnouncementController.listPublic);

// ─────────────────────────────────────────────────────────────
// ADMIN routes (authentication required)
// ─────────────────────────────────────────────────────────────

// Dashboard stats
router.get('/admin/stats',               requireAuth, DocumentController.stats);

// Document management
router.get   ('/admin/documents',             requireAuth, DocumentController.listAdmin);
router.post  ('/admin/documents',             requireAuth, upload.single('file'), DocumentController.upload);
router.patch ('/admin/documents/:id/publish', requireAuth, DocumentController.togglePublish);
router.delete('/admin/documents/:id',         requireAuth, requireRole('admin','chairperson'), DocumentController.remove);

// User management (admin only)
router.get  ('/admin/users',           requireRole('admin'), UserController.list);
router.post ('/admin/users',           requireRole('admin'), UserController.create);
router.patch('/admin/users/:id/toggle',requireRole('admin'), UserController.toggleActive);

// Announcements
router.get   ('/admin/announcements',      requireAuth, AnnouncementController.listAdmin);
router.post  ('/admin/announcements',      requireAuth, AnnouncementController.create);
router.delete('/admin/announcements/:id',  requireAuth, AnnouncementController.remove);

// Activity logs
router.get('/admin/activity-logs', requireAuth, ActivityLogController.list);

module.exports = router;
