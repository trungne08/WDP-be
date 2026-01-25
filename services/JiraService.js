const axios = require('axios');

// Hàm cấu hình Header cho Jira
const getJiraHeaders = (tokenBase64) => ({
    'Authorization': `Basic ${tokenBase64}`,
    'Accept': 'application/json'
});

// 1. Lấy danh sách Sprint từ Board
const fetchSprints = async (jiraUrl, boardId, tokenBase64) => {
    try {
        // Domain ví dụ: https://trung-swp.atlassian.net
        const cleanUrl = jiraUrl.replace(/\/$/, ""); // Xóa dấu / ở cuối nếu có
        
        const response = await axios.get(`${cleanUrl}/rest/agile/1.0/board/${boardId}/sprint`, {
            headers: getJiraHeaders(tokenBase64)
        });

        return response.data.values.map(sprint => ({
            id: sprint.id,
            name: sprint.name,
            state: sprint.state, // active, future, closed
            startDate: sprint.startDate,
            endDate: sprint.endDate
        }));

    } catch (error) {
        console.error('❌ Lỗi Jira Sprint API:', error.response ? error.response.data : error.message);
        return [];
    }
};

// 2. Lấy Task trong một Sprint
const fetchTasksInSprint = async (jiraUrl, sprintId, tokenBase64) => {
    try {
        const cleanUrl = jiraUrl.replace(/\/$/, "");
        
        const response = await axios.get(`${cleanUrl}/rest/agile/1.0/sprint/${sprintId}/issue`, {
            headers: getJiraHeaders(tokenBase64),
            params: {
                // Chỉ lấy các trường cần thiết để nhẹ gánh
                fields: 'summary,status,assignee,customfield_10026' // customfield_10026 thường là Story Point (check lại trên Jira của bạn)
            }
        });

        return response.data.issues.map(issue => ({
            issue_key: issue.key,
            issue_id: issue.id,
            summary: issue.fields.summary,
            status: issue.fields.status.name,
            status_category: issue.fields.status.statusCategory.name, // To Do, In Progress, Done
            assignee_account_id: issue.fields.assignee ? issue.fields.assignee.accountId : null,
            assignee_name: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
            story_point: issue.fields.customfield_10026 || 0 // Cần check ID của field Story Point trên Jira của bạn
        }));

    } catch (error) {
        console.error(`❌ Lỗi Jira Task API (Sprint ${sprintId}):`, error.message);
        return [];
    }
};

module.exports = { fetchSprints, fetchTasksInSprint };