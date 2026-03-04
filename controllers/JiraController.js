const { Sprint, JiraTask } = require('../models/JiraData');
const Team = require('../models/Team');
const Project = require('../models/Project');
const models = require('../models');
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
  const user = req.user; // req.user từ authenticateToken
  const userId = req.user?._id || req.userId || req.user?.id;
  console.log('🔍 Đang tìm Jira Auth cho user ID:', userId);

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

    const { accessToken, refreshToken, cloudId: newCloudId } = await JiraAuthService.refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken: jira.refreshToken
    });

    user.integrations.jira.accessToken = accessToken;
    user.integrations.jira.refreshToken = refreshToken;
    if (newCloudId) {
      console.log('🔄 [Jira Controller] Updating cloudId in DB to:', newCloudId);
      user.integrations.jira.cloudId = newCloudId;
    }
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

/**
 * Resolve assignee_id (User/Student ID hoặc TeamMember ID) → Jira accountId
 * @param {string|ObjectId} assigneeId - Internal ID (Student._id hoặc TeamMember._id)
 * @returns {Promise<string|null>} - jiraAccountId hoặc null
 * @throws {Error} - Nếu assignee_id được gửi nhưng user chưa kết nối Jira
 */
async function resolveAssigneeToJiraAccountId(assigneeId) {
  if (!assigneeId) return null;

  // 1. Thử lookup Student trước (assignee_id thường là Student ID)
  const Student = models.Student;
  const TeamMember = models.TeamMember;

  const student = await Student.findById(assigneeId).lean();
  if (student) {
    const jiraAccountId = student.integrations?.jira?.jiraAccountId;
    if (!jiraAccountId) {
      const err = new Error('Thành viên được gán chưa kết nối tài khoản Jira. Vui lòng yêu cầu họ đồng bộ tài khoản trước khi gán task!');
      err.code = 'ASSIGNEE_NOT_LINKED_JIRA';
      throw err;
    }
    return jiraAccountId;
  }

  // 2. Fallback: TeamMember ID
  const teamMember = await TeamMember.findById(assigneeId)
    .populate('student_id', 'integrations')
    .lean();
  if (teamMember) {
    const jiraAccountId = teamMember.jira_account_id
      || teamMember.student_id?.integrations?.jira?.jiraAccountId;
    if (!jiraAccountId) {
      const err = new Error('Thành viên được gán chưa kết nối tài khoản Jira. Vui lòng yêu cầu họ đồng bộ tài khoản trước khi gán task!');
      err.code = 'ASSIGNEE_NOT_LINKED_JIRA';
      throw err;
    }
    return jiraAccountId;
  }

  return null;
}

// Format ngày chuẩn Jira (YYYY-MM-DDThh:mm:ssZ — không milliseconds)
const formatDateForJira = (dateString) => {
    if (!dateString) return null;
    try {
        const date = new Date(dateString);
        return date.toISOString().split('.')[0] + 'Z';
    } catch (err) {
        return dateString;
    }
};

