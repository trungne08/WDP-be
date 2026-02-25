const axios = require('axios');
const jwt = require('jsonwebtoken');

function getJwtSecret() {
  return process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
}

// =========================
// 1) STATE JWT (stateless)
// =========================
function signOAuthState(payload) {
  // State chỉ sống ngắn để chống CSRF
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '10m' });
}

function verifyOAuthState(state) {
  return jwt.verify(state, getJwtSecret());
}

// =========================
// 2) GITHUB OAUTH
// =========================
function buildGithubAuthUrl({ clientId, redirectUri, scope, state }) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeGithubCodeForToken({ clientId, clientSecret, code, redirectUri }) {
  // GitHub trả về form/urlencoded; dùng header accept json để nhận JSON
  const res = await axios.post(
    'https://github.com/login/oauth/access_token',
    {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    },
    { headers: { Accept: 'application/json' } }
  );

  if (res.data?.error) {
    throw new Error(res.data.error_description || res.data.error);
  }
  return res.data.access_token;
}

async function fetchGithubUser(accessToken) {
  const res = await axios.get('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });
  return {
    githubId: String(res.data.id),
    username: res.data.login
  };
}

async function fetchGithubRepos(accessToken) {
  const res = await axios.get('https://api.github.com/user/repos', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json'
    },
    params: { per_page: 100, sort: 'updated' }
  });
  return (res.data || []).map(r => ({
    id: r.id,
    name: r.full_name,
    url: r.html_url
  }));
}

// =========================
// 3) ATLASSIAN (JIRA) OAUTH
// =========================
function buildAtlassianAuthUrl({ clientId, redirectUri, scope, state }) {
  const url = new URL('https://auth.atlassian.com/authorize');
  url.searchParams.set('audience', 'api.atlassian.com');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', scope);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent'); // để chắc chắn có refresh_token khi offline_access
  return url.toString();
}

// Atlassian token endpoint (RFC 6749: token request dùng application/x-www-form-urlencoded)
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };

function atlassianTokenBody(params) {
  return Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function exchangeAtlassianCodeForTokens({ clientId, clientSecret, code, redirectUri }) {
  const body = atlassianTokenBody({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });
  const res = await axios.post(ATLASSIAN_TOKEN_URL, body, {
    headers: FORM_HEADERS,
    timeout: 15000
  });
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token || null
  };
}

async function refreshAtlassianAccessToken({ clientId, clientSecret, refreshToken }) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    const err = new Error('refreshToken không hợp lệ hoặc thiếu');
    err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }
  try {
    const body = atlassianTokenBody({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });
    const res = await axios.post(ATLASSIAN_TOKEN_URL, body, {
      headers: FORM_HEADERS,
      timeout: 15000
    });
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token || refreshToken
    };
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    const msg = data?.error_description || data?.error || err.message;
    const e = new Error(msg || `Atlassian refresh token failed (${status || 'network'})`);
    e.status = status;
    e.responseData = data;
    throw e;
  }
}

async function fetchAtlassianAccessibleResources(accessToken) {
  const res = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return res.data || [];
}

async function fetchJiraMyself({ accessToken, cloudId }) {
  // UPDATED: Dùng User Identity API endpoint (scope: read:me)
  // Thay vì Jira API endpoint cũ
  const res = await axios.get('https://api.atlassian.com/me', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  return {
    jiraAccountId: res.data.account_id,
    email: res.data.email || null
  };
}

async function fetchJiraProjects({ accessToken, cloudId }) {
  // NOTE: Kept for backward-compatibility / future use.
  // Prefer using JiraSyncService.fetchProjects where possible.
  const res = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const list = Array.isArray(res.data) ? res.data : [];
  return list.map(p => ({
    id: p.id,
    key: p.key,
    name: p.name
  }));
}

async function fetchJiraProjectInfo({ accessToken, cloudId, projectKey }) {
  const res = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${projectKey}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  return res.data;
}

/**
 * Lấy danh sách boards của một Jira project
 * @param {string} accessToken - OAuth access token
 * @param {string} cloudId - Jira cloud ID
 * @param {string} projectKey - Project key (e.g., "SCRUM")
 * @returns {Promise<Array>} - Danh sách boards
 */
async function fetchJiraBoards({ accessToken, cloudId, projectKey }) {
  try {
    // Lấy tất cả boards
    const res = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/board`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      params: {
        projectKeyOrId: projectKey,
        maxResults: 50
      }
    });
    
    const boards = (res.data?.values || []).map(board => ({
      id: board.id,
      name: board.name,
      type: board.type, // scrum, kanban
      location: board.location // project info
    }));
    
    return boards;
  } catch (error) {
    console.error('❌ [IntegrationService] Lỗi lấy Jira boards:', error.message);
    throw error;
  }
}

module.exports = {
  signOAuthState,
  verifyOAuthState,
  buildGithubAuthUrl,
  exchangeGithubCodeForToken,
  fetchGithubUser,
  fetchGithubRepos,
  buildAtlassianAuthUrl,
  exchangeAtlassianCodeForTokens,
  refreshAtlassianAccessToken,
  fetchAtlassianAccessibleResources,
  fetchJiraMyself,
  fetchJiraProjects,
  fetchJiraProjectInfo,
  fetchJiraBoards
};

