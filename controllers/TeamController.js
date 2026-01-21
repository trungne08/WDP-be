// src/controllers/TeamController.js
const Team = require('../models/Team');

// 1. Cập nhật cấu hình cho Team (Leader nhập Token vào đây)
exports.updateTeamConfig = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { 
            jira_url, jira_project_key, jira_board_id, api_token_jira, // Jira Info
            github_repo_url, api_token_github // Git Info
        } = req.body;
        console.log("🔍 Đang tìm ID:", teamId);
        console.log("📂 Database đang kết nối:", require('mongoose').connection.name);
        
        console.log("🔍 Đang tìm ID từ URL:", teamId);
        
        // --- THÊM ĐOẠN NÀY ---
        // 1. In ra tất cả các nhóm đang có trong Database mà code nhìn thấy
        const allTeams = await Team.find({}); 
        console.log(`📋 Code tìm thấy ${allTeams.length} nhóm trong collection 'teams':`);
        console.log(allTeams);
        // Tìm và update
        const updatedTeam = await Team.findByIdAndUpdate(
            teamId,
            {
                jira_url,
                jira_project_key,
                jira_board_id,
                api_token_jira,      // Lưu ý: Với Jira yêu cầu nhập chuỗi Base64 (Email:Token)
                github_repo_url,
                api_token_github,
                last_sync_at: Date.now()
            },
            { new: true } // Trả về data mới sau khi update
        );

        if (!updatedTeam) {
            return res.status(404).json({ message: "Không tìm thấy nhóm này!" });
        }

        res.json({ message: "✅ Cập nhật cấu hình thành công!", team: updatedTeam });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};