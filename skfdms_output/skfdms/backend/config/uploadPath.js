const os = require('os');
const path = require('path');

function getUploadDir() {
  const isServerless =
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT ||
    process.cwd() === '/var/task';

  if (isServerless) {
    const tmpDir = path.resolve(os.tmpdir());
    const configuredDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : '';

    if (configuredDir && configuredDir.startsWith(tmpDir + path.sep)) {
      return configuredDir;
    }

    return path.join(tmpDir, 'uploads');
  }

  if (process.env.UPLOAD_DIR) {
    return path.resolve(process.env.UPLOAD_DIR);
  }

  return path.join(__dirname, '..', 'uploads');
}

module.exports = { getUploadDir };
