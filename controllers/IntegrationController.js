const models = require('../models');
const IntegrationService = require('../services/IntegrationService');
const GithubService = require('../services/GithubService');
const JiraService = require('../services/JiraService');
const mongoose = require('mongoose');

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
// GITHUB: CONNECT + CALLBACK
// =========================
exports.githubConnect = async (req, res) => {
  try {
    const { clientId, redirectUri } = getGithubConfig(req);
    
    // Frontend có thể truyền redirect_uri để redirect về sau khi callback (cho dev local)
    // Nếu không có thì dùng CLIENT_URL từ env
    const frontendRedirectUri = req.query.redirect_uri || process.env.CLIENT_URL || 'http://localhost:3000';

    // State JWT: chứa userId + role và frontendRedirectUri để callback biết redirect về đâu
    const state = IntegrationService.signOAuthState({
      provider: 'github',
      userId: req.userId,
      role: req.role,
      frontendRedirectUri // Lưu URL frontend để redirect về sau
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

    // Redirect về frontend sau khi thành công
    // Dùng frontendRedirectUri từ state (đã được frontend truyền khi connect) hoặc fallback về CLIENT_URL
    const frontendUrl = decoded.frontendRedirectUri || process.env.CLIENT_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/callback/github?success=true&username=${encodeURIComponent(ghUser.username)}`);
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
    
    // Frontend có thể truyền redirect_uri để redirect về sau khi callback (cho dev local)
    // Nếu không có thì dùng CLIENT_URL từ env
    const frontendRedirectUri = req.query.redirect_uri || process.env.CLIENT_URL || 'http://localhost:3000';

    const state = IntegrationService.signOAuthState({
      provider: 'jira',
      userId: req.userId,
      role: req.role,
      frontendRedirectUri // Lưu URL frontend để redirect về sau
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

    // 1) Lấy cloudId và jira_url từ accessible-resources
    const resources = await IntegrationService.fetchAtlassianAccessibleResources(accessToken);
    if (!resources.length) {
      return res.status(400).json({ error: 'Không lấy được accessible-resources từ Atlassian' });
    }

    // Comment VN: Nếu user có nhiều site Jira, tạm lấy resource đầu tiên.
    // Có thể nâng cấp: FE gửi cloudId mong muốn để chọn đúng site.
    const selectedResource = resources[0];
    const cloudId = selectedResource.id;
    // Lấy jira_url từ resource (có thể là url hoặc scopes)
    const jiraUrl = selectedResource.url || `https://${selectedResource.id}.atlassian.net`;

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
      jiraUrl, // Tự động lấy Jira URL
      email: me.email,
      accessToken,
      refreshToken,
      linkedAt: new Date()
    };
    await user.save();
    
    console.log(`✅ [Jira Connect] Đã lưu integration cho user ${user.email}:`);
    console.log(`   - Jira URL: ${jiraUrl}`);
    console.log(`   - Cloud ID: ${cloudId}`);
    console.log(`   - Account ID: ${me.jiraAccountId}`);

    // Redirect về frontend sau khi thành công
    // Dùng frontendRedirectUri từ state (đã được frontend truyền khi connect) hoặc fallback về CLIENT_URL
    const frontendUrl = decoded.frontendRedirectUri || process.env.CLIENT_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/callback/jira?success=true&accountId=${encodeURIComponent(me.jiraAccountId)}`);
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

/**
 * GET /api/integrations/jira/boards?projectKey=SCRUM
 * Lấy danh sách boards của một Jira project
 */
exports.getJiraBoards = async (req, res) => {
  try {
    const jira = req.user?.integrations?.jira;
    if (!jira?.accessToken || !jira?.cloudId) {
      return res.status(400).json({ error: 'Chưa kết nối Jira. Vui lòng link Jira trước.' });
    }

    const { projectKey } = req.query;
    if (!projectKey) {
      return res.status(400).json({ error: 'Thiếu projectKey trong query params' });
    }

    // Sanitize project key
    const sanitizeJiraProjectKey = (input) => {
      if (!input || typeof input !== 'string') return '';
      let cleaned = input.trim();
      const bracketMatch = cleaned.match(/^\[([^\]]+)\]/);
      if (bracketMatch) cleaned = bracketMatch[1];
      cleaned = cleaned.trim().replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
      return cleaned;
    };
    
    const cleanProjectKey = sanitizeJiraProjectKey(projectKey);
    if (!cleanProjectKey) {
      return res.status(400).json({ error: 'Project key không hợp lệ' });
    }

    const { clientId, clientSecret } = getAtlassianConfig(req);

    // Try 1 lần; nếu token hết hạn thì refresh và retry
    try {
      const boards = await IntegrationService.fetchJiraBoards({
        accessToken: jira.accessToken,
        cloudId: jira.cloudId,
        projectKey: cleanProjectKey
      });
      return res.json({ 
        projectKey: cleanProjectKey,
        total: boards.length, 
        boards 
      });
    } catch (err) {
      const status = err.response?.status;
      if ((status === 401 || status === 403) && jira.refreshToken) {
        const refreshed = await IntegrationService.refreshAtlassianAccessToken({
          clientId,
          clientSecret,
          refreshToken: jira.refreshToken
        });

        req.user.integrations.jira.accessToken = refreshed.accessToken;
        req.user.integrations.jira.refreshToken = refreshed.refreshToken;
        await req.user.save();

        const boards = await IntegrationService.fetchJiraBoards({
          accessToken: refreshed.accessToken,
          cloudId: jira.cloudId,
          projectKey: cleanProjectKey
        });
        return res.json({ 
          projectKey: cleanProjectKey,
          total: boards.length, 
          boards 
        });
      }
      throw err;
    }
  } catch (error) {
    console.error('Get Jira Boards Error:', error);
    return res.status(500).json({ error: error.message });
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
    user.integrations = user.integrations || {};
    user.integrations.github = null;
    await user.save();

    return res.json({ 
      message: '✅ Đã ngắt kết nối GitHub thành công!',
      github: null
    });
  } catch (error) {
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
    user.integrations = user.integrations || {};
    user.integrations.jira = null;
    await user.save();

    return res.json({ 
      message: '✅ Đã ngắt kết nối Jira thành công!',
      jira: null
    });
  } catch (error) {
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
    // SYNC GITHUB (nếu có token và repo URL)
    // ==========================================
    if (user.integrations?.github?.accessToken && project.githubRepoUrl) {
      console.log(`🔄 [Sync GitHub] Đang sync repo: ${project.githubRepoUrl}`);
      try {
        const commits = await GithubService.fetchCommits(
          project.githubRepoUrl, 
          user.integrations.github.accessToken
        );
        
        // teamId đã được tìm ở trên (trong phần check quyền)

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
              { hash: commit.hash },
              {
                team_id: teamId,
                author_email: commit.author_email,
                message: commit.message,
                commit_date: commit.commit_date,
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
        console.log(`✅ [Sync GitHub] Đã sync ${syncedCommits} commits`);
      } catch (err) {
        console.error('❌ [Sync GitHub] Lỗi:', err.message);
        results.errors.push(`GitHub Error: ${err.message}`);
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
    // SYNC JIRA (nếu có token và project key)
    // ==========================================
    if (user.integrations?.jira?.accessToken && user.integrations?.jira?.cloudId && project.jiraProjectKey) {
      // Sanitize projectKey: loại bỏ "[SCRUM]", trim, uppercase
      const cleanProjectKey = sanitizeJiraProjectKey(project.jiraProjectKey);
      
      if (!cleanProjectKey) {
        results.errors.push('Jira Project Key không hợp lệ. Vui lòng kiểm tra lại.');
        return res.json({
          message: '✅ Đồng bộ dữ liệu hoàn tất!',
          stats: results
        });
      }

      const cloudId = user.integrations.jira.cloudId;
      const jiraApiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search`;
      
      console.log(`🔄 [Sync Jira] Đang sync dự án: "${cleanProjectKey}" với CloudID: ${cloudId}`);
      
      const doJiraSearch = (token) =>
        axios.get(jiraApiUrl, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          params: {
            jql: `project = "${cleanProjectKey}"`, // Dấu ngoặc kép để tránh lỗi JQL
            maxResults: 100,
            fields: 'summary,status,assignee,created,updated,issuetype,storyPoints'
          }
        });

      let jiraResponse = null;
      let accessToken = user.integrations.jira.accessToken;
      try {
        jiraResponse = await doJiraSearch(accessToken);
      } catch (jiraErr) {
        const status = jiraErr.response?.status;
        if ((status === 401 || status === 403) && user.integrations?.jira?.refreshToken) {
          try {
            const { clientId, clientSecret } = getAtlassianConfig(req);
            const refreshed = await IntegrationService.refreshAtlassianAccessToken({
              clientId,
              clientSecret,
              refreshToken: user.integrations.jira.refreshToken
            });
            user.integrations.jira.accessToken = refreshed.accessToken;
            user.integrations.jira.refreshToken = refreshed.refreshToken ?? user.integrations.jira.refreshToken;
            await user.save();
            jiraResponse = await doJiraSearch(refreshed.accessToken);
          } catch (refreshErr) {
            console.error('Lỗi Sync Jira (refresh token thất bại):', refreshErr.message);
            results.errors.push('Token Jira đã hết hạn. Vui lòng kết nối lại Jira.');
          }
        } else if (status === 404 || status === 410) {
          // 404: Project không tồn tại (key sai hoặc không có quyền)
          // 410: Project đã bị xóa
          const message = status === 404 
            ? `Không tìm thấy Jira Project có Key "${cleanProjectKey}". Kiểm tra lại Project Key trên Jira!`
            : 'Jira project không còn tồn tại (410). GitHub đã đồng bộ bình thường.';
          results.errors.push(message);
          console.warn(`⚠️ [Sync Jira] ${status === 404 ? '404' : '410'}: Project Key "${cleanProjectKey}"`);
        } else if (status === 401 || status === 403) {
          results.errors.push('Token Jira đã hết hạn. Vui lòng kết nối lại Jira.');
        } else {
          results.errors.push(`Jira Error: ${jiraErr.message}`);
        }
      }

      if (jiraResponse && jiraResponse.data) {
        const issues = jiraResponse.data.issues || [];

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

        // Nếu là member, chỉ lấy tasks của chính mình
        let userJiraAccountId = null;
        if (userRoleInTeam === 'Member' && teamId) {
          const userTeamMember = await TeamMember.findOne({
            team_id: teamId,
            student_id: user._id
          });
          userJiraAccountId = userTeamMember?.jira_account_id;
        }

        let syncedTasks = 0;
        for (const issue of issues) {
          // Nếu không có sprint, bỏ qua task này (vì schema yêu cầu sprint_id)
          if (!defaultSprintId) {
            console.log('⚠️ Bỏ qua Jira task vì không có sprint cho project');
            continue;
          }

          // Nếu là member, chỉ sync tasks của chính mình
          if (userRoleInTeam === 'Member' && issue.fields.assignee?.accountId !== userJiraAccountId) {
            continue; // Bỏ qua task không phải của user
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
              story_point: issue.fields.storyPoints || null,
              created_at: issue.fields.created ? new Date(issue.fields.created) : undefined,
              updated_at: issue.fields.updated ? new Date(issue.fields.updated) : new Date()
            },
            { upsert: true, new: true }
          );
          syncedTasks++;
        }
        results.jira = syncedTasks;
        console.log(`✅ [Sync Jira] Đã sync ${syncedTasks} tasks`);
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

