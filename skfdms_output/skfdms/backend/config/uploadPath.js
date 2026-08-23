const os = require('os');
const path = require('path');

function getUploadDir() {
  if (process.env.UPLOAD_DIR) {
    return path.resolve(process.env.UPLOAD_DIR);
  }

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'uploads');
  }

  return path.join(__dirname, '..', 'uploads');
}

module.exports = { getUploadDir };
