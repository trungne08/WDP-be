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
                const commits = await GithubService.fetchCommits(team.github_repo_url, team.api_token_github);
                for (const commit of commits) {
                    const checkResult = await GithubCommit.processCommit(commit, teamId);
                    await GithubCommit.findOneAndUpdate(
                        // Upsert theo (team_id + hash) để cùng 1 hash ở team khác
                        // không bị "đè" lẫn nhau.
                        { team_id: teamId, hash: commit.hash },
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
                }
                results.git = commits.length;
            } catch (err) {
                console.error("Lỗi Sync Git:", err.message);
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
                // 1. Lấy danh sách Sprint
                const sprints = await JiraService.fetchSprints(team.jira_url, team.jira_board_id, team.api_token_jira);
                
                for (const sprintData of sprints) {
                    // Lưu Sprint vào DB
                    const savedSprint = await Sprint.findOneAndUpdate(
                        { jira_sprint_id: sprintData.id },
                        {
                            team_id: teamId,
                            name: sprintData.name,
                            state: sprintData.state,
                            start_date: sprintData.startDate,
                            end_date: sprintData.endDate
                        },
                        { upsert: true, new: true }
                    );
                    results.jira_sprints++;

                    // 2. Lấy danh sách Task trong Sprint
                    const tasks = await JiraService.fetchTasksInSprint(team.jira_url, sprintData.id, team.api_token_jira);
                    
                    for (const task of tasks) {
                        // Lưu Task vào DB với đầy đủ trường thông tin
                        await JiraTask.findOneAndUpdate(
                            { issue_id: task.issue_id },
                            {
                                sprint_id: savedSprint._id,
                                team_id: team._id,
                                issue_key: task.issue_key,
                                summary: task.summary,
                                
                                // 🔥 Update: Description (HTML)
                                description: task.description, 

                                status_name: task.status_name,
                                status_category: task.status_category,
                                story_point: task.story_point,
                                
                                // 🔥 Update: Assignee
                                assignee_account_id: task.assignee ? task.assignee.accountId : null,
                                assignee_name: task.assignee ? task.assignee.displayName : null,
                                assignee_avatar: task.assignee ? task.assignee.avatarUrls['48x48'] : null,

                                // 🔥 Update: Reporter
                                reporter_account_id: task.reporter ? task.reporter.accountId : null,
                                reporter_name: task.reporter ? task.reporter.displayName : null,
                                reporter_avatar: task.reporter ? task.reporter.avatarUrls['48x48'] : null,

                                // 🔥 Update: Dates
                                start_date: task.start_date ? new Date(task.start_date) : null,
                                due_date: task.due_date ? new Date(task.due_date) : null,

                                updated_at: new Date()
                            },
                            { upsert: true }
                        );
                        results.jira_tasks++;
                    }
                }
            } catch (err) {
                console.error("Lỗi Sync Jira:", err.message);
                results.errors.push(`Jira Error: ${err.message}`);
            }
        } else {
             console.log("⏩ Bỏ qua Jira (Chưa có Token hoặc Board ID)");
        }

        await Team.findByIdAndUpdate(teamId, { last_sync_at: new Date() });

        res.json({ 
            message: "✅ Đồng bộ hoàn tất!", 
            stats: results 
        });

    } catch (error) {
        console.error("General Sync Error:", error);
        res.status(500).json({ error: error.message });
    }
};