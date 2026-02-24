const axios = require('axios');
const JiraAuthService = require('./JiraAuthService');

/**
 * JiraSyncService - Sync dữ liệu từ Jira với Auto-Refresh Token
 * Tự động retry khi gặp lỗi 401 Unauthorized
 */

// =========================
// 1. AXIOS INSTANCE VỚI RETRY
// =========================

/**
 * Tạo Axios instance với interceptor auto-refresh
 * @param {Object} options
 * @param {string} options.accessToken - Access token hiện tại
 * @param {string} options.cloudId - Jira Cloud ID
 * @param {Function} options.onTokenRefresh - Callback khi refresh token thành công
 * @returns {AxiosInstance}
 */
function createJiraApiClient({ accessToken, cloudId, onTokenRefresh }) {
  const client = axios.create({
    baseURL: `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  // Response Interceptor: Auto-refresh on 401
  client.interceptors.response.use(
    (response) => response, // Success: trả về response bình thường
    async (error) => {
      const originalRequest = error.config;

      // Nếu lỗi 401 và chưa retry
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true; // Đánh dấu đã retry

        console.log('🔄 [Jira Sync] Token hết hạn (401). Đang refresh...');

        try {
          // Gọi callback để refresh token
          const newAccessToken = await onTokenRefresh();

          // Cập nhật token mới vào header
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          client.defaults.headers.Authorization = `Bearer ${newAccessToken}`;

          console.log('✅ [Jira Sync] Refresh thành công. Retry request...');

          // Retry request với token mới
          return client(originalRequest);
        } catch (refreshError) {
          console.error('❌ [Jira Sync] Refresh token thất bại:', refreshError.message);
          throw refreshError; // Throw lỗi để caller xử lý (yêu cầu login lại)
        }
      }

      // Các lỗi khác: throw ngay
      return Promise.reject(error);
    }
  );

  return client;
}

// =========================
// 2. JIRA API CALLS
// =========================

/**
 * Tìm kiếm Issues theo JQL
 * @param {Object} options
 * @param {AxiosInstance} options.client - Jira API client
 * @param {string} options.jql - JQL query
 * @param {number} options.startAt - Offset (pagination)
 * @param {number} options.maxResults - Số lượng kết quả tối đa
 * @param {Array<string>} options.fields - Danh sách fields cần lấy
 * @returns {Promise<{issues: Array, total: number}>}
 */
async function searchIssues({ client, jql, startAt = 0, maxResults = 100, fields = [] }) {
  try {
    const defaultFields = [
      'summary',
      'status',
      'assignee',
      'created',
      'updated',
      'issuetype',
      'customfield_10026' // Story Points (có thể thay đổi tùy Jira instance)
    ];

    const response = await client.post('/search', {
      jql,
      startAt,
      maxResults,
      fields: fields.length > 0 ? fields : defaultFields
    });

    return {
      issues: response.data.issues || [],
      total: response.data.total || 0
    };
  } catch (error) {
    console.error('❌ [Jira Sync] Lỗi search issues:', error.message);
    throw error;
  }
}

/**
 * Lấy tất cả Issues của một project (với pagination)
 * @param {Object} options
 * @param {AxiosInstance} options.client
 * @param {string} options.projectKey - Jira project key (VD: SCRUM)
 * @returns {Promise<Array>}
 */
async function fetchAllProjectIssues({ client, projectKey }) {
  const allIssues = [];
  let startAt = 0;
  const maxResults = 100;
  let hasMore = true;

  console.log(`📦 [Jira Sync] Fetching issues for project: ${projectKey}`);

  while (hasMore) {
    const { issues, total } = await searchIssues({
      client,
      jql: `project = "${projectKey}"`,
      startAt,
      maxResults
    });

    allIssues.push(...issues);

    hasMore = startAt + issues.length < total;
    startAt += issues.length;

    console.log(`   - Đã lấy ${allIssues.length}/${total} issues...`);
  }

  console.log(`✅ [Jira Sync] Hoàn tất: ${allIssues.length} issues`);

  return allIssues;
}

/**
 * Lấy danh sách Projects
 * @param {AxiosInstance} client
 * @returns {Promise<Array<{id: string, key: string, name: string}>>}
 */
async function fetchProjects(client) {
  try {
    const response = await client.get('/project/search', {
      params: { maxResults: 50 }
    });

    const projects = (response.data.values || []).map(p => ({
      id: p.id,
      key: p.key,
      name: p.name
    }));

    return projects;
  } catch (error) {
    console.error('❌ [Jira Sync] Lỗi fetch projects:', error.message);
    throw error;
  }
}

/**
 * Lấy danh sách Boards của một project
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {string} options.projectKey
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<Array>}
 */
async function fetchBoards({ accessToken, cloudId, projectKey, onTokenRefresh }) {
  try {
    // Dùng Agile API (khác với REST API v3)
    const client = axios.create({
      baseURL: `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      },
      timeout: 15000
    });

    // Add interceptor tương tự
    client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          const newAccessToken = await onTokenRefresh();
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          client.defaults.headers.Authorization = `Bearer ${newAccessToken}`;
          return client(originalRequest);
        }
        return Promise.reject(error);
      }
    );

    const response = await client.get('/board', {
      params: {
        projectKeyOrId: projectKey,
        maxResults: 50
      }
    });

    const boards = (response.data.values || []).map(board => ({
      id: board.id,
      name: board.name,
      type: board.type,
      location: board.location
    }));

    return boards;
  } catch (error) {
    console.error('❌ [Jira Sync] Lỗi fetch boards:', error.message);
    throw error;
  }
}

