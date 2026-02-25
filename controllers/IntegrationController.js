const models = require('../models');
const IntegrationService = require('../services/IntegrationService');
const GithubService = require('../services/GithubService');
const JiraService = require('../services/JiraService');
const JiraAuthService = require('../services/JiraAuthService');
const JiraSyncService = require('../services/JiraSyncService');
const mongoose = require('mongoose');

function getClientBaseUrl(req) {
  // FE có thể truyền redirect riêng; nếu không có thì dùng env
  return process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`;
}

function getGithubConfig(req, platform = 'web') {
  // Hỗ trợ 2 OAuth App khác nhau cho GitHub: WEB & MOBILE
  // - WEB:   GITHUB_CLIENT_ID_WEB,   GITHUB_CLIENT_SECRET_WEB
  // - MOBILE:GITHUB_CLIENT_ID_MOBILE,GITHUB_CLIENT_SECRET_MOBILE
  // Backward-compatible: nếu biến *_WEB không có, fallback về GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET cũ.

  const normalizedPlatform = (platform || 'web').toLowerCase();

  let clientId;
  let clientSecret;

  if (normalizedPlatform === 'mobile') {
    clientId = process.env.GITHUB_CLIENT_ID_MOBILE;
    clientSecret = process.env.GITHUB_CLIENT_SECRET_MOBILE;

    if (!clientId || !clientSecret) {
      throw new Error('Thiếu cấu hình GITHUB_CLIENT_ID_MOBILE hoặc GITHUB_CLIENT_SECRET_MOBILE trong .env');
    }
  } else {
    // WEB (mặc định)
    clientId = process.env.GITHUB_CLIENT_ID_WEB || process.env.GITHUB_CLIENT_ID;
    clientSecret = process.env.GITHUB_CLIENT_SECRET_WEB || process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Thiếu cấu hình GITHUB_CLIENT_ID_WEB/GITHUB_CLIENT_SECRET_WEB (hoặc GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET) trong .env');
    }
  }

  const redirectUri = process.env.GITHUB_CALLBACK_URL || `${getClientBaseUrl(req)}/api/integrations/github/callback`;
  return { clientId, clientSecret, redirectUri, platform: normalizedPlatform };
}

function getAtlassianConfig(req) {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  const redirectUri = process.env.ATLASSIAN_CALLBACK_URL || `${getClientBaseUrl(req)}/api/integrations/jira/callback`;
  if (!clientId || !clientSecret) {
    throw new Error('Thiếu cấu hình ATLASSIAN_CLIENT_ID hoặc ATLASSIAN_CLIENT_SECRET trong .env');
  }
  return { clientId, clientSecret, redirectUri };
}

async function loadUserByRole(role, userId) {
  if (role === 'ADMIN') return await models.Admin.findById(userId);
  if (role === 'LECTURER') return await models.Lecturer.findById(userId);
  if (role === 'STUDENT') return await models.Student.findById(userId);
  return null;
}

/**
 * Sanitize Jira Project Key: Trim, uppercase, loại bỏ ký tự không hợp lệ
 * Ví dụ: "[SCRUM] My Team" -> "SCRUM", "scrum " -> "SCRUM", "SCRUM-1" -> "SCRUM1"
 * Jira Project Key chỉ cho phép: chữ cái, số, dấu gạch ngang, dấu gạch dưới
 */
function sanitizeJiraProjectKey(input) {
  if (!input || typeof input !== 'string') return '';
  
  // 1. Loại bỏ dấu ngoặc vuông và nội dung sau (ví dụ: "[SCRUM] My Team" -> "[SCRUM]")
  let cleaned = input.trim();
  const bracketMatch = cleaned.match(/^\[([^\]]+)\]/);
  if (bracketMatch) {
    cleaned = bracketMatch[1];
  }
  
  // 2. Trim lại
  cleaned = cleaned.trim();
  
  // 3. Chỉ giữ lại chữ cái, số, dấu gạch ngang, dấu gạch dưới (Jira Project Key format)
  cleaned = cleaned.replace(/[^A-Za-z0-9_-]/g, '');
  
  // 4. Uppercase để chuẩn hóa
  cleaned = cleaned.toUpperCase();
  
  return cleaned;
}

// =========================
// Helpers: đảm bảo GitHub/Jira không bị link trùng cho 2 user khác nhau
// =========================
async function ensureGithubUnique(githubId, currentRole, currentId) {
  if (!githubId) return;
  const cond = { 'integrations.github.githubId': githubId, _id: { $ne: currentId } };
  if (await models.Admin.exists(cond) || await models.Lecturer.exists(cond) || await models.Student.exists(cond)) {
    throw new Error('Tài khoản GitHub này đã được liên kết với user khác rồi.');
  }
}

async function ensureJiraUnique(jiraAccountId, cloudId, currentRole, currentId) {
  if (!jiraAccountId || !cloudId) return;
  const cond = {
    'integrations.jira.jiraAccountId': jiraAccountId,
    'integrations.jira.cloudId': cloudId,
    _id: { $ne: currentId }
  };
  if (await models.Admin.exists(cond) || await models.Lecturer.exists(cond) || await models.Student.exists(cond)) {
    throw new Error('Tài khoản Jira này đã được liên kết với user khác rồi.');
  }
}

// =========================
// HELPER: Lấy Jira OAuth Config từ User (Dùng cho các Controller khác)
// =========================

/**
 * Lấy Jira OAuth config và client từ user đã connect
 * @param {Object} req - Express request (phải có req.user)
 * @returns {Promise<{user, jira, clientId, clientSecret, client}>}
 * @throws {Error} Nếu user chưa connect Jira hoặc thiếu config
 */
async function getJiraOAuthConfig(req) {
  const user = req.user;
  const jira = user?.integrations?.jira;
  
  if (!jira?.accessToken || !jira?.cloudId) {
    const error = new Error('Chưa kết nối Jira. Vui lòng kết nối Jira trước.');
    error.code = 'JIRA_NOT_CONNECTED';
    error.status = 400;
    throw error;
  }
  
  const { clientId, clientSecret } = getAtlassianConfig(req);
  
  // Tạo Jira API client với auto-refresh
  const client = await JiraSyncService.syncWithAutoRefresh({
    user,
    clientId,
    clientSecret,
    syncFunction: async (client) => client
  });
  
  return { user, jira, clientId, clientSecret, client };
}

// Export helper để các controller khác dùng
module.exports.getJiraOAuthConfig = getJiraOAuthConfig;

// =========================
// GITHUB: CONNECT + CALLBACK
// =========================
exports.githubConnect = async (req, res) => {
  try {
    // platform: 'web' (default) | 'mobile'
    const platform = (req.query.platform || req.headers['x-platform'] || 'web').toString().toLowerCase();
    const { clientId, redirectUri } = getGithubConfig(req, platform);
    
    // Frontend có thể truyền redirect_uri để redirect về sau khi callback (cho dev local)
    // Nếu không có thì dùng CLIENT_URL từ env
    const frontendRedirectUri = req.query.redirect_uri || process.env.CLIENT_URL || 'http://localhost:3000';

    // State JWT: chứa userId + role và frontendRedirectUri để callback biết redirect về đâu
    const state = IntegrationService.signOAuthState({
      provider: 'github',
      userId: req.userId,
      role: req.role,
      platform, // Lưu lại platform để callback biết dùng OAuth App nào
      frontendRedirectUri // Lưu URL frontend (có thể là web hoặc deep link mobile) để redirect về sau
    });

    const scope = 'repo user';
    const url = IntegrationService.buildGithubAuthUrl({ clientId, redirectUri, scope, state });
    
    // Trả về JSON với URL thay vì redirect để frontend tự redirect (tránh lỗi CORS khi dùng XHR)
    return res.json({ redirectUrl: url });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.githubCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ error: 'Thiếu code hoặc state từ GitHub callback' });
    }

    const decoded = IntegrationService.verifyOAuthState(state);
    if (decoded.provider !== 'github') {
      return res.status(400).json({ error: 'State không hợp lệ (provider mismatch)' });
    }

    const platform = decoded.platform || 'web';
    const { clientId, clientSecret, redirectUri } = getGithubConfig(req, platform);
    
    console.log('🔐 [GitHub Callback] Đang exchange code → token...');
    console.log('   - Client ID:', clientId);
    console.log('   - Platform:', platform);
    console.log('   - Redirect URI:', redirectUri);
    
    const accessToken = await IntegrationService.exchangeGithubCodeForToken({
      clientId,
      clientSecret,
      code,
      redirectUri
    });

    const ghUser = await IntegrationService.fetchGithubUser(accessToken);
    const user = await loadUserByRole(decoded.role, decoded.userId);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user để lưu integration' });

    // Đảm bảo githubId không bị trùng với user khác (trừ chính user này)
    await ensureGithubUnique(ghUser.githubId, decoded.role, user._id);

    // Đảm bảo integrations object tồn tại (có thể là {} hoặc có jira nhưng không có github)
    user.integrations = user.integrations || {};
    
    // Overwrite hoặc tạo mới github integration
    // Nếu đã có github từ trước (reconnect), sẽ overwrite với token mới
    user.integrations.github = {
      githubId: ghUser.githubId,
      username: ghUser.username,
      accessToken, // Token này sẽ được mã hóa trong pre-save hook
      linkedAt: new Date()
    };
    
    await user.save();

    // Redirect về frontend sau khi thành công
    // Dùng frontendRedirectUri từ state (đã được frontend truyền khi connect) hoặc fallback về CLIENT_URL
    const frontendUrl = decoded.frontendRedirectUri || process.env.CLIENT_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/callback/github?success=true&username=${encodeURIComponent(ghUser.username)}`);
  } catch (error) {
    // Log chi tiết lỗi từ GitHub API
    console.error('❌ [GitHub Callback] Lỗi:', error.message);
    if (error.response) {
      console.error('   - Status:', error.response.status);
      console.error('   - Data:', JSON.stringify(error.response.data, null, 2));
    }
    
    // Trả về lỗi chi tiết để dễ debug
    const errorDetails = error.response?.data || error.message;
    return res.status(error.response?.status || 500).json({ 
      error: 'Lỗi kết nối GitHub',
      details: errorDetails,
      message: error.message
    });
  }
};

