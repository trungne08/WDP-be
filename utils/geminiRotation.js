const { GoogleGenerativeAI } = require('@google/generative-ai');
const { isGeminiRateLimitError } = require('./geminiQuota');

/** Chỉ số round-robin cho lần gọi AI tiếp theo (mỗi `withGemini429Retry` tiêu thụ 1 bước). */
let roundRobinIndex = 0;

/**
 * GEMINI_API_KEY có thể là một key hoặc nhiều key ngăn cách bằng dấu phẩy (Render).
 * @returns {string[]}
 */
function getGeminiApiKeys() {
  const raw = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
  if (!String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasGeminiApiKeys() {
  return getGeminiApiKeys().length > 0;
}

/**
 * Mỗi lần gọi: chọn key theo vòng (round-robin). Nếu 429, thử key kế tiếp trong mảng ngay lập tức.
 * @template T
 * @param {(genAI: import('@google/generative-ai').GoogleGenerativeAI) => Promise<T>} execute
 * @returns {Promise<T>}
 */
async function withGemini429Retry(execute) {
  const keys = getGeminiApiKeys();
  if (!keys.length) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY (hoặc GOOGLE_AI_API_KEY) trên server.');
  }

  const n = keys.length;
  const startIdx = roundRobinIndex % n;
  roundRobinIndex += 1;

  let lastErr;
  for (let o = 0; o < n; o += 1) {
    const idx = (startIdx + o) % n;
    const genAI = new GoogleGenerativeAI(keys[idx]);
    try {
      return await execute(genAI);
    } catch (err) {
      lastErr = err;
      if (isGeminiRateLimitError(err) && o < n - 1) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = {
  getGeminiApiKeys,
  hasGeminiApiKeys,
  withGemini429Retry
};