/**
 * Lấy thông tin User theo accountId
 * @param {AxiosInstance} client
 * @param {string} accountId
 * @returns {Promise<{accountId: string, displayName: string, emailAddress: string}>}
 */
async function fetchUser(client, accountId) {
  try {
    const response = await client.get('/user', {
      params: { accountId }
    });

    return {
      accountId: response.data.accountId,
      displayName: response.data.displayName,
      emailAddress: response.data.emailAddress || null
    };
  } catch (error) {
    console.error(`❌ [Jira Sync] Lỗi fetch user ${accountId}:`, error.message);
    return null;
  }
}

// =========================
// 3. WRAPPER: SYNC VỚI AUTO-REFRESH
// =========================

/**
 * Wrapper function để sync dữ liệu với auto-refresh token
 * @param {Object} options
 * @param {Object} options.user - User object từ DB (có integrations.jira)
 * @param {string} options.clientId - Atlassian Client ID
 * @param {string} options.clientSecret - Atlassian Client Secret
 * @param {Function} options.syncFunction - Function thực hiện sync (nhận client làm tham số)
 * @returns {Promise<any>} Kết quả từ syncFunction
 */
async function syncWithAutoRefresh({ user, clientId, clientSecret, syncFunction }) {
  const jira = user.integrations?.jira;

  console.log('🔄 [Jira Sync] syncWithAutoRefresh called');
  console.log('   - User:', user.email);
  console.log('   - Has jira integration?', !!jira);
  console.log('   - Has accessToken?', !!jira?.accessToken);
  console.log('   - CloudId:', jira?.cloudId);

  if (!jira?.accessToken || !jira?.cloudId) {
    console.error('❌ [Jira Sync] User chưa kết nối Jira!');
    const error = new Error('User chưa kết nối Jira');
    error.code = 'JIRA_NOT_CONNECTED';
    throw error;
  }

  let currentAccessToken = jira.accessToken;

  // Callback để refresh token khi cần
  const onTokenRefresh = async () => {
    console.log('🔄 [Jira Sync] onTokenRefresh called');
    console.log('   - Has refreshToken?', !!jira.refreshToken);
    console.log('   - RefreshToken type:', typeof jira.refreshToken);
    
    if (!jira.refreshToken) {
      console.error('❌ [Jira Sync] RefreshToken is NULL or UNDEFINED!');
      console.error('   - This means offline_access scope was NOT granted');
      console.error('   - User MUST reconnect Jira with offline_access scope');
      
      const error = new Error('Không có refresh_token. Vui lòng đăng nhập lại Jira.');
      error.code = 'REFRESH_TOKEN_MISSING';
      throw error;
    }

    console.log('🔄 [Jira Sync] Calling JiraAuthService.refreshAccessToken...');
    console.log('   - ClientId:', clientId ? '✅' : '❌');
    console.log('   - ClientSecret:', clientSecret ? '✅' : '❌');
    console.log('   - RefreshToken length:', jira.refreshToken.length);

    const { accessToken, refreshToken } = await JiraAuthService.refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: jira.refreshToken
    });

    console.log('✅ [Jira Sync] Got new tokens from Atlassian');
    console.log('   - New accessToken?', !!accessToken);
    console.log('   - New refreshToken?', !!refreshToken);

    // Cập nhật token mới vào DB
    user.integrations.jira.accessToken = accessToken;
    user.integrations.jira.refreshToken = refreshToken;
    await user.save();

    console.log('✅ [Jira Sync] Saved new tokens to DB');

    currentAccessToken = accessToken;
    return accessToken;
  };

  // Tạo Jira API client với auto-refresh
  const client = createJiraApiClient({
    accessToken: currentAccessToken,
    cloudId: jira.cloudId,
    onTokenRefresh
  });

  // Thực hiện sync function
  return await syncFunction(client);
}

// =========================
// 4. EXPORTS
// =========================

module.exports = {
  // Core
  createJiraApiClient,
  syncWithAutoRefresh,

  // API Calls
  searchIssues,
  fetchAllProjectIssues,
  fetchProjects,
  fetchBoards,
  fetchUser
};
