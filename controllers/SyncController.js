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

        // ❌ XÓA DÒNG CHECK CỨNG NHẮC CŨ: if (!team.api_token_github || !team.api_token_jira) ...

        console.log(`⏳ Đang Sync dữ liệu cho Team: ${team.project_name}...`);
        const results = { git: 0, jira_sprints: 0, jira_tasks: 0, errors: [] };

        // ==========================================
        // PHẦN 1: GITHUB (Chỉ chạy nếu có Token)
        // ==========================================
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
        // PHẦN 2: JIRA (Chỉ chạy nếu có Token)
        // ==========================================
        if (team.api_token_jira && team.jira_url && team.jira_board_id) {
            try {
                const sprints = await JiraService.fetchSprints(team.jira_url, team.jira_board_id, team.api_token_jira);
                
                for (const sprintData of sprints) {
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

                    // Lấy Task của Sprint này
                    const tasks = await JiraService.fetchTasksInSprint(team.jira_url, sprintData.id, team.api_token_jira);
                    for (const task of tasks) {
                        await JiraTask.findOneAndUpdate(
                            { issue_id: task.issue_id },
                            {
                                sprint_id: savedSprint._id,
                                issue_key: task.issue_key,
                                status_name: task.status_name,
                                status_category: task.status_category,
                                story_point: task.story_point,
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
             console.log("⏩ Bỏ qua Jira (Chưa có Token)");
        }

        // Cập nhật thời gian Sync
        await Team.findByIdAndUpdate(teamId, { last_sync_at: new Date() });

        res.json({ 
            message: "✅ Đồng bộ hoàn tất (theo cấu hình có sẵn)!", 
            stats: results 
        });

    } catch (error) {
        console.error("General Sync Error:", error);
        res.status(500).json({ error: error.message });
    }
};