// ============================================================
// backend/controllers/DocumentController.js
// Upload, list, publish, delete SK disclosure documents
// PostgreSQL (Supabase) version
// ============================================================

const path        = require('path');
const fs          = require('fs');
const db          = require('../config/database');
const { logActivity } = require('../utils/logger');

// ── GET /api/documents  (public — only published) ───────────
async function listPublic(req, res) {
  const { category_id, year, q } = req.query;
  
  // Note: Boolean check changed to true for Postgres
  let queryText = `
    SELECT d.id, d.title, d.description, d.file_name, d.file_type,
           d.file_size_kb, d.fiscal_year, d.quarter, d.published_at,
           c.name AS category_name, c.code AS category_code,
           u.name AS uploaded_by
      FROM documents d
      JOIN categories c ON c.id = d.category_id
      JOIN users u      ON u.id = d.uploaded_by
     WHERE d.is_published = true AND d.barangay_id = 1
  `;
  const params = [];

  if (category_id) { 
    params.push(category_id);
    queryText += ` AND d.category_id = $${params.length}`; 
  }
  if (year) { 
    params.push(year);
    queryText += ` AND d.fiscal_year = $${params.length}`; 
  }
  if (q) { 
    params.push(`%${q}%`);
    queryText += ` AND d.title ILIKE $${params.length}`; // ILIKE is case-insensitive in Postgres
  }

  queryText += ' ORDER BY d.published_at DESC';

  try {
    const { rows } = await db.query(queryText, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listPublic error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/admin/documents  (admin — all docs) ────────────
async function listAdmin(req, res) {
  const { category_id, year, is_published } = req.query;
  let queryText = `
    SELECT d.*, c.name AS category_name, c.code AS category_code,
           u.name AS uploaded_by_name
      FROM documents d
      JOIN categories c ON c.id = d.category_id
      JOIN users u      ON u.id = d.uploaded_by
     WHERE d.barangay_id = $1
  `;
  const params = [req.user.barangay_id];

  if (category_id) { 
    params.push(category_id);
    queryText += ` AND d.category_id = $${params.length}`; 
  }
  if (year) { 
    params.push(year);
    queryText += ` AND d.fiscal_year = $${params.length}`; 
  }
  if (is_published !== undefined) {
    params.push(is_published === 'true');
    queryText += ` AND d.is_published = $${params.length}`;
  }
  queryText += ' ORDER BY d.created_at DESC';

  try {
    const { rows } = await db.query(queryText, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listAdmin error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── POST /api/admin/documents  (upload) ─────────────────────
async function upload(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  const { title, description, category_id, fiscal_year, quarter } = req.body;

  if (!title || !category_id || !fiscal_year) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ success: false, message: 'Title, category, and fiscal year are required.' });
  }

  try {
    const fileSizeKb = Math.ceil(req.file.size / 1024);
    const fileExt    = path.extname(req.file.originalname).replace('.', '').toLowerCase();

    // RETURNING id is added to get the new ID in Postgres
    const queryText = `
      INSERT INTO documents
          (barangay_id, category_id, uploaded_by, title, description,
           file_path, file_name, file_type, file_size_kb, fiscal_year, quarter)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id
    `;
    
    const { rows } = await db.query(queryText, [
      req.user.barangay_id,
      category_id,
      req.user.id,
      title.trim(),
      description?.trim() || '',
      req.file.path,
      req.file.filename,
      fileExt,
      fileSizeKb,
      fiscal_year,
      quarter || 'Annual',
    ]);

    const newDocId = rows[0].id;

    await logActivity({
      userId:     req.user.id,
      action:     'UPLOAD_DOCUMENT',
      entityType: 'document',
      entityId:   newDocId,
      details:    `Uploaded "${title}" (${fileExt.toUpperCase()}, ${fileSizeKb}KB)`,
      ip:         req.ip,
    });

    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully.',
      documentId: newDocId,
    });

  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('upload error:', err);
    return res.status(500).json({ success: false, message: 'Server error during upload.' });
  }
}

// ── PATCH /api/admin/documents/:id/publish ──────────────────
async function togglePublish(req, res) {
  const { id } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT id, title, is_published FROM documents WHERE id = $1 AND barangay_id = $2`,
      [id, req.user.barangay_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    const doc       = rows[0];
    const newStatus = !doc.is_published;

    await db.query(
      `UPDATE documents SET is_published = $1, published_at = $2 WHERE id = $3`,
      [newStatus, newStatus ? new Date() : null, id]
    );

    await logActivity({
      userId:     req.user.id,
      action:     newStatus ? 'PUBLISH_DOCUMENT' : 'UNPUBLISH_DOCUMENT',
      entityType: 'document',
      entityId:   parseInt(id),
      details:    `"${doc.title}" ${newStatus ? 'published' : 'unpublished'}`,
      ip:         req.ip,
    });

    return res.json({
      success:  true,
      message:  `Document ${newStatus ? 'published' : 'unpublished'} successfully.`,
      is_published: newStatus,
    });

  } catch (err) {
    console.error('togglePublish error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── DELETE /api/admin/documents/:id ─────────────────────────
async function remove(req, res) {
  const { id } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT id, title, file_path FROM documents WHERE id = $1 AND barangay_id = $2`,
      [id, req.user.barangay_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    const doc = rows[0];

    if (fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path);

    await db.query(`DELETE FROM documents WHERE id = $1`, [id]);

    await logActivity({
      userId:     req.user.id,
      action:     'DELETE_DOCUMENT',
      entityType: 'document',
      entityId:   parseInt(id),
      details:    `Deleted "${doc.title}"`,
      ip:         req.ip,
    });

    return res.json({ success: true, message: 'Document deleted successfully.' });

  } catch (err) {
    console.error('remove error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/documents/:id/download ─────────────────────────
async function download(req, res) {
  const { id } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT file_path, file_name, is_published FROM documents WHERE id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    const doc = rows[0];

    if (!doc.is_published && !req.session.user) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (!fs.existsSync(doc.file_path)) {
      return res.status(404).json({ success: false, message: 'File not found on server.' });
    }

    res.download(doc.file_path, doc.file_name);

  } catch (err) {
    console.error('download error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/admin/stats  (dashboard counts) ────────────────
async function stats(req, res) {
  try {
    const barangayId = req.user.barangay_id;

    // In Postgres, COUNT returns a string/bigint, so we parse it or use as is
    const resTotal     = await db.query(`SELECT COUNT(*) AS total FROM documents WHERE barangay_id = $1`, [barangayId]);
    const resPublished = await db.query(`SELECT COUNT(*) AS published FROM documents WHERE barangay_id = $1 AND is_published = true`, [barangayId]);
    const resDraft     = await db.query(`SELECT COUNT(*) AS draft FROM documents WHERE barangay_id = $1 AND is_published = false`, [barangayId]);
    const resCats      = await db.query(`SELECT COUNT(DISTINCT category_id) AS cats FROM documents WHERE barangay_id = $1`, [barangayId]);

    const { rows: recentDocs } = await db.query(
      `SELECT d.id, d.title, d.created_at, c.code AS category_code, d.is_published
         FROM documents d JOIN categories c ON c.id = d.category_id
        WHERE d.barangay_id = $1 ORDER BY d.created_at DESC LIMIT 5`,
      [barangayId]
    );

    return res.json({
      success: true,
      data: { 
        totalDocs: parseInt(resTotal.rows[0].total), 
        publishedDocs: parseInt(resPublished.rows[0].published), 
        draftDocs: parseInt(resDraft.rows[0].draft), 
        categories: parseInt(resCats.rows[0].cats), 
        recentDocs 
      },
    });
  } catch (err) {
    console.error('stats error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { listPublic, listAdmin, upload, togglePublish, remove, download, stats };