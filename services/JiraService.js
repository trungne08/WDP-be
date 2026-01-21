const axios = require('axios');

/**
 * Hàm tạo Header Authen cho Jira
 * @param {string} tokenBase64 - Chuỗi đã mã hóa Base64 (Email:Token)
 */
const getJiraHeaders = (tokenBase64) => ({
    'Authorization': `Basic ${tokenBase64}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
});

/**
 * 1. Lấy danh sách Sprint
 */
const fetchSprints = async (jiraUrl, boardId, tokenBase64) => {
    try {
        if (!jiraUrl || !boardId || !tokenBase64) return [];

        // Xóa dấu / ở cuối URL nếu user lỡ nhập
        const cleanUrl = jiraUrl.replace(/\/$/, ""); 

        console.log(`📡 [JiraService] Đang lấy Sprint từ Board ID: ${boardId}...`);

        const response = await axios.get(`${cleanUrl}/rest/agile/1.0/board/${boardId}/sprint`, {
            headers: getJiraHeaders(tokenBase64),
            params: {
                state: 'active,future,closed', // Lấy tất cả trạng thái
                maxResults: 50
            }
        });

        const sprints = response.data.values.map(sprint => ({
            id: sprint.id,
            name: sprint.name,
            state: sprint.state, // active, closed, future
            startDate: sprint.startDate || null,
            endDate: sprint.endDate || null
        }));

        console.log(`✅ [JiraService] Tìm thấy ${sprints.length} sprints.`);
        return sprints;

    } catch (error) {
        console.error(`❌ [JiraService] Lỗi lấy Sprint: ${error.message}`);
        return [];
    }
};

/**
 * 2. Lấy Task trong một Sprint cụ thể
 */
const fetchTasksInSprint = async (jiraUrl, sprintId, tokenBase64) => {
    try {
        const cleanUrl = jiraUrl.replace(/\/$/, "");
        
        // Gọi API lấy Issue, chỉ lấy các trường cần thiết cho nhẹ
        const response = await axios.get(`${cleanUrl}/rest/agile/1.0/sprint/${sprintId}/issue`, {
            headers: getJiraHeaders(tokenBase64),
            params: {
                // jql: 'issuetype = Story', // Nếu chỉ muốn lấy Story (tùy chọn)
                fields: 'summary,status,assignee,customfield_10026,created,updated', 
                maxResults: 100
            }
        });

        const tasks = response.data.issues.map(issue => {
            // Xử lý Story Point (Vì mỗi Jira mỗi khác, nên check kỹ)
            let sp = 0;
            if (issue.fields.customfield_10026) {
                sp = issue.fields.customfield_10026;
            }

            return {
                issue_key: issue.key,         // SWP-12
                issue_id: issue.id,           // 10021
                summary: issue.fields.summary,
                
                // Trạng thái (To Do, Done...)
                status_name: issue.fields.status.name,
                status_category: issue.fields.status.statusCategory.name, // Quan trọng: dùng để tính điểm (Done)
                
                // Người làm
                assignee_account_id: issue.fields.assignee ? issue.fields.assignee.accountId : null,
                assignee_name: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
                assignee_email: issue.fields.assignee ? issue.fields.assignee.emailAddress : null, // (Lưu ý: Jira mới thường ẩn email)

                story_point: sp,
                created_at: issue.fields.created,
                updated_at: issue.fields.updated
            };
        });

        return tasks;

    } catch (error) {
        console.error(`❌ [JiraService] Lỗi lấy Task (Sprint ${sprintId}): ${error.message}`);
        return [];
    }
};

module.exports = { fetchSprints, fetchTasksInSprint };