const axios = require('axios');
const jwt = require('jsonwebtoken');

/**
 * JiraAuthService - Xử lý toàn bộ Jira OAuth 2.0 flow
 * Hỗ trợ Granular Scopes và Mobile App
 */

// =========================
// 1. CONSTANTS & CONFIG
// =========================

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

/**
 * SCOPES - Jira Platform (Classic) + Jira Software (Agile)
 *
 * Jira Platform (CLASSIC SCOPES):
 * - offline_access: Để lấy refresh_token (BẮT BUỘC)
 * - read:jira-work: Đọc projects/issues/worklogs... (classic)
 * - write:jira-work: Tạo/sửa projects/issues... (classic)
 * - read:jira-user: Đọc thông tin users (classic)
 * - read:me: Đọc thông tin user hiện tại
 *
 * Jira Software API (AGILE - BẮT BUỘC cho /boards và /sprints):
 * - read:board-scope:jira-software: Đọc boards (Scrum/Kanban)
 * - read:sprint:jira-software: Đọc sprints
 * - write:sprint:jira-software: Thêm/xóa issue khỏi sprint (POST sprint/{id}/issue, backlog/issue)
 * - write:board-scope:jira-software: Tạo/sửa boards (optional)
 *
 * Strategy:
 * - Dùng CLASSIC SCOPES cho Jira Platform (/rest/api/3/project, /issue, /user...)
 * - Giữ GRANULAR SCOPES cho Jira Software (Agile API: /rest/agile/1.0/board...)
 */
const JIRA_SCOPES =
  'offline_access ' + // Refresh Token
  'read:jira-work write:jira-work read:jira-user read:me ' + // Classic scopes cho Project/Issue/User
  'read:board-scope:jira-software read:sprint:jira-software write:sprint:jira-software write:board-scope:jira-software read:project:jira'; // Agile scopes cho Board/Sprint

// =========================
// 2. HELPER FUNCTIONS
// =========================

/**
 * Lấy JWT Secret từ env
 */
function getJwtSecret() {
  return process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
}

/**
 * Tạo State JWT cho OAuth flow
 */
function signOAuthState(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '10m' });
}

/**
 * Verify State JWT từ callback
 */
function verifyOAuthState(state) {
  return jwt.verify(state, getJwtSecret());
}

/**
 * Xác định redirect_uri dựa vào platform
 * @param {string} platform - 'web' hoặc 'mobile'
 * @param {Object} req - Express request object
 * @returns {string} redirect_uri
 */
function getRedirectUri(platform, req) {
  if (platform === 'mobile') {
    // Mobile app deep link
    return 'syncapp://connections';
  } else {
    // Web callback URL
    return process.env.ATLASSIAN_CALLBACK_URL || 'http://localhost:5000/auth/atlassian/callback';
  }
}

/**
 * Build form-urlencoded body cho Atlassian token requests
 */
