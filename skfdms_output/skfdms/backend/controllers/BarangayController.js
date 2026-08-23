const db = require('../config/database');

async function list(req, res) {
  try {
    const { rows } = await db.query(
      'SELECT id, name, municipality, province, region FROM barangays ORDER BY name'
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Barangay list error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

module.exports = { list };