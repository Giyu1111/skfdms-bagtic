const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { logActivity } = require('../utils/logger');
const { getEffectiveBarangayId } = require('../utils/barangayHelper');

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS fund_proofs (
      id SERIAL PRIMARY KEY,
      barangay_id INTEGER NOT NULL,
      uploaded_by INTEGER NOT NULL,
      document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
      title VARCHAR(300) NOT NULL,
      purpose TEXT NOT NULL,
      expense_category VARCHAR(120) NOT NULL,
      payee VARCHAR(180),
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      fiscal_year INTEGER NOT NULL DEFAULT (EXTRACT(YEAR FROM CURRENT_DATE)),
      spent_at DATE,
      proof_label VARCHAR(120) DEFAULT 'Preview',
      file_path VARCHAR(500) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(50) NOT NULL,
      file_size_kb INTEGER NOT NULL,
      is_published BOOLEAN NOT NULL DEFAULT false,
      publish_requested BOOLEAN NOT NULL DEFAULT false,
      requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      requested_at TIMESTAMP NULL,
      is_archived BOOLEAN NOT NULL DEFAULT false,
      archived_at TIMESTAMP NULL,
      archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      published_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    ALTER TABLE fund_proofs
      ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS fiscal_year INTEGER NOT NULL DEFAULT (EXTRACT(YEAR FROM CURRENT_DATE)),
      ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS publish_requested BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_fund_proofs_archive_scope
      ON fund_proofs (is_archived, barangay_id, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_fund_proofs_document_id
      ON fund_proofs (document_id) WHERE document_id IS NOT NULL
  `);

  tableReady = true;
}

function normalizeFiles(row) {
  let files = parseStoredFiles(row);
  return files.map((file, index) => ({
    index,
    name: file.name || `proof-${index + 1}`,
    type: String(file.type || '').toLowerCase(),
    size_kb: Number(file.size_kb || 0),
    is_image: ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(String(file.type || '').toLowerCase()),
  }));
}

function parseStoredFiles(row) {
  let files = row.files;
  if (typeof files === 'string') {
    try { files = JSON.parse(files); } catch (err) { files = []; }
  }
  if (!Array.isArray(files)) files = [];

  if (!files.length && row.file_path) {
    files = [{
      path: row.file_path,
      name: row.file_name,
      type: row.file_type,
      size_kb: row.file_size_kb,
    }];
  }
  return files;
}

function publicFields(row) {
  const files = normalizeFiles(row);
  let connectedDocuments = row.connected_documents || [];
  if (typeof connectedDocuments === 'string') {
    try { connectedDocuments = JSON.parse(connectedDocuments); } catch (err) { connectedDocuments = []; }
  }
  if (!Array.isArray(connectedDocuments)) connectedDocuments = [];

  return {
    ...row,
    amount: Number(row.amount || 0),
    files,
    file_count: files.length,
    connected_documents: connectedDocuments,
    document_ids: connectedDocuments.length
      ? connectedDocuments.map(doc => doc.id)
      : (row.document_id ? [row.document_id] : []),
    is_image: files[0] ? files[0].is_image : ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(String(row.file_type || '').toLowerCase()),
  };
}

async function listPublic(req, res) {
  try {
    await ensureTable();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 6, 50));
    const params = [];
    const where = ['fp.is_published = true', 'COALESCE(fp.is_archived, false) = false'];

    if (req.query.barangay_id && req.query.barangay_id !== 'all') {
      const barangayId = parseInt(req.query.barangay_id, 10);
      if (!Number.isInteger(barangayId) || barangayId <= 0) {
        return res.status(400).json({ success: false, message: 'Please select a valid barangay.' });
      }
      params.push(barangayId);
      where.push(`fp.barangay_id = $${params.length}`);
    }

    params.push(limit);
    const { rows } = await db.query(
      `SELECT fp.id, fp.title, fp.purpose, fp.expense_category, fp.payee,
              fp.amount, fp.fiscal_year, fp.spent_at, fp.proof_label, fp.file_type, fp.files,
              fp.file_size_kb, fp.published_at, fp.barangay_id, fp.document_id,
              d.title AS document_title, docs.connected_documents, b.name AS barangay
       FROM fund_proofs fp
       LEFT JOIN barangays b ON b.id = fp.barangay_id
       LEFT JOIN documents d ON d.id = fp.document_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', d2.id, 'title', d2.title) ORDER BY d2.title) AS connected_documents
           FROM documents d2
          WHERE (d2.id = fp.document_id
             OR d2.id IN (
               SELECT ids.value::integer
                 FROM jsonb_array_elements_text(COALESCE(fp.document_ids, '[]'::jsonb)) AS ids(value)
             ))
            AND d2.is_published = true
            AND COALESCE(d2.is_archived, false) = false
       ) docs ON true
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(fp.spent_at, fp.published_at, fp.created_at) DESC
        LIMIT $${params.length}`,
      params
    );

    return res.json({ success: true, data: rows.map(publicFields) });
  } catch (err) {
    console.error('listPublic fund proofs error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function listAdmin(req, res) {
  try {
    await ensureTable();
    const barangayId = getEffectiveBarangayId(req);
    const allBarangays = req.user.role === 'admin' && barangayId === 'all';
    const showArchived = req.query.archived === 'true' || req.query.archived === '1';

    if (showArchived && req.user.role !== 'admin' && !['chairperson', 'treasurer'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Archived fund proofs are available to SKFED admin only.' });
    }

    const params = [];
    const where = [];
    if (!allBarangays) {
      params.push(barangayId);
      where.push(`fp.barangay_id = $${params.length}`);
    }
    params.push(showArchived);
    where.push(`COALESCE(fp.is_archived, false) = $${params.length}`);

    const { rows } = await db.query(
      `SELECT fp.*, u.name AS uploaded_by_name, b.name AS barangay, d.title AS document_title,
              docs.connected_documents
         FROM fund_proofs fp
         LEFT JOIN users u ON u.id = fp.uploaded_by
         LEFT JOIN barangays b ON b.id = fp.barangay_id
         LEFT JOIN documents d ON d.id = fp.document_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('id', d2.id, 'title', d2.title) ORDER BY d2.title) AS connected_documents
             FROM documents d2
            WHERE d2.id = fp.document_id
               OR d2.id IN (
                 SELECT ids.value::integer
                   FROM jsonb_array_elements_text(COALESCE(fp.document_ids, '[]'::jsonb)) AS ids(value)
               )
         ) docs ON true
        WHERE ${where.join(' AND ')}
        ORDER BY fp.created_at DESC`,
      params
    );

    return res.json({ success: true, data: rows.map(publicFields) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('listAdmin fund proofs error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function create(req, res) {
  const uploadedFiles = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
  if (!uploadedFiles.length) {
    return res.status(400).json({ success: false, message: 'Please upload at least one image, PDF, DOC/DOCX file, or other supporting document.' });
  }
  if (uploadedFiles.length > 5) {
    uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    return res.status(400).json({ success: false, message: 'You can upload up to 5 proof files only.' });
  }

  const { title, purpose, expense_category, payee, amount, fiscal_year, spent_at, proof_label, document_id, document_ids } = req.body;
  if (!title || !purpose || !expense_category || !amount || !fiscal_year) {
    uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    return res.status(400).json({ success: false, message: 'Title, purpose, category, amount, fiscal year, and proof file are required.' });
  }

  const parsedAmount = Number(String(amount).replace(/,/g, ''));
  if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
    uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    return res.status(400).json({ success: false, message: 'Please enter a valid amount.' });
  }
  const parsedFiscalYear = parseInt(fiscal_year, 10);
  if (!Number.isInteger(parsedFiscalYear) || parsedFiscalYear < 2000 || parsedFiscalYear > 2100) {
    uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    return res.status(400).json({ success: false, message: 'Please enter a valid fiscal year.' });
  }

  try {
    await ensureTable();
      const barangayId = getEffectiveBarangayId(req);
    let documentIds = [];
    if (document_ids) {
      try {
        const parsed = JSON.parse(document_ids);
        if (Array.isArray(parsed)) documentIds = parsed;
      } catch (err) {
        uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
        return res.status(400).json({ success: false, message: 'Selected documents were not formatted correctly.' });
      }
    } else if (document_id) {
      documentIds = [document_id];
    }
    documentIds = [...new Set(documentIds
      .map(id => parseInt(id, 10))
      .filter(id => Number.isInteger(id) && id > 0))];
    const documentId = documentIds.length ? documentIds[0] : null;

    if (documentIds.length) {
      const docCheck = await db.query(
        `SELECT id FROM documents
          WHERE id = ANY($1::int[])
            AND barangay_id = $2
            AND is_published = true
            AND COALESCE(is_archived, false) = false`,
        [documentIds, barangayId]
      );
      if (docCheck.rows.length !== documentIds.length) {
        uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
        return res.status(400).json({ success: false, message: 'One or more selected documents were not found, not published, or not in your barangay.' });
      }
    }

    const files = uploadedFiles.map(file => ({
      path: file.path,
      name: file.filename,
      type: path.extname(file.originalname).replace('.', '').toLowerCase(),
      size_kb: Math.ceil(file.size / 1024),
    }));
    const primaryFile = files[0];

    const { rows } = await db.query(
      `INSERT INTO fund_proofs
          (barangay_id, uploaded_by, title, purpose, expense_category, payee,
           document_id, document_ids, amount, fiscal_year, spent_at, proof_label, file_path, file_name, file_type, file_size_kb, files)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        barangayId,
        req.user.id,
        title.trim(),
        purpose.trim(),
        expense_category.trim(),
        payee?.trim() || '',
        documentId,
        JSON.stringify(documentIds),
        parsedAmount,
        parsedFiscalYear,
        spent_at || null,
        proof_label?.trim() || 'Preview',
        primaryFile.path,
        primaryFile.name,
        primaryFile.type,
        primaryFile.size_kb,
        JSON.stringify(files),
      ]
    );

    await logActivity({
      userId: req.user.id,
      action: 'UPLOAD_FUND_PROOF',
      entityType: 'fund_proof',
      entityId: rows[0].id,
      details: `Uploaded fund proof "${title}" worth PHP ${parsedAmount.toFixed(2)}${documentIds.length ? ' (connected to ' + documentIds.length + ' document' + (documentIds.length === 1 ? '' : 's') + ')' : ''}`,
      ip: req.ip,
    });

    return res.status(201).json({ success: true, message: 'Fund proof uploaded. Publish it when ready for public viewing.', id: rows[0].id, document_id: documentId, document_ids: documentIds });
  } catch (err) {
    uploadedFiles.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('create fund proof error:', err);
    return res.status(500).json({ success: false, message: 'Server error during upload.' });
  }
}

