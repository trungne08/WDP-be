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

async function exchangeAtlassianCodeForTokens({ clientId, clientSecret, code, redirectUri }) {
  const res = await axios.post('https://auth.atlassian.com/oauth/token', {
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token || null
  };
}

async function refreshAtlassianAccessToken({ clientId, clientSecret, refreshToken }) {
  // Comment VN: Jira/Atlassian dùng refresh_token để xin access_token mới khi hết hạn.
  const res = await axios.post('https://auth.atlassian.com/oauth/token', {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  });
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token || refreshToken // đôi khi Atlassian trả refresh_token mới
  };
}

async function fetchAtlassianAccessibleResources(accessToken) {
  const res = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return res.data || [];
}

async function fetchJiraMyself({ accessToken, cloudId }) {
  const res = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  return {
    jiraAccountId: res.data.accountId,
    email: res.data.emailAddress || null
  };
}

async function fetchJiraProjects({ accessToken, cloudId }) {
  const res = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    params: { maxResults: 50 }
  });
  const values = res.data?.values || [];
  return values.map(p => ({
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

