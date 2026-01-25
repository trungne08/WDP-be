const { Sprint, JiraTask } = require('../models/JiraData');
const Team = require('../models/Team');
const JiraService = require('../services/JiraService');

// Helper config
const getJiraConfig = (team) => {
    if (!team.api_token_jira || !team.jira_url) {
        throw new Error("Team chưa cấu hình Jira URL hoặc Token");
    }
    return { url: team.jira_url, key: team.jira_project_key, token: team.api_token_jira };
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

// POST: Tạo Sprint (Đồng bộ Jira -> DB)
exports.createSprint = async (req, res) => {
    try {
        // Model dùng snake_case: start_date, end_date
        const { team_id, name, start_date, end_date } = req.body;
        
        const team = await Team.findById(team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        if (!team.jira_board_id) return res.status(400).json({ error: 'Team chưa có Board ID' });

        const { url, token } = getJiraConfig(team);
        
        // Gọi Jira tạo Sprint
        const jiraSprint = await JiraService.createJiraSprint(url, token, team.jira_board_id, name, start_date, end_date);

        // Lưu vào DB (Map từ Jira camelCase -> Model snake_case)
        const newSprint = new Sprint({
            team_id: team._id,
            jira_sprint_id: jiraSprint.id,
            name: jiraSprint.name,
            state: jiraSprint.state, // future
            start_date: jiraSprint.startDate, 
            end_date: jiraSprint.endDate
        });

        await newSprint.save();
        res.status(201).json({ message: '✅ Tạo Sprint thành công', data: newSprint });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// POST: Bắt đầu Sprint
exports.startSprint = async (req, res) => {
    try {
        const { id } = req.params;
        const { start_date, end_date } = req.body;

        const sprint = await Sprint.findById(id);
        if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

        const team = await Team.findById(sprint.team_id);
        const { url, token } = getJiraConfig(team);

        await JiraService.startJiraSprint(url, token, sprint.jira_sprint_id, start_date, end_date);

        sprint.state = 'active';
        sprint.start_date = start_date;
        sprint.end_date = end_date;
        await sprint.save();

        res.json({ message: '✅ Start Sprint thành công', data: sprint });
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

// PUT: Update Sprint (Chỉ thông tin cơ bản, KHÔNG có điểm số)
exports.updateSprint = async (req, res) => {
    try {
        const { name, state, start_date, end_date } = req.body;
        const sprint = await Sprint.findByIdAndUpdate(
            req.params.id, 
            { name, state, start_date, end_date }, 
            { new: true }
        );
        res.json({ message: 'Update thành công', data: sprint });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// DELETE: Xóa Sprint
exports.deleteSprint = async (req, res) => {
    try {
        await Sprint.findByIdAndDelete(req.params.id);
        res.json({ message: 'Đã xóa Sprint' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// ==========================================
// 2. TASK CONTROLLER
// ==========================================
// POST: Tạo Task
exports.createTask = async (req, res) => {
    try {
        const { team_id, summary, description } = req.body;

        const team = await Team.findById(team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });

        const { url, key, token } = getJiraConfig(team);

        // Gọi Jira tạo issue (Không gửi storyPoint)
        const jiraResp = await JiraService.createJiraIssue(url, token, {
            projectKey: key,
            summary,
            description,
            // Không truyền storyPoint -> Jira sẽ để trống
            assigneeAccountId: null 
        });

        const newTask = new JiraTask({
            team_id: team._id,
            sprint_id: null,       // Backlog
            issue_key: jiraResp.key,
            issue_id: jiraResp.id,
            summary: summary,
            description: description || "",
            story_point: 0,        // Mặc định 0
            assignee_account_id: null,
            status_name: 'To Do',
            status_category: 'To Do'
        });

        await newTask.save();
        res.status(201).json({ message: '✅ Tạo Task thành công', data: newTask });

    } catch (error) {
        console.error("Create Task Error:", error);
        res.status(500).json({ error: error.message });
    }
};

// GET: Chi tiết Task
exports.getTaskById = async (req, res) => {
    try {
        const task = await JiraTask.findById(req.params.id).populate('sprint_id');
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json(task);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// PUT: Update Task
exports.updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        // Nhận đầy đủ các trường
        const { summary, story_point, assignee_account_id, sprint_id, status } = req.body;
        
        const task = await JiraTask.findById(id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        
        const team = await Team.findById(task.team_id);
        const { url, token } = getJiraConfig(team);
        const spFieldId = team.jira_story_point_field || 'customfield_10026';

        // Update Jira
        await JiraService.updateJiraIssue(url, token, task.issue_key, {
            summary, 
            storyPoint: story_point, // Lúc này mới gửi điểm lên
            assigneeAccountId: assignee_account_id, 
            storyPointFieldId: spFieldId
        });

        // Update Local DB
        if (summary) task.summary = summary;
        if (story_point !== undefined) task.story_point = story_point;
        if (assignee_account_id !== undefined) task.assignee_account_id = assignee_account_id;
        
        // Logic gán Sprint
        if (sprint_id !== undefined) {
            if (!sprint_id) task.sprint_id = null; // Gửi null/rỗng -> Về Backlog
            else {
                const sprintExists = await Sprint.findById(sprint_id);
                if (sprintExists) task.sprint_id = sprint_id;
            }
        }

        // Logic đổi Status
        if (status) {
            task.status_name = status;
            task.status_category = status;
        }

        task.updated_at = Date.now();
        await task.save();
        
        const updatedTask = await JiraTask.findById(id).populate('sprint_id', 'name state');
        res.json({ message: '✅ Cập nhật Task thành công', data: updatedTask });

    } catch (error) { res.status(500).json({ error: error.message }); }
};

// DELETE: Xóa Task
exports.deleteTask = async (req, res) => {
    try {
        const task = await JiraTask.findById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const team = await Team.findById(task.team_id);
        if (team) {
            const { url, token } = getJiraConfig(team);
            await JiraService.deleteJiraIssue(url, token, task.issue_key);
        }
        await JiraTask.findByIdAndDelete(req.params.id);
        res.json({ message: 'Đã xóa Task' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};