async function togglePublish(req, res) {
  try {
    await ensureTable();
    const barangayId = getEffectiveBarangayId(req);
    const isAdmin = req.user.role === 'admin';

    const { rows } = await db.query(
      `SELECT id, title, is_published, COALESCE(is_archived, false) AS is_archived,
              COALESCE(publish_requested, false) AS publish_requested
         FROM fund_proofs
        WHERE id = $1 AND barangay_id = $2`,
      [req.params.id, barangayId]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Fund proof not found.' });

    const proof = rows[0];
    if (proof.is_archived) {
      return res.status(400).json({ success: false, message: 'Archived fund proofs cannot be published.' });
    }

    if (req.user.role === 'chairperson' && proof.publish_requested) {
      return res.status(400).json({ success: false, message: 'This fund proof has already been requested for publish.' });
    }

    if (req.user.role === 'chairperson' && !proof.publish_requested) {
      await db.query(
        `UPDATE fund_proofs
            SET publish_requested = true,
                requested_by = $1,
                requested_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND barangay_id = $3
          RETURNING id`,
        [req.user.id, req.params.id, barangayId]
      );

      await logActivity({
        userId: req.user.id,
        action: 'REQUEST_PUBLISH_FUND_PROOF',
        entityType: 'fund_proof',
        entityId: parseInt(req.params.id, 10),
        details: `"${proof.title}" publish requested`,
        ip: req.ip,
      });

      return res.json({
        success: true,
        message: 'Fund proof publish request submitted.',
        is_published: proof.is_published,
        publish_requested: true,
      });
    }

    if (isAdmin) {
      const nextStatus = !proof.is_published;
      await db.query(
        `UPDATE fund_proofs
            SET is_published = $1,
                publish_requested = false,
                requested_by = NULL,
                requested_at = NULL,
                published_at = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $3 AND barangay_id = $4`,
        [nextStatus, nextStatus ? new Date() : null, req.params.id, barangayId]
      );

      await logActivity({
        userId: req.user.id,
        action: nextStatus ? 'PUBLISH_FUND_PROOF' : 'UNPUBLISH_FUND_PROOF',
        entityType: 'fund_proof',
        entityId: parseInt(req.params.id, 10),
        details: `"${proof.title}" ${nextStatus ? 'published' : 'unpublished'}`,
        ip: req.ip,
      });

      return res.json({
        success: true,
        message: `Fund proof ${nextStatus ? 'published' : 'unpublished'} successfully.`,
        is_published: nextStatus,
        publish_requested: false,
      });
    }

    return res.status(403).json({ success: false, message: 'Only admin can publish fund proofs directly.' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('toggle fund proof error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function remove(req, res) {
  try {
    await ensureTable();
    const barangayId = getEffectiveBarangayId(req);
    const { rows } = await db.query(
      `SELECT id, title, file_path, files FROM fund_proofs WHERE id = $1 AND barangay_id = $2`,
      [req.params.id, barangayId]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Fund proof not found.' });

    const files = parseStoredFiles(rows[0]);
    files.forEach(file => {
      const filePath = file && file.path ? file.path : null;
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    await db.query(`DELETE FROM fund_proofs WHERE id = $1`, [req.params.id]);

    await logActivity({
      userId: req.user.id,
      action: 'DELETE_FUND_PROOF',
      entityType: 'fund_proof',
      entityId: parseInt(req.params.id, 10),
      details: `Deleted fund proof "${rows[0].title}"`,
      ip: req.ip,
    });

    return res.json({ success: true, message: 'Fund proof deleted successfully.' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('remove fund proof error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function archive(req, res) {
  try {
    await ensureTable();
    const barangayId = getEffectiveBarangayId(req);
    const { rows } = await db.query(
      `SELECT id, title FROM fund_proofs
        WHERE id = $1 AND barangay_id = $2 AND COALESCE(is_archived, false) = false`,
      [req.params.id, barangayId]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Fund proof not found or already archived.' });

    await db.query(
      `UPDATE fund_proofs
          SET is_archived = true,
              archived_at = CURRENT_TIMESTAMP,
              archived_by = $1,
              is_published = false,
              publish_requested = false,
              requested_by = NULL,
              published_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND barangay_id = $3`,
      [req.user.id, req.params.id, barangayId]
    );

    await logActivity({
      userId: req.user.id,
      action: 'ARCHIVE_FUND_PROOF',
      entityType: 'fund_proof',
      entityId: parseInt(req.params.id, 10),
      details: `Archived fund proof "${rows[0].title}"`,
      ip: req.ip,
    });

    return res.json({ success: true, message: 'Fund proof archived successfully.', is_archived: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('archive fund proof error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function restore(req, res) {
  try {
    await ensureTable();
    const barangayId = getEffectiveBarangayId(req);
    const { rows } = await db.query(
      `SELECT id, title FROM fund_proofs
        WHERE id = $1 AND barangay_id = $2 AND COALESCE(is_archived, false) = true`,
      [req.params.id, barangayId]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Archived fund proof not found.' });

    await db.query(
      `UPDATE fund_proofs
          SET is_archived = false,
              archived_at = NULL,
              archived_by = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND barangay_id = $2`,
      [req.params.id, barangayId]
    );

    await logActivity({
      userId: req.user.id,
      action: 'RESTORE_FUND_PROOF',
      entityType: 'fund_proof',
      entityId: parseInt(req.params.id, 10),
      details: `Restored fund proof "${rows[0].title}" from archive`,
      ip: req.ip,
    });

    return res.json({ success: true, message: 'Fund proof restored successfully.', is_archived: false });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('restore fund proof error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function download(req, res) {
  try {
    await ensureTable();
    const { rows } = await db.query(
      `SELECT file_path, file_name, file_type, file_size_kb, files, is_published, barangay_id FROM fund_proofs WHERE id = $1`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Fund proof not found.' });
    const proof = rows[0];
    if (!proof.is_published) {
      const user = req.session && req.session.user;
      const sameBarangay = user && Number(user.barangay_id) === Number(proof.barangay_id);
      if (!user || (user.role !== 'admin' && !sameBarangay)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
    }
    let storedFiles = proof.files;
    if (typeof storedFiles === 'string') {
      try { storedFiles = JSON.parse(storedFiles); } catch (err) { storedFiles = []; }
    }
    if (!Array.isArray(storedFiles) || !storedFiles.length) {
      storedFiles = [{
        path: proof.file_path,
        name: proof.file_name,
        type: proof.file_type,
        size_kb: proof.file_size_kb,
      }];
    }
    const index = Math.max(0, Math.min(parseInt(req.query.file, 10) || 0, storedFiles.length - 1));
    const selected = storedFiles[index];
    if (!selected || !selected.path || !fs.existsSync(selected.path)) return res.status(404).json({ success: false, message: 'File not found on server.' });

    const inlineTypes = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    const type = inlineTypes[String(selected.type).toLowerCase()];
    if (req.query.preview === '1' && type) {
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Disposition', `inline; filename="${selected.name}"`);
      return res.sendFile(path.resolve(selected.path));
    }

    return res.download(selected.path, selected.name);
  } catch (err) {
    console.error('download fund proof error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { listPublic, listAdmin, create, togglePublish, remove, archive, restore, download };