function buildTokenRequestBody(params) {
  return Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

// =========================
// 3. AUTHENTICATION FLOW
// =========================

/**
 * Bước 1: Tạo Authorization URL
 * @param {Object} options
 * @param {string} options.clientId - Atlassian Client ID
 * @param {string} options.platform - 'web' hoặc 'mobile'
 * @param {string} options.userId - User ID
 * @param {string} options.role - User role
 * @param {string} options.frontendRedirectUri - Frontend redirect URI sau khi thành công
 * @param {Object} options.req - Express request object
 * @returns {string} Authorization URL
 */
function buildAuthorizationUrl({ clientId, platform, userId, role, frontendRedirectUri, req }) {
  const redirectUri = getRedirectUri(platform, req);
  
  // Tạo state JWT chứa thông tin user và platform
  const state = signOAuthState({
    provider: 'jira',
    userId,
    role,
    platform,
    redirectUri, // LƯU redirect_uri vào state để dùng lại khi exchange token
    frontendRedirectUri
  });

  // Build Authorization URL với Granular Scopes
  const url = new URL(ATLASSIAN_AUTH_URL);
  url.searchParams.set('audience', 'api.atlassian.com');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', JIRA_SCOPES); // Dùng scopes mới
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent'); // Đảm bảo có refresh_token

  return url.toString();
}

/**
 * Bước 2: Exchange Authorization Code → Access Token + Refresh Token
 * @param {Object} options
 * @param {string} options.clientId - Atlassian Client ID
 * @param {string} options.clientSecret - Atlassian Client Secret
 * @param {string} options.code - Authorization code từ callback
 * @param {string} options.redirectUri - PHẢI GIỐNG redirect_uri dùng lúc tạo auth URL
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 */
async function exchangeCodeForTokens({ clientId, clientSecret, code, redirectUri }) {
  try {
    const body = buildTokenRequestBody({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri // QUAN TRỌNG: Phải đúng với lúc tạo auth URL
    });

    console.log('🔐 [Jira Auth] Exchanging code for tokens...');
    console.log('   - Redirect URI:', redirectUri);

    const response = await axios.post(ATLASSIAN_TOKEN_URL, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });

    const { access_token, refresh_token } = response.data;

    if (!access_token) {
      throw new Error('Không nhận được access_token từ Atlassian');
    }

    if (!refresh_token) {
      console.warn('⚠️ [Jira Auth] Không nhận được refresh_token. Kiểm tra scope "offline_access"!');
    }

    console.log('✅ [Jira Auth] Exchange token thành công!');

    return {
      accessToken: access_token,
      refreshToken: refresh_token || null
    };
  } catch (error) {
    console.error('❌ [Jira Auth] Lỗi exchange code:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error_description || 'Lỗi khi exchange authorization code');
  }
}

/**
 * Bước 3: Lấy Accessible Resources (CloudID)
 * @param {string} accessToken
 * @returns {Promise<Array<{id: string, url: string, name: string}>>}
 */
async function fetchAccessibleResources(accessToken) {
  try {
    console.log('🌐 [Jira Auth] Fetching accessible resources (CloudID)...');

    const response = await axios.get(ATLASSIAN_RESOURCES_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000
    });

    const resources = response.data || [];

    if (resources.length === 0) {
      throw new Error('Không tìm thấy Jira site nào. Vui lòng kiểm tra quyền truy cập.');
    }

    console.log(`✅ [Jira Auth] Tìm thấy ${resources.length} Jira site(s)`);

    return resources;
  } catch (error) {
    console.error('❌ [Jira Auth] Lỗi lấy accessible resources:', error.message);
    throw new Error('Không thể lấy danh sách Jira sites');
  }
}

/**
 * Bước 4: Lấy thông tin User hiện tại (Account Profile)
 * Sử dụng User Identity API với scope read:me
 * @param {string} accessToken
 * @param {string} cloudId
 * @returns {Promise<{accountId: string, email: string, displayName: string}>}
 */
async function fetchCurrentUser(accessToken, cloudId) {
  try {
    console.log('👤 [Jira Auth] Fetching current user info...');

    // QUAN TRỌNG: Dùng User Identity API endpoint (không phải Jira API)
    // Endpoint này yêu cầu scope: read:me
    const response = await axios.get(
      'https://api.atlassian.com/me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        },
        timeout: 10000
      }
    );

    const { account_id, email, name } = response.data;

    console.log(`✅ [Jira Auth] User: ${name} (${email})`);

    return {
      accountId: account_id,
      email: email || null,
      displayName: name || null
    };
  } catch (error) {
    console.error('❌ [Jira Auth] Lỗi lấy user info:', error.message);
    if (error.response) {
      console.error('   - Status:', error.response.status);
      console.error('   - Data:', JSON.stringify(error.response.data, null, 2));
    }
    throw new Error('Không thể lấy thông tin user. Vui lòng kiểm tra scope "read:me" trong Atlassian Console.');
  }
}

// =========================
// 4. TOKEN REFRESH (FIX LỖI 401)
// =========================

/**
 * Refresh Access Token khi hết hạn
 * @param {Object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} options.refreshToken
 * @returns {Promise<{accessToken: string, refreshToken: string, cloudId?: string}>}
 */