// =========================
// JIRA (ATLASSIAN): CONNECT + CALLBACK (REFACTORED với JiraAuthService)
// =========================
exports.jiraConnect = async (req, res) => {
  try {
    const { clientId } = getAtlassianConfig(req);
    
    // Xác định platform: mobile hoặc web
    const platform = (req.query.platform || req.headers['x-platform'] || 'web').toString().toLowerCase();
    
    // Frontend redirect URI (để redirect về sau khi callback thành công)
    const frontendRedirectUri = req.query.redirect_uri || process.env.CLIENT_URL || 'http://localhost:3000';

    console.log(`🔐 [Jira Connect] Platform: ${platform}, User: ${req.user?.email}`);

    // Tạo Authorization URL với JiraAuthService (hỗ trợ Granular Scopes)
    const authUrl = JiraAuthService.buildAuthorizationUrl({
      clientId,
      platform,
      userId: req.userId,
      role: req.role,
      frontendRedirectUri,
      req
    });
    
    console.log('✅ [Jira Connect] Authorization URL created');
    
    // Trả về JSON với URL thay vì redirect để frontend tự redirect (tránh lỗi CORS khi dùng XHR)
    return res.json({ redirectUrl: authUrl });
  } catch (error) {
    console.error('❌ [Jira Connect] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

exports.jiraCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ error: 'Thiếu code hoặc state từ Jira callback' });
    }

    // Verify state JWT
    const decoded = JiraAuthService.verifyOAuthState(state);
    if (decoded.provider !== 'jira') {
      return res.status(400).json({ error: 'State không hợp lệ (provider mismatch)' });
    }

    const { clientId, clientSecret } = getAtlassianConfig(req);
    
    // QUAN TRỌNG: Dùng redirectUri từ state (phải giống lúc tạo auth URL)
    const redirectUri = decoded.redirectUri || JiraAuthService.getRedirectUri(decoded.platform || 'web', req);
    
    console.log('🔐 [Jira Callback] Đang exchange code → token...');
    console.log('   - Client ID:', clientId);
    console.log('   - Platform:', decoded.platform || 'web');
    console.log('   - Redirect URI:', redirectUri);
    
    // 1) Exchange code → tokens (sử dụng JiraAuthService)
    const { accessToken, refreshToken } = await JiraAuthService.exchangeCodeForTokens({
      clientId,
      clientSecret,
      code,
      redirectUri // PHẢI ĐÚNG với lúc tạo auth URL
    });

    // 2) Lấy cloudId từ accessible-resources
    const resources = await JiraAuthService.fetchAccessibleResources(accessToken);
    if (!resources.length) {
      return res.status(400).json({ error: 'Không lấy được accessible-resources từ Atlassian' });
    }

    // Lấy resource đầu tiên (có thể nâng cấp: cho user chọn site)
    const selectedResource = resources[0];
    const cloudId = selectedResource.id;
    const jiraUrl = selectedResource.url || `https://${selectedResource.name}.atlassian.net`;

    console.log(`   - Jira Site: ${selectedResource.name}`);
    console.log(`   - Cloud ID: ${cloudId}`);

    // 3) Lấy thông tin user hiện tại
    const me = await JiraAuthService.fetchCurrentUser(accessToken, cloudId);
    
    // 4) Tìm user trong DB
    const user = await loadUserByRole(decoded.role, decoded.userId);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user để lưu integration' });

    // 5) Đảm bảo jiraAccountId + cloudId không bị trùng với user khác
    await ensureJiraUnique(me.accountId, cloudId, decoded.role, user._id);

    // 6) Lưu integration vào DB
    user.integrations = user.integrations || {};
    user.integrations.jira = {
      jiraAccountId: me.accountId,
      cloudId,
      jiraUrl,
      email: me.email,
      displayName: me.displayName,
      accessToken, // Sẽ được mã hóa trong pre-save hook
      refreshToken, // Sẽ được mã hóa trong pre-save hook
      linkedAt: new Date()
    };
    
    await user.save();

    // 7) Best-effort: auto map Jira accountId cho TeamMember
    try {
      const updatedMembers = await models.TeamMember.find({
        student_id: user._id,
        is_active: true
      }).select('_id team_id').lean();

      if (updatedMembers.length > 0) {
        await models.TeamMember.updateMany(
          { student_id: user._id, is_active: true },
          { jira_account_id: me.accountId }
        );

        // Backfill JiraTask.assignee_id
        const { Sprint, JiraTask } = require('../models/JiraData');
        for (const tm of updatedMembers) {
          const sprintIds = await Sprint.find({ team_id: tm.team_id }).select('_id').lean();
          const ids = sprintIds.map(s => s._id);
          if (ids.length === 0) continue;

          await JiraTask.updateMany(
            { sprint_id: { $in: ids }, assignee_account_id: me.accountId },
            { assignee_id: tm._id }
          );
        }
      }
    } catch (e) {
      console.warn('⚠️ [Jira Callback] Lỗi khi map TeamMember:', e.message);
    }
    
    console.log(`✅ [Jira Connect] Đã lưu integration cho user ${user.email}:`);
    console.log(`   - Jira URL: ${jiraUrl}`);
    console.log(`   - Cloud ID: ${cloudId}`);
    console.log(`   - Account ID: ${me.accountId}`);

    // 8) Redirect về frontend
    const frontendUrl = decoded.frontendRedirectUri?.trim() || process.env.CLIENT_URL || 'http://localhost:3000';
    
    // Xử lý mobile deep link
    if (decoded.platform === 'mobile') {
      return res.redirect(`syncapp://connections?success=true&accountId=${encodeURIComponent(me.accountId)}`);
    }
    
    // Web callback
    return res.redirect(`${frontendUrl}/callback/jira?success=true&accountId=${encodeURIComponent(me.accountId)}`);
  } catch (error) {
    console.error('❌ [Jira Callback] Lỗi:', error.message);
    if (error.response) {
      console.error('   - Status:', error.response.status);
      console.error('   - Data:', JSON.stringify(error.response.data, null, 2));
    }
    
    const errorDetails = error.response?.data || error.message;
    return res.status(error.response?.status || 500).json({ 
      error: 'Lỗi kết nối Jira',
      details: errorDetails,
      message: error.message
    });
  }
};

