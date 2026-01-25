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
    },

    createJiraSprint: async (jiraUrl, tokenBase64, boardId, name, startDate, endDate) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");

            const payload = {
                originBoardId: Number(boardId), // Bắt buộc là số
                name: name,
                startDate: startDate, // ISO String (2024-02-01T09:00:00.000Z)
                endDate: endDate
            };

            const response = await axios.post(`${cleanUrl}/rest/agile/1.0/sprint`, payload, {
                headers: getJiraHeaders(tokenBase64)
            });
            return response.data;

        } catch (error) {
            console.error("❌ Create Sprint Error:", error.response?.data || error.message);
            // Ném lỗi chi tiết để Controller bắt được
            throw new Error(error.response?.data?.message || "Lỗi tạo Sprint bên Jira");
        }
    },

    updateJiraSprint: async (jiraUrl, tokenBase64, jiraSprintId, data) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            
            // Jira chỉ cho phép update các trường này
            const payload = {};
            if (data.name) payload.name = data.name;
            if (data.startDate) payload.startDate = data.startDate;
            if (data.endDate) payload.endDate = data.endDate;
            if (data.state) payload.state = data.state; // active, future, closed

            const response = await axios.put(`${cleanUrl}/rest/agile/1.0/sprint/${jiraSprintId}`, payload, {
                headers: getJiraHeaders(tokenBase64)
            });
            
            return response.data;

        } catch (error) {
            console.error("❌ Update Sprint Error:", error.response?.data || error.message);
            throw new Error(error.response?.data?.message || "Không thể cập nhật Sprint trên Jira");
        }
    },

    startJiraSprint: async (jiraUrl, tokenBase64, sprintId, startDate, endDate) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            
            // Payload bắt buộc để Start Sprint trên Jira
            const payload = {
                state: 'active',
                startDate: startDate, // Định dạng ISO 8601 (VD: 2024-02-01T09:00:00.000Z)
                endDate: endDate
            };

            // Gọi API Jira Agile: POST /rest/agile/1.0/sprint/{sprintId}
            // Lưu ý: Endpoint này dùng chung cho update, nhưng khi gửi state='active' nó sẽ hiểu là Start Sprint
            const response = await axios.post(`${cleanUrl}/rest/agile/1.0/sprint/${sprintId}`, payload, {
                headers: getJiraHeaders(tokenBase64)
            });
            
            return response.data;

        } catch (error) {
            console.error("❌ Start Sprint Error:", error.response?.data || error.message);
            // Ném lỗi chi tiết ra để Controller bắt được
            throw new Error(error.response?.data?.message || "Không thể bắt đầu Sprint trên Jira");
        }
    },

    addIssueToSprint: async (jiraUrl, tokenBase64, jiraSprintId, issueKey) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            
            // Payload nhận mảng các issue keys
            const payload = {
                issues: [issueKey]
            };

            await axios.post(`${cleanUrl}/rest/agile/1.0/sprint/${jiraSprintId}/issue`, payload, {
                headers: getJiraHeaders(tokenBase64)
            });
            
            return true;
        } catch (error) {
            console.error("❌ Move to Sprint Error:", error.response?.data || error.message);
            // Không throw lỗi chết app, chỉ log ra để biết
            return false;
        }
    },

    /**
     * ĐÁ ISSUE VỀ BACKLOG
     * POST /rest/agile/1.0/backlog/issue
     */
    moveIssueToBacklog: async (jiraUrl, tokenBase64, issueKey) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            
            const payload = {
                issues: [issueKey]
            };

            await axios.post(`${cleanUrl}/rest/agile/1.0/backlog/issue`, payload, {
                headers: getJiraHeaders(tokenBase64)
            });
            
            return true;
        } catch (error) {
            console.error("❌ Move to Backlog Error:", error.response?.data || error.message);
            return false;
        }
    }
};

module.exports = JiraService;