const path        = require('path');
const fs          = require('fs');
const db          = require('../config/database');
const { logActivity } = require('../utils/logger');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');

const ARCHIVE_RETENTION_YEARS = 5;

let archiveColumnsPromise = null;
function ensureArchiveColumns() {
  if (!archiveColumnsPromise) {
    archiveColumnsPromise = (async () => {
      await db.query(`
        ALTER TABLE documents
          ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS chairperson_archived BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS chairperson_archived_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS chairperson_archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_archive_scope
          ON documents (is_archived, barangay_id, created_at DESC)
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_archive_retention
          ON documents (archived_at)
          WHERE is_archived = true
      `);
    })().catch((err) => {
      archiveColumnsPromise = null;
      throw err;
    });
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
    })().catch((err) => {
      requestColumnsPromise = null;
      throw err;
    });
  }
  return requestColumnsPromise;
}

let engagementColumnsPromise = null;
function ensureEngagementColumns() {
  if (!engagementColumnsPromise) {
    engagementColumnsPromise = (async () => {
      await db.query(`
        ALTER TABLE documents
          ADD COLUMN IF NOT EXISTS preview_count INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0
      `);
    })().catch((err) => {
      engagementColumnsPromise = null;
      throw err;
    });
  }
  return engagementColumnsPromise;
}

async function purgeExpiredArchivedDocuments() {
  await ensureArchiveColumns();

  const { rows } = await db.query(
    `SELECT id, title, file_path, barangay_id
       FROM documents
      WHERE COALESCE(is_archived, false) = true
        AND archived_at IS NOT NULL
        AND archived_at <= CURRENT_TIMESTAMP - ($1::text::interval)`,
    [`${ARCHIVE_RETENTION_YEARS} years`]
  );

  if (!rows.length) return 0;

  const ids = rows.map((row) => row.id);
  const deleted = await db.query(
    `DELETE FROM documents
      WHERE id = ANY($1::int[])
      RETURNING id`,
    [ids]
  );
  const deletedIds = new Set(deleted.rows.map((row) => Number(row.id)));

  rows
    .filter((row) => deletedIds.has(Number(row.id)))
    .forEach((doc) => {
      if (!doc.file_path) return;
      try {
        if (fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path);
      } catch (err) {
        console.error(`[WARN] Failed to remove expired archived document file (${doc.file_path}):`, err.message);
      }
    });

  await logActivity({
    userId:     null,
    action:     'AUTO_DELETE_ARCHIVED_DOCUMENTS',
    entityType: 'document',
    entityId:   deleted.rows[0] ? parseInt(deleted.rows[0].id, 10) : null,
    details:    `Automatically deleted ${deleted.rowCount} archived document(s) older than ${ARCHIVE_RETENTION_YEARS} years.`,
    barangayId: null,
    ip:         '',
  });

  return deleted.rowCount;
}