// =========================
// DROPDOWN APIs
// =========================
exports.getGithubRepos = async (req, res) => {
  try {
    const token = req.user?.integrations?.github?.accessToken;
    if (!token) {
      return res.status(400).json({ error: 'Chưa kết nối GitHub. Vui lòng link GitHub trước.' });
    }
    const repos = await IntegrationService.fetchGithubRepos(token);
    return res.json({ total: repos.length, repos });
  } catch (error) {
    const status = error?.response?.status;
    // GitHub token sai / hết hạn / bị revoke → báo 401 + gợi ý reconnect
    if (status === 401 || status === 403) {
      // Best-effort: xóa github integration để tránh gọi lại token hỏng
      try {
        req.user.integrations = req.user.integrations || {};
        delete req.user.integrations.github;
        await req.user.save();
      } catch (e) {
        // ignore
      }
      return res.status(401).json({
        error: 'GitHub token không hợp lệ hoặc đã hết hạn. Vui lòng ngắt kết nối và kết nối lại GitHub.'
      });
    }
    return res.status(500).json({ error: error.message });
  }
};

exports.getJiraProjects = async (req, res) => {
  try {
    const user = req.user;
    const jira = user.integrations?.jira;
    
    console.log('🔍 [Get Jira Projects] Request from user:', user.email);
    console.log('   - User ID:', user._id);
    console.log('   - Has Jira integration?', !!jira);
    console.log('   - Has accessToken?', !!jira?.accessToken);
    console.log('   - Has refreshToken?', !!jira?.refreshToken);
    console.log('   - Has cloudId?', !!jira?.cloudId);
    
    // Detailed debug info
    if (jira) {
      console.log('   📊 Jira Integration Details:');
      console.log('      - CloudId:', jira.cloudId);
      console.log('      - CloudId type:', typeof jira.cloudId);
      console.log('      - CloudId length:', jira.cloudId?.length || 0);
      console.log('      - Jira URL:', jira.jiraUrl);
      console.log('      - Account ID:', jira.jiraAccountId);
      console.log('      - Email:', jira.email);
      console.log('      - Display Name:', jira.displayName);
      console.log('      - Linked At:', jira.linkedAt);
      console.log('      - AccessToken type:', typeof jira.accessToken);
      console.log('      - AccessToken length:', jira.accessToken?.length || 0);
      console.log('      - AccessToken prefix (20 chars):', jira.accessToken ? jira.accessToken.substring(0, 20) + '...' : 'NULL');
      console.log('      - RefreshToken type:', typeof jira.refreshToken);
      console.log('      - RefreshToken length:', jira.refreshToken?.length || 0);
      console.log('      - Expected API URL:', `https://api.atlassian.com/ex/jira/${jira.cloudId}/rest/api/3/project/search`);
    }
    
    if (!jira?.accessToken || !jira?.cloudId) {
      console.log('   ❌ [Get Jira Projects] Missing Jira integration');
      return res.status(400).json({ 
        error: 'Chưa kết nối Jira. Vui lòng kết nối Jira trước.',
        code: 'JIRA_NOT_CONNECTED'
      });
    }
    
    // Validate cloudId format
    if (typeof jira.cloudId !== 'string' || jira.cloudId.trim() === '') {
      console.error('   ❌ [Get Jira Projects] Invalid cloudId format!');
      console.error('      - CloudId value:', jira.cloudId);
      console.error('      - CloudId type:', typeof jira.cloudId);
      return res.status(400).json({
        error: 'CloudId không hợp lệ. Vui lòng reconnect Jira.',
        code: 'INVALID_CLOUD_ID'
      });
    }
    
    // Validate accessToken format
    if (typeof jira.accessToken !== 'string' || jira.accessToken.trim() === '') {
      console.error('   ❌ [Get Jira Projects] Invalid accessToken format!');
      console.error('      - AccessToken type:', typeof jira.accessToken);
      return res.status(400).json({
        error: 'AccessToken không hợp lệ. Vui lòng reconnect Jira.',
        code: 'INVALID_ACCESS_TOKEN'
      });
    }
    
    const { clientId, clientSecret } = getAtlassianConfig(req);
    
    console.log('   🔑 OAuth Config:');
    console.log('      - Client ID:', clientId ? clientId.substring(0, 10) + '...' : 'MISSING');
    console.log('      - Client Secret:', clientSecret ? '✅ Present' : '❌ MISSING');

    // Sử dụng JiraSyncService với auto-refresh
    const projects = await JiraSyncService.syncWithAutoRefresh({
      user: req.user,
      clientId,
      clientSecret,
      syncFunction: async (client) => {
        return await JiraSyncService.fetchProjects(client);
      }
    });

    console.log('✅ [Get Jira Projects] Success:', projects.length, 'projects');
    return res.json({ total: projects.length, projects });
  } catch (error) {
    console.error('❌ [Get Jira Projects] Error:', error.message);
    console.error('   - Error code:', error.code);
    console.error('   - Response status:', error.response?.status);
    console.error('   - Response data:', JSON.stringify(error.response?.data, null, 2));
    console.error('   - Atlassian error:', error.atlassianError);
    console.error('   - Atlassian description:', error.atlassianDescription);
    
    // Phân loại lỗi chi tiết
    if (error.code === 'REFRESH_TOKEN_EXPIRED') {
      console.log('🔴 [Get Jira Projects] Refresh token hết hạn - YÊU CẦU REAUTH');
      return res.status(401).json({
        error: 'Jira token đã hết hạn. Vui lòng ngắt kết nối và kết nối lại Jira.',
        code: 'TOKEN_EXPIRED',
        requiresReauth: true
      });
    }
    
    if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'INVALID_REFRESH_TOKEN') {
      console.log('🔴 [Get Jira Projects] Refresh token thiếu hoặc invalid - YÊU CẦU REAUTH');
      return res.status(401).json({
        error: 'Jira refresh token không hợp lệ. Vui lòng kết nối lại Jira với scope "offline_access".',
        code: 'REFRESH_TOKEN_INVALID',
        requiresReauth: true
      });
    }

    // Lỗi 401 nhưng không phải refresh token issue
    if (error.response?.status === 401) {
      const responseData = error.response?.data;
      
      // Check nếu là lỗi scope
      if (responseData?.message?.includes('scope')) {
        console.log('🔴 [Get Jira Projects] Token THIẾU SCOPES - YÊU CẦU RECONNECT');
        return res.status(401).json({
          error: 'Jira token thiếu quyền (scopes). Vui lòng ngắt kết nối và kết nối lại Jira.',
          code: 'INSUFFICIENT_SCOPES',
          requiresReauth: true,
          details: responseData?.message
        });
      }
      
      // Lỗi 401 khác
      console.log('🔴 [Get Jira Projects] Unauthorized - YÊU CẦU REAUTH');
      return res.status(401).json({
        error: 'Jira token không hợp lệ. Vui lòng kết nối lại Jira.',
        code: 'UNAUTHORIZED',
        requiresReauth: true
      });
    }

    // Lỗi khác (không phải 401) - KHÔNG NÊN LOGOUT USER!
    const status = error.response?.status || 500;
    console.log(`⚠️ [Get Jira Projects] Lỗi ${status} - KHÔNG YÊU CẦU LOGOUT`);
    
    return res.status(status).json({ 
      error: error.message || 'Lỗi khi lấy danh sách Jira projects',
      code: error.code || 'UNKNOWN_ERROR'
    });
  }
};

