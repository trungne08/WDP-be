const axios = require('axios');

// Hàm cấu hình Header cho Jira
const getJiraHeaders = (tokenBase64) => ({
    'Authorization': `Basic ${tokenBase64}`,
    'Accept': 'application/json'
});
const JiraService = {
    // 1. Lấy danh sách Sprint từ Board
    fetchSprints: async (jiraUrl, boardId, tokenBase64) => {
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
    },

    // 2. Lấy Task trong một Sprint
    fetchTasksInSprint: async (jiraUrl, sprintId, tokenBase64) => {
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
    },

    detectStoryPointField: async (jiraUrl, tokenBase64) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const response = await axios.get(`${cleanUrl}/rest/api/3/field`, {
                headers: getJiraHeaders(tokenBase64)
            });

            const targetField = response.data.find(f => 
                f.name === 'Story Points' || f.name === 'Story point estimate' || f.name === 'Story Points (Agile)'
            );
            return targetField ? targetField.id : 'customfield_10026';
        } catch (error) {
            return 'customfield_10026';
        }
    },

    // ==========================================
    // 3. CÁC HÀM CRUD (Dùng token trực tiếp)
    // ==========================================

    createJiraIssue: async (jiraUrl, tokenBase64, data) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const payload = {
                fields: {
                    project: { key: data.projectKey },
                    summary: data.summary,
                    description: { 
                        type: "doc", 
                        version: 1, 
                        content: [{ type: "paragraph", content: [{ type: "text", text: data.description || "" }] }] 
                    },
                    issuetype: { name: "Task" },
                    ...(data.assigneeAccountId && { assignee: { accountId: data.assigneeAccountId } }),
                    ...(data.storyPoint && { [data.storyPointFieldId || 'customfield_10026']: Number(data.storyPoint) })
                }
            };

            const response = await axios.post(`${cleanUrl}/rest/api/3/issue`, payload, {
                headers: getJiraHeaders(tokenBase64)
            });
            return response.data;
        } catch (error) {
            console.error("❌ Create Jira Issue Error:", error.response?.data || error.message);
            throw new Error(JSON.stringify(error.response?.data?.errors || error.message));
        }
    },

    updateJiraIssue: async (jiraUrl, tokenBase64, issueIdOrKey, data) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const payload = { fields: {} };

            if (data.summary) payload.fields.summary = data.summary;
            if (data.assigneeAccountId) payload.fields.assignee = { accountId: data.assigneeAccountId };
            if (data.storyPoint) {
                const fieldId = data.storyPointFieldId || 'customfield_10026';
                payload.fields[fieldId] = Number(data.storyPoint);
            }
            
            await axios.put(`${cleanUrl}/rest/api/3/issue/${issueIdOrKey}`, payload, {
                headers: getJiraHeaders(tokenBase64)
            });
            return true;
        } catch (error) {
            console.error("❌ Update Jira Issue Error:", error.response?.data || error.message);
            throw new Error("Không thể cập nhật Task trên Jira");
        }
    },

    deleteJiraIssue: async (jiraUrl, tokenBase64, issueIdOrKey) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            await axios.delete(`${cleanUrl}/rest/api/3/issue/${issueIdOrKey}`, {
                headers: getJiraHeaders(tokenBase64)
            });
            return true;
        } catch (error) {
            console.error("❌ Delete Jira Issue Error:", error.response?.data || error.message);
            throw new Error("Không thể xóa Task trên Jira");
        }
    }
};

module.exports = JiraService;