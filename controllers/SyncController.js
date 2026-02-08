const Team = require('../models/Team');
const GithubCommit = require('../models/GitData');
const { Sprint, JiraTask } = require('../models/JiraData');
const GithubService = require('../services/GithubService');
const JiraService = require('../services/JiraService');

exports.syncTeamData = async (req, res) => {
    const { teamId } = req.params;
    try {
        const team = await Team.findById(teamId);
        if (!team) return res.status(404).json({ msg: "Team not found" });
        console.log(`⏳ Đang Sync dữ liệu cho Team: ${team.project_name}...`);
        const results = { git: 0, jira_sprints: 0, jira_tasks: 0, errors: [] };
        if (team.api_token_github && team.github_repo_url) {
            try {
                // REFACTORED: Fetch commits từ TẤT CẢ branches
                const commits = await GithubService.fetchCommits(
                    team.github_repo_url, 
                    team.api_token_github,
                    {
                        maxCommitsPerBranch: 100,
                        includeBranchInfo: true
                    }
                );
                
                for (const commit of commits) {
                    const checkResult = await GithubCommit.processCommit(commit, teamId);
                    await GithubCommit.findOneAndUpdate(
                        // Upsert theo (team_id + hash) để cùng 1 hash ở team khác
                        // không bị "đè" lẫn nhau.
                        { team_id: teamId, hash: commit.hash },
                        {
                            team_id: teamId,
                            author_email: commit.author_email,
                            author_name: commit.author_name,
                            message: commit.message,
                            commit_date: commit.commit_date,
                            url: commit.url,
                            branches: commit.branches || [],
                            is_counted: checkResult.is_counted,
                            rejection_reason: checkResult.reason
                        },
                        { upsert: true, new: true }
                    );
                }
                results.git = commits.length;
                console.log(`✅ [Team Sync] Đã sync ${commits.length} commits từ tất cả branches`);
            } catch (err) {
                console.error("❌ Lỗi Sync Git:", err.message);
                results.errors.push(`Git Error: ${err.message}`);
            }
        } else {
            console.log("⏩ Bỏ qua GitHub (Chưa có Token)");
        }

        // ==========================================
        // PHẦN 2: JIRA (Cập nhật logic mới)
        // ==========================================
        if (team.api_token_jira && team.jira_url && team.jira_board_id) {
            try {
                // ==========================================
                // BƯỚC 1: SYNC TẤT CẢ SPRINTS (Để tạo khung chứa)
                // ==========================================
                const sprints = await JiraService.fetchSprints(team.jira_url, team.jira_board_id, team.api_token_jira);
                
                // Tạo Map để tra cứu nhanh: JiraID -> MongoDB_ID
                const sprintMap = new Map();

                for (const s of sprints) {
                    const savedSprint = await Sprint.findOneAndUpdate(
                        { jira_sprint_id: s.id },
                        {
                            team_id: teamId,
                            name: s.name,
                            state: s.state,
                            start_date: s.startDate,
                            end_date: s.endDate
                        },
                        { upsert: true, new: true }
                    );
                    sprintMap.set(s.id, savedSprint._id);
                    results.jira_sprints++;
                }

                // ==========================================
                // BƯỚC 2: SYNC TOÀN BỘ TASK (1 LẦN DUY NHẤT)
                // ==========================================
                console.log("⏳ Đang kéo toàn bộ Task trên Board...");
                const allTasks = await JiraService.fetchAllBoardIssues(team.jira_url, team.jira_board_id, team.api_token_jira);

                for (const task of allTasks) {
                    // Tìm xem task này thuộc Sprint nào trong DB
                    let dbSprintId = null;
                    if (task.jira_sprint_id && sprintMap.has(task.jira_sprint_id)) {
                        dbSprintId = sprintMap.get(task.jira_sprint_id);
                    }
                    // Nếu task.jira_sprint_id là null -> dbSprintId là null (Backlog)

                    await JiraTask.findOneAndUpdate(
                        { issue_id: task.issue_id },
                        {
                            team_id: teamId,
                            sprint_id: dbSprintId, // Tự động nhận diện Sprint hoặc Backlog
                            issue_key: task.issue_key,
                            summary: task.summary,
                            description: task.description,
                            status_name: task.status_name,
                            status_category: task.status_category,
                            story_point: task.story_point,
                            assignee_account_id: task.assignee_account_id,
                            reporter_account_id: task.reporter_account_id,
                            due_date: task.due_date ? new Date(task.due_date) : null,
                            updated_at: new Date()
                        },
                        { upsert: true }
                    );
                    results.jira_tasks++;
                }

            } catch (err) {
                console.error("❌ Jira Sync Error:", err.message);
                results.errors.push(err.message);
            }
        }

        await Team.findByIdAndUpdate(teamId, { last_sync_at: new Date() });
        res.json({ message: "✅ Đồng bộ xong!", stats: results });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};