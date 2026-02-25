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
  // Debug logging
  console.log('🔧 [Jira API Client] Creating client...');
  console.log('   - CloudId:', cloudId);
  console.log('   - CloudId type:', typeof cloudId);
  console.log('   - CloudId length:', cloudId?.length || 0);
  console.log('   - AccessToken present?', !!accessToken);
  console.log('   - AccessToken type:', typeof accessToken);
  console.log('   - AccessToken length:', accessToken?.length || 0);
  console.log('   - AccessToken prefix (first 20):', accessToken ? accessToken.substring(0, 20) + '...' : 'NULL');
  console.log('   - Base URL:', `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`);
  
  // Validate inputs
  if (!cloudId || typeof cloudId !== 'string' || cloudId.trim() === '') {
    console.error('❌ [Jira API Client] Invalid cloudId!');
    throw new Error('cloudId không hợp lệ. Vui lòng reconnect Jira.');
  }
  
  if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
    console.error('❌ [Jira API Client] Invalid accessToken!');
    throw new Error('accessToken không hợp lệ. Vui lòng reconnect Jira.');
  }
  
  const client = axios.create({
    baseURL: `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  // Request Interceptor: Log outgoing requests
  client.interceptors.request.use(
    (config) => {
      console.log('📤 [Jira API] Outgoing Request:');
      console.log('   - Method:', config.method?.toUpperCase());
      console.log('   - URL:', config.baseURL + config.url);
      console.log('   - Full URL:', `${config.baseURL}${config.url}`);
      console.log('   - Headers:', JSON.stringify(config.headers, null, 2));
      console.log('   - Has Authorization?', !!config.headers.Authorization);
      console.log('   - Auth header:', config.headers.Authorization ? config.headers.Authorization.substring(0, 30) + '...' : 'MISSING');
      return config;
    },
    (error) => {
      console.error('❌ [Jira API] Request error:', error.message);
      return Promise.reject(error);
    }
  );

  // Response Interceptor: Auto-refresh on 401
  client.interceptors.response.use(
    (response) => {
      console.log('📥 [Jira API] Response received:');
      console.log('   - Status:', response.status);
      console.log('   - URL:', response.config.url);
      return response;
    },
    async (error) => {
      const originalRequest = error.config;

      // Log error details
      console.error('❌ [Jira API] Response Error:');
      console.error('   - Status:', error.response?.status);
      console.error('   - URL:', originalRequest.url);
      console.error('   - Full URL:', originalRequest.baseURL + originalRequest.url);
      console.error('   - Response data:', JSON.stringify(error.response?.data, null, 2));

      // Nếu lỗi 401 và chưa retry
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        console.log('🔄 [Jira Sync] Token hết hạn (401). Đang refresh...');
        console.log('   - Original token (first 20):', originalRequest.headers.Authorization?.substring(0, 27) || 'MISSING');

        try {
          // Gọi callback để refresh token
          const newAccessToken = await onTokenRefresh();

          console.log('✅ [Jira Sync] Got new token (first 20):', newAccessToken ? newAccessToken.substring(0, 20) + '...' : 'NULL');

          // Cập nhật token mới vào header
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          client.defaults.headers.Authorization = `Bearer ${newAccessToken}`;

          console.log('✅ [Jira Sync] Refresh thành công. Retry request...');

          // Retry request với token mới
          return client(originalRequest);
        } catch (refreshError) {
          console.error('❌ [Jira Sync] Refresh token thất bại:', refreshError.message);
          throw refreshError;
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

    // NOTE: Jira đã deprecate /rest/api/3/search và yêu cầu dùng /search/jql
    const response = await client.post('/search/jql', {
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
    // NOTE:
    // - Trước đây dùng /project/search (trả về { values: [...] }) nhưng endpoint này
    //   yêu cầu thêm nhiều granular scopes và dễ bị 401/\"scope does not match\".
    // - Đổi sang /project (trả về trực tiếp một mảng Project) → ít khắt khe hơn.
    const response = await client.get('/project');

    const list = Array.isArray(response.data) ? response.data : [];

    const projects = list.map(p => ({
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
// 4. JIRA AGILE API (SPRINTS & BOARDS) - OAuth Version
// =========================

/**
 * Tạo Agile API client (khác với REST API v3)
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {Function} options.onTokenRefresh
 * @returns {AxiosInstance}
 */
function createJiraAgileClient({ accessToken, cloudId, onTokenRefresh }) {
  const client = axios.create({
    baseURL: `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 30000
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

  return client;
}

/**
 * Lấy danh sách Sprints của Board
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {number} options.boardId
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<Array>}
 */
async function fetchSprints({ accessToken, cloudId, boardId, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
    
    const response = await client.get(`/board/${boardId}/sprint`, {
      params: { state: 'active,future' }
    });

    return response.data.values || [];
  } catch (error) {
    console.error('❌ [Jira Agile] Lỗi fetch sprints:', error.message);
    throw error;
  }
}

/**
 * Tạo Sprint mới
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {number} options.boardId
 * @param {string} options.name
 * @param {string} options.startDate - ISO format
 * @param {string} options.endDate - ISO format
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<Object>}
 */
async function createSprint({ accessToken, cloudId, boardId, name, startDate, endDate, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
    
    const payload = {
      name,
      originBoardId: boardId,
      startDate,
      endDate
    };

    const response = await client.post('/sprint', payload);
    return response.data;
  } catch (error) {
    console.error('❌ [Jira Agile] Lỗi create sprint:', error.message);
    throw error;
  }
}

/**
 * Start Sprint
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {number} options.sprintId
 * @param {string} options.startDate
 * @param {string} options.endDate
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<Object>}
 */
async function startSprint({ accessToken, cloudId, sprintId, startDate, endDate, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
    
    const payload = {
      state: 'active',
      startDate,
      endDate
    };

    const response = await client.post(`/sprint/${sprintId}`, payload);
    return response.data;
  } catch (error) {
    console.error('❌ [Jira Agile] Lỗi start sprint:', error.message);
    throw error;
  }
}

/**
 * Update Sprint
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {number} options.sprintId
 * @param {Object} options.data - {name, state, startDate, endDate}
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<Object>}
 */
async function updateSprint({ accessToken, cloudId, sprintId, data, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
    
    const response = await client.put(`/sprint/${sprintId}`, data);
    return response.data;
  } catch (error) {
    console.error('❌ [Jira Agile] Lỗi update sprint:', error.message);
    throw error;
  }
}

/**
 * Lấy tất cả Issues của Board (Sprint + Backlog)
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {number} options.boardId
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<Array>}
 */
async function fetchAllBoardIssues({ accessToken, cloudId, boardId, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
    
    let allIssues = [];
    let startAt = 0;
    let isLast = false;

    while (!isLast) {
      const response = await client.get(`/board/${boardId}/issue`, {
        params: {
          startAt,
          maxResults: 50,
          fields: 'summary,status,assignee,description,duedate,reporter,customfield_10026,customfield_10020'
        }
      });

      const issues = response.data.issues || [];
      
      // Map issues với sprint info
      const mappedIssues = issues.map(issue => {
        let currentSprintId = null;
        const sprintsData = issue.fields.customfield_10020; // Sprint field

        if (sprintsData && Array.isArray(sprintsData) && sprintsData.length > 0) {
          const lastSprint = sprintsData[sprintsData.length - 1];
          
          if (lastSprint && lastSprint.id) {
            currentSprintId = lastSprint.id;
          } else if (typeof lastSprint === 'string') {
            const match = lastSprint.match(/id=(\d+)/);
            if (match) currentSprintId = Number(match[1]);
          }
        }

        return {
          issue_key: issue.key,
          issue_id: issue.id,
          summary: issue.fields.summary,
          description: issue.fields.description || '',
          status_name: issue.fields.status.name,
          status_category: issue.fields.status.statusCategory.name,
          assignee_account_id: issue.fields.assignee ? issue.fields.assignee.accountId : null,
          reporter_account_id: issue.fields.reporter ? issue.fields.reporter.accountId : null,
          due_date: issue.fields.duedate,
          story_point: issue.fields.customfield_10026 || 0,
          jira_sprint_id: currentSprintId
        };
      });

      allIssues.push(...mappedIssues);

      if (issues.length < 50) isLast = true;
      else startAt += 50;
    }

    console.log(`📦 [Jira Agile] Fetched ${allIssues.length} issues from board ${boardId}`);
    return allIssues;

  } catch (error) {
    console.error('❌ [Jira Agile] Lỗi fetch board issues:', error.message);
    throw error;
  }
}

/**
 * Thêm Issue vào Sprint
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {number} options.sprintId
 * @param {string} options.issueKey - Jira issue key (VD: SCRUM-123)
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<boolean>}
 */
async function addIssueToSprint({ accessToken, cloudId, sprintId, issueKey, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
    
    await client.post(`/sprint/${sprintId}/issue`, {
      issues: [issueKey]
    });

    return true;
  } catch (error) {
    console.error('❌ [Jira Agile] Lỗi add issue to sprint:', error.message);
    return false;
  }
}

/**
 * Move Issue về Backlog
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {string} options.issueKey
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<boolean>}
 */
async function moveIssueToBacklog({ accessToken, cloudId, issueKey, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
    
    await client.post('/backlog/issue', {
      issues: [issueKey]
    });

    return true;
  } catch (error) {
    console.error('❌ [Jira Agile] Lỗi move issue to backlog:', error.message);
    return false;
  }
}

// =========================
// 5. JIRA ISSUE OPERATIONS (REST API v3) - OAuth Version
// =========================

/**
 * Helper: Convert text to ADF format
 */
function textToADF(text) {
  if (!text) return null;
  return {
    type: 'doc',
    version: 1,
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text }]
    }]
  };
}

