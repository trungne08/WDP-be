const Team = require('../models/Team');
const GithubCommit = require('../models/GitData');
const { Sprint, JiraTask } = require('../models/JiraData');
const GithubService = require('../services/GithubService');
const JiraService = require('../services/JiraService'); // Legacy - Deprecated
const JiraSyncService = require('../services/JiraSyncService'); // OAuth version
const JiraAuthService = require('../services/JiraAuthService');

/**
 * Sync Team Data - OAuth Version
 * Yêu cầu: User phải đã connect Jira OAuth trước khi sync
 */
exports.syncTeamData = async (req, res) => {
    const { teamId } = req.params;
    const currentUser = req.user;

    try {
        const team = await Team.findById(teamId);
        if (!team) return res.status(404).json({ msg: 'Team not found' });
        
        console.log(`⏳ Đang Sync dữ liệu cho Team: ${team.project_name}...`);
        const results = { git: 0, jira_sprints: 0, jira_tasks: 0, errors: [] };
        
        // ==========================================
        // PHẦN 1: GITHUB (OAuth Version)
        // ==========================================
        if (team.github_repo_url && currentUser.integrations?.github) {
            try {
                const github = currentUser.integrations.github;
                
                // Check OAuth connection
                if (!github.accessToken) {
                    results.errors.push('User chưa kết nối GitHub OAuth. Vui lòng kết nối GitHub trước.');
                    console.log('⚠️ User chưa connect GitHub OAuth');
                } else {
                    console.log('🔄 [Team Sync] Đang sync GitHub qua OAuth...');
                    
                    // Fetch commits từ TẤT CẢ branches với user OAuth token
                    const commits = await GithubService.fetchCommits(
                        team.github_repo_url, 
                        github.accessToken,  // User OAuth token thay vì team token
                        {
                            maxCommitsPerBranch: 100,
                            includeBranchInfo: true
                        }
                    );
                    
                    for (const commit of commits) {
                        const checkResult = await GithubCommit.processCommit(commit, teamId);
                        await GithubCommit.findOneAndUpdate(
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
                }
            } catch (err) {
                console.error('❌ Lỗi Sync GitHub:', err.message);
                
                // Handle GitHub token errors
                if (err.message.includes('token không hợp lệ') || err.message.includes('Bad credentials')) {
                    results.errors.push('GitHub token đã hết hạn. Vui lòng kết nối lại GitHub.');
                } else {
                    results.errors.push(`GitHub Error: ${err.message}`);
                }
            }
        } else {
            if (!team.github_repo_url) {
                results.errors.push('Team chưa có GitHub repository URL.');
                console.log('⚠️ Team chưa có GitHub repo URL');
            }
            if (!currentUser.integrations?.github) {
                results.errors.push('User chưa kết nối GitHub. Vui lòng kết nối GitHub trước.');
                console.log('⚠️ User chưa connect GitHub');
            }
        }

        // ==========================================
        // PHẦN 2: JIRA (OAuth Version)
        // ==========================================
        if (team.jira_board_id && currentUser.integrations?.jira) {
            try {
                const jira = currentUser.integrations.jira;
                
                // Check OAuth connection
                if (!jira.accessToken || !jira.cloudId) {
                    results.errors.push('User chưa kết nối Jira OAuth. Vui lòng kết nối Jira trước.');
                    console.log('⚠️ User chưa connect Jira OAuth');
                } else {
                    console.log('🔄 [Team Sync] Đang sync Jira qua OAuth...');
                    
                    const clientId = process.env.ATLASSIAN_CLIENT_ID;
                    const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
                    
                    // Callback để refresh token
                    const onTokenRefresh = async () => {
                        if (!jira.refreshToken) {
                            throw new Error('Không có refresh_token');
                        }

                        const { accessToken, refreshToken, cloudId: newCloudId } = await JiraAuthService.refreshAccessToken({
                            clientId,
                            clientSecret,
                            refreshToken: jira.refreshToken
                        });

                        currentUser.integrations.jira.accessToken = accessToken;
                        currentUser.integrations.jira.refreshToken = refreshToken;
                        if (newCloudId) {
                            console.log('🔄 [Team Sync] Updating cloudId in DB to:', newCloudId);
                            currentUser.integrations.jira.cloudId = newCloudId;
                        }
                        await currentUser.save();

                        return accessToken;
                    };

                    // ==========================================
                    // BƯỚC 1: SYNC TẤT CẢ SPRINTS
                    // ==========================================
                    const sprints = await JiraSyncService.fetchSprints({
                        accessToken: jira.accessToken,
                        cloudId: jira.cloudId,
                        boardId: team.jira_board_id,
                        onTokenRefresh
                    });
                    
                    // Tạo Map để tra cứu nhanh: JiraID -> MongoDB_ID
                    const sprintMap = new Map();
                    const activeJiraSprintIds = [];

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
                        activeJiraSprintIds.push(s.id);
                        results.jira_sprints++;
                    }

                    // Cleanup Sprint rác: mọi Sprint của team này không còn tồn tại trên Jira
                    try {
                        await Sprint.deleteMany({
                            team_id: teamId,
                            jira_sprint_id: { $nin: activeJiraSprintIds }
                        });
                        console.log('🧹 [Team Sync] Cleanup Sprint orphan thành công cho team', teamId.toString());
                    } catch (cleanupErr) {
                        console.warn('⚠️ [Team Sync] Cleanup Sprint orphan thất bại:', cleanupErr.message);
                    }

                    // ==========================================
                    // BƯỚC 2: SYNC TOÀN BỘ TASK
                    // ==========================================
                    console.log('⏳ Đang kéo toàn bộ Task trên Board...');
                    const allTasks = await JiraSyncService.fetchAllBoardIssues({
                        accessToken: jira.accessToken,
                        cloudId: jira.cloudId,
                        boardId: team.jira_board_id,
                        onTokenRefresh
                    });

                    const activeIssueIds = [];

                    for (const task of allTasks) {
                        // Tìm xem task này thuộc Sprint nào trong DB
                        let dbSprintId = null;
                        if (task.jira_sprint_id && sprintMap.has(task.jira_sprint_id)) {
                            dbSprintId = sprintMap.get(task.jira_sprint_id);
                        }

                        await JiraTask.findOneAndUpdate(
                            { issue_id: task.issue_id },
                            {
                                team_id: teamId,
                                sprint_id: dbSprintId,
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
                        activeIssueIds.push(task.issue_id);
                        results.jira_tasks++;
                    }

                    // Cleanup Task rác: mọi Task thuộc team này nhưng không còn trên board Jira
                    try {
                        await JiraTask.deleteMany({
                            team_id: teamId,
                            issue_id: { $nin: activeIssueIds }
                        });
                        console.log('🧹 [Team Sync] Cleanup JiraTask orphan thành công cho team', teamId.toString());
                    } catch (cleanupErr) {
                        console.warn('⚠️ [Team Sync] Cleanup JiraTask orphan thất bại:', cleanupErr.message);
                    }
                    
                    console.log(`✅ [Team Sync] Jira sync hoàn tất: ${results.jira_sprints} sprints, ${results.jira_tasks} tasks`);
                }

            } catch (err) {
                console.error('❌ Jira Sync Error:', err.message);
                
                if (err.code === 'REFRESH_TOKEN_EXPIRED') {
                    results.errors.push('Token Jira đã hết hạn. Vui lòng kết nối lại Jira.');
                } else {
                    results.errors.push(`Jira Error: ${err.message}`);
                }
            }
        } else {
            if (!team.jira_board_id) {
                results.errors.push('Team chưa có Jira Board ID.');
                console.log('⚠️ Team chưa có Jira Board ID');
            }
            if (!currentUser.integrations?.jira) {
                results.errors.push('User chưa kết nối Jira. Vui lòng kết nối Jira trước.');
                console.log('⚠️ User chưa connect Jira');
            }
        }

        await Team.findByIdAndUpdate(teamId, { last_sync_at: new Date() });
        res.json({ message: "✅ Đồng bộ xong!", stats: results });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};