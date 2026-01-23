const models = require('../models');
const IntegrationService = require('../services/IntegrationService');

function getClientBaseUrl(req) {
  // FE có thể truyền redirect riêng; nếu không có thì dùng env
  return process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`;
}

function getGithubConfig(req) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_CALLBACK_URL || `${getClientBaseUrl(req)}/api/integrations/github/callback`;
  if (!clientId || !clientSecret) {
    throw new Error('Thiếu cấu hình GITHUB_CLIENT_ID hoặc GITHUB_CLIENT_SECRET trong .env');
  }
  return { clientId, clientSecret, redirectUri };
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
// GITHUB: CONNECT + CALLBACK
// =========================
exports.githubConnect = async (req, res) => {
  try {
    const { clientId, redirectUri } = getGithubConfig(req);

    // State JWT: chứa userId + role để callback biết lưu vào ai (stateless, không cần session)
    const state = IntegrationService.signOAuthState({
      provider: 'github',
      userId: req.userId,
      role: req.role
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

    const { clientId, clientSecret, redirectUri } = getGithubConfig(req);
    const accessToken = await IntegrationService.exchangeGithubCodeForToken({
      clientId,
      clientSecret,
      code,
      redirectUri
    });

    const ghUser = await IntegrationService.fetchGithubUser(accessToken);
    const user = await loadUserByRole(decoded.role, decoded.userId);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user để lưu integration' });

    // Đảm bảo githubId không bị trùng với user khác
    await ensureGithubUnique(ghUser.githubId, decoded.role, user._id);

    user.integrations = user.integrations || {};
    user.integrations.github = {
      githubId: ghUser.githubId,
      username: ghUser.username,
      accessToken,
      linkedAt: new Date()
    };
    await user.save();

    // Có thể redirect về FE nếu muốn
    return res.json({
      message: '✅ Kết nối GitHub thành công!',
      github: { githubId: ghUser.githubId, username: ghUser.username }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// =========================
// JIRA (ATLASSIAN): CONNECT + CALLBACK
// =========================
exports.jiraConnect = async (req, res) => {
  try {
    const { clientId, redirectUri } = getAtlassianConfig(req);

    const state = IntegrationService.signOAuthState({
      provider: 'jira',
      userId: req.userId,
      role: req.role
    });

    // Scope bắt buộc theo yêu cầu
    const scope = 'read:jira-user read:jira-work offline_access';
    const url = IntegrationService.buildAtlassianAuthUrl({ clientId, redirectUri, scope, state });
    
    // Trả về JSON với URL thay vì redirect để frontend tự redirect (tránh lỗi CORS khi dùng XHR)
    return res.json({ redirectUrl: url });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.jiraCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ error: 'Thiếu code hoặc state từ Jira callback' });
    }

    const decoded = IntegrationService.verifyOAuthState(state);
    if (decoded.provider !== 'jira') {
      return res.status(400).json({ error: 'State không hợp lệ (provider mismatch)' });
    }

    const { clientId, clientSecret, redirectUri } = getAtlassianConfig(req);
    const { accessToken, refreshToken } = await IntegrationService.exchangeAtlassianCodeForTokens({
      clientId,
      clientSecret,
      code,
      redirectUri
    });

    // 1) Lấy cloudId (accessible-resources)
    const resources = await IntegrationService.fetchAtlassianAccessibleResources(accessToken);
    if (!resources.length) {
      return res.status(400).json({ error: 'Không lấy được accessible-resources từ Atlassian' });
    }

    // Comment VN: Nếu user có nhiều site Jira, tạm lấy resource đầu tiên.
    // Có thể nâng cấp: FE gửi cloudId mong muốn để chọn đúng site.
    const cloudId = resources[0].id;

    // 2) Lấy accountId từ /myself
    const me = await IntegrationService.fetchJiraMyself({ accessToken, cloudId });
    const user = await loadUserByRole(decoded.role, decoded.userId);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user để lưu integration' });

    // Đảm bảo jiraAccountId + cloudId không bị trùng với user khác
    await ensureJiraUnique(me.jiraAccountId, cloudId, decoded.role, user._id);

    user.integrations = user.integrations || {};
    user.integrations.jira = {
      jiraAccountId: me.jiraAccountId,
      cloudId,
      email: me.email,
      accessToken,
      refreshToken,
      linkedAt: new Date()
    };
    await user.save();

    return res.json({
      message: '✅ Kết nối Jira (Atlassian) thành công!',
      jira: { jiraAccountId: me.jiraAccountId, cloudId }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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
    return res.status(500).json({ error: error.message });
  }
};

exports.getJiraProjects = async (req, res) => {
  try {
    const jira = req.user?.integrations?.jira;
    if (!jira?.accessToken || !jira?.cloudId) {
      return res.status(400).json({ error: 'Chưa kết nối Jira. Vui lòng link Jira trước.' });
    }

    const { clientId, clientSecret } = getAtlassianConfig(req);

    // Try 1 lần; nếu token hết hạn thì refresh và retry
    try {
      const projects = await IntegrationService.fetchJiraProjects({
        accessToken: jira.accessToken,
        cloudId: jira.cloudId
      });
      return res.json({ total: projects.length, projects });
    } catch (err) {
      const status = err.response?.status;
      if ((status === 401 || status === 403) && jira.refreshToken) {
        // Comment VN: access token hết hạn → dùng refresh token xin token mới
        const refreshed = await IntegrationService.refreshAtlassianAccessToken({
          clientId,
          clientSecret,
          refreshToken: jira.refreshToken
        });

        // Lưu token mới vào DB (best-effort)
        req.user.integrations.jira.accessToken = refreshed.accessToken;
        req.user.integrations.jira.refreshToken = refreshed.refreshToken;
        await req.user.save();

        const projects = await IntegrationService.fetchJiraProjects({
          accessToken: refreshed.accessToken,
          cloudId: jira.cloudId
        });
        return res.json({ total: projects.length, projects, refreshed: true });
      }
      throw err;
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

