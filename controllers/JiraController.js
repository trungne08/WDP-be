const { Sprint, JiraTask } = require('../models/JiraData');
const Team = require('../models/Team');
const JiraService = require('../services/JiraService');

// Helper config
const getJiraConfig = (team) => {
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

// POST: Tạo Sprint (Đồng bộ Jira -> DB)
exports.createSprint = async (req, res) => {
    try {
        const { team_id, name, start_date, end_date } = req.body;
        
        const team = await Team.findById(team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        if (!team.jira_board_id) return res.status(400).json({ error: 'Team chưa có Board ID' });

        const { url, token } = getJiraConfig(team);
        
        // Gọi Jira tạo Sprint
        const jiraSprint = await JiraService.createJiraSprint(url, token, team.jira_board_id, name, start_date, end_date);

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

// PUT: Update Sprint
exports.updateSprint = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, state, start_date, end_date } = req.body;

        const sprint = await Sprint.findById(id);
        if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

        const team = await Team.findById(sprint.team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });

        const { url, token } = getJiraConfig(team);

        await JiraService.updateJiraSprint(url, token, sprint.jira_sprint_id, {
            name: name,
            state: state,
            startDate: start_date,
            endDate: end_date
        });

        if (name) sprint.name = name;
        if (state) sprint.state = state;
        if (start_date) sprint.start_date = start_date;
        if (end_date) sprint.end_date = end_date;
        
        await sprint.save();

        res.json({ message: '✅ Cập nhật Sprint thành công', data: sprint });

    } catch (error) {
        console.error("Update Sprint Failed:", error);
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

// POST: Tạo Task (Đã cập nhật thêm các trường mới: reporter, dates...)
exports.createTask = async (req, res) => {
    try {
        const currentUserId = req.user ? req.user._id : null;
        const { 
            team_id, 
            summary, 
            description, 
            assignee_account_id, 
            reporter_account_id, 
            story_point, 
            start_date, 
            due_date,
            sprint_id // <--- Có thể null hoặc undefined
        } = req.body;

        // Validate bắt buộc
        if (!team_id) return res.status(400).json({ error: 'Thiếu team_id' });
        if (!summary) return res.status(400).json({ error: 'Thiếu summary (Tên task)' });

        const team = await Team.findById(team_id);
        if (!team) return res.status(404).json({ error: 'Team not found' });
        const { url, key, token } = getJiraConfig(team);
        let autoReporterId = null;
        if (currentUserId) {
            const currentUser = await User.findById(currentUserId);
            // Nếu user này đã liên kết Jira, lấy ID Jira của họ
            if (currentUser && currentUser.jira_account_id) {
                autoReporterId = currentUser.jira_account_id;
            }
        }
        const spFieldId = team.jira_story_point_field || 'customfield_10026';
        const startDateFieldId = team.jira_start_date_field || 'customfield_10015';

        // 2. Tạo Issue trên Jira (Mặc định sẽ vào Backlog)
        const jiraResp = await JiraService.createJiraIssue(url, token, {
            projectKey: key,
            summary,
            description,
            assigneeAccountId: assignee_account_id,
            reporterAccountId: reporter_account_id,
            storyPoint: story_point,
            storyPointFieldId: spFieldId,
            duedate: due_date,
            startDate: start_date,
            startDateFieldId: startDateFieldId
        });

        // 3. Xử lý Sprint (CHỈ CHẠY NẾU CÓ sprint_id)
        let finalSprintId = null;
        
        if (sprint_id) {
            const sprintTarget = await Sprint.findById(sprint_id);
            if (sprintTarget) {
                // Gọi API di chuyển task vào sprint
                await JiraService.addIssueToSprint(url, token, sprintTarget.jira_sprint_id, jiraResp.key);
                finalSprintId = sprint_id; // Lưu vào DB
            }
        }

        // 4. Lưu Task vào MongoDB
        const newTask = new JiraTask({
            team_id: team._id,
            
            sprint_id: finalSprintId, // Null nếu không chọn sprint
            
            issue_key: jiraResp.key,
            issue_id: jiraResp.id,
            summary: summary,
            description: description || "",
            story_point: story_point || 0,
            
            assignee_account_id: assignee_account_id || null,
            reporter_account_id: reporter_account_id || null,
            
            start_date: start_date ? new Date(start_date) : null,
            due_date: due_date ? new Date(due_date) : null,

            status_name: 'To Do',
            status_category: 'To Do',
            
            updated_at: new Date()
        });

        await newTask.save();
        
        // Populate tên sprint để FE hiển thị (nếu có)
        if (finalSprintId) {
            await newTask.populate('sprint_id', 'name state');
        }

        res.status(201).json({ 
            message: '✅ Tạo Task thành công', 
            data: newTask 
        });

    } catch (error) {
        console.error("Create Task Error:", error);
        res.status(500).json({ error: error.message });
    }
};

// PUT: Update Task (Logic đầy đủ nhất)
exports.updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        // Nhận tất cả các trường
        const { 
            team_id, summary, description, 
            story_point, assignee_account_id, 
            reporter_account_id, // Mới
            sprint_id, status,
            start_date, due_date // Mới
        } = req.body;
        
        if (!team_id) return res.status(400).json({ error: 'Thiếu team_id.' });

        const task = await JiraTask.findById(id);
        const team = await Team.findById(team_id);
        if (!task || !team) return res.status(404).json({ error: 'Task hoặc Team không tồn tại' });

        const { url, token } = getJiraConfig(team);
        const spFieldId = team.jira_story_point_field || 'customfield_10026';
        const startDateFieldId = team.jira_start_date_field || 'customfield_10015';

        // 1. GỬI LÊN JIRA
        try {
            await JiraService.updateJiraIssue(url, token, task.issue_key, {
                summary,
                description,
                storyPoint: story_point,
                storyPointFieldId: spFieldId,
                assigneeAccountId: assignee_account_id,
                
                // Các trường mới
                reporterAccountId: reporter_account_id,
                startDate: start_date, // YYYY-MM-DD
                startDateFieldId: startDateFieldId,
                duedate: due_date // YYYY-MM-DD
            });
        } catch (jiraErr) {
            return res.status(500).json({ error: "Lỗi Sync Jira: " + jiraErr.message });
        }

        // 2. XỬ LÝ STATUS (Transition)
        if (status && status !== task.status_name) {
            const ok = await JiraService.transitionIssue(url, token, task.issue_key, status);
            if (ok) {
                task.status_name = status;
                task.status_category = status;
            }
        }

        // 3. XỬ LÝ SPRINT (Move)
        if (sprint_id !== undefined) {
             if (sprint_id) {
                const sp = await Sprint.findById(sprint_id);
                if (sp) {
                    await JiraService.addIssueToSprint(url, token, sp.jira_sprint_id, task.issue_key);
                    task.sprint_id = sprint_id;
                }
             } else {
                await JiraService.moveIssueToBacklog(url, token, task.issue_key);
                task.sprint_id = null;
             }
        }

        // 4. LƯU LOCAL DB
        task.team_id = team_id;
        if (summary) task.summary = summary;
        if (description) task.description = description;
        if (story_point !== undefined) task.story_point = story_point;
        if (assignee_account_id !== undefined) task.assignee_account_id = assignee_account_id;
        
        // Lưu trường mới vào DB
        if (reporter_account_id !== undefined) task.reporter_account_id = reporter_account_id;
        if (start_date) task.start_date = new Date(start_date);
        if (due_date) task.due_date = new Date(due_date);
        
        task.updated_at = Date.now();
        await task.save();
        
        res.json({ message: '✅ Cập nhật thành công', data: task });
    } catch (error) { 
        console.error("Update Task Error:", error);
        res.status(500).json({ error: error.message }); 
    }
};

// DELETE: Xóa Task
exports.deleteTask = async (req, res) => {
    try {
        const task = await JiraTask.findById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const team = await Team.findById(task.team_id);
        if (team) {
            const { url, token } = getJiraConfig(team);
             try {
                // Kiểm tra nếu service có hàm xóa
                if (JiraService.deleteJiraIssue) {
                    await JiraService.deleteJiraIssue(url, token, task.issue_key);
                }
            } catch (e) {
                console.warn("Không thể xóa trên Jira (hoặc lỗi quyền):", e.message);
            }
        }
        await JiraTask.findByIdAndDelete(req.params.id);
        res.json({ message: 'Đã xóa Task' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};