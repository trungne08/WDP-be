const { Sprint, JiraTask } = require('../models/JiraData');
const Team = require('../models/Team');
const JiraService = require('../services/JiraService');

// Helper: Lấy Config Jira từ Team
const getJiraConfig = (team) => {
    if (!team.api_token_jira || !team.jira_url || !team.jira_project_key) {
        throw new Error("Team chưa cấu hình Jira (URL, Token, Project Key)");
    }
    // Token dùng trực tiếp (như bạn yêu cầu)
    return { url: team.jira_url, key: team.jira_project_key, token: team.api_token_jira };
};

// ==========================================
// 1. QUẢN LÝ SPRINT
// ==========================================

// GET: Lấy danh sách Sprint
exports.getSprintsByTeam = async (req, res) => {
    try {
        const { teamId } = req.params;
        const sprints = await Sprint.find({ team_id: teamId }).sort({ start_date: -1 });
        res.json(sprints);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// GET: Chi tiết Sprint
exports.getSprintById = async (req, res) => {
    try {
        const sprint = await Sprint.findById(req.params.id);
        if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
        res.json(sprint);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PUT: Cập nhật Sprint (Ví dụ: Chấm điểm)
exports.updateSprint = async (req, res) => {
    try {
        const { name, state, lecturer_grade } = req.body;
        const sprint = await Sprint.findByIdAndUpdate(
            req.params.id,
            { name, state, lecturer_grade }, 
            { new: true }
        );
        if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
        res.json({ message: '✅ Cập nhật Sprint thành công', data: sprint });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// DELETE: Xóa Sprint
exports.deleteSprint = async (req, res) => {
    try {
        const sprint = await Sprint.findByIdAndDelete(req.params.id);
        if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
        res.json({ message: '✅ Đã xóa Sprint thành công' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// 2. QUẢN LÝ TASK (CRUD 2 CHIỀU)
// ==========================================

// GET: Lấy danh sách Task (Có filter)
exports.getTasksByTeam = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { sprintId, status } = req.query;

        let query = { team_id: teamId };
        if (sprintId) query.sprint_id = sprintId;
        if (status) query.status_category = status;

        const tasks = await JiraTask.find(query)
            .populate('sprint_id', 'name state')
            .sort({ updated_at: -1 });

        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// GET: Chi tiết Task
exports.getTaskById = async (req, res) => {
    try {
        const task = await JiraTask.findById(req.params.id).populate('sprint_id');
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json(task);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// POST: Tạo Task (Ghi lên Jira -> Lưu DB)
exports.createTask = async (req, res) => {
    try {
        const { team_id, summary, description, story_point, assignee_account_id } = req.body;
        
        const team = await Team.findById(team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });

        const { url, key, token } = getJiraConfig(team);
        
        // Lấy ID custom field cho Story Point từ DB (đã lưu lúc config) hoặc fallback
        const spFieldId = team.jira_story_point_field || 'customfield_10026';

        // 1. Gọi Jira
        const jiraResp = await JiraService.createJiraIssue(url, token, {
            projectKey: key,
            summary,
            description,
            storyPoint: story_point,
            assigneeAccountId: assignee_account_id,
            storyPointFieldId: spFieldId 
        });

        // 2. Lưu DB
        const newTask = new JiraTask({
            team_id,
            issue_key: jiraResp.key,
            issue_id: jiraResp.id,
            summary,
            story_point,
            assignee_account_id,
            status_name: 'To Do',
            status_category: 'To Do'
        });

        await newTask.save();
        res.status(201).json({ message: '✅ Tạo Task thành công', data: newTask });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PUT: Cập nhật Task (Ghi lên Jira -> Update DB)
exports.updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const { summary, story_point, assignee_account_id } = req.body;

        const task = await JiraTask.findById(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const team = await Team.findById(task.team_id);
        const { url, token } = getJiraConfig(team);
        const spFieldId = team.jira_story_point_field || 'customfield_10026';

        // 1. Gọi Jira Update
        await JiraService.updateJiraIssue(url, token, task.issue_key, {
            summary,
            storyPoint: story_point,
            assigneeAccountId: assignee_account_id,
            storyPointFieldId: spFieldId
        });

        // 2. Update DB
        if (summary) task.summary = summary;
        if (story_point) task.story_point = story_point;
        if (assignee_account_id) task.assignee_account_id = assignee_account_id;
        task.updated_at = Date.now();
        
        await task.save();

        res.json({ message: '✅ Cập nhật Task thành công', data: task });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// DELETE: Xóa Task (Xóa trên Jira -> Xóa DB)
exports.deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        const task = await JiraTask.findById(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const team = await Team.findById(task.team_id);
        
        // Nếu Team đã bị xóa config thì vẫn cho xóa local
        if (team && team.api_token_jira) {
            try {
                const { url, token } = getJiraConfig(team);
                await JiraService.deleteJiraIssue(url, token, task.issue_key);
            } catch (err) {
                console.warn("⚠️ Không thể xóa trên Jira (có thể đã bị xóa trước đó):", err.message);
            }
        }

        await JiraTask.findByIdAndDelete(id);
        res.json({ message: '✅ Đã xóa Task thành công' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};