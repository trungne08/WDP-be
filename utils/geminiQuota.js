/** Thông báo thân thiện khi Gemini trả 429 / hết quota — tránh UI đỏ lòm. */
const GEMINI_QUOTA_USER_MESSAGE =
  'Dạ AI đang nạp năng lượng (hết quota), sếp vui lòng thử lại sau 1 phút hoặc đổi API Key mới ạ!';

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isGeminiRateLimitError(err) {
  if (!err || typeof err !== 'object') return false;
  const e = /** @type {any} */ (err);
  const status =
    e.status ??
    e.statusCode ??
    e.response?.status ??
    e.error?.code ??
    e.code;
  if (status === 429) return true;
  const msg = String(e.message || e.error?.message || '').toLowerCase();
  if (
    msg.includes('429') ||
    msg.includes('resource exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return true;
  }
  return false;
}

module.exports = {
  GEMINI_QUOTA_USER_MESSAGE,
  isGeminiRateLimitError
};