/**
 * GET /api/integrations/jira/boards?projectKey=SCRUM
 * Lấy danh sách boards của một Jira project
 */
exports.getJiraBoards = async (req, res) => {
  try {
    const { projectKey } = req.query;
    const user = req.user;
    const jira = user.integrations?.jira;
    
    if (!projectKey) {
      return res.status(400).json({ error: 'Thiếu projectKey trong query params' });
    }

    // Sanitize project key
    const cleanProjectKey = sanitizeJiraProjectKey(projectKey);
    if (!cleanProjectKey) {
      return res.status(400).json({ error: 'Project key không hợp lệ' });
    }

    console.log('🔍 [Get Jira Boards] Request from user:', user.email);
    console.log('   - Project key:', cleanProjectKey);
    console.log('   - Has Jira integration?', !!jira);
    console.log('   - Has accessToken?', !!jira?.accessToken);
    console.log('   - Has refreshToken?', !!jira?.refreshToken);
    console.log('   - Has cloudId?', jira?.cloudId);

    if (!jira?.accessToken || !jira?.cloudId) {
      console.log('   ❌ [Get Jira Boards] Missing Jira integration');
      return res.status(400).json({ 
        error: 'Chưa kết nối Jira. Vui lòng kết nối Jira trước.',
        code: 'JIRA_NOT_CONNECTED'
      });
    }

    const { clientId, clientSecret } = getAtlassianConfig(req);

    // Sử dụng JiraSyncService với auto-refresh
    const boards = await JiraSyncService.syncWithAutoRefresh({
      user: req.user,
      clientId,
      clientSecret,
      syncFunction: async (client) => {
        // Callback để refresh token
        const onTokenRefresh = async () => {
          console.log('🔄 [Get Jira Boards] onTokenRefresh triggered');
          
          if (!jira.refreshToken) {
            console.error('❌ [Get Jira Boards] No refreshToken available!');
            const error = new Error('Không có refresh_token. Vui lòng kết nối lại Jira.');
            error.code = 'REFRESH_TOKEN_MISSING';
            throw error;
          }
          
          const { accessToken, refreshToken } = await JiraAuthService.refreshAccessToken({
            clientId,
            clientSecret,
            refreshToken: jira.refreshToken
          });
          
          req.user.integrations.jira.accessToken = accessToken;
          req.user.integrations.jira.refreshToken = refreshToken;
          await req.user.save();
          
          return accessToken;
        };

        return await JiraSyncService.fetchBoards({
          accessToken: jira.accessToken,
          cloudId: jira.cloudId,
          projectKey: cleanProjectKey,
          onTokenRefresh
        });
      }
    });

    console.log('✅ [Get Jira Boards] Success:', boards.length, 'boards');
    return res.json({ 
      projectKey: cleanProjectKey,
      total: boards.length, 
      boards 
    });
  } catch (error) {
    console.error('❌ [Get Jira Boards] Error:', error.message);
    console.error('   - Error code:', error.code);
    console.error('   - Response status:', error.response?.status);
    console.error('   - Response data:', JSON.stringify(error.response?.data, null, 2));
    
    // Phân loại lỗi chi tiết
    if (error.code === 'REFRESH_TOKEN_EXPIRED') {
      console.log('🔴 [Get Jira Boards] Refresh token hết hạn - YÊU CẦU REAUTH');
      return res.status(401).json({
        error: 'Jira token đã hết hạn. Vui lòng ngắt kết nối và kết nối lại Jira.',
        code: 'TOKEN_EXPIRED',
        requiresReauth: true
      });
    }
    
    if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'INVALID_REFRESH_TOKEN') {
      console.log('🔴 [Get Jira Boards] Refresh token thiếu hoặc invalid - YÊU CẦU REAUTH');
      return res.status(401).json({
        error: 'Jira refresh token không hợp lệ. Vui lòng kết nối lại Jira với scope "offline_access".',
        code: 'REFRESH_TOKEN_INVALID',
        requiresReauth: true
      });
    }

    // Lỗi 401 nhưng không phải refresh token issue
    if (error.response?.status === 401) {
      const responseData = error.response?.data;
      
      // Check nếu là lỗi scope (ĐẶC BIỆT CHO JIRA SOFTWARE!)
      if (responseData?.message?.includes('scope')) {
        console.log('🔴 [Get Jira Boards] Token THIẾU SCOPES - YÊU CẦU RECONNECT');
        console.log('   ⚠️  Có thể thiếu: read:board-scope:jira-software');
        return res.status(401).json({
          error: 'Jira token thiếu quyền truy cập boards (Agile API). Vui lòng ngắt kết nối và kết nối lại Jira.',
          code: 'INSUFFICIENT_SCOPES',
          requiresReauth: true,
          details: 'Thiếu scope: read:board-scope:jira-software hoặc read:sprint:jira-software',
          hint: 'Vào Atlassian Console → Permissions → Jira Software → Tick "View boards and sprints"'
        });
      }
      
      // Lỗi 401 khác
      console.log('🔴 [Get Jira Boards] Unauthorized - YÊU CẦU REAUTH');
      return res.status(401).json({
        error: 'Jira token không hợp lệ. Vui lòng kết nối lại Jira.',
        code: 'UNAUTHORIZED',
        requiresReauth: true
      });
    }

    // Lỗi khác (không phải 401) - KHÔNG NÊN LOGOUT USER!
    const status = error.response?.status || 500;
    console.log(`⚠️ [Get Jira Boards] Lỗi ${status} - KHÔNG YÊU CẦU LOGOUT`);
    
    return res.status(status).json({ 
      error: error.message || 'Lỗi khi lấy danh sách boards',
      code: error.code || 'UNKNOWN_ERROR'
    });
  }
};

