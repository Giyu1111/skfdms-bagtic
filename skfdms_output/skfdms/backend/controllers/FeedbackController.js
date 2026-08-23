// ============================================================
// backend/controllers/FeedbackController.js
// Public community feedback
// ============================================================

const db = require('../config/database');

function normalizeRating(value) {
  const rating = Number.parseInt(value, 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  return rating;
}

async function listPublic(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT id, name, rating, message AS text, created_at
         FROM public_feedback
        ORDER BY created_at DESC
        LIMIT 20`
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('feedback listPublic error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

async function create(req, res) {
  const name = (req.body.name || 'Anonymous').trim().slice(0, 150) || 'Anonymous';
  const text = (req.body.text || '').trim();
  const rating = normalizeRating(req.body.rating);

  if (!text) {
    return res.status(400).json({ success: false, message: 'Feedback is required.' });
  }

  if (text.length > 1000) {
    return res.status(400).json({ success: false, message: 'Feedback must be 1000 characters or less.' });
  }

  if (rating === null) {
    return res.status(400).json({ success: false, message: 'Please select a valid rating.' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO public_feedback (name, rating, message, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, rating, message AS text, created_at`,
      [name, rating, text, req.ip, req.get('user-agent') || null]
    );

    return res.status(201).json({
      success: true,
      message: 'Feedback submitted.',
      data: rows[0],
    });
  } catch (err) {
    console.error('feedback create error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { listPublic, create };
