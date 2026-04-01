/**
 * CORS + OAuth redirect + email base URL (Production Vercel + Local dev).
 * FRONTEND_URL: domain production (Vercel), không có dấu / cuối.
 */

const DEFAULT_PRODUCTION_FRONTEND = 'https://sync-system.vercel.app';

function stripTrailingSlash(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\/+$/, '');
}

function normalizeToOrigin(url) {
  try {
    const u = new URL(String(url).trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** CORS_EXTRA_ORIGINS: danh sách thêm (phân tách bằng dấu phẩy), ví dụ preview Vercel khác domain production. */
function parseExtraOrigins() {
  const raw = process.env.CORS_EXTRA_ORIGINS;
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => stripTrailingSlash(s.trim()))
    .filter(Boolean);
}

/** OAUTH_EXTRA_REDIRECT_ORIGINS: thêm origin được phép làm redirect_uri (GitHub/Jira), tách với CORS nếu cần. */
function parseOAuthExtraOrigins() {
  const raw = process.env.OAUTH_EXTRA_REDIRECT_ORIGINS;
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => {
      const t = stripTrailingSlash(s.trim());
      if (!t) return null;
      const o = normalizeToOrigin(t);
      return o || t;
    })
    .filter(Boolean);
}

/** Localhost / 127.0.0.1 cổng thường dùng (Vite, CRA, Next, preview) — web + dev cùng backend. */
function getDefaultLocalDevOrigins() {
  const ports = [3000, 3001, 4173, 5173, 5174, 8080, 8888];
  const hosts = ['localhost', '127.0.0.1'];
  const out = [];
  for (const h of hosts) {
    for (const p of ports) {
      out.push(`http://${h}:${p}`);
    }
  }
  return out;
}

/**
 * Origin của chính server API (Render, v.v.).
 * Sau OAuth hoặc một số flow, trình duyệt có thể gửi Socket.io / fetch với Origin = backend — phải whitelist để không bị CORS chặn.
 */
const DEFAULT_BACKEND_ORIGIN_FOR_CORS = 'https://wdp-be-ama3.onrender.com';

function getBackendSelfOrigins() {
  const candidates = [
    DEFAULT_BACKEND_ORIGIN_FOR_CORS,
    process.env.SERVER_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.BACKEND_URL
  ].filter(Boolean);
  const origins = [];
  for (const raw of candidates) {
    try {
      const u = new URL(stripTrailingSlash(String(raw).trim()));
      origins.push(`${u.protocol}//${u.host}`);
    } catch {
      /* bỏ qua chuỗi không phải URL hợp lệ */
    }
  }
  return [...new Set(origins)];
}

/** Danh sách origin cho CORS / Socket.io — nhiều cổng local + Vercel + env + origin của chính backend + extra. */
function getAllowedCorsOrigins() {
  const fromEnv = [process.env.FRONTEND_URL, process.env.CLIENT_URL]
    .filter(Boolean)
    .map(stripTrailingSlash);
  const defaults = [...getDefaultLocalDevOrigins(), DEFAULT_PRODUCTION_FRONTEND];
  return [
    ...new Set([
      ...defaults,
      ...fromEnv,
      ...parseExtraOrigins(),
      ...parseOAuthExtraOrigins(),
      ...getBackendSelfOrigins()
    ])
  ];
}

/**
 * Origin hợp lệ cho redirect sau OAuth (GitHub/Jira).
 * Không gồm domain chỉ là API — tránh redirect user về `https://wdp-be-...` (không có SPA) khi nhầm redirect_uri.
 */
function getOAuthTrustedOrigins() {
  const backendSet = new Set(getBackendSelfOrigins());
  return getAllowedCorsOrigins().filter((o) => !backendSet.has(o));
}

/**
 * Cho phép mọi origin https://*.vercel.app khi CORS_ALLOW_VERCEL_PREVIEW=true (preview deploy khác tên app).
 * Chỉ bật khi cần; production chỉ cần FRONTEND_URL + CORS_EXTRA_ORIGINS.
 */
function isVercelAppPreviewOrigin(origin) {
  if (process.env.CORS_ALLOW_VERCEL_PREVIEW !== 'true') return false;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (getAllowedCorsOrigins().includes(origin)) return true;
  return isVercelAppPreviewOrigin(origin);
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

/**
 * Chỉ chấp nhận redirect về origin mà CORS/Socket cũng chấp nhận, NGOẠI TRỪ domain thuần API
 * (ví dụ Render) — tránh redirect SPA về host không có UI.
 */
function isTrustedOAuthReturnBase(url) {
  if (!url || typeof url !== 'string') return false;
  const o = normalizeToOrigin(url);
  if (!o) return false;
  const backendSet = new Set(getBackendSelfOrigins());
  if (backendSet.has(o)) return false;
  return isOriginAllowed(o);
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
  normalizeToOrigin,
  getAllowedCorsOrigins,
  getOAuthTrustedOrigins,
  getBackendSelfOrigins,
  isOriginAllowed,
  getBackendBaseUrl,
  isTrustedOAuthReturnBase,
  getDefaultOAuthInitBase,
  getEmailFrontendUrl,
  resolveOAuthRedirectBaseUrl,
  getFrontendUrl,
  DEFAULT_PRODUCTION_FRONTEND
};
