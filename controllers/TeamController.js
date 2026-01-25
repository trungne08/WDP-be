const Team = require('../models/Team');
const JiraService = require('../services/JiraService');

exports.updateTeamConfig = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { 
            jira_url, 
            jira_project_key, 
            jira_board_id, 
            api_token_jira, // Đây là chuỗi Base64 user đã mã hóa sẵn
            github_repo_url, 
            api_token_github 
        } = req.body;

        console.log("🔍 Đang update config cho Team ID:", teamId);

        // 1. Detect Story Point Field (Dùng luôn token user gửi lên)
        let storyPointFieldId = 'customfield_10026'; // Default
        if (jira_url && api_token_jira) {
            try {
                storyPointFieldId = await JiraService.detectStoryPointField(jira_url, api_token_jira);
                console.log(`✅ Detected Field ID: ${storyPointFieldId}`);
            } catch (err) {
                console.warn("⚠️ Detect field failed, using default.");
            }
        }

        // 2. Update DB
        const updatedTeam = await Team.findByIdAndUpdate(
            teamId,
            {
                jira_url,
                jira_project_key,
                jira_board_id,
                api_token_jira, // Lưu thẳng chuỗi Base64
                jira_story_point_field: storyPointFieldId,
                github_repo_url,
                api_token_github,
                last_sync_at: Date.now()
            },
            { new: true }
        );

        if (!updatedTeam) return res.status(404).json({ message: "Không tìm thấy nhóm!" });

        res.json({ message: "✅ Cập nhật cấu hình thành công!", team: updatedTeam });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};