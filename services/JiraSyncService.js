const axios = require('axios');
const JiraAuthService = require('./JiraAuthService');

/**
 * JiraSyncService - Sync dữ liệu từ Jira với Auto-Refresh Token
 * Tự động retry khi gặp lỗi 401 Unauthorized
 *
 * QUAN TRỌNG: Phân tách 2 Base URL
 * - Platform API (.../rest/api/3): Issues, search/jql
 * - Agile API (.../rest/agile/1.0): Board, Sprint
 */

// =========================
// 1. PLATFORM API CLIENT (Issues)
// Base URL: https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3
// Dùng cho: /search/jql, /issue, /project, ...
// =========================

/**
 * Tạo Axios instance cho Platform API (REST API v2 hoặc v3)
 * Có cơ chế tự động Refresh Token khi 401 — giống hệt luồng Sync.
 * @param {Object} options
 * @param {string} options.accessToken - Access token hiện tại
 * @param {string} options.cloudId - Jira Cloud ID
 * @param {Function} options.onTokenRefresh - Callback khi refresh token thành công (PHẢI lưu token mới vào DB)
 * @param {number} [options.apiVersion=3] - API version (2: plain text description, 3: ADF)
 * @returns {AxiosInstance}
 */
function createJiraApiClient({ accessToken, cloudId, onTokenRefresh, apiVersion = 3 }) {
  const basePath = `/rest/api/${apiVersion}`;

  // Debug logging
  console.log(`🔧 [Jira API Client v${apiVersion}] Creating client...`);
  console.log('   - CloudId:', cloudId);
  console.log('   - AccessToken present?', !!accessToken);
  console.log('   - Base URL:', `https://api.atlassian.com/ex/jira/${cloudId}${basePath}`);

  // Validate inputs
  if (!cloudId || typeof cloudId !== 'string' || cloudId.trim() === '') {
    console.error('❌ [Jira API Client] Invalid cloudId!');
    throw new Error('cloudId không hợp lệ. Vui lòng reconnect Jira.');
  }

  if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
    console.error('❌ [Jira API Client] Invalid accessToken!');
    throw new Error('accessToken không hợp lệ. Vui lòng reconnect Jira.');
  }

  if (typeof onTokenRefresh !== 'function') {
    console.error('❌ [Jira API Client] onTokenRefresh phải là function!');
    throw new Error('onTokenRefresh callback bắt buộc để xử lý 401 khi token hết hạn.');
  }

  const baseURL = `https://api.atlassian.com/ex/jira/${cloudId}${basePath}`;
  const client = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  // Request Interceptor: Log outgoing requests (Platform API)
  client.interceptors.request.use(
    (config) => {
      console.log(`📤 [Jira Platform API v${apiVersion}] Outgoing Request`);
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

          // BẮT BUỘC ghi đè Authorization với token mới trước khi retry
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
          client.defaults.headers = client.defaults.headers || {};
          client.defaults.headers['Authorization'] = `Bearer ${newAccessToken}`;
          if (client.defaults.headers.common) {
            client.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;
          }

          console.log('✅ [Jira Sync] Refresh thành công. Retry request với token mới');

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

/**
 * Tạo Axios instance cho Platform API v2 (REST API v2)
 * Dùng cho Create/Update/Delete Issue — description nhận plain text (không cần ADF)
 * Tái sử dụng đúng client + interceptor 401 của createJiraApiClient.
 */
function createJiraApiV2Client({ accessToken, cloudId, onTokenRefresh }) {
  return createJiraApiClient({ accessToken, cloudId, onTokenRefresh, apiVersion: 2 });
}

// =========================
// 2. JIRA API CALLS
// =========================

/**
 * Tìm kiếm Issues theo JQL (POST /rest/api/3/search/jql)
 * Hỗ trợ phân trang nextPageToken của Jira Cloud.
 * @param {Object} options
 * @param {AxiosInstance} options.client - Jira API client
 * @param {string} options.jql - JQL query (chỉ nên lọc theo project, VD: project = SCRUM)
 * @param {number} options.maxResults - Số lượng kết quả mỗi trang
 * @param {Array<string>} options.fields - Danh sách fields cần lấy
 * @param {string} [options.nextPageToken] - Token trang tiếp (pagination)
 * @returns {Promise<{issues: Array, total: number, nextPageToken?: string, isLast?: boolean}>}
 */
async function searchIssues({ client, jql, startAt = 0, maxResults = 100, fields = [], nextPageToken }) {
  try {
    // Dùng ["*all"] để Jira trả về mọi Custom Field (bao gồm Sprint) — ID Sprint field thay đổi theo instance
    const payload = {
      jql,
      maxResults,
      fields: fields.length > 0 ? fields : ['*all']
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    console.log('📤 [Jira Sync] POST /search/jql — JQL:', jql);
    console.log('📤 [Jira Sync] Request body:', JSON.stringify(payload, null, 2));

    const response = await client.post('/search/jql', payload);

    const issues = response.data.issues || [];
    const total = response.data.totalIssueCount ?? response.data.total ?? issues.length;

    if (!nextPageToken && Object.keys(response.data).length) {
      console.log('📥 [Jira Sync] Response keys:', Object.keys(response.data));
    }
    console.log('📥 [Jira Sync] Page: issues=', issues.length, 'totalIssueCount/total=', total, 'isLast=', response.data.isLast);

    return {
      issues,
      total,
      nextPageToken: response.data.nextPageToken,
      isLast: response.data.isLast !== false
    };
  } catch (error) {
    console.error('❌ [Jira Sync] Lỗi search issues:', error.message);
    throw error;
  }
}

/**
 * Lấy tất cả Issues của một project (chỉ lọc theo Project Key, không lọc status/assignee).
 * Dùng JQL: project = KEY và phân trang nextPageToken đến khi isLast.
 * @param {Object} options
 * @param {AxiosInstance} options.client
 * @param {string} options.projectKey - Jira project key (VD: SCRUM)
 * @returns {Promise<Array>}
 */
async function fetchAllProjectIssues({ client, projectKey }) {
  const key = typeof projectKey === 'string' ? projectKey.trim() : String(projectKey || '').trim();
  if (!key) {
    console.warn('⚠️ [Jira Sync] fetchAllProjectIssues: projectKey rỗng');
    return [];
  }

  // JQL chỉ lọc theo project — KHÔNG thêm điều kiện status, assignee, v.v. để lấy đủ mọi issue.
  const safeKey = key.replace(/"/g, '');
  const jql = `project = "${safeKey}"`;
  console.log(`📦 [Jira Sync] Fetching all issues for project: "${safeKey}" (JQL: ${jql})`);

  const maxResults = 50;
  const allIssues = [];
  let nextPageToken = null;
  let pageNum = 0;
  let totalReported = 0;

  do {
    pageNum++;
    const result = await searchIssues({
      client,
      jql,
      maxResults,
      nextPageToken: nextPageToken || undefined
    });

    allIssues.push(...(result.issues || []));
    if (result.total != null) totalReported = result.total;
    nextPageToken = result.nextPageToken || null;

    if (!result.isLast && nextPageToken) {
      console.log(`📦 [Jira Sync] Fetching next page (${pageNum + 1}), nextPageToken=...`);
    }
  } while (nextPageToken);

  const total = totalReported || allIssues.length;
  console.log(`✅ [Jira Sync] Hoàn tất: ${allIssues.length}/${total} issues (${pageNum} page(s), JQL: ${jql}).`);

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
 * BẮT BUỘC dùng Agile API: baseURL .../rest/agile/1.0 (KHÔNG dùng Platform API)
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {string} options.projectKey
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<Array>}
 */
async function fetchBoards({ accessToken, cloudId, projectKey, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
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
// 4. AGILE API CLIENT (Board, Sprint)
// Base URL: https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0
// Dùng cho: /board, /board/{boardId}/sprint, /sprint, ...
// KHÔNG dùng cho /search/jql (Platform API)
// =========================

/**
 * Tạo Axios instance cho Agile API (Board, Sprint)
 * Base URL: .../rest/agile/1.0
 */
function createJiraAgileClient({ accessToken, cloudId, onTokenRefresh }) {
  if (!accessToken || typeof accessToken !== 'string' || !accessToken.trim()) {
    console.error('❌ [Jira Agile Client] accessToken thiếu hoặc rỗng');
    throw new Error('accessToken không hợp lệ. Vui lòng reconnect Jira.');
  }
  const baseURL = `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0`;
  const client = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  client.interceptors.request.use((config) => {
    console.log('🔥 Token Agile API gửi đi:', config.headers && config.headers['Authorization'] ? config.headers['Authorization'].substring(0, 25) + '...' : 'BỊ RỖNG!');
    console.log('📤 [Jira Agile API] Outgoing Request (base: .../rest/agile/1.0)', config.url);
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        const newAccessToken = await onTokenRefresh();
        // TUYỆT ĐỐI ghi đè Authorization (không có logic "chỉ gán nếu chưa có")
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers['Authorization'] = 'Bearer ' + newAccessToken;
        client.defaults.headers = client.defaults.headers || {};
        client.defaults.headers['Authorization'] = 'Bearer ' + newAccessToken;
        if (client.defaults.headers.common) {
          client.defaults.headers.common['Authorization'] = 'Bearer ' + newAccessToken;
        }
        console.log('🔄 [Jira Agile] Retry với token mới:', newAccessToken ? newAccessToken.substring(0, 20) + '...' : 'NULL');
        return client(originalRequest);
      }
      return Promise.reject(error);
    }
  );

  return client;
}

/**
 * Lấy TOÀN BỘ Sprints của Board (có phân trang)
 * GET .../rest/agile/1.0/board/{boardId}/sprint
 * @param {Object} options
 * @param {string} options.accessToken
 * @param {string} options.cloudId
 * @param {number} options.boardId
 * @param {Function} options.onTokenRefresh
 * @returns {Promise<Array<{id: number, name: string, state: string, startDate?: string, endDate?: string}>>}
 */
async function fetchSprints({ accessToken, cloudId, boardId, onTokenRefresh }) {
  try {
    const client = createJiraAgileClient({ accessToken, cloudId, onTokenRefresh });
    const allSprints = [];
    let startAt = 0;
    const maxResults = 50;
    let isLast = false;

    // Lấy đủ 3 state để không bỏ sót sprint mới tạo (future), đang chạy (active), đã đóng (closed)
    const stateParam = 'active,future,closed';

    while (!isLast) {
      const response = await client.get(`/board/${boardId}/sprint`, {
        params: { state: stateParam, startAt, maxResults }
      });

      const values = response.data.values || (Array.isArray(response.data) ? response.data : []);
      allSprints.push(...values);

      // Log cấu trúc response lần đầu (để debug nếu Jira trả format khác)
      if (startAt === 0 && values.length > 0) {
        const first = values[0];
        console.log('📦 [Jira Agile] Sprint response sample keys:', Object.keys(first || {}));
      }

      const total = response.data.total != null ? response.data.total : values.length;
      if (values.length < maxResults || startAt + values.length >= total) {
        isLast = true;
      } else {
        startAt += values.length;
      }
    }

    console.log(`📦 [Jira Agile] Fetched ${allSprints.length} sprints for board ${boardId} (state=${stateParam})`);
    if (allSprints.length > 0) {
      allSprints.forEach((s, i) => {
        console.log(`   [${i + 1}] id=${s.id}, name="${s.name || '(no name)'}", state=${s.state ?? 'n/a'}`);
      });
    } else {
      console.warn('⚠️ [Jira Agile] Không lấy được sprint nào. Kiểm tra boardId và quyền scope read:sprint:jira-software.');
    }
    return allSprints;
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

// =========================
// JIRA API v2 (plain text description — Đồng bộ 1.5 chiều)
// =========================

/**
 * Tạo Issue mới (API v2 — description plain text)
 * @param {Object} options
 * @param {AxiosInstance} options.client - REST API v2 client
 * @param {string} options.projectKey
 * @param {Object} options.data - { summary, description? }
 * @returns {Promise<{id: string, key: string}>}
 */
async function createIssueV2({ client, projectKey, data }) {
  try {
    const payload = {
      fields: {
        project: { key: projectKey },
        summary: data.summary,
        description: data.description || '',
        issuetype: { name: 'Task' }
      }
    };
    const response = await client.post('/issue', payload);
    if (response.status === 201 && response.data) {
      return { id: response.data.id, key: response.data.key };
    }
    throw new Error('Jira trả về không đúng format');
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    if (status === 401) console.error('❌ [Jira API v2] 401 Unauthorized — token hết hạn hoặc sai scope');
    else if (status === 403) console.error('❌ [Jira API v2] 403 Forbidden — thiếu quyền tạo issue');
    else console.error('❌ [Jira API v2] Lỗi create issue:', data || error.message);
    throw error;
  }
}

/**
 * Sửa Issue (API v2 — description plain text)
 * @param {Object} options
 * @param {AxiosInstance} options.client
 * @param {string} options.issueIdOrKey
 * @param {Object} options.data - { summary?, description? }
 * @returns {Promise<boolean>}
 */
async function updateIssueV2({ client, issueIdOrKey, data }) {
  try {
    const fields = {};
    if (data.summary != null) fields.summary = data.summary;
    if (data.description != null) fields.description = data.description;
    if (Object.keys(fields).length === 0) return true;

    const response = await client.put(`/issue/${issueIdOrKey}`, { fields });
    return response.status === 204 || response.status === 200;
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    if (status === 401) console.error('❌ [Jira API v2] 401 Unauthorized');
    else if (status === 403) console.error('❌ [Jira API v2] 403 Forbidden');
    else console.error('❌ [Jira API v2] Lỗi update issue:', data || error.message);
    throw error;
  }
}

/**
 * Xóa Issue (API v2)
 * @param {Object} options
 * @param {AxiosInstance} options.client
 * @param {string} options.issueIdOrKey
 * @returns {Promise<boolean>}
 */
async function deleteIssueV2({ client, issueIdOrKey }) {
  try {
    const response = await client.delete(`/issue/${issueIdOrKey}`);
    return response.status === 204 || response.status === 200;
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    if (status === 401) console.error('❌ [Jira API v2] 401 Unauthorized');
    else if (status === 403) console.error('❌ [Jira API v2] 403 Forbidden');
    else if (status === 404) console.error('❌ [Jira API v2] 404 Not Found — issue không tồn tại');
    else console.error('❌ [Jira API v2] Lỗi delete issue:', data || error.message);
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
// 3. HELPER: MAP ISSUE -> SPRINT
// =========================

/**
 * Bóc tách jira_sprint_id từ issue.fields.
 * Sprint field ID thay đổi theo Jira instance (không phải lúc nào cũng customfield_10020).
 * Quét toàn bộ fields, tìm field có cấu trúc Sprint (id, state, name, boardId).
 * @param {Object} issue - Issue từ Jira API
 * @returns {number|null} jira_sprint_id hoặc null (Backlog)
 */
function extractJiraSprintIdFromIssue(issue) {
  const fields = issue?.fields || {};
  for (const key in fields) {
    const value = fields[key];
    if (value == null) continue;
    const arr = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : null);
    if (!arr || arr.length === 0) continue;
    const item = arr[arr.length - 1]; // Sprint hiện tại thường ở cuối
    if (item && item.id != null && item.state != null && (item.name != null || item.boardId != null)) {
      return Number(item.id);
    }
  }
  return null;
}

// =========================
// 4. LUỒNG SYNC PROJECT: PROJECT -> BOARD -> SPRINTS -> ISSUES
// =========================

const { Sprint, JiraTask } = require('../models/JiraData');
const models = require('../models');

/**
 * Sync dữ liệu Jira cho Project theo đúng thứ tự: Board -> Sprints -> Issues.
 * B1: Lấy boardId từ projectKey
 * B2: Fetch & upsert Sprints (trước khi fetch Issues)
 * B3: Fetch Issues qua search/jql
 * B4: Map Task vào đúng Sprint (chỉ dùng Default Sprint cho Backlog)
 * @param {Object} options
 * @param {Object} options.user - User có integrations.jira
 * @param {string} options.clientId - Atlassian Client ID
 * @param {string} options.clientSecret - Atlassian Client Secret
 * @param {string} options.projectKey - Jira Project Key (VD: SCRUM)
 * @param {Object} options.teamId - MongoDB ObjectId của Team
 * @returns {Promise<{syncedTasks: number, activeIssueIds: string[]}>}
 */
async function syncProjectJiraData({ user, clientId, clientSecret, projectKey, teamId }) {
  const jira = user.integrations?.jira;
  if (!jira?.accessToken || !jira?.cloudId) {
    const err = new Error('User chưa kết nối Jira');
    err.code = 'JIRA_NOT_CONNECTED';
    throw err;
  }

  const key = typeof projectKey === 'string' ? projectKey.trim() : String(projectKey || '').trim();
  if (!key) {
    const err = new Error('Project Key rỗng');
    err.code = 'INVALID_PROJECT_KEY';
    throw err;
  }

  let currentAccessToken = jira.accessToken;
  const onTokenRefresh = async () => {
    if (!jira.refreshToken) {
      const err = new Error('Không có refresh_token. Vui lòng đăng nhập lại Jira.');
      err.code = 'REFRESH_TOKEN_MISSING';
      throw err;
    }
    const { accessToken, refreshToken, cloudId: newCloudId } = await JiraAuthService.refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: jira.refreshToken
    });
    user.integrations.jira.accessToken = accessToken;
    user.integrations.jira.refreshToken = refreshToken;
    if (newCloudId) user.integrations.jira.cloudId = newCloudId;
    await user.save();
    currentAccessToken = accessToken;
    return accessToken;
  };

  const cloudId = jira.cloudId;

  // ==================== BƯỚC 1: LẤY BOARD ID ====================
  console.log('📌 [Jira Sync] B1: Lấy board theo projectKey:', key);
  const boards = await fetchBoards({ accessToken: currentAccessToken, cloudId, projectKey: key, onTokenRefresh });
  const boardId = boards?.[0]?.id ?? null;

  if (!boardId) {
    console.log('⚠️ [Jira Sync] Không có board cho project. Skip Sprint sync, chỉ fetch Issues (Backlog).');
  }

  // ==================== BƯỚC 2: FETCH & UPSERT SPRINTS ====================
  const sprintMap = new Map(); // jira_sprint_id -> Mongo _id
  const activeJiraSprintIds = [];

  if (boardId) {
    console.log('📌 [Jira Sync] B2: Fetch Sprints cho board:', boardId);
    const sprints = await fetchSprints({
      accessToken: currentAccessToken,
      cloudId,
      boardId,
      onTokenRefresh
    });

    for (const s of sprints) {
      const jiraSprintId = s.id != null ? Number(s.id) : null;
      if (jiraSprintId == null) continue;

      const saved = await Sprint.findOneAndUpdate(
        { team_id: teamId, jira_sprint_id: jiraSprintId },
        {
          $set: {
            team_id: teamId,
            jira_sprint_id: jiraSprintId,
            name: s.name || `Sprint ${jiraSprintId}`,
            state: (() => {
              const st = ((s.state || 'future') + '').toLowerCase();
              return ['active', 'closed', 'future'].includes(st) ? st : 'future';
            })(),
            start_date: s.startDate ? new Date(s.startDate) : null,
            end_date: s.endDate ? new Date(s.endDate) : null,
            goal: s.goal || null
          }
        },
        { upsert: true, new: true }
      );
      sprintMap.set(jiraSprintId, saved._id);
      activeJiraSprintIds.push(jiraSprintId);
    }

    try {
      const deleted = await Sprint.deleteMany({
        team_id: teamId,
        jira_sprint_id: { $nin: activeJiraSprintIds }
      });
      if (deleted.deletedCount > 0) {
        console.log('🧹 [Jira Sync] Đã xóa', deleted.deletedCount, 'Sprint orphan');
      }
    } catch (e) {
      console.warn('⚠️ [Jira Sync] Cleanup Sprint thất bại:', e.message);
    }
  }

  // Tạo Default Sprint cho Backlog (issue không thuộc sprint nào)
  const defaultSprint = await Sprint.findOneAndUpdate(
    { team_id: teamId, jira_sprint_id: 0 },
    {
      $set: {
        team_id: teamId,
        jira_sprint_id: 0,
        name: 'Default Sprint',
        state: 'active',
        start_date: new Date(),
        end_date: null
      }
    },
    { upsert: true, new: true }
  );
  const defaultSprintId = defaultSprint._id;

  // ==================== BƯỚC 3: FETCH ISSUES ====================
  console.log('📌 [Jira Sync] B3: Fetch Issues (project =', key, ')');
  const restClient = createJiraApiClient({ accessToken: currentAccessToken, cloudId, onTokenRefresh });
  const issues = await fetchAllProjectIssues({ client: restClient, projectKey: key });

  // ==================== BƯỚC 4: MAP TASK VÀO ĐÚNG SPRINT ====================
  let syncedTasks = 0;
  const activeIssueIds = [];

  for (const issue of issues) {
    const jiraSprintId = extractJiraSprintIdFromIssue(issue);
    let dbSprintId = null;
    if (jiraSprintId != null && sprintMap.has(jiraSprintId)) {
      dbSprintId = sprintMap.get(jiraSprintId);
    } else {
      dbSprintId = defaultSprintId; // Backlog -> Default Sprint
    }

    let assigneeMemberId = null;
    const assigneeAccountId = issue.fields?.assignee?.accountId;
    if (assigneeAccountId && teamId) {
      const m = await models.TeamMember.findOne({
        team_id: teamId,
        jira_account_id: assigneeAccountId,
        is_active: true
      }).select('_id').lean();
      assigneeMemberId = m ? m._id : null;
    }

    await JiraTask.findOneAndUpdate(
      { issue_id: String(issue.id) },
      {
        $set: {
          team_id: teamId,
          sprint_id: dbSprintId,
          issue_id: String(issue.id),
          issue_key: issue.key,
          summary: issue.fields?.summary ?? '',
          description: issue.fields?.description ?? '',
          status_name: issue.fields?.status?.name ?? '',
          status_category: issue.fields?.status?.statusCategory?.key ?? '',
          story_point: issue.fields?.customfield_10026 ?? 0,
          assignee_account_id: assigneeAccountId ?? null,
          assignee_name: issue.fields?.assignee?.displayName ?? null,
          assignee_id: assigneeMemberId,
          reporter_account_id: issue.fields?.reporter?.accountId ?? null,
          reporter_name: issue.fields?.reporter?.displayName ?? null,
          start_date: issue.fields?.customfield_10015 ? new Date(issue.fields.customfield_10015) : null,
          due_date: issue.fields?.duedate ? new Date(issue.fields.duedate) : null,
          updated_at: new Date()
        }
      },
      { upsert: true, new: true }
    );

    syncedTasks++;
    activeIssueIds.push(String(issue.id));
  }

  // Cleanup JiraTask rác (không còn trên Jira)
  try {
    await JiraTask.deleteMany({
      team_id: teamId,
      issue_id: { $nin: activeIssueIds }
    });
  } catch (e) {
    console.warn('⚠️ [Jira Sync] Cleanup JiraTask thất bại:', e.message);
  }

  console.log('✅ [Jira Sync] Hoàn tất:', syncedTasks, 'tasks, sprintMap size:', sprintMap.size);
  return { syncedTasks, activeIssueIds };
}

// =========================
// 5. WRAPPER: SYNC VỚI AUTO-REFRESH
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
  syncProjectJiraData,
  extractJiraSprintIdFromIssue,

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
  createJiraApiV2Client,
  createIssueV2,
  updateIssueV2,
  deleteIssueV2,
  transitionIssue,
  getCustomFieldId
};
