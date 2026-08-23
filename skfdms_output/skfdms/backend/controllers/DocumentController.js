const path        = require('path');
const fs          = require('fs');
const db          = require('../config/database');
const { logActivity } = require('../utils/logger');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');

let archiveColumnsPromise = null;
function ensureArchiveColumns() {
  if (!archiveColumnsPromise) {
    archiveColumnsPromise = (async () => {
      await db.query(`
        ALTER TABLE documents
          ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_archive_scope
          ON documents (is_archived, barangay_id, created_at DESC)
      `);
    })();
  }
  return archiveColumnsPromise;
}

let requestColumnsPromise = null;
function ensureRequestColumns() {
  if (!requestColumnsPromise) {
    requestColumnsPromise = (async () => {
      await db.query(`
        ALTER TABLE documents
          ADD COLUMN IF NOT EXISTS publish_requested BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_requested
          ON documents (barangay_id, publish_requested, is_published, created_at DESC)
      `);
    })();
  }
  return requestColumnsPromise;
}

// ── GET /api/documents  (public — only published) ───────────
async function listPublic(req, res) {
  const { category_id, year, q, limit } = req.query;
  const barangayId = req.query.barangay_id;
  
  let queryText = `
    SELECT d.id, d.title, d.description, d.file_name, d.file_type,
           d.file_size_kb, d.fiscal_year, d.quarter, d.published_at,
           d.category_id, d.barangay_id,
           c.name AS category_name, c.code AS category_code,
           b.name AS barangay_name,
           u.name AS uploaded_by
      FROM documents d
      JOIN categories c ON c.id = d.category_id
      JOIN users u      ON u.id = d.uploaded_by
      JOIN barangays b  ON b.id = d.barangay_id
     WHERE d.is_published = true
       AND COALESCE(d.is_archived, false) = false
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
    queryText += ` AND d.title ILIKE $${params.length}`;
  }
  if (barangayId && barangayId !== 'all') {
    params.push(barangayId);
    queryText += ` AND d.barangay_id = $${params.length}`;
  }

  queryText += ' ORDER BY d.published_at DESC';

  if (limit) {
    params.push(Math.max(1, Math.min(parseInt(limit, 10) || 20, 100)));
    queryText += ` LIMIT $${params.length}`;
  }

  try {
    await ensureArchiveColumns();
    const { rows } = await db.query(queryText, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listPublic error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/admin/documents ────────────────────────────────
async function listAdmin(req, res) {
  try {
    await ensureArchiveColumns();
    await ensureRequestColumns();
    const barangayId = getEffectiveBarangayId(req);
    const { category_id, year, is_published, archived } = req.query;
    const showArchived = archived === 'true' || archived === '1';

    if (showArchived && req.user.role !== 'admin' && req.user.role !== 'chairperson') {
      return res.status(403).json({ success: false, message: 'Archived documents are available to SK Fed admin and SK Chairperson only.' });
    }

    let queryText = `
      SELECT d.id, d.title, d.description, d.file_name, d.file_type,
             d.file_size_kb, d.fiscal_year, d.quarter, d.published_at,
             d.created_at, d.updated_at,
             d.category_id, d.barangay_id, d.is_published,
             COALESCE(d.is_archived, false) AS is_archived, d.archived_at,
             COALESCE(d.publish_requested, false) AS publish_requested,
             d.requested_by, d.requested_at,
             c.name AS category_name, c.code AS category_code,
             u.name AS uploaded_by_name, au.name AS archived_by_name
        FROM documents d
        JOIN categories c ON c.id = d.category_id
        JOIN users u      ON u.id = d.uploaded_by
        LEFT JOIN users au ON au.id = d.archived_by
    `;
    const params = [];

    if (barangayId !== 'all') {
      queryText += ' WHERE d.barangay_id = $1';
      params.push(barangayId);
    } else {
      queryText += ' WHERE 1=1';
    }

    params.push(showArchived);
    queryText += ` AND COALESCE(d.is_archived, false) = $${params.length}`;

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

    const { rows } = await db.query(queryText, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('listAdmin error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── POST /api/admin/documents ───────────────────────────────
async function upload(req, res) {
  const uploadedFiles = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);

  if (!uploadedFiles.length) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }
  if (uploadedFiles.length > 10) {
    uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    return res.status(400).json({ success: false, message: 'You can upload up to 10 document files only.' });
  }

  const { title, description, category_id, fiscal_year, quarter } = req.body;
  if (!title || !category_id || !fiscal_year) {
    uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    return res.status(400).json({ success: false, message: 'Title, category, and fiscal year are required.' });
  }

  try {
    const barangayId = getEffectiveBarangayId(req);
    const createdIds = [];

    for (const file of uploadedFiles) {
      const fileSizeKb = Math.ceil(file.size / 1024);
      const fileExt = path.extname(file.originalname).replace('.', '').toLowerCase();

      const { rows } = await db.query(
        `INSERT INTO documents
            (barangay_id, category_id, uploaded_by, title, description,
             file_path, file_name, file_type, file_size_kb, fiscal_year, quarter)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [barangayId, category_id, req.user.id, title.trim(), description?.trim() || '',
         file.path, file.filename, fileExt, fileSizeKb, fiscal_year, quarter || 'Annual']
      );

      const newDocId = rows[0].id;
      createdIds.push(newDocId);

      await logActivity({
        userId:     req.user.id,
        action:     'UPLOAD_DOCUMENT',
        entityType: 'document',
        entityId:   newDocId,
        details:    `Uploaded "${title}" (${fileExt.toUpperCase()}, ${fileSizeKb}KB)`,
        ip:         req.ip,
      });
    }

    return res.status(201).json({
      success: true,
      message: uploadedFiles.length === 1 ? 'Document uploaded successfully.' : `${uploadedFiles.length} documents uploaded successfully.`,
      documentId: createdIds[0],
      documentIds: createdIds,
    });

  } catch (err) {
    uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('upload error:', err);
    return res.status(500).json({ success: false, message: 'Server error during upload.' });
  }
}

