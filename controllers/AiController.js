const axios = require('axios');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const JUNK_PATTERNS = [
  'package-lock.json',
  'yarn.lock',
  '.lock',
  '.min.js',
  '.min.css',
  'dist/',
  'build/',
  '.svg',
  '.png'
];

function isJunkFile(filename) {
  if (!filename || typeof filename !== 'string') return true;
  const lower = filename.toLowerCase();
  return JUNK_PATTERNS.some(p => lower.endsWith(p) || lower.includes(p));
}

/**
 * POST /api/ai/review-commit
 * Gọi AI Review Code từ Python microservice
 */
exports.reviewCommit = async (req, res) => {
  try {
    const { commitMessage, files } = req.body || {};

    if (!commitMessage || typeof commitMessage !== 'string') {
      return res.status(400).json({ error: 'commitMessage là bắt buộc.' });
    }

    if (!Array.isArray(files)) {
      return res.status(400).json({ error: 'files phải là mảng.' });
    }

    const filteredFiles = files.filter(
      f => f && typeof f === 'object' && f.filename && !isJunkFile(f.filename)
    );

    const codeDiffString = filteredFiles
      .map(f => (f.patch && typeof f.patch === 'string' ? f.patch : ''))
      .filter(Boolean)
      .join('\n\n---\n\n')
      .trim();

    if (!codeDiffString) {
      return res.status(400).json({
        error: 'Không tìm thấy code logic để review. (Chỉ có file ảnh/lock/dist/build)'
      });
    }

    const response = await axios.post(
      `${AI_SERVICE_URL}/api/ai/review-commit`,
      {
        commit_message: commitMessage.trim(),
        code_diff: codeDiffString
      },
      {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    return res.status(200).json(response.data || {});
  } catch (error) {
    if (error.response?.status === 400) {
      return res.status(400).json(error.response.data || { error: error.message });
    }
    console.error('[AiController] reviewCommit error:', error.message);
    return res.status(500).json({
      error: 'Server AI đang bận hoặc quá tải.'
    });
  }
};