// ── GET /api/documents  (public — only published) ───────────
async function listPublic(req, res) {
  const { category_id, year, q, limit } = req.query;
  const barangayId = req.query.barangay_id;
  
  let queryText = `
    SELECT d.id, d.title, d.description, d.file_name, d.file_type,
           d.file_size_kb, d.fiscal_year, d.quarter, d.published_at,
           COALESCE(d.preview_count, 0) AS preview_count,
           COALESCE(d.download_count, 0) AS download_count,
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
    await ensureEngagementColumns();
    await purgeExpiredArchivedDocuments();
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
    await purgeExpiredArchivedDocuments();
    const barangayId = getEffectiveBarangayId(req);
    const { category_id, year, is_published, publish_requested, archived } = req.query;
    const showArchived = archived === 'true' || archived === '1';
    const isAdmin = req.user.role === 'admin';

    if (showArchived && req.user.role !== 'admin' && req.user.role !== 'chairperson') {
      return res.status(403).json({ success: false, message: 'Archived documents are available to SK Fed admin and SK Chairperson only.' });
    }

    let queryText = `
      SELECT d.id, d.title, d.description, d.file_name, d.file_type,
             d.file_size_kb, d.fiscal_year, d.quarter, d.published_at,
             d.created_at, d.updated_at,
             d.category_id, d.barangay_id, d.is_published,
             COALESCE(d.is_archived, false) AS is_archived, d.archived_at,
             COALESCE(d.chairperson_archived, false) AS chairperson_archived, d.chairperson_archived_at,
                COALESCE(d.publish_requested, false) AS publish_requested,
               d.requested_by, d.requested_at,
               c.name AS category_name, c.code AS category_code,
               u.name AS uploaded_by_name, au.name AS archived_by_name,
               b.name AS barangay_name
         FROM documents d
         JOIN categories c ON c.id = d.category_id
         JOIN users u      ON u.id = d.uploaded_by
         LEFT JOIN users au ON au.id = d.archived_by
         JOIN barangays b  ON b.id = d.barangay_id
     `;
    const params = [];

    if (barangayId !== 'all') {
      queryText += ' WHERE d.barangay_id = $1';
      params.push(barangayId);
    } else {
      queryText += ' WHERE 1=1';
    }

    // A chairperson's "My Documents" is an account-specific workspace.
    // Barangay-scoped access alone would also include files submitted by a
    // previous or another chairperson in the same barangay.
    if (req.user.role === 'chairperson') {
      params.push(req.user.id);
      queryText += ` AND d.uploaded_by = $${params.length}`;
    }

    params.push(showArchived);
    queryText += req.user.role === 'chairperson'
      ? ` AND COALESCE(d.is_archived, false) = false AND COALESCE(d.chairperson_archived, false) = $${params.length}`
      : ` AND COALESCE(d.is_archived, false) = $${params.length}`;

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
    if (publish_requested !== undefined) {
      params.push(publish_requested === 'true');
      queryText += ` AND COALESCE(d.publish_requested, false) = $${params.length}`;
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
  const uploadedFiles = req.file ? [req.file] : [];

  if (!uploadedFiles.length) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
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
        barangayId,
        ip:         req.ip,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully.',
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
              COALESCE(publish_requested, false) AS publish_requested, requested_by, requested_at
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
      if (Number(doc.requested_by) !== Number(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Only the chairperson who submitted this request can cancel it.' });
      }

      await db.query(
        `UPDATE documents
            SET publish_requested = false,
                requested_by = NULL,
                requested_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND barangay_id = $2
          RETURNING id`,
        [id, barangayId]
      );

      await logActivity({
        userId: req.user.id,
        action: 'CANCEL_PUBLISH_REQUEST_DOCUMENT',
        entityType: 'document',
        entityId: parseInt(id, 10),
        details: `Cancelled publish request for "${doc.title}"`,
        barangayId,
        ip: req.ip,
      });

      return res.json({
        success: true,
        message: 'Document publish request cancelled.',
        is_published: doc.is_published,
        publish_requested: false,
      });
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
        barangayId,
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
                publish_requested = NOT $1,
                requested_by = COALESCE(requested_by, $2::integer),
                requested_at = COALESCE(requested_at, CURRENT_TIMESTAMP),
                published_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END
          WHERE id = $3
          RETURNING is_published, publish_requested, published_at`,
        [newStatus, req.user.id, id]
      );

      await logActivity({
        userId:     req.user.id,
        action:     newStatus ? 'PUBLISH_DOCUMENT' : 'UNPUBLISH_DOCUMENT',
        entityType: 'document',
        entityId:   parseInt(id),
        details:    `"${doc.title}" ${newStatus ? 'published' : 'unpublished'}`,
        barangayId,
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
      barangayId,
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
      barangayId,
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
    await ensureRequestColumns();
    const barangayId = getEffectiveBarangayId(req);
    const isChairperson = req.user.role === 'chairperson';

    const { rows } = await db.query(
      `SELECT id, title, is_published, COALESCE(publish_requested, false) AS publish_requested
         FROM documents
        WHERE id = $1 AND barangay_id = $2
          AND COALESCE(is_archived, false) = false
          AND ($3::boolean = false OR uploaded_by = $4)
          AND ($3::boolean = false OR COALESCE(chairperson_archived, false) = false)`,
      [id, barangayId, isChairperson, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found or already archived.' });
    }

    if (isChairperson && rows[0].publish_requested) {
      return res.status(400).json({ success: false, message: 'Requested documents cannot be archived while awaiting SK Fed approval.' });
    }

    if (isChairperson) {
      // A chairperson archive is personal to their My Documents workspace.
      // It must not unpublish a document already approved by SK Fed.
      await db.query(
        `UPDATE documents
            SET chairperson_archived = true,
                chairperson_archived_at = CURRENT_TIMESTAMP,
                chairperson_archived_by = $1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND barangay_id = $3`,
        [req.user.id, id, barangayId]
      );
    } else {
      await db.query(
        `UPDATE documents
            SET is_archived = true,
                archived_at = CURRENT_TIMESTAMP,
                archived_by = $1,
                is_published = false,
                published_at = NULL,
                publish_requested = false,
                requested_by = NULL,
                requested_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND barangay_id = $3`,
        [req.user.id, id, barangayId]
      );
    }

    await logActivity({
      userId:     req.user.id,
      action:     'ARCHIVE_DOCUMENT',
      entityType: 'document',
      entityId:   parseInt(id, 10),
      details:    `${isChairperson ? 'Archived in My Documents' : 'Archived'} "${rows[0].title}"`,
      barangayId,
      ip:         req.ip,
    });

    return res.json({ success: true, message: 'Document archived successfully.', is_archived: !isChairperson });
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
    await ensureRequestColumns();
    await purgeExpiredArchivedDocuments();
    const barangayId = getEffectiveBarangayId(req);
    const isChairperson = req.user.role === 'chairperson';

    const { rows } = await db.query(
      `SELECT id, title FROM documents
         WHERE id = $1 AND barangay_id = $2
           AND ($3::boolean = false OR uploaded_by = $4)
           AND (CASE WHEN $3::boolean THEN COALESCE(chairperson_archived, false) ELSE COALESCE(is_archived, false) END) = true`,
      [id, barangayId, isChairperson, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Archived document not found.' });
    }

    if (isChairperson) {
      await db.query(
        `UPDATE documents
            SET chairperson_archived = false,
                chairperson_archived_at = NULL,
                chairperson_archived_by = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND barangay_id = $2`,
        [id, barangayId]
      );
    } else {
      await db.query(
        `UPDATE documents
           SET is_archived = false,
               archived_at = NULL,
               archived_by = NULL,
               is_published = false,
               publish_requested = true,
               requested_by = $1,
               requested_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND barangay_id = $3`,
        [req.user.id, id, barangayId]
      );
    }

    await logActivity({
      userId:     req.user.id,
      action:     'RESTORE_DOCUMENT',
      entityType: 'document',
      entityId:   parseInt(id, 10),
      details:    `Restored "${rows[0].title}" from archive`,
      barangayId,
      ip:         req.ip,
    });

    return res.json({ success: true, message: isChairperson ? 'Document restored successfully.' : 'Document restored as requested.', is_archived: false, publish_requested: !isChairperson });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('restore error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── PATCH /api/admin/documents/bulk/archive ────────────────────
async function bulkArchive(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No documents selected.' });
  }

  const barangayId = getEffectiveBarangayId(req);
  const isScopeAll = barangayId === 'all';

  try {
    await ensureArchiveColumns();
    await ensureRequestColumns();

    const idList = ids.map(Number).filter((n) => !isNaN(n));
    if (!idList.length) {
      return res.status(400).json({ success: false, message: 'No valid document ids provided.' });
    }

    // Chairperson archiving is local to My Documents. Never unpublish items
    // that SK Fed has already approved, and never archive pending requests.
    if (req.user.role === 'chairperson') {
      const placeholders = idList.map((_, i) => `$${i + 1}`);
      const { rows } = await db.query(
        `SELECT id, title FROM documents
          WHERE id IN (${placeholders.join(',')})
            AND barangay_id = $${idList.length + 1}
            AND uploaded_by = $${idList.length + 2}
            AND COALESCE(is_archived, false) = false
            AND COALESCE(chairperson_archived, false) = false
            AND COALESCE(publish_requested, false) = false`,
        [...idList, barangayId, req.user.id]
      );
      if (!rows.length) {
        return res.status(400).json({ success: false, message: 'Requested or unavailable documents cannot be archived.' });
      }
      const validIds = rows.map((row) => row.id);
      const updatePlaceholders = validIds.map((_, i) => `$${i + 1}`);
      await db.query(
        `UPDATE documents
            SET chairperson_archived = true,
                chairperson_archived_at = CURRENT_TIMESTAMP,
                chairperson_archived_by = $${validIds.length + 1},
                updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${updatePlaceholders.join(',')})`,
        [...validIds, req.user.id]
      );
      await logActivity({
        userId: req.user.id,
        action: 'BULK_ARCHIVE_DOCUMENT',
        entityType: 'document',
        entityId: validIds[0],
        details: `Archived ${validIds.length} document(s) in My Documents: ${rows.map((row) => row.title).join(', ')}`,
        barangayId,
        ip: req.ip,
      });
      return res.json({ success: true, message: `${validIds.length} document(s) archived successfully.`, archived: validIds.length });
    }

    const selParams = idList.map((_, i) => `$${i + 1}`);
    let selectParams = [...idList];
    let scopeClause = '';
    if (!isScopeAll) {
      const barIdx = idList.length + 1;
      scopeClause = ` AND barangay_id = $${barIdx}`;
      selectParams.push(barangayId);
    }

    const { rows } = await db.query(
      `SELECT id, title FROM documents
         WHERE id IN (${selParams.join(',')})
           ${scopeClause}
           AND COALESCE(is_archived, false) = false`,
      selectParams
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'No matching documents found.' });
    }

    // idsToUpdate are already validated against the (scoped) barangay above,
    // so the UPDATE can safely target them by id only — this avoids casting
    // the string 'all' into the integer barangay_id column.
    const idsToUpdate = rows.map((r) => r.id);
    const titles = rows.map((r) => r.title);
    const updParams = idsToUpdate.map((_, i) => `$${i + 1}`);
    const archByIdx = idsToUpdate.length + 1;

    await db.query(
      `UPDATE documents
           SET is_archived = true,
               archived_at = CURRENT_TIMESTAMP,
               archived_by = $${archByIdx},
               is_published = false,
               published_at = NULL,
               publish_requested = false,
               requested_by = NULL,
               updated_at = CURRENT_TIMESTAMP
         WHERE id IN (${updParams.join(',')})`,
      [...idsToUpdate, req.user.id]
    );

    await logActivity({
      userId:     req.user.id,
      action:     'BULK_ARCHIVE_DOCUMENT',
      entityType: 'document',
      entityId:   parseInt(idsToUpdate[0], 10),
      details:    `Archived ${idsToUpdate.length} document(s): ${titles.join(', ')}`,
      barangayId: isScopeAll ? null : barangayId,
      ip:         req.ip,
    });

    return res.json({
      success:  true,
      message:  `${idsToUpdate.length} document(s) archived successfully.`,
      archived: idsToUpdate.length,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('bulkArchive error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function download(req, res) {
  const { id } = req.params;
  const isPreview = req.query.preview === '1';
  const engagementAlreadyRecorded = req.query.tracked === '1';

  try {
    await ensureArchiveColumns();
    await ensureEngagementColumns();
    await purgeExpiredArchivedDocuments();
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
      var inlineTypes = ['pdf','jpg','jpeg','png','gif','svg','webp'];
      var fileType = String(doc.file_type || '').toLowerCase().trim().replace(/^\.+/, '');
      if (fileType.includes('/')) fileType = fileType.split('/').pop();
      if (!inlineTypes.includes(fileType)) {
        var fileNameMatch = String(doc.file_name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
        if (fileNameMatch) fileType = fileNameMatch[1];
      }
      if (inlineTypes.includes(fileType)) {
        if (!engagementAlreadyRecorded) {
          await db.query(
            `UPDATE documents
                SET preview_count = COALESCE(preview_count, 0) + 1
              WHERE id = $1`,
            [id]
          );
        }
        var mimeType = 'application/octet-stream';
        if (fileType === 'pdf') mimeType = 'application/pdf';
        if (fileType === 'jpg' || fileType === 'jpeg') mimeType = 'image/jpeg';
        if (fileType === 'png') mimeType = 'image/png';
        if (fileType === 'gif') mimeType = 'image/gif';
        if (fileType === 'svg') mimeType = 'image/svg+xml';
        if (fileType === 'webp') mimeType = 'image/webp';

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${doc.file_name}"`);
        return res.sendFile(path.resolve(doc.file_path));
      }
    }

    await db.query(
      `UPDATE documents
          SET download_count = COALESCE(download_count, 0) + 1
        WHERE id = $1`,
      [id]
    );
    res.download(path.resolve(doc.file_path), doc.file_name);

  } catch (err) {
    console.error('download error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// Records an interaction before a public preview is rendered. This also covers
// file formats that do not have an inline browser preview.
async function recordEngagement(req, res) {
  const { id } = req.params;
  const type = String(req.body && req.body.type || '').toLowerCase();
  if (!['preview', 'download'].includes(type)) {
    return res.status(400).json({ success: false, message: 'Invalid engagement type.' });
  }

  try {
    await ensureArchiveColumns();
    await ensureEngagementColumns();
    const countColumn = type === 'preview' ? 'preview_count' : 'download_count';
    const { rows } = await db.query(
      `UPDATE documents
          SET ${countColumn} = COALESCE(${countColumn}, 0) + 1
        WHERE id = $1
          AND is_published = true
          AND COALESCE(is_archived, false) = false
        RETURNING preview_count, download_count`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Document not found.' });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('record document engagement error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ── GET /api/admin/stats ────────────────────────────────────
async function stats(req, res) {
  try {
    await ensureArchiveColumns();
    await purgeExpiredArchivedDocuments();
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

module.exports = { listPublic, listAdmin, upload, togglePublish, update, remove, archive, restore, bulkArchive, download, recordEngagement, stats, purgeExpiredArchivedDocuments };