async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  console.log('🔄 [Jira Auth] refreshAccessToken called');
  console.log('   - Has refreshToken?', !!refreshToken);
  console.log('   - RefreshToken type:', typeof refreshToken);
  console.log('   - RefreshToken length:', refreshToken?.length || 0);
  
  if (!refreshToken || typeof refreshToken !== 'string') {
    console.error('❌ [Jira Auth] Invalid refreshToken!');
    console.error('   - Value:', refreshToken);
    console.error('   - Type:', typeof refreshToken);
    
    const error = new Error('refreshToken không hợp lệ hoặc thiếu');
    error.code = 'INVALID_REFRESH_TOKEN';
    throw error;
  }

  if (!clientId || !clientSecret) {
    console.error('❌ [Jira Auth] Missing Client ID or Secret!');
    console.error('   - ClientId:', clientId ? 'OK' : 'MISSING');
    console.error('   - ClientSecret:', clientSecret ? 'OK' : 'MISSING');
    
    const error = new Error('Thiếu ATLASSIAN_CLIENT_ID hoặc ATLASSIAN_CLIENT_SECRET');
    error.code = 'MISSING_CLIENT_CREDENTIALS';
    throw error;
  }

  try {
    console.log('🔄 [Jira Auth] Calling Atlassian token endpoint...');
    console.log('   - URL:', ATLASSIAN_TOKEN_URL);
    console.log('   - Grant type: refresh_token');

    const body = buildTokenRequestBody({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });

    console.log('   - Request body prepared (length:', body.length, 'chars)');

    const response = await axios.post(ATLASSIAN_TOKEN_URL, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });

    const { access_token, refresh_token } = response.data;

    console.log('✅ [Jira Auth] Refresh token thành công!');
    console.log('   - New accessToken received?', !!access_token);
    console.log('   - New refreshToken received?', !!refresh_token);
    
    // Sau khi có access_token mới, BẮT BUỘC lấy lại accessible-resources
    // để đảm bảo cloudId luôn khớp với token hiện tại.
    let newCloudId = null;
    try {
      console.log('🌐 [Jira Auth] Fetching accessible resources after refresh...');
      const resources = await fetchAccessibleResources(access_token);
      if (Array.isArray(resources) && resources.length > 0) {
        newCloudId = resources[0].id;
        console.log('✅ [Jira Auth] New Cloud ID from refreshed token:', newCloudId);
      } else {
        console.warn('⚠️ [Jira Auth] No accessible resources found after refresh. Keeping existing cloudId.');
      }
    } catch (e) {
      console.warn('⚠️ [Jira Auth] Could not refresh accessible-resources after token refresh:', e.message);
      console.warn('   → Sẽ giữ nguyên cloudId cũ trong DB.');
    }

    return {
      accessToken: access_token,
      refreshToken: refresh_token || refreshToken, // Giữ refresh_token cũ nếu không có mới
      cloudId: newCloudId || undefined
    };
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;

    console.error('❌ [Jira Auth] Lỗi refresh token:', {
      status,
      error: data?.error,
      description: data?.error_description,
      fullResponse: data
    });

    // Log chi tiết request để debug
    console.error('📋 [Jira Auth] Request details:');
    console.error('   - Endpoint:', ATLASSIAN_TOKEN_URL);
    console.error('   - Method: POST');
    console.error('   - Client ID:', clientId ? clientId.substring(0, 10) + '...' : 'MISSING');
    console.error('   - RefreshToken (first 20 chars):', refreshToken ? refreshToken.substring(0, 20) + '...' : 'MISSING');

    // Phân loại lỗi
    if (status === 400 || status === 401 || status === 404) {
      const err = new Error('Refresh token hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.');
      err.code = 'REFRESH_TOKEN_EXPIRED';
      err.status = status;
      err.atlassianError = data?.error;
      err.atlassianDescription = data?.error_description;
      throw err;
    }

    throw new Error(data?.error_description || 'Lỗi khi refresh token');
  }
}

// =========================
// 5. EXPORTS
// =========================

module.exports = {
  // Auth Flow
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  fetchAccessibleResources,
  fetchCurrentUser,

  // Token Management
  refreshAccessToken,

  // Helpers
  signOAuthState,
  verifyOAuthState,
  getRedirectUri,

  // Constants
  JIRA_SCOPES
};
