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
  const ports = [3000, 3001, 4173, 5173, 5174, 8080, 8081, 8888];
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
 * Android Emulator: WebView / RN Metro trỏ về máy dev qua 10.0.2.2 (tương đương localhost trên host).
 */
function getAndroidEmulatorDevOrigins() {
  const ports = [3000, 3001, 4173, 5173, 5174, 8080, 8081, 8888];
  const out = [];
  for (const p of ports) {
    out.push(`http://10.0.2.2:${p}`);
  }
  return out;
}

/** Capacitor / Ionic WebView — origin hay gặp khi bọc SPA trong app Android Studio. */
function getCapacitorStyleOrigins() {
  return ['capacitor://localhost', 'ionic://localhost'];
}

/**
 * Mạng LAN (máy thật gọi BE trên PC) — chỉ bật khi CORS_ALLOW_PRIVATE_NETWORK_DEV=true (dev).
 */
function isPrivateLanDevHttpOrigin(origin) {
  if (process.env.CORS_ALLOW_PRIVATE_NETWORK_DEV !== 'true') return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    return false;
  } catch {
    return false;
  }
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
    .map((x) => {
      const t = stripTrailingSlash(String(x).trim());
      return normalizeToOrigin(t) || t;
    })
    .filter(Boolean);
  const defaults = [
    ...getDefaultLocalDevOrigins(),
    ...getAndroidEmulatorDevOrigins(),
    ...getCapacitorStyleOrigins(),
    DEFAULT_PRODUCTION_FRONTEND
  ];
  return [
    ...new Set([
      ...defaults,
      ...fromEnv,
      ...parseExtraOrigins().map((x) => normalizeToOrigin(x) || x),
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
 * HTTPS + hostname *.vercel.app (preview / production trên domain Vercel).
 */
function isHttpsVercelAppHostname(origin) {
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (h.endsWith('.vercel.app') || h === 'vercel.app');
  } catch {
    return false;
  }
}

/**
 * Cho phép mọi origin https://*.vercel.app khi CORS_ALLOW_VERCEL_PREVIEW=true (tương thích cũ).
 */
function isVercelAppPreviewOrigin(origin) {
  if (process.env.CORS_ALLOW_VERCEL_PREVIEW !== 'true') return false;
  return isHttpsVercelAppHostname(origin);
}

/**
 * Mọi deploy `https://*.vercel.app` — mặc định BẬT (FE preview hay khác `sync-system.vercel.app`).
 * Tắt: CORS_ALLOW_ALL_VERCEL_APP=false trên server.
 */
function isPublicVercelAppOriginForCors(origin) {
  if (process.env.CORS_ALLOW_ALL_VERCEL_APP === 'false') return false;
  return isHttpsVercelAppHostname(origin);
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (getAllowedCorsOrigins().includes(origin)) return true;
  if (isVercelAppPreviewOrigin(origin)) return true;
  if (isPublicVercelAppOriginForCors(origin)) return true;
  return isPrivateLanDevHttpOrigin(origin);
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
 * Origin được phép làm redirect_uri sau OAuth (chống open redirect về domain lạ).
 * Không gọi trực tiếp isOriginAllowed (vì CORS có thể mở rộng *.vercel.app).
 */
function isTrustedOAuthReturnBase(url) {
  if (!url || typeof url !== 'string') return false;
  const t = url.trim();
  // Deep link app (Jira/GitHub mobile callback trong IntegrationController)
  if (/^syncapp:\/\//i.test(t)) return true;
  const o = normalizeToOrigin(url);
  if (!o) return false;
  const backendSet = new Set(getBackendSelfOrigins());
  if (backendSet.has(o)) return false;
  if (getOAuthTrustedOrigins().includes(o)) return true;
  if (isPublicVercelAppOriginForCors(o)) return true;
  if (isPrivateLanDevHttpOrigin(o)) return true;
  return false;
}

function isLocalhostUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const s = url.trim();
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** URL FE production ưu tiên từ env; không fallback localhost. */
function getProductionOAuthFrontendBase() {
  return stripTrailingSlash(
    process.env.FRONTEND_URL || process.env.CLIENT_URL || DEFAULT_PRODUCTION_FRONTEND
  );
}

/**
 * Trên server production (Render): không redirect user về localhost khi họ dùng web deploy
 * (FE hay gửi nhầm redirect_uri=http://localhost:3000 từ biến dev).
 */
function coerceOAuthRedirectForProduction(baseUrl) {
  const strip = stripTrailingSlash(String(baseUrl || '').trim());
  if (!strip) return strip;
  if (!isLocalhostUrl(strip)) return strip;
  const onProd = process.env.NODE_ENV === 'production';
  if (!onProd) return strip;
  const replacement = getProductionOAuthFrontendBase();
  if (replacement && !isLocalhostUrl(replacement)) {
    console.warn(
      `⚠️ OAuth: Bỏ redirect về localhost trên production; chuyển về FE: ${replacement}`
    );
    return replacement;
  }
  return strip;
}

/**
 * Khi FE gọi init OAuth: mặc định redirect sau login.
 * Production: không mặc định localhost (tránh web Vercel bị callback về máy local).
 */
function getDefaultOAuthInitBase() {
  const devFallback = 'http://localhost:3000';
  if (process.env.NODE_ENV === 'production') {
    return getProductionOAuthFrontendBase();
  }
  return stripTrailingSlash(
    process.env.FRONTEND_URL || process.env.CLIENT_URL || devFallback
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
  let resolved;
  if (!decodedState || typeof decodedState !== 'object') {
    resolved = stripTrailingSlash(process.env.FRONTEND_URL || DEFAULT_PRODUCTION_FRONTEND);
  } else {
    const raw = String(
      decodedState.redirect_uri || decodedState.frontendRedirectUri || ''
    ).trim();
    if (raw && isTrustedOAuthReturnBase(raw)) {
      resolved = stripTrailingSlash(raw);
    } else {
      resolved = stripTrailingSlash(process.env.FRONTEND_URL || DEFAULT_PRODUCTION_FRONTEND);
    }
  }
  return coerceOAuthRedirectForProduction(resolved);
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
  coerceOAuthRedirectForProduction,
  getDefaultOAuthInitBase,
  getEmailFrontendUrl,
  resolveOAuthRedirectBaseUrl,
  getFrontendUrl,
  DEFAULT_PRODUCTION_FRONTEND
};
