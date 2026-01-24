const models = require('../models');
const IntegrationService = require('../services/IntegrationService');

/**
 * Đồng bộ Leader từ Jira về WDP
 * Logic:
 * 1. Lấy Jira Project Key từ Team
 * 2. Gọi Jira API lấy thông tin Project (bao gồm Lead Account ID)
 * 3. Tìm Student có Jira Account ID tương ứng
 * 4. Cập nhật Role trong TeamMember
 */
const syncJiraLeader = async (req, res) => {
    try {
        const { teamId } = req.params;
        
        // 1. Lấy thông tin Team
        const team = await models.Team.findById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Không tìm thấy nhóm' });
        }

        if (!team.jira_project_key) {
            return res.status(400).json({ error: 'Nhóm chưa được liên kết với dự án Jira (thiếu project key)' });
        }

        // 2. Lấy Token để gọi Jira API
        // Ưu tiên lấy của user đang request (nếu user đó đã link Jira)
        const requestUser = await models.Student.findById(req.user.userId);
        
        // Kiểm tra xem user có tồn tại không
        if (!requestUser) {
             return res.status(404).json({ error: 'Không tìm thấy thông tin người dùng.' });
        }

        const jiraIntegration = requestUser.integrations?.jira;

        if (!jiraIntegration || !jiraIntegration.accessToken || !jiraIntegration.cloudId) {
            return res.status(400).json({ 
                error: 'Bạn cần liên kết tài khoản Jira để thực hiện đồng bộ dữ liệu.' 
            });
        }

        // TODO: Có thể thêm logic refresh token nếu token hết hạn (IntegrationService.refreshAtlassianAccessToken)
        // Tạm thời giả định token còn hạn hoặc client sẽ handle re-login

        // 3. Gọi Jira API lấy thông tin Project
        console.log(`🔄 Đang đồng bộ Leader cho team ${team.project_name} (Jira Key: ${team.jira_project_key})...`);
        
        let projectInfo;
        try {
            projectInfo = await IntegrationService.fetchJiraProjectInfo({
                accessToken: jiraIntegration.accessToken,
                cloudId: jiraIntegration.cloudId,
                projectKey: team.jira_project_key
            });
        } catch (jiraError) {
            console.error('Lỗi gọi Jira API:', jiraError.response?.data || jiraError.message);
            
            // Xử lý lỗi 401 (Unauthorized) -> Token hết hạn
            if (jiraError.response?.status === 401) {
                 return res.status(401).json({
                    error: 'Token Jira đã hết hạn. Vui lòng kết nối lại tài khoản Jira.'
                 });
            }

            return res.status(502).json({ 
                error: 'Không thể lấy thông tin dự án từ Jira. Vui lòng kiểm tra quyền truy cập hoặc kết nối lại tài khoản Jira.',
                details: jiraError.response?.data?.errorMessages || jiraError.message
            });
        }

        if (!projectInfo || !projectInfo.lead || !projectInfo.lead.accountId) {
            return res.status(400).json({ error: 'Jira không trả về thông tin Project Lead hợp lệ.' });
        }

        const jiraLeadAccountId = projectInfo.lead.accountId;
        const jiraLeadName = projectInfo.lead.displayName;
        
        console.log(`🎯 Jira Leader: ${jiraLeadName} (AccountId: ${jiraLeadAccountId})`);

        // 4. Tìm Student trong DB có accountId này
        const newLeaderUser = await models.Student.findOne({
            'integrations.jira.jiraAccountId': jiraLeadAccountId
        });

        if (!newLeaderUser) {
            return res.status(404).json({ 
                error: `Tìm thấy Leader trên Jira là "${jiraLeadName}", nhưng sinh viên này chưa liên kết tài khoản Jira vào hệ thống WDP nên không thể đồng bộ.` 
            });
        }

        // Kiểm tra xem sinh viên này có trong Team không
        const isMember = await models.TeamMember.findOne({
            team_id: teamId,
            student_id: newLeaderUser._id
        });

        if (!isMember) {
            return res.status(400).json({ 
                error: `Sinh viên "${newLeaderUser.full_name}" (Leader trên Jira) không phải là thành viên của nhóm này trên WDP.` 
            });
        }

        // 5. Cập nhật Role
        // Bước 5a: Reset tất cả thành Member
        await models.TeamMember.updateMany(
            { team_id: teamId },
            { role_in_team: 'Member' }
        );

        // Bước 5b: Set Leader mới
        await models.TeamMember.updateOne(
            { team_id: teamId, student_id: newLeaderUser._id },
            { role_in_team: 'Leader' }
        );

        res.json({
            message: '✅ Đã đồng bộ Leader từ Jira thành công!',
            jira_leader: jiraLeadName,
            new_leader: newLeaderUser.full_name,
            student_code: newLeaderUser.student_code
        });

    } catch (error) {
        console.error('Sync Jira Leader Error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    syncJiraLeader
};