// =========================
// DISCONNECT APIs
// =========================
exports.disconnectGithub = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    // Kiểm tra xem đã kết nối GitHub chưa
    if (!user.integrations?.github?.githubId) {
      return res.status(400).json({ error: 'Chưa kết nối GitHub. Không có gì để ngắt kết nối.' });
    }

    // Xóa thông tin GitHub integration
    // Đảm bảo integrations object tồn tại trước khi xóa
    user.integrations = user.integrations || {};
    
    // Xóa field github (delete thay vì set null để clean hơn)
    delete user.integrations.github;
    
    // Nếu integrations trở thành empty object sau khi xóa github, có thể giữ nguyên hoặc set về {}
    // Mongoose sẽ tự xử lý với Schema.Types.Mixed
    
    await user.save();

    return res.json({ 
      message: '✅ Đã ngắt kết nối GitHub thành công!',
      github: null
    });
  } catch (error) {
    console.error('❌ [Disconnect GitHub] Lỗi:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.disconnectJira = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    // Kiểm tra xem đã kết nối Jira chưa
    if (!user.integrations?.jira?.jiraAccountId) {
      return res.status(400).json({ error: 'Chưa kết nối Jira. Không có gì để ngắt kết nối.' });
    }

    // Xóa thông tin Jira integration
    // Đảm bảo integrations object tồn tại trước khi xóa
    user.integrations = user.integrations || {};
    
    // Xóa field jira (delete thay vì set null để clean hơn)
    delete user.integrations.jira;
    
    // Nếu integrations trở thành empty object sau khi xóa jira, có thể giữ nguyên hoặc set về {}
    // Mongoose sẽ tự xử lý với Schema.Types.Mixed
    
    await user.save();

    return res.json({ 
      message: '✅ Đã ngắt kết nối Jira thành công!',
      jira: null
    });
  } catch (error) {
    console.error('❌ [Disconnect Jira] Lỗi:', error);
    return res.status(500).json({ error: error.message });
  }
};

