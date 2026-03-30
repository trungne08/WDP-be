const Team = require('../models/Team');
const JiraService = require('../services/JiraService'); // Legacy - Deprecated
const JiraSyncService = require('../services/JiraSyncService'); // OAuth version
const JiraAuthService = require('../services/JiraAuthService');

/**
 * Update Team Config - Full OAuth Version
 * Không cần api_token_jira và api_token_github nữa - dùng user OAuth tokens
 */
exports.updateTeamConfig = async (req, res) => {
    try {
        const currentUser = req.user;
        const { teamId } = req.params;
        const { 
            jira_project_key, 
            jira_board_id,
            github_repo_url
        } = req.body;

        console.log('🔍 Đang update config cho Team ID:', teamId);

        // Validate OAuth connections
        let storyPointFieldId = 'customfield_10026'; // Default
        
        // Check Jira OAuth nếu có Jira config
        if (jira_board_id || jira_project_key) {
            const jira = currentUser.integrations?.jira;
            
            if (!jira?.accessToken || !jira?.cloudId) {
                return res.status(400).json({ 
                    error: 'Chưa kết nối Jira. Vui lòng kết nối Jira OAuth trước.',
                    requiresAuth: true
                });
            }

            // Auto-detect Story Point Field qua OAuth
            try {
                const clientId = process.env.ATLASSIAN_CLIENT_ID;
                const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;

                const client = await JiraSyncService.syncWithAutoRefresh({
                    user: currentUser,
                    clientId,
                    clientSecret,
                    syncFunction: async (client) => client
                });

                const fieldId = await JiraSyncService.getCustomFieldId(client, 'Story Points');
                if (fieldId) {
                    storyPointFieldId = fieldId;
                    console.log(`✅ Detected Story Point Field: ${storyPointFieldId}`);
                }
            } catch (err) {
                console.warn('⚠️ Detect field failed, using default:', err.message);
            }
        }
        
        // Check GitHub OAuth nếu có GitHub config
        if (github_repo_url) {
            const github = currentUser.integrations?.github;
            
            if (!github?.accessToken) {
                return res.status(400).json({ 
                    error: 'Chưa kết nối GitHub. Vui lòng kết nối GitHub OAuth trước.',
                    requiresAuth: true
                });
            }
            
            console.log('✅ GitHub OAuth connection verified');
        }

        // Update DB (không lưu api_token_jira và api_token_github nữa)
        const updatedTeam = await Team.findByIdAndUpdate(
            teamId,
            {
                jira_project_key,
                jira_board_id,
                jira_story_point_field: storyPointFieldId,
                github_repo_url,
                // ❌ REMOVED: api_token_jira (dùng user OAuth)
                // ❌ REMOVED: api_token_github (dùng user OAuth)
                last_sync_at: Date.now()
            },
            { new: true }
        );

        if (!updatedTeam) return res.status(404).json({ message: 'Không tìm thấy nhóm!' });

        // Manual Socket Emission: khôi phục realtime khi đã tắt ChangeStream
        if (global._io && updatedTeam.class_id) {
            const classRoom = String(updatedTeam.class_id);
            global._io.to(classRoom).emit('team_updated', {
                action: 'update',
                data: updatedTeam
            });
        }

        res.json({ message: '✅ Cập nhật cấu hình thành công!', team: updatedTeam });

    } catch (error) {
        console.error('❌ Update Team Config Error:', error.message);
        
        if (error.code === 'JIRA_NOT_CONNECTED' || error.code === 'GITHUB_NOT_CONNECTED') {
            return res.status(400).json({ error: error.message, requiresAuth: true });
        }
        if (error.code === 'REFRESH_TOKEN_MISSING' || error.code === 'REFRESH_TOKEN_EXPIRED') {
            return res.status(401).json({ error: error.message, requiresReauth: true });
        }
        
        res.status(500).json({ error: error.message });
    }
};