// ── PATCH /api/admin/documents/:id/publish ──────────────────
async function togglePublish(req, res) {
  const { id } = req.params;
  const requesterIsChair = req.user.role === 'chairperson';

  try {
    await ensureArchiveColumns();
    await ensureRequestColumns();
    const barangayId = getEffectiveBarangayId(req);
    const isAdmin = req.user.role === 'admin';

    const { rows } = await db.query(
      `SELECT id, title, is_published, COALESCE(is_archived, false) AS is_archived,
              COALESCE(publish_requested, false) AS publish_requested, requested_by
         FROM documents
        WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    const doc = rows[0];
    if (doc.is_archived) {
      return res.status(400).json({ success: false, message: 'Archived documents cannot be published.' });
    }

    if (requesterIsChair && doc.publish_requested) {
      return res.status(400).json({ success: false, message: 'This document has already been requested for publish.' });
    }

    if (requesterIsChair && !doc.publish_requested) {
      await db.query(
        `UPDATE documents
            SET publish_requested = true,
                requested_by = $1,
                requested_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND barangay_id = $3
          RETURNING id`,
        [req.user.id, id, barangayId]
      );

      await logActivity({
        userId:     req.user.id,
        action:     'REQUEST_PUBLISH_DOCUMENT',
        entityType: 'document',
        entityId:   parseInt(id),
        details:    `"${doc.title}" publish requested`,
        ip:         req.ip,
      });

      return res.json({
        success: true,
        message: 'Document publish request submitted.',
        is_published: doc.is_published,
        publish_requested: true,
      });
    }

    if (isAdmin) {
      const newStatus = !doc.is_published;

      const updated = await db.query(
        `UPDATE documents
            SET is_published = $1,
                publish_requested = false,
                requested_by = NULL,
                requested_at = NULL,
                published_at = $2
          WHERE id = $3
          RETURNING is_published, publish_requested, published_at`,
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
        is_published: updated.rows[0].is_published,
        publish_requested: updated.rows[0].publish_requested,
        published_at: updated.rows[0].published_at,
      });
    }

    return res.status(403).json({ success: false, message: 'Only admin can publish documents directly.' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('togglePublish error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── PATCH /api/admin/documents/:id ───────────────────────────
async function update(req, res) {
  const { id } = req.params;
  const { title, description, category_id, fiscal_year, quarter } = req.body;

  if (!title || !category_id || !fiscal_year) {
    return res.status(400).json({
      success: false,
      message: 'Title, category, and fiscal year are required.',
    });
  }

  try {
    await ensureArchiveColumns();
    const barangayId = getEffectiveBarangayId(req);

    const existing = await db.query(
      `SELECT id, title FROM documents
        WHERE id = $1 AND barangay_id = $2 AND COALESCE(is_archived, false) = false`,
      [id, barangayId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    const category = await db.query(`SELECT id FROM categories WHERE id = $1`, [category_id]);
    if (category.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid category selected.' });
    }

    const { rows } = await db.query(
      `UPDATE documents
          SET title = $1,
              description = $2,
              category_id = $3,
              fiscal_year = $4,
              quarter = $5
        WHERE id = $6 AND barangay_id = $7
        RETURNING *`,
      [
        title.trim(),
        description?.trim() || '',
        category_id,
        fiscal_year,
        quarter || 'Annual',
        id,
        barangayId,
      ]
    );

    await logActivity({
      userId:     req.user.id,
      action:     'UPDATE_DOCUMENT',
      entityType: 'document',
      entityId:   parseInt(id),
      details:    `Updated "${existing.rows[0].title}" to "${title.trim()}"`,
      ip:         req.ip,
    });

    return res.json({
      success: true,
      message: 'Document updated successfully.',
      data: rows[0],
    });

  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('update document error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── DELETE /api/admin/documents/:id ─────────────────────────
async function remove(req, res) {
  const { id } = req.params;

  try {
    const barangayId = getEffectiveBarangayId(req);

    const { rows } = await db.query(
      `SELECT id, title, file_path FROM documents WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
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
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('remove error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/documents/:id/download ─────────────────────────
async function archive(req, res) {
  const { id } = req.params;

  try {
    await ensureArchiveColumns();
    const barangayId = getEffectiveBarangayId(req);

    const { rows } = await db.query(
      `SELECT id, title FROM documents
        WHERE id = $1 AND barangay_id = $2 AND COALESCE(is_archived, false) = false`,
      [id, barangayId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found or already archived.' });
    }

    await db.query(
      `UPDATE documents
          SET is_archived = true,
              archived_at = CURRENT_TIMESTAMP,
              archived_by = $1,
              is_published = false,
              published_at = NULL,
              publish_requested = false,
              requested_by = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND barangay_id = $3`,
      [req.user.id, id, barangayId]
    );

    await logActivity({
      userId:     req.user.id,
      action:     'ARCHIVE_DOCUMENT',
      entityType: 'document',
      entityId:   parseInt(id, 10),
      details:    `Archived "${rows[0].title}"`,
      ip:         req.ip,
    });

    return res.json({ success: true, message: 'Document archived successfully.', is_archived: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('archive error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function restore(req, res) {
  const { id } = req.params;

  try {
    await ensureArchiveColumns();
    const barangayId = getEffectiveBarangayId(req);

    const { rows } = await db.query(
      `SELECT id, title FROM documents
        WHERE id = $1 AND barangay_id = $2 AND COALESCE(is_archived, false) = true`,
      [id, barangayId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Archived document not found.' });
    }

    await db.query(
      `UPDATE documents
          SET is_archived = false,
              archived_at = NULL,
              archived_by = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND barangay_id = $2`,
      [id, barangayId]
    );

    await logActivity({
      userId:     req.user.id,
      action:     'RESTORE_DOCUMENT',
      entityType: 'document',
      entityId:   parseInt(id, 10),
      details:    `Restored "${rows[0].title}" from archive`,
      ip:         req.ip,
    });

    return res.json({ success: true, message: 'Document restored successfully.', is_archived: false });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('restore error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function download(req, res) {
  const { id } = req.params;
  const isPreview = req.query.preview === '1';

  try {
    await ensureArchiveColumns();
    const { rows } = await db.query(
      `SELECT file_path, file_name, file_type, is_published FROM documents WHERE id = $1`,
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

    if (isPreview) {
      var inlineTypes = ['pdf','jpg','jpeg','png','gif','svg'];
      var fileType = (doc.file_type || '').toLowerCase();
      if (inlineTypes.includes(fileType)) {
        var mimeType = 'application/octet-stream';
        if (fileType === 'pdf') mimeType = 'application/pdf';
        if (fileType === 'jpg' || fileType === 'jpeg') mimeType = 'image/jpeg';
        if (fileType === 'png') mimeType = 'image/png';
        if (fileType === 'gif') mimeType = 'image/gif';
        if (fileType === 'svg') mimeType = 'image/svg+xml';

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${doc.file_name}"`);
        return res.sendFile(path.resolve(doc.file_path));
      }
    }

    res.download(path.resolve(doc.file_path), doc.file_name);

  } catch (err) {
    console.error('download error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/admin/stats ────────────────────────────────────
async function stats(req, res) {
  try {
    await ensureArchiveColumns();
    const barangayId = getEffectiveBarangayId(req);
    const allBarangays = barangayId === 'all';

    const resTotal     = await db.query(`SELECT COUNT(*) AS total FROM documents WHERE COALESCE(is_archived, false) = false${allBarangays ? '' : ' AND barangay_id = $1'}`, allBarangays ? [] : [barangayId]);
    const resPublished = await db.query(`SELECT COUNT(*) AS published FROM documents WHERE COALESCE(is_archived, false) = false AND is_published = true${allBarangays ? '' : ' AND barangay_id = $1'}`, allBarangays ? [] : [barangayId]);
    const resDraft     = await db.query(`SELECT COUNT(*) AS draft FROM documents WHERE COALESCE(is_archived, false) = false AND is_published = false${allBarangays ? '' : ' AND barangay_id = $1'}`, allBarangays ? [] : [barangayId]);
    const resCats      = await db.query(`SELECT COUNT(DISTINCT category_id) AS cats FROM documents WHERE COALESCE(is_archived, false) = false${allBarangays ? '' : ' AND barangay_id = $1'}`, allBarangays ? [] : [barangayId]);

    const recentDocsQuery = allBarangays
      ? `SELECT d.id, d.title, d.created_at, c.code AS category_code, d.is_published
           FROM documents d JOIN categories c ON c.id = d.category_id
          WHERE COALESCE(d.is_archived, false) = false
          ORDER BY d.created_at DESC LIMIT 5`
      : `SELECT d.id, d.title, d.created_at, c.code AS category_code, d.is_published
           FROM documents d JOIN categories c ON c.id = d.category_id
          WHERE d.barangay_id = $1 AND COALESCE(d.is_archived, false) = false
          ORDER BY d.created_at DESC LIMIT 5`;

    const { rows: recentDocs } = await db.query(recentDocsQuery, allBarangays ? [] : [barangayId]);

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
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('stats error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { listPublic, listAdmin, upload, togglePublish, update, remove, archive, restore, download, stats };