// =========================
// SYNC APIs (User tự sync data)
// =========================
exports.syncMyProjectData = async (req, res) => {
  try {
    const user = req.user;
    const { projectId } = req.params;
    
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    // Lấy project
    const Project = models.Project;
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Không tìm thấy project' });
    }

    // Kiểm tra user có quyền sync không (phải là leader hoặc member)
    const isLeader = project.leader_id.toString() === user._id.toString();
    const isMember = project.members.some(m => m.toString() === user._id.toString());
    
    if (!isLeader && !isMember) {
      return res.status(403).json({ error: 'Bạn không có quyền sync project này' });
    }

    // Tìm team từ project (thông qua TeamMember có project_id) để check role
    let userRoleInTeam = null;
    let teamId = null;
    const TeamMember = models.TeamMember;
    const teamMember = await TeamMember.findOne({
      project_id: project._id,
      student_id: user._id
    });
    if (teamMember) {
      teamId = teamMember.team_id;
      userRoleInTeam = teamMember.role_in_team || null;
    }

    const results = { github: 0, jira: 0, errors: [] };
    const GithubCommit = models.GithubCommit;
    const { Sprint, JiraTask } = require('../models/JiraData');
    const Team = models.Team;
    const axios = require('axios');

    // Log thông tin project để debug
    console.log(`🔄 [Sync] Bắt đầu sync project "${project.name}" (ID: ${project._id})`);
    console.log(`   📦 GitHub Repo: ${project.githubRepoUrl || '(không có)'}`);
    console.log(`   📦 Jira Project Key: ${project.jiraProjectKey || '(không có)'}`);
    console.log(`   👤 User: ${user.email} (${user._id})`);

    // ==========================================
    // SYNC GITHUB (nếu có token và repo URL) - ALL BRANCHES
    // ==========================================
    if (user.integrations?.github?.accessToken && project.githubRepoUrl) {
      console.log(`🔄 [Sync GitHub] Đang sync repo: ${project.githubRepoUrl}`);
      try {
        // REFACTORED: Fetch commits từ TẤT CẢ branches
        const commits = await GithubService.fetchCommits(
          project.githubRepoUrl, 
          user.integrations.github.accessToken,
          {
            maxCommitsPerBranch: 100, // Max commits per branch
            includeBranchInfo: true   // Lưu thông tin branches vào DB
          }
        );
        
        console.log(`   📊 Total unique commits: ${commits.length}`);

        let syncedCommits = 0;
        for (const commit of commits) {
          // Nếu có teamId thì dùng logic processCommit
          if (teamId) {
            // Nếu là member, chỉ sync commits của chính mình
            if (userRoleInTeam === 'Member' && commit.author_email?.toLowerCase() !== user.email?.toLowerCase()) {
              continue; // Bỏ qua commit không phải của user
            }

            const checkResult = await GithubCommit.processCommit(commit, teamId);
            await GithubCommit.findOneAndUpdate(
              // Upsert theo (team_id + hash) để tránh trộn dữ liệu
              // giữa các team có chung history/repo.
              { team_id: teamId, hash: commit.hash },
              {
                team_id: teamId,
                author_email: commit.author_email,
                author_name: commit.author_name,
                message: commit.message,
                commit_date: commit.commit_date,
                url: commit.url,
                branches: commit.branches || [], // Lưu danh sách branches
                is_counted: checkResult.is_counted,
                rejection_reason: checkResult.reason
              },
              { upsert: true, new: true }
            );
            syncedCommits++;
          } else {
            // Nếu không có team, bỏ qua commit này (vì schema yêu cầu team_id)
            console.log('⚠️ Bỏ qua commit vì không tìm thấy team cho project');
          }
        }
        results.github = syncedCommits;
        console.log(`✅ [Sync GitHub] Đã sync ${syncedCommits} commits từ tất cả branches`);
      } catch (err) {
        console.error('❌ [Sync GitHub] Lỗi:', err.message);
        if (err.message.includes('token không hợp lệ')) {
          results.errors.push('GitHub token đã hết hạn. Vui lòng kết nối lại GitHub.');
        } else {
          results.errors.push(`GitHub Error: ${err.message}`);
        }
      }
    } else {
      if (!user.integrations?.github?.accessToken) {
        results.errors.push('Chưa kết nối GitHub. Vui lòng link GitHub trước.');
        console.log('⚠️ [Sync GitHub] User chưa link GitHub');
      }
      if (!project.githubRepoUrl) {
        results.errors.push('Project chưa có GitHub repo URL.');
        console.log('⚠️ [Sync GitHub] Project chưa có GitHub repo URL');
      }
    }

    // ==========================================
    // SYNC JIRA (nếu có token và project key) - SỬ DỤNG JiraSyncService
    // ==========================================
    if (user.integrations?.jira?.accessToken && user.integrations?.jira?.cloudId && project.jiraProjectKey) {
      const cleanProjectKey = sanitizeJiraProjectKey(project.jiraProjectKey);
      
      if (!cleanProjectKey) {
        results.errors.push('Jira Project Key không hợp lệ. Vui lòng kiểm tra lại.');
        return res.json({
          message: '✅ Đồng bộ dữ liệu hoàn tất!',
          stats: results
        });
      }

      console.log(`🔄 [Sync Jira] Đang sync dự án: "${cleanProjectKey}"`);
      
      try {
        const { clientId, clientSecret } = getAtlassianConfig(req);

        // Sử dụng JiraSyncService với auto-refresh
        const issues = await JiraSyncService.syncWithAutoRefresh({
          user,
          clientId,
          clientSecret,
          syncFunction: async (client) => {
            return await JiraSyncService.fetchAllProjectIssues({
              client,
              projectKey: cleanProjectKey
            });
          }
        });

        // Tạo hoặc lấy sprint mặc định cho project (nếu có team)
        let defaultSprintId = null;
        if (teamId) {
          const defaultSprint = await Sprint.findOneAndUpdate(
            { team_id: teamId, name: 'Default Sprint' },
            {
              team_id: teamId,
              jira_sprint_id: 0,
              name: 'Default Sprint',
              state: 'active',
              start_date: new Date(),
              end_date: null
            },
            { upsert: true, new: true }
          );
          defaultSprintId = defaultSprint._id;
        }

        let syncedTasks = 0;
        for (const issue of issues) {
          if (!defaultSprintId) {
            console.log('⚠️ Bỏ qua Jira task vì không có sprint cho project');
            continue;
          }

          let assigneeMemberId = null;
          if (issue.fields.assignee?.accountId && teamId) {
            const member = await TeamMember.findOne({
              team_id: teamId,
              jira_account_id: issue.fields.assignee.accountId
            }).select('_id');
            assigneeMemberId = member ? member._id : null;
          }

          await JiraTask.findOneAndUpdate(
            { issue_id: issue.id },
            {
              sprint_id: defaultSprintId,
              assignee_id: assigneeMemberId,
              issue_key: issue.key,
              issue_id: issue.id,
              summary: issue.fields.summary || '',
              status_name: issue.fields.status?.name || '',
              status_category: issue.fields.status?.statusCategory?.key || '',
              assignee_account_id: issue.fields.assignee?.accountId || null,
              assignee_name: issue.fields.assignee?.displayName || null,
              story_point: issue.fields.customfield_10026 || null, // Story Points
              created_at: issue.fields.created ? new Date(issue.fields.created) : undefined,
              updated_at: issue.fields.updated ? new Date(issue.fields.updated) : new Date()
            },
            { upsert: true, new: true }
          );
          syncedTasks++;
        }
        results.jira = syncedTasks;
        console.log(`✅ [Sync Jira] Đã sync ${syncedTasks} tasks`);

      } catch (jiraErr) {
        console.error('❌ [Sync Jira] Lỗi:', jiraErr.message);
        
        if (jiraErr.code === 'REFRESH_TOKEN_EXPIRED') {
          results.errors.push('Token Jira đã hết hạn. Vui lòng kết nối lại Jira.');
        } else {
          const status = jiraErr.response?.status;
          if (status === 404 || status === 410) {
            const message = status === 404 
              ? `Không tìm thấy Jira Project có Key "${cleanProjectKey}". Kiểm tra lại Project Key trên Jira!`
              : 'Jira project không còn tồn tại (410). GitHub đã đồng bộ bình thường.';
            results.errors.push(message);
          } else {
            results.errors.push(`Jira Error: ${jiraErr.message}`);
          }
        }
      }
    } else {
      if (!user.integrations?.jira?.accessToken) {
        results.errors.push('Chưa kết nối Jira. Vui lòng link Jira trước.');
        console.log('⚠️ [Sync Jira] User chưa link Jira');
      }
      if (!project.jiraProjectKey) {
        results.errors.push('Project chưa có Jira project key.');
        console.log('⚠️ [Sync Jira] Project chưa có Jira project key');
      }
    }

    console.log(`✅ [Sync] Hoàn tất: GitHub=${results.github}, Jira=${results.jira}, Errors=${results.errors.length}`);
    
    return res.json({
      message: '✅ Đồng bộ dữ liệu hoàn tất!',
      stats: results
    });

  } catch (error) {
    console.error('Sync Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// =========================
// GET DATA APIs (Phân quyền Leader/Member)
// =========================

/**
 * GET /api/integrations/my-commits
 * Member: Lấy commits GitHub của chính mình
 */
exports.getMyCommits = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    // Lấy project của user
    const Project = models.Project;
    const project = await Project.findOne({
      $or: [
        { leader_id: user._id },
        { members: user._id }
      ]
    });

    if (!project) {
      return res.json({ 
        total: 0,
        commits: [],
        message: 'Bạn chưa tham gia project nào'
      });
    }

    // Tìm team từ project (thông qua TeamMember có project_id)
    let teamId = null;
    const TeamMember = models.TeamMember;
    const teamMember = await TeamMember.findOne({
      project_id: project._id,
      student_id: user._id
    });
    if (teamMember) {
      teamId = teamMember.team_id;
    }

    const GithubCommit = models.GithubCommit;
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));

    // Lấy commits của user (theo email)
    let commits = [];
    if (teamId && user.email) {
      commits = await GithubCommit.find({
        team_id: teamId,
        author_email: user.email.toLowerCase()
      })
      .sort({ commit_date: -1 })
      .limit(limit)
      .lean();
    }

    return res.json({
      project: {
        _id: project._id,
        name: project.name
      },
      total: commits.length,
      commits: commits
    });

  } catch (error) {
    console.error('Get My Commits Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/integrations/my-tasks
 * Member: Lấy tasks Jira của chính mình
 */
exports.getMyTasks = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    // Lấy project của user
    const Project = models.Project;
    const project = await Project.findOne({
      $or: [
        { leader_id: user._id },
        { members: user._id }
      ]
    });

    if (!project) {
      return res.json({ 
        total: 0,
        tasks: [],
        message: 'Bạn chưa tham gia project nào'
      });
    }

    // Tìm team từ project (thông qua TeamMember có project_id)
    let teamId = null;
    const TeamMember = models.TeamMember;
    const teamMember = await TeamMember.findOne({
      project_id: project._id,
      student_id: user._id
    });
    if (teamMember) {
      teamId = teamMember.team_id;
    }

    const { Sprint, JiraTask } = require('../models/JiraData');
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));

    // Lấy tasks của user (theo jira_account_id)
    let tasks = [];
    if (teamId) {
      // Tìm team member của user
      const teamMember = await TeamMember.findOne({
        team_id: teamId,
        student_id: user._id
      });

      if (teamMember?.jira_account_id) {
        const sprints = await Sprint.find({ team_id: teamId }).select('_id').lean();
        const sprintIds = sprints.map(s => s._id);

        // Filter theo status nếu có
        const statusFilter = req.query.status;
        let query = {
          sprint_id: { $in: sprintIds },
          assignee_account_id: teamMember.jira_account_id
        };
        
        if (statusFilter) {
          query.$or = [
            { status_category: statusFilter },
            { status_name: statusFilter }
          ];
        }

        tasks = await JiraTask.find(query)
        .populate({
          path: 'sprint_id',
          select: 'name state'
        })
        .sort({ updated_at: -1 })
        .limit(limit)
        .lean();
      }
    }

    return res.json({
      project: {
        _id: project._id,
        name: project.name
      },
      total: tasks.length,
      tasks: tasks
    });

  } catch (error) {
    console.error('Get My Tasks Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/integrations/team/:teamId/commits
 * Leader: Lấy commits GitHub của cả team
 */
exports.getTeamCommits = async (req, res) => {
  try {
    const user = req.user;
    const { teamId } = req.params;
    
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    const Team = models.Team;
    const TeamMember = models.TeamMember;
    const GithubCommit = models.GithubCommit;

    // Kiểm tra team tồn tại
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Không tìm thấy team' });
    }

    // Kiểm tra user có phải leader không
    const teamMember = await TeamMember.findOne({
      team_id: teamId,
      student_id: user._id
    });

    if (!teamMember || teamMember.role_in_team !== 'Leader') {
      return res.status(403).json({ error: 'Chỉ Leader mới có quyền xem commits của cả team' });
    }

    // Lấy tất cả members
    const members = await TeamMember.find({ team_id: teamId })
      .populate('student_id', 'student_code email full_name')
      .lean();

    const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 100)));

    // Lấy tất cả commits của team
    const allCommits = await GithubCommit.find({ team_id: teamId })
      .sort({ commit_date: -1 })
      .limit(limit)
      .lean();

    // Phân loại commits theo member
    const commitsByMember = members.map(member => {
      const email = (member.student_id?.email || '').toLowerCase();
      const memberCommits = allCommits.filter(c => 
        c.author_email?.toLowerCase() === email
      );

      return {
        member: {
          _id: member._id,
          student: member.student_id,
          role_in_team: member.role_in_team,
          github_username: member.github_username
        },
        total: memberCommits.length,
        commits: memberCommits
      };
    });

    return res.json({
      team: {
        _id: team._id,
        project_name: team.project_name
      },
      summary: {
        total_members: members.length,
        total_commits: allCommits.length
      },
      members_commits: commitsByMember
    });

  } catch (error) {
    console.error('Get Team Commits Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/integrations/team/:teamId/tasks
 * Leader: Lấy tasks Jira của cả team
 */
exports.getTeamTasks = async (req, res) => {
  try {
    const user = req.user;
    const { teamId } = req.params;
    
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    const Team = models.Team;
    const TeamMember = models.TeamMember;
    const { Sprint, JiraTask } = require('../models/JiraData');

    // Kiểm tra team tồn tại
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Không tìm thấy team' });
    }

    // Kiểm tra user có phải leader không
    const teamMember = await TeamMember.findOne({
      team_id: teamId,
      student_id: user._id
    });

    if (!teamMember || teamMember.role_in_team !== 'Leader') {
      return res.status(403).json({ error: 'Chỉ Leader mới có quyền xem tasks của cả team' });
    }

    // Lấy tất cả members
    const members = await TeamMember.find({ team_id: teamId })
      .populate('student_id', 'student_code email full_name')
      .lean();

    const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 100)));
    const statusFilter = req.query.status;

    // Lấy tất cả tasks của team
    const sprints = await Sprint.find({ team_id: teamId }).select('_id').lean();
    const sprintIds = sprints.map(s => s._id);
    
    let query = { sprint_id: { $in: sprintIds } };
    if (statusFilter) {
      query.$or = [
        { status_category: statusFilter },
        { status_name: statusFilter }
      ];
    }

    const allTasks = await JiraTask.find(query)
      .populate({
        path: 'sprint_id',
        select: 'name state'
      })
      .sort({ updated_at: -1 })
      .limit(limit)
      .lean();

    // Phân loại tasks theo member
    const tasksByMember = members.map(member => {
      const jiraAccountId = member.jira_account_id;
      const memberTasks = allTasks.filter(t => 
        t.assignee_account_id === jiraAccountId
      );

      return {
        member: {
          _id: member._id,
          student: member.student_id,
          role_in_team: member.role_in_team,
          jira_account_id: member.jira_account_id
        },
        total: memberTasks.length,
        tasks: memberTasks
      };
    });

    return res.json({
      team: {
        _id: team._id,
        project_name: team.project_name
      },
      summary: {
        total_members: members.length,
        total_tasks: allTasks.length
      },
      members_tasks: tasksByMember
    });

  } catch (error) {
    console.error('Get Team Tasks Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/integrations/team/:teamId/member/:memberId/commits
 * Leader: Lấy commits GitHub của một member cụ thể
 */
exports.getMemberCommits = async (req, res) => {
  try {
    const user = req.user;
    const { teamId, memberId } = req.params;
    
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    const Team = models.Team;
    const TeamMember = models.TeamMember;
    const GithubCommit = models.GithubCommit;

    // Kiểm tra team tồn tại
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Không tìm thấy team' });
    }

    // Kiểm tra user có phải leader không
    const currentUserMember = await TeamMember.findOne({
      team_id: teamId,
      student_id: user._id
    });

    if (!currentUserMember || currentUserMember.role_in_team !== 'Leader') {
      return res.status(403).json({ error: 'Chỉ Leader mới có quyền xem commits của member khác' });
    }

    // Lấy member cần xem
    const member = await TeamMember.findById(memberId)
      .populate('student_id', 'student_code email full_name')
      .lean();

    if (!member || member.team_id.toString() !== teamId) {
      return res.status(404).json({ error: 'Không tìm thấy member trong team này' });
    }

    const email = (member.student_id?.email || '').toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));

    // Lấy commits của member
    const commits = await GithubCommit.find({
      team_id: teamId,
      author_email: email
    })
    .sort({ commit_date: -1 })
    .limit(limit)
    .lean();

    return res.json({
      member: {
        _id: member._id,
        student: member.student_id,
        role_in_team: member.role_in_team,
        github_username: member.github_username
      },
      total: commits.length,
      commits: commits
    });

  } catch (error) {
    console.error('Get Member Commits Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/integrations/team/:teamId/member/:memberId/tasks
 * Leader: Lấy tasks Jira của một member cụ thể
 */
exports.getMemberTasks = async (req, res) => {
  try {
    const user = req.user;
    const { teamId, memberId } = req.params;
    
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy user' });
    }

    const Team = models.Team;
    const TeamMember = models.TeamMember;
    const { Sprint, JiraTask } = require('../models/JiraData');

    // Kiểm tra team tồn tại
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Không tìm thấy team' });
    }

    // Kiểm tra user có phải leader không
    const currentUserMember = await TeamMember.findOne({
      team_id: teamId,
      student_id: user._id
    });

    if (!currentUserMember || currentUserMember.role_in_team !== 'Leader') {
      return res.status(403).json({ error: 'Chỉ Leader mới có quyền xem tasks của member khác' });
    }

    // Lấy member cần xem
    const member = await TeamMember.findById(memberId)
      .populate('student_id', 'student_code email full_name')
      .lean();

    if (!member || member.team_id.toString() !== teamId) {
      return res.status(404).json({ error: 'Không tìm thấy member trong team này' });
    }

    const jiraAccountId = member.jira_account_id;
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
    const statusFilter = req.query.status;

    // Lấy tasks của member
    const sprints = await Sprint.find({ team_id: teamId }).select('_id').lean();
    const sprintIds = sprints.map(s => s._id);
    
    let query = {
      sprint_id: { $in: sprintIds },
      assignee_account_id: jiraAccountId
    };
    
    if (statusFilter) {
      query.$or = [
        { status_category: statusFilter },
        { status_name: statusFilter }
      ];
    }

    const tasks = await JiraTask.find(query)
    .populate({
      path: 'sprint_id',
      select: 'name state'
    })
    .sort({ updated_at: -1 })
    .limit(limit)
    .lean();

    return res.json({
      member: {
        _id: member._id,
        student: member.student_id,
        role_in_team: member.role_in_team,
        jira_account_id: member.jira_account_id
      },
      total: tasks.length,
      tasks: tasks
    });

  } catch (error) {
    console.error('Get Member Tasks Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

