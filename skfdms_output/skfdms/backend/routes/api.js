// ============================================================
// backend/routes/api.js
// All SK-FDMS API route definitions
// ============================================================

const express     = require('express');
const router      = express.Router();

const BarangayController = require('../controllers/BarangayController');
const AuthController         = require('../controllers/AuthController');
const DocumentController     = require('../controllers/DocumentController');
const UserController         = require('../controllers/UserController');
const AnnouncementController = require('../controllers/AnnouncementController');
const ActivityLogController  = require('../controllers/ActivityLogController');
const CategoryController     = require('../controllers/CategoryController');
const FundProofController    = require('../controllers/FundProofController');
const FeedbackController     = require('../controllers/FeedbackController');
const ContactMessageController = require('../controllers/ContactMessageController');

const { requireAuth, requireRole } = require('../middleware/auth');
const { upload, documentUpload } = require('../middleware/upload');

// ─────────────────────────────────────────────────────────────
// AUTH routes
// ─────────────────────────────────────────────────────────────
router.post('/auth/login',  AuthController.login);
router.post('/auth/logout', AuthController.logout);
router.get ('/auth/password-setup/validate', AuthController.validatePasswordSetup);
router.post('/auth/password-setup', AuthController.completePasswordSetup);
router.get ('/auth/me',     AuthController.me);
router.patch('/auth/account/name', requireAuth, AuthController.changeName);
router.patch('/auth/account/email', requireAuth, AuthController.changeEmail);
router.patch('/auth/account/password', requireAuth, AuthController.changePassword);

// ─────────────────────────────────────────────────────────────
// PUBLIC routes (no auth required)
// ─────────────────────────────────────────────────────────────
router.get('/categories',                CategoryController.list);
router.get('/documents',                 DocumentController.listPublic);
router.post('/documents/:id/engagement', DocumentController.recordEngagement);
router.get('/documents/:id/download',    DocumentController.download);
router.get('/fund-proofs',               FundProofController.listPublic);
router.get('/fund-proofs/:id/download',  FundProofController.download);
router.get('/announcements',             AnnouncementController.listPublic);
router.get('/feedback',                  FeedbackController.listPublic);
router.post('/feedback',                 FeedbackController.create);
router.post('/contact-messages',         ContactMessageController.create);
router.get('/officials',                 UserController.listPublicOfficials);
router.get('/barangays',                    BarangayController.list);    

// ─────────────────────────────────────────────────────────────
// ADMIN routes (authentication required)
// ─────────────────────────────────────────────────────────────

// Dashboard stats
router.get('/admin/stats',               requireAuth, DocumentController.stats);

// Document management
router.get   ('/admin/documents',             requireAuth, DocumentController.listAdmin);
router.post  ('/admin/documents',             requireRole('chairperson'), documentUpload.single('file'), DocumentController.upload);
router.patch ('/admin/documents/:id',         requireRole(['admin', 'chairperson']), DocumentController.update);
router.patch ('/admin/documents/:id/publish', requireRole(['admin', 'chairperson']), DocumentController.togglePublish);
router.patch ('/admin/documents/bulk/archive',  requireRole(['admin', 'chairperson']), DocumentController.bulkArchive);
router.patch ('/admin/documents/:id/archive', requireRole(['admin', 'chairperson']), DocumentController.archive);
router.patch ('/admin/documents/:id/restore', requireRole(['admin', 'chairperson']), DocumentController.restore);
router.delete('/admin/documents/:id',         requireRole(['admin', 'chairperson']), DocumentController.remove);

// Fund usage proof management
router.get   ('/admin/fund-proofs',             requireAuth, FundProofController.listAdmin);
router.post  ('/admin/fund-proofs',             requireRole('chairperson'), upload.array('file', 5), FundProofController.create);
router.patch ('/admin/fund-proofs/:id/publish', requireRole(['admin', 'chairperson', 'treasurer']), FundProofController.togglePublish);
router.patch ('/admin/fund-proofs/:id/archive', requireRole(['admin', 'chairperson', 'treasurer']), FundProofController.archive);
router.patch ('/admin/fund-proofs/:id/restore', requireRole(['admin', 'chairperson', 'treasurer']), FundProofController.restore);
router.delete('/admin/fund-proofs/:id',         requireRole(['admin', 'chairperson', 'treasurer']), FundProofController.remove);

// User management
router.get  ('/admin/users',                   requireRole(['admin', 'chairperson']), UserController.list);
router.get  ('/admin/users/archived',          requireRole('admin'), UserController.listArchived);
router.post ('/admin/users',                   requireRole('admin'), UserController.create);
router.put  ('/admin/users/:id',               requireRole('admin'), UserController.update);
router.patch('/admin/users/:id/toggle',        requireRole('admin'), UserController.toggleActive);
router.post  ('/admin/users/:id/reset-password', requireRole('admin'), UserController.resetPassword);
router.patch ('/admin/users/:id/password',       requireRole('admin'), UserController.updatePassword);
router.patch ('/admin/users/:id/archive',        requireRole('admin'), UserController.archive);
router.patch ('/admin/users/:id/restore',        requireRole('admin'), UserController.restore);
router.delete('/admin/users/:id',              requireRole('admin'), UserController.remove);
router.post  ('/admin/users/:id/profile-image', requireRole(['admin', 'chairperson']), upload.single('image'), UserController.uploadProfileImage);
router.delete('/admin/users/:id/profile-image', requireRole(['admin', 'chairperson']), UserController.removeProfileImage);

// Announcements
router.get   ('/admin/announcements',      requireAuth, AnnouncementController.listAdmin);
router.post  ('/admin/announcements',      requireRole('chairperson'), AnnouncementController.create);
router.patch ('/admin/announcements/:id/review', requireRole('admin'), AnnouncementController.review);
router.patch ('/admin/announcements/:id/archive', requireRole(['admin', 'chairperson']), AnnouncementController.archive);
router.patch ('/admin/announcements/:id/restore', requireRole(['admin', 'chairperson']), AnnouncementController.restore);
router.delete('/admin/announcements/:id',  requireRole(['admin', 'chairperson']), AnnouncementController.remove);

// Activity logs
router.get('/admin/activity-logs', requireRole(['admin', 'chairperson']), ActivityLogController.list);

// Contact messages
router.get('/admin/contact-messages', requireRole(['admin', 'chairperson']), ContactMessageController.listAdmin);
router.post('/admin/contact-messages', requireRole('admin'), ContactMessageController.sendToChairperson);
router.get('/admin/contact-messages/unread-count', requireRole(['admin', 'chairperson']), ContactMessageController.unreadCount);
router.patch('/admin/contact-messages/:id/read', requireRole(['admin', 'chairperson']), ContactMessageController.markRead);
router.delete('/admin/contact-messages/:id', requireRole(['admin', 'chairperson']), ContactMessageController.remove);

module.exports = router;