/**
 * Tạo Issue mới
 * @param {Object} options
 * @param {AxiosInstance} options.client - REST API client (v3)
 * @param {string} options.projectKey
 * @param {Object} options.data - Issue data
 * @returns {Promise<Object>}
 */
async function createIssue({ client, projectKey, data }) {
  try {
    const payload = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: 'Task' },
        summary: data.summary,
        description: textToADF(data.description || ''),
        
        ...(data.assigneeAccountId && { assignee: { accountId: data.assigneeAccountId } }),
        ...(data.reporterAccountId && { reporter: { accountId: data.reporterAccountId } }),
        ...(data.duedate && { duedate: data.duedate }),
        
        // Custom fields
        ...(data.storyPoint && data.storyPointFieldId && { 
          [data.storyPointFieldId]: Number(data.storyPoint) 
        }),
        ...(data.startDate && data.startDateFieldId && { 
          [data.startDateFieldId]: data.startDate 
        })
      }
    };

    const response = await client.post('/issue', payload);
    return response.data;
  } catch (error) {
    console.error('❌ [Jira API] Lỗi create issue:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Update Issue
 * @param {Object} options
 * @param {AxiosInstance} options.client
 * @param {string} options.issueKey
 * @param {Object} options.data
 * @returns {Promise<boolean>}
 */
async function updateIssue({ client, issueKey, data }) {
  try {
    const fields = {};

    if (data.summary) fields.summary = data.summary;
    if (data.description) fields.description = textToADF(data.description);
    if (data.assigneeAccountId) fields.assignee = { accountId: data.assigneeAccountId };
    if (data.reporterAccountId) fields.reporter = { accountId: data.reporterAccountId };
    if (data.duedate) fields.duedate = data.duedate;

    if (data.storyPoint !== undefined && data.storyPointFieldId) {
      fields[data.storyPointFieldId] = Number(data.storyPoint);
    }
    if (data.startDate && data.startDateFieldId) {
      fields[data.startDateFieldId] = data.startDate;
    }

    if (Object.keys(fields).length === 0) return true;

    await client.put(`/issue/${issueKey}`, { fields });
    return true;
  } catch (error) {
    console.error('❌ [Jira API] Lỗi update issue:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Delete Issue
 * @param {Object} options
 * @param {AxiosInstance} options.client
 * @param {string} options.issueKey
 * @returns {Promise<boolean>}
 */
async function deleteIssue({ client, issueKey }) {
  try {
    await client.delete(`/issue/${issueKey}`);
    return true;
  } catch (error) {
    console.error('❌ [Jira API] Lỗi delete issue:', error.message);
    throw error;
  }
}

/**
 * Transition Issue (change status)
 * @param {Object} options
 * @param {AxiosInstance} options.client
 * @param {string} options.issueKey
 * @param {string} options.targetStatusName
 * @returns {Promise<boolean>}
 */
async function transitionIssue({ client, issueKey, targetStatusName }) {
  try {
    const transitionsRes = await client.get(`/issue/${issueKey}/transitions`);
    
    const transition = transitionsRes.data.transitions.find(
      t => t.name.toLowerCase() === targetStatusName.toLowerCase()
    );

    if (!transition) return false;

    await client.post(`/issue/${issueKey}/transitions`, {
      transition: { id: transition.id }
    });

    return true;
  } catch (error) {
    console.error('❌ [Jira API] Lỗi transition issue:', error.message);
    return false;
  }
}

/**
 * Lấy Custom Field ID theo tên
 * @param {AxiosInstance} client
 * @param {string} fieldName
 * @returns {Promise<string|null>}
 */
async function getCustomFieldId(client, fieldName) {
  try {
    const response = await client.get('/field');
    const field = response.data.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
    return field ? field.id : null;
  } catch (error) {
    console.error(`❌ [Jira API] Lỗi get custom field "${fieldName}":`, error.message);
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

    const { accessToken, refreshToken, cloudId: newCloudId } = await JiraAuthService.refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: jira.refreshToken
    });

    console.log('✅ [Jira Sync] Got new tokens from Atlassian');
    console.log('   - New accessToken?', !!accessToken);
    console.log('   - New refreshToken?', !!refreshToken);
    console.log('   - New cloudId?', !!newCloudId);

    // Cập nhật token mới (và cloudId nếu có) vào DB
    user.integrations.jira.accessToken = accessToken;
    user.integrations.jira.refreshToken = refreshToken;
    if (newCloudId) {
      console.log('🔄 [Jira Sync] Updating cloudId in DB to:', newCloudId);
      user.integrations.jira.cloudId = newCloudId;
    }
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
// 6. EXPORTS
// =========================

module.exports = {
  // Core
  createJiraApiClient,
  createJiraAgileClient,
  syncWithAutoRefresh,

  // Search & Fetch (REST API)
  searchIssues,
  fetchAllProjectIssues,
  fetchProjects,
  fetchBoards,
  fetchUser,

  // Agile API (Sprints & Boards)
  fetchSprints,
  createSprint,
  startSprint,
  updateSprint,
  fetchAllBoardIssues,
  addIssueToSprint,
  moveIssueToBacklog,

  // Issue Operations (REST API v3)
  createIssue,
  updateIssue,
  deleteIssue,
  transitionIssue,
  getCustomFieldId
};
