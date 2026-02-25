const { Sprint, JiraTask } = require('../models/JiraData');
const Team = require('../models/Team');
const JiraService = require('../services/JiraService'); // Legacy - Deprecated
const JiraSyncService = require('../services/JiraSyncService'); // OAuth version
const JiraAuthService = require('../services/JiraAuthService');
const IntegrationController = require('./IntegrationController');

// =========================
// HELPER: Lấy Jira OAuth Config
// =========================

/**
 * Lấy Jira OAuth config và client từ user
 * @param {Object} req - Express request
 * @returns {Promise<{user, jira, clientId, clientSecret, onTokenRefresh}>}
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
  
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('Thiếu ATLASSIAN_CLIENT_ID hoặc ATLASSIAN_CLIENT_SECRET trong .env');
  }
  
  // Callback để refresh token
  const onTokenRefresh = async () => {
    if (!jira.refreshToken) {
      const error = new Error('Không có refresh_token. Vui lòng đăng nhập lại Jira.');
      error.code = 'REFRESH_TOKEN_MISSING';
      throw error;
    }

    const { accessToken, refreshToken } = await JiraAuthService.refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: jira.refreshToken
    });

    user.integrations.jira.accessToken = accessToken;
    user.integrations.jira.refreshToken = refreshToken;
    await user.save();

    return accessToken;
  };
  
  return { 
    user, 
    jira, 
    clientId, 
    clientSecret, 
    onTokenRefresh,
    accessToken: jira.accessToken,
    cloudId: jira.cloudId
  };
}

// Legacy helper - Deprecated
const getJiraConfig = (team) => {
    console.warn('⚠️ [DEPRECATED] getJiraConfig() - Team Basic Auth không còn được khuyến nghị. Vui lòng dùng User OAuth.');
    if (!team.api_token_jira || !team.jira_url) {
        throw new Error("Team chưa cấu hình Jira URL hoặc Token");
    }
    return { 
        url: team.jira_url, 
        key: team.jira_project_key, 
        token: team.api_token_jira 
    };
};

// ==========================================
// 1. SPRINT CONTROLLER (GIỮ NGUYÊN CỦA BẠN)
// ==========================================

// GET: Lấy danh sách Sprint
exports.getSprintsByTeam = async (req, res) => {
    try {
        const { teamId } = req.params;
        const sprints = await Sprint.find({ team_id: teamId }).sort({ start_date: -1 });
        res.json(sprints);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// GET: Chi tiết Sprint
exports.getSprintById = async (req, res) => {
    try {
        const sprint = await Sprint.findById(req.params.id);
        if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
        res.json(sprint);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// POST: Tạo Sprint (OAuth Version)
exports.createSprint = async (req, res) => {
    try {
        const { team_id, name, start_date, end_date } = req.body;
        
        // Validate
        if (!team_id || !name) {
            return res.status(400).json({ error: 'Thiếu team_id hoặc name' });
        }
        
        const team = await Team.findById(team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        if (!team.jira_board_id) return res.status(400).json({ error: 'Team chưa có Board ID' });

        // Lấy OAuth config từ user
        const { accessToken, cloudId, onTokenRefresh } = await getJiraOAuthConfig(req);
        
        // Tạo Sprint qua OAuth
        const jiraSprint = await JiraSyncService.createSprint({
            accessToken,
            cloudId,
            boardId: team.jira_board_id,
            name,
            startDate: start_date,
            endDate: end_date,
            onTokenRefresh
        });

        // Lưu vào DB
        const newSprint = new Sprint({
            team_id: team._id,
            jira_sprint_id: jiraSprint.id,
            name: jiraSprint.name,
            state: jiraSprint.state,
            start_date: jiraSprint.startDate, 
            end_date: jiraSprint.endDate
        });

        await newSprint.save();
        res.status(201).json({ message: '✅ Tạo Sprint thành công', data: newSprint });
    } catch (error) { 
        console.error('❌ Create Sprint Error:', error.message);
        
        if (error.code === 'JIRA_NOT_CONNECTED') {
            return res.status(400).json({ error: error.message, requiresAuth: true });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        
        res.status(500).json({ error: error.message }); 
    }
};

// POST: Bắt đầu Sprint (OAuth Version)
exports.startSprint = async (req, res) => {
    try {
        const { id } = req.params;
        const { start_date, end_date } = req.body;

        const sprint = await Sprint.findById(id);
        if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

        const team = await Team.findById(sprint.team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });

        // Lấy OAuth config
        const { accessToken, cloudId, onTokenRefresh } = await getJiraOAuthConfig(req);

        // Start Sprint qua OAuth
        await JiraSyncService.startSprint({
            accessToken,
            cloudId,
            sprintId: sprint.jira_sprint_id,
            startDate: start_date,
            endDate: end_date,
            onTokenRefresh
        });

        // Update DB
        sprint.state = 'active';
        sprint.start_date = start_date;
        sprint.end_date = end_date;
        await sprint.save();

        res.json({ message: '✅ Start Sprint thành công', data: sprint });
    } catch (error) { 
        console.error('❌ Start Sprint Error:', error.message);
        
        if (error.code === 'JIRA_NOT_CONNECTED') {
            return res.status(400).json({ error: error.message, requiresAuth: true });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        
        res.status(500).json({ error: error.message }); 
    }
};

// PUT: Update Sprint (OAuth Version)
exports.updateSprint = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, state, start_date, end_date } = req.body;

        const sprint = await Sprint.findById(id);
        if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

        const team = await Team.findById(sprint.team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });

        // Lấy OAuth config
        const { accessToken, cloudId, onTokenRefresh } = await getJiraOAuthConfig(req);

        // Update Sprint qua OAuth
        await JiraSyncService.updateSprint({
            accessToken,
            cloudId,
            sprintId: sprint.jira_sprint_id,
            data: {
                name,
                state,
                startDate: start_date,
                endDate: end_date
            },
            onTokenRefresh
        });

        // Update DB
        if (name) sprint.name = name;
        if (state) sprint.state = state;
        if (start_date) sprint.start_date = start_date;
        if (end_date) sprint.end_date = end_date;
        
        await sprint.save();

        res.json({ message: '✅ Cập nhật Sprint thành công', data: sprint });

    } catch (error) {
        console.error('❌ Update Sprint Error:', error.message);
        
        if (error.code === 'JIRA_NOT_CONNECTED') {
            return res.status(400).json({ error: error.message, requiresAuth: true });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        
        res.status(500).json({ error: error.message });
    }
};

// DELETE: Xóa Sprint
exports.deleteSprint = async (req, res) => {
    try {
        await Sprint.findByIdAndDelete(req.params.id);
        res.json({ message: 'Đã xóa Sprint' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// ==========================================
// 2. TASK CONTROLLER (CẬP NHẬT LOGIC MỚI)
// ==========================================

// GET: Chi tiết Task
exports.getTaskById = async (req, res) => {
    try {
        const task = await JiraTask.findById(req.params.id).populate('sprint_id');
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json(task);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// GET: Lấy danh sách Task (Helper cho Frontend lấy tasks theo Team/Sprint)
exports.getTasks = async (req, res) => {
    try {
        const { team_id, sprint_id } = req.query;
        const query = {};
        if (team_id) query.team_id = team_id;
        if (sprint_id) query.sprint_id = sprint_id;

        const tasks = await JiraTask.find(query).sort({ updated_at: -1 });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// POST: Tạo Task (OAuth Version)
exports.createTask = async (req, res) => {
    try {
        const currentUser = req.user;
        const { 
            team_id, 
            summary, 
            description, 
            assignee_account_id, 
            reporter_account_id, 
            story_point, 
            start_date, 
            due_date,
            sprint_id
        } = req.body;

        // Validate
        if (!team_id) return res.status(400).json({ error: 'Thiếu team_id' });
        if (!summary) return res.status(400).json({ error: 'Thiếu summary (Tên task)' });

        const team = await Team.findById(team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        if (!team.jira_project_key) return res.status(400).json({ error: 'Team chưa có Jira Project Key' });

        // Lấy OAuth config
        const { accessToken, cloudId, jira, onTokenRefresh } = await getJiraOAuthConfig(req);

        // Tạo REST API client
        const client = await JiraSyncService.syncWithAutoRefresh({
            user: currentUser,
            clientId: process.env.ATLASSIAN_CLIENT_ID,
            clientSecret: process.env.ATLASSIAN_CLIENT_SECRET,
            syncFunction: async (client) => client
        });

        // Lấy custom field IDs
        const spFieldId = await JiraSyncService.getCustomFieldId(client, 'Story Points') || 'customfield_10026';
        const startDateFieldId = await JiraSyncService.getCustomFieldId(client, 'Start date') || 'customfield_10015';

        // Tạo Issue trên Jira
        const jiraResp = await JiraSyncService.createIssue({
            client,
            projectKey: team.jira_project_key,
            data: {
                summary,
                description,
                assigneeAccountId: assignee_account_id,
                reporterAccountId: reporter_account_id || jira.jiraAccountId,
                storyPoint: story_point,
                storyPointFieldId: spFieldId,
                duedate: due_date,
                startDate: start_date,
                startDateFieldId
            }
        });

        // Xử lý Sprint
        let finalSprintId = null;
        if (sprint_id) {
            const sprintTarget = await Sprint.findById(sprint_id);
            if (sprintTarget) {
                await JiraSyncService.addIssueToSprint({
                    accessToken,
                    cloudId,
                    sprintId: sprintTarget.jira_sprint_id,
                    issueKey: jiraResp.key,
                    onTokenRefresh
                });
                finalSprintId = sprint_id;
            }
        }

        // Lưu Task vào MongoDB
        const newTask = new JiraTask({
            team_id: team._id,
            sprint_id: finalSprintId,
            issue_key: jiraResp.key,
            issue_id: jiraResp.id,
            summary,
            description: description || '',
            story_point: story_point || 0,
            assignee_account_id: assignee_account_id || null,
            reporter_account_id: reporter_account_id || jira.jiraAccountId,
            start_date: start_date ? new Date(start_date) : null,
            due_date: due_date ? new Date(due_date) : null,
            status_name: 'To Do',
            status_category: 'To Do',
            updated_at: new Date()
        });

        await newTask.save();
        
        if (finalSprintId) {
            await newTask.populate('sprint_id', 'name state');
        }

        res.status(201).json({ 
            message: '✅ Tạo Task thành công', 
            data: newTask 
        });

    } catch (error) {
        console.error('❌ Create Task Error:', error.message);
        
        if (error.code === 'JIRA_NOT_CONNECTED') {
            return res.status(400).json({ error: error.message, requiresAuth: true });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        
        res.status(500).json({ error: error.message });
    }
};

// PUT: Update Task (OAuth Version)
exports.updateTask = async (req, res) => {
    try {
        const currentUser = req.user;
        const { id } = req.params;
        const { 
            team_id, summary, description, 
            story_point, assignee_account_id, 
            reporter_account_id,
            sprint_id, status,
            start_date, due_date
        } = req.body;
        
        if (!team_id) return res.status(400).json({ error: 'Thiếu team_id.' });

        const task = await JiraTask.findById(id);
        const team = await Team.findById(team_id);
        if (!task || !team) return res.status(404).json({ error: 'Task hoặc Team không tồn tại' });

        // Lấy OAuth config
        const { accessToken, cloudId, onTokenRefresh } = await getJiraOAuthConfig(req);

        // Tạo REST API client
        const client = await JiraSyncService.syncWithAutoRefresh({
            user: currentUser,
            clientId: process.env.ATLASSIAN_CLIENT_ID,
            clientSecret: process.env.ATLASSIAN_CLIENT_SECRET,
            syncFunction: async (client) => client
        });

        // Lấy custom field IDs
        const spFieldId = await JiraSyncService.getCustomFieldId(client, 'Story Points') || 'customfield_10026';
        const startDateFieldId = await JiraSyncService.getCustomFieldId(client, 'Start date') || 'customfield_10015';

        // 1. Update Issue trên Jira
        try {
            await JiraSyncService.updateIssue({
                client,
                issueKey: task.issue_key,
                data: {
                    summary,
                    description,
                    storyPoint: story_point,
                    storyPointFieldId: spFieldId,
                    assigneeAccountId: assignee_account_id,
                    reporterAccountId: reporter_account_id,
                    startDate: start_date,
                    startDateFieldId,
                    duedate: due_date
                }
            });
        } catch (jiraErr) {
            return res.status(500).json({ error: 'Lỗi Sync Jira: ' + jiraErr.message });
        }

        // 2. Xử lý Status Transition
        if (status && status !== task.status_name) {
            const ok = await JiraSyncService.transitionIssue({
                client,
                issueKey: task.issue_key,
                targetStatusName: status
            });
            if (ok) {
                task.status_name = status;
                task.status_category = status;
            }
        }

        // 3. Xử lý Sprint Move
        if (sprint_id !== undefined) {
            if (sprint_id) {
                const sp = await Sprint.findById(sprint_id);
                if (sp) {
                    await JiraSyncService.addIssueToSprint({
                        accessToken,
                        cloudId,
                        sprintId: sp.jira_sprint_id,
                        issueKey: task.issue_key,
                        onTokenRefresh
                    });
                    task.sprint_id = sprint_id;
                }
            } else {
                await JiraSyncService.moveIssueToBacklog({
                    accessToken,
                    cloudId,
                    issueKey: task.issue_key,
                    onTokenRefresh
                });
                task.sprint_id = null;
            }
        }

        // 4. Update DB
        task.team_id = team_id;
        if (summary) task.summary = summary;
        if (description) task.description = description;
        if (story_point !== undefined) task.story_point = story_point;
        if (assignee_account_id !== undefined) task.assignee_account_id = assignee_account_id;
        if (reporter_account_id !== undefined) task.reporter_account_id = reporter_account_id;
        if (start_date) task.start_date = new Date(start_date);
        if (due_date) task.due_date = new Date(due_date);
        
        task.updated_at = Date.now();
        await task.save();
        
        res.json({ message: '✅ Cập nhật thành công', data: task });
    } catch (error) { 
        console.error('❌ Update Task Error:', error.message);
        
        if (error.code === 'JIRA_NOT_CONNECTED') {
            return res.status(400).json({ error: error.message, requiresAuth: true });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        
        res.status(500).json({ error: error.message }); 
    }
};

// DELETE: Xóa Task (OAuth Version)
exports.deleteTask = async (req, res) => {
    try {
        const currentUser = req.user;
        const task = await JiraTask.findById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const team = await Team.findById(task.team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });

        // Xóa trên Jira trước
        try {
            // Lấy OAuth config
            await getJiraOAuthConfig(req);

            // Tạo REST API client
            const client = await JiraSyncService.syncWithAutoRefresh({
                user: currentUser,
                clientId: process.env.ATLASSIAN_CLIENT_ID,
                clientSecret: process.env.ATLASSIAN_CLIENT_SECRET,
                syncFunction: async (client) => client
            });

            await JiraSyncService.deleteIssue({
                client,
                issueKey: task.issue_key
            });
        } catch (e) {
            console.warn('⚠️ Không thể xóa trên Jira:', e.message);
            // Continue anyway để xóa local DB
        }

        // Xóa trong DB
        await JiraTask.findByIdAndDelete(req.params.id);
        res.json({ message: '✅ Đã xóa Task' });
    } catch (error) { 
        console.error('❌ Delete Task Error:', error.message);
        
        if (error.code === 'JIRA_NOT_CONNECTED') {
            return res.status(400).json({ error: error.message, requiresAuth: true });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        
        res.status(500).json({ error: error.message }); 
    }
};