// ==========================================
// 1. SPRINT CONTROLLER
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

        // Lấy OAuth config từ user
        const { accessToken, cloudId, onTokenRefresh } = await getJiraOAuthConfig(req);

        // Lấy boardId: ưu tiên từ Team; nếu thiếu thì suy ra từ Project.jiraProjectKey
        let boardId = team.jira_board_id;
        if (!boardId) {
            // Tìm project gắn với team này
            const project = await Project.findOne({ team_id: team._id }).lean();
            const jiraProjectKey = project?.jiraProjectKey;
            if (!jiraProjectKey) {
                return res.status(400).json({ error: 'Team/Project chưa có Jira Project Key để tìm Board.' });
            }

            // Gọi Jira lấy danh sách boards cho project
            const boards = await JiraSyncService.fetchBoards({
                accessToken,
                cloudId,
                projectKey: jiraProjectKey,
                onTokenRefresh
            });

            if (!boards || boards.length === 0) {
                return res.status(400).json({ error: 'Không tìm thấy Jira Board cho project này. Vui lòng kiểm tra lại trên Jira.' });
            }

            boardId = boards[0].id;

            // Backfill lưu lại boardId vào Team để các lần sau dùng nhanh hơn
            await Team.findByIdAndUpdate(team._id, { jira_board_id: boardId });
        }
        
        // Tạo Sprint qua OAuth (format ngày chuẩn Jira — không milliseconds)
        const jiraSprint = await JiraSyncService.createSprint({
            accessToken,
            cloudId,
            boardId,
            name,
            startDate: formatDateForJira(start_date),
            endDate: formatDateForJira(end_date),
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

        // Start Sprint qua OAuth (format ngày chuẩn Jira — không milliseconds)
        await JiraSyncService.startSprint({
            accessToken,
            cloudId,
            sprintId: sprint.jira_sprint_id,
            startDate: formatDateForJira(start_date),
            endDate: formatDateForJira(end_date),
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

        const dataToUpdate = {};
        if (req.body.name !== undefined) dataToUpdate.name = req.body.name;
        if (req.body.start_date !== undefined) dataToUpdate.startDate = formatDateForJira(req.body.start_date);
        if (req.body.end_date !== undefined) dataToUpdate.endDate = formatDateForJira(req.body.end_date);
        if (req.body.state !== undefined) dataToUpdate.state = req.body.state;

        if (Object.keys(dataToUpdate).length > 0) {
            await JiraSyncService.updateSprint({
                accessToken,
                cloudId,
                sprintId: sprint.jira_sprint_id,
                data: dataToUpdate,
                onTokenRefresh
            });
        }

        if (req.body.name !== undefined) sprint.name = req.body.name;
        if (req.body.state !== undefined) sprint.state = req.body.state;
        if (req.body.start_date !== undefined) sprint.start_date = req.body.start_date;
        if (req.body.end_date !== undefined) sprint.end_date = req.body.end_date;
        
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
// Quy tắc: Jira thành công 100% mới lưu DB — tránh Sync cleanup xóa nhầm
exports.createTask = async (req, res) => {
    try {
        const { 
            team_id, 
            summary, 
            description, 
            assignee_id, 
            assignee_account_id, 
            reporter_account_id, 
            story_point, 
            start_date, 
            due_date,
            sprint_id
        } = req.body;

        if (!team_id) return res.status(400).json({ error: 'Thiếu team_id' });
        if (!summary) return res.status(400).json({ error: 'Thiếu summary (Tên task)' });

        const team = await Team.findById(team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });

        // projectKey: ưu tiên Project (schema mới), fallback Team (backward-compatible)
        const project = await Project.findOne({ team_id: team._id }).lean();
        const projectKey = project?.jiraProjectKey || team.jira_project_key;
        if (!projectKey) {
            return res.status(400).json({ error: 'Team/Project chưa có Jira Project Key. Vui lòng cấu hình trên Project hoặc Team.' });
        }

        // Ánh xạ assignee: assignee_id (nội bộ) → jiraAccountId
        let assigneeAccountId = assignee_account_id || null;
        if (assignee_id) {
            assigneeAccountId = await resolveAssigneeToJiraAccountId(assignee_id);
        }

        const { accessToken, cloudId, jira, onTokenRefresh } = await getJiraOAuthConfig(req);
        const clientV2 = JiraSyncService.createJiraApiV2Client({ accessToken, cloudId, onTokenRefresh });

        const createData = { 
            summary, 
            description: description || '',
            ...(assigneeAccountId && { assigneeAccountId }),
            ...(reporter_account_id && { reporterAccountId: reporter_account_id })
        };
        if (!reporter_account_id && jira?.jiraAccountId) {
            createData.reporterAccountId = jira.jiraAccountId;
        }

        // === BƯỚC 1: Tạo Issue trên Jira (API v2) — Chờ 201 Created, thất bại -> throw
        const jiraResp = await JiraSyncService.createIssueV2({
            client: clientV2,
            projectKey,
            data: createData
        });
        const issueKey = jiraResp.key;
        const issueId = String(jiraResp.id); // Sync tìm theo String(issue.id)

        // === BƯỚC 2: Nếu có sprint_id — Add vào Sprint (Agile API), thất bại -> throw
        // QUAN TRỌNG: sprint_id là Mongo _id → query Sprint để lấy jira_sprint_id (số) gửi lên Jira
        let finalSprintId = null;
        if (sprint_id) {
            const sprintTarget = await Sprint.findById(sprint_id);
            if (sprintTarget) {
                // Đảm bảo sprint thuộc cùng team
                if (sprintTarget.team_id?.toString() !== team._id?.toString()) {
                    return res.status(400).json({ error: 'Sprint không thuộc team này' });
                }
                const jiraSprintId = Number(sprintTarget.jira_sprint_id);
                if (!isNaN(jiraSprintId) && jiraSprintId > 0) {
                    await JiraSyncService.addIssueToSprint({
                        accessToken,
                        cloudId,
                        sprintId: jiraSprintId,
                        issueKey,
                        onTokenRefresh
                    });
                }
                finalSprintId = sprint_id; // Lưu sprint_id vào DB (kể cả Backlog)
            }
        }

        // Resolve assignee_id (TeamMember) cho JiraTask nếu có assignee_id và team_id
        let assigneeMemberId = null;
        if (assignee_id && team_id) {
            const tm = await models.TeamMember.findOne({
                team_id,
                $or: [
                    { student_id: assignee_id },
                    { _id: assignee_id }
                ],
                is_active: true
            }).select('_id').lean();
            assigneeMemberId = tm?._id || null;
        }

        // === BƯỚC 3: CHỈ KHI TẤT CẢ JIRA API THÀNH CÔNG — mới lưu MongoDB
        const newTask = new JiraTask({
            team_id: team._id,
            sprint_id: finalSprintId,
            issue_id: issueId,
            issue_key: issueKey,
            summary,
            description: description || '',
            story_point: story_point || 0,
            assignee_account_id: assigneeAccountId || null,
            assignee_id: assigneeMemberId,
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
        if (error.code === 'ASSIGNEE_NOT_LINKED_JIRA') {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        res.status(500).json({ error: error.message });
    }
};

// PUT: Update Task (OAuth Version)
// Quy tắc: Tất cả Jira API thành công mới update DB — thất bại -> throw
exports.updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            team_id, summary, description, 
            story_point, assignee_id, assignee_account_id, 
            reporter_account_id,
            sprint_id, status,
            start_date, due_date
        } = req.body;

        if (!team_id) return res.status(400).json({ error: 'Thiếu team_id.' });

        const task = await JiraTask.findById(id);
        const team = await Team.findById(team_id);
        if (!task || !team) return res.status(404).json({ error: 'Task hoặc Team không tồn tại' });

        // Ánh xạ assignee: assignee_id (nội bộ) → jiraAccountId (khi gán người)
        let assigneeAccountId = undefined;
        if (assignee_id !== undefined || assignee_account_id !== undefined) {
            if (assignee_id === null || assignee_id === '' || assignee_account_id === null || assignee_account_id === '') {
                assigneeAccountId = null; // Unassign
            } else if (assignee_id) {
                assigneeAccountId = await resolveAssigneeToJiraAccountId(assignee_id);
            } else {
                assigneeAccountId = assignee_account_id || null;
            }
        }

        const { accessToken, cloudId, onTokenRefresh } = await getJiraOAuthConfig(req);
        const clientV2 = JiraSyncService.createJiraApiV2Client({ accessToken, cloudId, onTokenRefresh });

        // === BƯỚC 1–3: GỌI TẤT CẢ JIRA API TRƯỚC — thất bại bất kỳ -> throw
        const updateFields = {};
        if (summary !== undefined) updateFields.summary = summary;
        if (description !== undefined) updateFields.description = description;
        if (assigneeAccountId !== undefined) updateFields.assigneeAccountId = assigneeAccountId;
        if (reporter_account_id !== undefined) updateFields.reporterAccountId = reporter_account_id || null;
        if (Object.keys(updateFields).length > 0) {
            await JiraSyncService.updateIssueV2({
                client: clientV2,
                issueIdOrKey: task.issue_key,
                data: updateFields
            });
        }

        if (status && status !== task.status_name) {
            await JiraSyncService.transitionIssue({
                client: clientV2,
                issueKey: task.issue_key,
                targetStatusName: status
            });
        }

        if (sprint_id !== undefined) {
            if (sprint_id) {
                const sp = await Sprint.findById(sprint_id);
                if (sp) {
                    if (sp.team_id?.toString() !== team_id?.toString()) {
                        return res.status(400).json({ error: 'Sprint không thuộc team này' });
                    }
                    const jiraSprintId = Number(sp.jira_sprint_id);
                    if (isNaN(jiraSprintId) || jiraSprintId <= 0) {
                        return res.status(400).json({ error: 'Sprint này là Backlog, dùng move to backlog.' });
                    }
                    await JiraSyncService.addIssueToSprint({
                        accessToken,
                        cloudId,
                        sprintId: jiraSprintId,
                        issueKey: task.issue_key,
                        onTokenRefresh
                    });
                }
            } else {
                await JiraSyncService.moveIssueToBacklog({
                    accessToken,
                    cloudId,
                    issueKey: task.issue_key,
                    onTokenRefresh
                });
            }
        }

        // Resolve assignee_id (TeamMember) cho DB khi assignee được cập nhật
        let assigneeMemberId = undefined;
        if ((assignee_id !== undefined || assignee_account_id !== undefined) && team_id) {
            if (!assigneeAccountId) {
                assigneeMemberId = null;
            } else if (assignee_id) {
                const tm = await models.TeamMember.findOne({
                    team_id,
                    $or: [
                        { student_id: assignee_id },
                        { _id: assignee_id }
                    ],
                    is_active: true
                }).select('_id').lean();
                assigneeMemberId = tm?._id || null;
            }
        }

        // === BƯỚC 4: CHỈ KHI TẤT CẢ JIRA API THÀNH CÔNG — mới update DB
        task.team_id = team_id;
        if (summary !== undefined) task.summary = summary;
        if (description !== undefined) task.description = description;
        if (story_point !== undefined) task.story_point = story_point;
        if (assigneeAccountId !== undefined) task.assignee_account_id = assigneeAccountId;
        if (assigneeMemberId !== undefined) task.assignee_id = assigneeMemberId;
        if (reporter_account_id !== undefined) task.reporter_account_id = reporter_account_id;
        if (start_date !== undefined) task.start_date = start_date ? new Date(start_date) : null;
        if (due_date !== undefined) task.due_date = due_date ? new Date(due_date) : null;
        if (status && status !== task.status_name) {
            task.status_name = status;
            task.status_category = status;
        }
        if (sprint_id !== undefined) {
            task.sprint_id = sprint_id || null;
        }
        task.updated_at = new Date();
        await task.save();

        res.json({ message: '✅ Cập nhật thành công', data: task });
    } catch (error) {
        console.error('❌ Update Task Error:', error.message);
        if (error.code === 'JIRA_NOT_CONNECTED') {
            return res.status(400).json({ error: error.message, requiresAuth: true });
        }
        if (error.code === 'ASSIGNEE_NOT_LINKED_JIRA') {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        res.status(500).json({ error: error.message });
    }
};

// DELETE: Xóa Task (OAuth Version)
// Quy tắc: Jira delete thành công 100% mới xóa DB — thất bại -> throw
exports.deleteTask = async (req, res) => {
    try {
        const task = await JiraTask.findById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const team = await Team.findById(task.team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });

        const { accessToken, cloudId, onTokenRefresh } = await getJiraOAuthConfig(req);
        const clientV2 = JiraSyncService.createJiraApiV2Client({ accessToken, cloudId, onTokenRefresh });

        // === BƯỚC 1: Xóa trên Jira — thất bại -> throw, KHÔNG xóa DB
        await JiraSyncService.deleteIssueV2({
            client: clientV2,
            issueIdOrKey: task.issue_key
        });

        // === BƯỚC 2: CHỈ KHI JIRA DELETE THÀNH CÔNG — mới xóa MongoDB
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