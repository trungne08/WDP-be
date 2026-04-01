const models = require('../models');
const Team = require('../models/Team');
const Project = require('../models/Project');
const GithubCommit = require('../models/GitData');
const { persistTeamMemberGitScores } = require('../utils/memberGitScorePersistence');
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

        // Lấy Project gắn với team (schema mới lưu githubRepoUrl & jiraProjectKey trên Project)
        const project = await Project.findOne({ team_id: team._id }).lean();
        const projectGithubUrl = project?.githubRepoUrl || null;
        const projectJiraKey = project?.jiraProjectKey || null;
        
        console.log(`⏳ Đang Sync dữ liệu cho Team: ${team.project_name}...`);
        const results = { git: 0, jira_sprints: 0, jira_tasks: 0, errors: [] };
        
        // ==========================================
        // PHẦN 1: GITHUB (OAuth Version)
        // ==========================================
        // Ưu tiên repo URL từ Project (schema mới); fallback sang Team.github_repo_url (backward-compatible)
        const repoUrl = projectGithubUrl || team.github_repo_url || null;

        if (repoUrl && currentUser.integrations?.github) {
            try {
                const github = currentUser.integrations.github;
                const branch = (req.body?.branch || req.query?.branch || '').trim() || undefined;

                if (!github.accessToken) {
                    results.errors.push('User chưa kết nối GitHub OAuth. Vui lòng kết nối GitHub trước.');
                    console.log('⚠️ User chưa connect GitHub OAuth');
                } else {
                    console.log(`🔄 [Team Sync] Đang sync GitHub qua OAuth...${branch ? ` (nhánh: ${branch})` : ' (tất cả nhánh)'}`);
                    
                    const commits = await GithubService.fetchCommits(repoUrl, github.accessToken, {
                        maxCommitsPerBranch: 500,
                        includeBranchInfo: true,
                        branch
                    });
                    
                    const jiraRegex = /[A-Z][A-Z0-9]+-\d+/g;
                    for (const commit of commits) {
                        const checkResult = await GithubCommit.processCommit(commit, teamId, { isSync: true });
                        const branchesToAdd = (commit.branches && commit.branches.length)
                            ? commit.branches
                            : (commit.branch ? [commit.branch] : []);
                        const primaryBranch = commit.branch || (commit.branches && commit.branches[0]) || null;
                        const extractedJiraIssues = [...new Set((commit.message || '').match(jiraRegex) || [])];

                        const setFields = {
                            team_id: teamId,
                            author_email: commit.author_email,
                            author_name: commit.author_name,
                            author_github_id: commit.author_github_id ?? null,
                            message: commit.message,
                            commit_date: commit.commit_date,
                            url: commit.url,
                            branch: primaryBranch,
                            is_counted: checkResult.is_counted,
                            is_merge_commit: !!checkResult.isMergeCommit,
                            rejection_reason: checkResult.is_counted ? null : checkResult.reason,
                            scoring_note_vi: checkResult.scoringNoteVi != null ? checkResult.scoringNoteVi : null
                        };
                        if (checkResult.isMergeCommit) {
                            setFields.ai_score = null;
                            setFields.ai_review = null;
                            setFields.scoring_note_vi = null;
                        }
                        const updateDoc = {
                            $set: setFields
                        };
                        const addToSetFields = {};
                        if (branchesToAdd.length > 0) addToSetFields.branches = { $each: branchesToAdd };
                        if (extractedJiraIssues.length > 0) addToSetFields.jira_issues = { $each: extractedJiraIssues };
                        if (Object.keys(addToSetFields).length > 0) updateDoc.$addToSet = addToSetFields;

                        await GithubCommit.findOneAndUpdate(
                            { team_id: teamId, hash: commit.hash },
                            updateDoc,
                            { upsert: true, new: true }
                        );
                    }
                    results.git = commits.length;
                    console.log(`✅ [Team Sync] Đã sync ${commits.length} commits từ tất cả branches`);

                    try {
                        await persistTeamMemberGitScores(models, teamId);
                    } catch (e) {
                        console.warn('⚠️ [Team Sync] persistTeamMemberGitScores:', e.message);
                    }

                    const io = req.app.get('io') || global._io;
                    if (io && project?._id) {
                        const payload = {
                            projectId: String(project._id),
                            teamId: String(teamId),
                            commitsSynced: results.git,
                            source: 'sync_team_data'
                        };
                        io.to(`project:${String(project._id)}`).emit('sync_github_completed', payload);
                        if (project.class_id) {
                            io.to(String(project.class_id)).emit('sync_github_completed', payload);
                        }
                        console.log(
                            `📡 [Socket] Đã bắn refresh cho GitHub Sync — project=${project._id} commits=${results.git}`
                        );
                    }
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
            if (!repoUrl) {
                results.errors.push('Team/Project chưa có GitHub repository URL.');
                console.log('⚠️ Team/Project chưa có GitHub repo URL');
            }
            if (!currentUser.integrations?.github) {
                results.errors.push('User chưa kết nối GitHub. Vui lòng kết nối GitHub trước.');
                console.log('⚠️ User chưa connect GitHub');
            }
        }

        // ==========================================
        // PHẦN 2: JIRA (OAuth Version)
        // ==========================================
        if ((team.jira_board_id || projectJiraKey) && currentUser.integrations?.jira) {
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
                    // Tìm Jira Board ID: ưu tiên từ Team, fallback từ Project.jiraProjectKey
                    // ==========================================
                    let boardId = team.jira_board_id;
                    if (!boardId) {
                        if (!projectJiraKey) {
                            results.errors.push('Team/Project chưa có Jira Project Key. Không thể xác định Board để sync Jira.');
                            console.log('⚠️ [Team Sync] Thiếu Jira Project Key trên Project');
                            // Bỏ qua phần Jira nhưng vẫn trả tổng kết
                            throw new Error('Thiếu Jira Project Key cho Team/Project');
                        }

                        const boards = await JiraSyncService.fetchBoards({
                            accessToken: jira.accessToken,
                            cloudId: jira.cloudId,
                            projectKey: projectJiraKey,
                            onTokenRefresh
                        });

                        if (!boards || boards.length === 0) {
                            results.errors.push('Không tìm thấy Jira Board cho project này. Vui lòng kiểm tra lại Jira Project Key.');
                            console.log('⚠️ [Team Sync] Không tìm thấy Jira Board');
                            throw new Error('Không tìm thấy Jira Board cho project');
                        }

                        boardId = boards[0].id;
                        await Team.findByIdAndUpdate(teamId, { jira_board_id: boardId });
                    }

                    // ==========================================
                    // BƯỚC 1: SYNC TẤT CẢ SPRINTS (active, future, closed từ Jira)
                    // "Default Sprint" (jira_sprint_id: 0) được tạo ở IntegrationController/WebhookController,
                    // không có trên Jira → sẽ bị xóa ở bước cleanup bên dưới; chỉ giữ sprint thật từ Jira.
                    // ==========================================
                    const sprints = await JiraSyncService.fetchSprints({
                        accessToken: jira.accessToken,
                        cloudId: jira.cloudId,
                        boardId,
                        onTokenRefresh
                    });

                    const sprintMap = new Map();
                    const activeJiraSprintIds = [];

                    for (const s of sprints) {
                        const jiraSprintId = s.id != null ? Number(s.id) : null;
                        if (jiraSprintId == null) continue; // bỏ qua item không có id (giữ id=0 nếu Jira trả về)

                        const stateValue = ((s.state || 'future') + '').toLowerCase();
                        const validState = ['active', 'closed', 'future'].includes(stateValue) ? stateValue : 'future';
                        const savedSprint = await Sprint.findOneAndUpdate(
                            { team_id: teamId, jira_sprint_id: jiraSprintId },
                            {
                                $set: {
                                    team_id: teamId,
                                    jira_sprint_id: jiraSprintId,
                                    name: s.name || `Sprint ${jiraSprintId}`,
                                    state: validState,
                                    isCompleted: validState === 'closed',
                                    start_date: s.startDate ? new Date(s.startDate) : null,
                                    end_date: s.endDate ? new Date(s.endDate) : null,
                                    goal: s.goal || null
                                }
                            },
                            { upsert: true, new: true }
                        );
                        sprintMap.set(jiraSprintId, savedSprint._id);
                        activeJiraSprintIds.push(jiraSprintId);
                        results.jira_sprints++;
                    }

                    // Cleanup Sprint rác: xóa mọi Sprint của team không còn tồn tại trên Jira
                    try {
                        const deleted = await Sprint.deleteMany({
                            team_id: teamId,
                            jira_sprint_id: { $nin: activeJiraSprintIds }
                        });
                        if (deleted.deletedCount > 0) {
                            console.log('🧹 [Team Sync] Đã xóa', deleted.deletedCount, 'Sprint orphan cho team', teamId.toString());
                        }
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
                        boardId,
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