function getEffectiveBarangayId(req) {
  if (req.user && req.user.role === 'admin') {
    const raw = req.query.barangay_id || req.body.barangay_id;
    if (raw === 'all') return 'all';
    const id = parseInt(raw, 10);
    if (!id || isNaN(id)) {
      const err = new Error('Admin must provide a valid barangay_id.');
      err.statusCode = 400;
      throw err;
    }
    return id;
  }
  return req.user.barangay_id;
}

module.exports = { getEffectiveBarangayId };