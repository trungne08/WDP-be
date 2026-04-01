/**
 * CORS + OAuth redirect + email base URL (Production Vercel + Local dev).
 * FRONTEND_URL: domain production (Vercel), không có dấu / cuối.
 */

const DEFAULT_PRODUCTION_FRONTEND = 'https://sync-system.vercel.app';

function stripTrailingSlash(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\/+$/, '');
}

/** Danh sách origin cho CORS / Socket.io — luôn gồm localhost + Vercel + env. */
function getAllowedCorsOrigins() {
  const fromEnv = [process.env.FRONTEND_URL, process.env.CLIENT_URL]
    .filter(Boolean)
    .map(stripTrailingSlash);
  const defaults = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    DEFAULT_PRODUCTION_FRONTEND
  ];
  return [...new Set([...defaults, ...fromEnv])];
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  return getAllowedCorsOrigins().includes(origin);
}

/** URL public backend (OAuth callback GitHub/Jira — không dùng CLIENT_URL). */
function getBackendBaseUrl(req) {
  const fromEnv = process.env.SERVER_URL || process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL;
  if (fromEnv) return stripTrailingSlash(fromEnv);
  if (req && typeof req.get === 'function' && req.protocol && req.get('host')) {
    return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
  }
  return '';
}

function normalizeToOrigin(url) {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Chỉ chấp nhận redirect về origin đã whitelist (localhost + Vercel + FRONTEND_URL/CLIENT_URL).
 * Chống open redirect.
 */
function isTrustedOAuthReturnBase(url) {
  if (!url || typeof url !== 'string') return false;
  const o = normalizeToOrigin(url);
  if (!o) return false;
  const allowed = getAllowedCorsOrigins();
  return allowed.includes(o);
}

/**
 * Khi FE gọi init OAuth: mặc định redirect sau login.
 * Ưu tiên env production, cuối cùng localhost (dev team).
 */
function getDefaultOAuthInitBase() {
  return stripTrailingSlash(
    process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000'
  );
}

/**
 * Email (Brevo): luôn dùng FRONTEND_URL — link thật gửi ra ngoài; không dùng localhost trừ khi set env.
 */
function getEmailFrontendUrl() {
  const raw = process.env.FRONTEND_URL;
  if (raw && String(raw).trim()) return stripTrailingSlash(raw);
  return DEFAULT_PRODUCTION_FRONTEND;
}

/**
 * Sau OAuth callback: giải mã state (JWT).
 * - Có redirect_uri / frontendRedirectUri hợp lệ (localhost hoặc Vercel trong whitelist) → dùng.
 * - Không có / không hợp lệ → FRONTEND_URL hoặc domain production mặc định.
 */
function resolveOAuthRedirectBaseUrl(decodedState) {
  if (!decodedState || typeof decodedState !== 'object') {
    return stripTrailingSlash(process.env.FRONTEND_URL || DEFAULT_PRODUCTION_FRONTEND);
  }
  const raw = String(
    decodedState.redirect_uri || decodedState.frontendRedirectUri || ''
  ).trim();
  if (raw && isTrustedOAuthReturnBase(raw)) {
    return stripTrailingSlash(raw);
  }
  return stripTrailingSlash(process.env.FRONTEND_URL || DEFAULT_PRODUCTION_FRONTEND);
}

/** Alias tương thích: base URL mặc định khi không có state OAuth. */
function getFrontendUrl() {
  return getDefaultOAuthInitBase();
}

module.exports = {
  stripTrailingSlash,
  getAllowedCorsOrigins,
  isOriginAllowed,
  getBackendBaseUrl,
  isTrustedOAuthReturnBase,
  getDefaultOAuthInitBase,
  getEmailFrontendUrl,
  resolveOAuthRedirectBaseUrl,
  getFrontendUrl,
  DEFAULT_PRODUCTION_FRONTEND
};
