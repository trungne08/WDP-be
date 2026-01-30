const axios = require('axios');

// ==================================================================
// 1. HELPER FUNCTIONS
// ==================================================================

const getJiraHeaders = (token) => ({
    'Authorization': `Basic ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
});

/**
 * Chuyển đổi String thường -> Jira ADF (Dùng cho Description)
 */
const textToADF = (text) => {
    if (!text) return null;
    return {
        type: "doc",
        version: 1,
        content: [{
            type: "paragraph",
            content: [{ type: "text", text: text }]
        }]
    };
};

// ==================================================================
// 2. MAIN SERVICE
// ==================================================================

module.exports = {

    // --- A. QUẢN LÝ SPRINT (ĐÃ KHÔI PHỤC) ---

    fetchSprints: async (jiraUrl, boardId, tokenBase64) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const response = await axios.get(
                `${cleanUrl}/rest/agile/1.0/board/${boardId}/sprint?state=active,future`,
                { headers: getJiraHeaders(tokenBase64) }
            );
            return response.data.values;
        } catch (error) {
            console.error("Fetch Sprints Error:", error.message);
            return [];
        }
    },

    createJiraSprint: async (jiraUrl, tokenBase64, originBoardId, name, startDate, endDate) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const payload = {
                name: name,
                originBoardId: originBoardId,
                startDate: startDate, // Format: ISO String
                endDate: endDate      // Format: ISO String
            };
            const response = await axios.post(
                `${cleanUrl}/rest/agile/1.0/sprint`, 
                payload, 
                { headers: getJiraHeaders(tokenBase64) }
            );
            return response.data;
        } catch (error) {
            throw new Error(error.response?.data?.message || "Lỗi tạo Sprint trên Jira");
        }
    },

    startJiraSprint: async (jiraUrl, tokenBase64, sprintId, startDate, endDate) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const payload = {
                state: 'active',
                startDate: startDate,
                endDate: endDate
            };
            const response = await axios.post(
                `${cleanUrl}/rest/agile/1.0/sprint/${sprintId}`, 
                payload, 
                { headers: getJiraHeaders(tokenBase64) }
            );
            return response.data;
        } catch (error) {
            throw new Error(error.response?.data?.message || "Lỗi Start Sprint trên Jira");
        }
    },

    updateJiraSprint: async (jiraUrl, tokenBase64, sprintId, data) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const response = await axios.put(
                `${cleanUrl}/rest/agile/1.0/sprint/${sprintId}`, 
                data, 
                { headers: getJiraHeaders(tokenBase64) }
            );
            return response.data;
        } catch (error) {
            throw new Error(error.response?.data?.message || "Lỗi cập nhật Sprint trên Jira");
        }
    },

    // --- B. QUẢN LÝ TASK (CÓ CÁC TRƯỜNG MỚI) ---

    getCustomFieldId: async (jiraUrl, tokenBase64, fieldName) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            // Gọi API lấy toàn bộ danh sách Field
            const response = await axios.get(`${cleanUrl}/rest/api/3/field`, {
                headers: getJiraHeaders(tokenBase64)
            });

            // Tìm field có tên trùng khớp (Không phân biệt hoa thường)
            const field = response.data.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
            
            return field ? field.id : null;
        } catch (error) {
            console.error(`⚠️ Không tìm thấy field "${fieldName}":`, error.message);
            return null;
        }
    },

    fetchTasksInSprint: async (jiraUrl, sprintId, tokenBase64) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const jql = `sprint=${sprintId}`;
            
            // Config ID
            const POINT_FIELD = "customfield_10026"; 
            const START_DATE_FIELD = "customfield_10015";

            const fieldsToGet = `summary,status,issuetype,assignee,reporter,description,duedate,${POINT_FIELD},${START_DATE_FIELD}`;
            
            const searchUrl = `${cleanUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${fieldsToGet}&expand=renderedFields&maxResults=100`;
            
            const response = await axios.get(searchUrl, {
                headers: getJiraHeaders(tokenBase64)
            });

            return response.data.issues.map(issue => {
                const descHtml = issue.renderedFields && issue.renderedFields.description 
                                ? issue.renderedFields.description 
                                : (issue.fields.description || "");

                return {
                    issue_id: issue.id,
                    issue_key: issue.key,
                    summary: issue.fields.summary,
                    description: descHtml,
                    status_name: issue.fields.status.name,
                    status_category: issue.fields.status.statusCategory.name,
                    story_point: issue.fields[POINT_FIELD] || 0,
                    assignee: issue.fields.assignee,
                    reporter: issue.fields.reporter,
                    due_date: issue.fields.duedate,
                    start_date: issue.fields[START_DATE_FIELD]
                };
            });
        } catch (error) {
            console.error("Fetch Tasks Error:", error.message);
            return [];
        }
    },

    createJiraIssue: async (jiraUrl, tokenBase64, data) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            
            // 1. Tự động tìm ID nếu không được truyền vào
            let pointFieldId = data.storyPointFieldId;
            if (!pointFieldId && data.storyPoint) {
                pointFieldId = await module.exports.getCustomFieldId(jiraUrl, tokenBase64, "Story Points");
            }

            let startDateFieldId = data.startDateFieldId;
            if (!startDateFieldId && data.startDate) {
                startDateFieldId = await module.exports.getCustomFieldId(jiraUrl, tokenBase64, "Start date");
            }

            // 2. Build Payload
            const payload = {
                fields: {
                    project: { key: data.projectKey },
                    issuetype: { name: "Task" },
                    summary: data.summary,
                    description: textToADF(data.description || ""),
                    
                    // Assignee & Reporter
                    ...(data.assigneeAccountId && { assignee: { accountId: data.assigneeAccountId } }),
                    ...(data.reporterAccountId && { reporter: { accountId: data.reporterAccountId } }),
                    
                    // Due Date
                    ...(data.duedate && { duedate: data.duedate }),

                    // Custom Fields (Dùng ID vừa tìm được)
                    ...(data.storyPoint && pointFieldId && { [pointFieldId]: Number(data.storyPoint) }),
                    ...(data.startDate && startDateFieldId && { [startDateFieldId]: data.startDate })
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

    updateJiraIssue: async (jiraUrl, tokenBase64, issueKey, data) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const fields = {};

            // 1. Tự động tìm ID nếu cần
            let pointFieldId = data.storyPointFieldId;
            if (!pointFieldId && data.storyPoint !== undefined) {
                pointFieldId = await module.exports.getCustomFieldId(jiraUrl, tokenBase64, "Story Points");
            }

            let startDateFieldId = data.startDateFieldId;
            if (!startDateFieldId && data.startDate) {
                startDateFieldId = await module.exports.getCustomFieldId(jiraUrl, tokenBase64, "Start date");
            }

            // 2. Map dữ liệu
            if (data.summary) fields.summary = data.summary;
            if (data.description) fields.description = textToADF(data.description);
            if (data.assigneeAccountId) fields.assignee = { accountId: data.assigneeAccountId };
            if (data.reporterAccountId) fields.reporter = { accountId: data.reporterAccountId };
            if (data.duedate) fields.duedate = data.duedate;

            // Map Custom Fields
            if (data.storyPoint !== undefined && pointFieldId) {
                fields[pointFieldId] = Number(data.storyPoint);
            }
            if (data.startDate && startDateFieldId) {
                fields[startDateFieldId] = data.startDate;
            }

            if (Object.keys(fields).length === 0) return true;

            await axios.put(
                `${cleanUrl}/rest/api/3/issue/${issueKey}`,
                { fields }, 
                { headers: getJiraHeaders(tokenBase64) }
            );

            return true;
        } catch (error) {
            console.error(`❌ Update Error [${issueKey}]:`, error.response?.data || error.message);
            throw new Error("Lỗi cập nhật Jira");
        }
    },

    // --- C. XÓA & CHUYỂN TRẠNG THÁI (ĐÃ KHÔI PHỤC) ---

    deleteJiraIssue: async (jiraUrl, tokenBase64, issueKeyOrId) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            await axios.delete(
                `${cleanUrl}/rest/api/3/issue/${issueKeyOrId}`, 
                { headers: getJiraHeaders(tokenBase64) }
            );
            return true;
        } catch (error) {
            console.error("Delete Jira Issue Error:", error.message);
            throw new Error("Không thể xóa issue trên Jira");
        }
    },

    transitionIssue: async (jiraUrl, tokenBase64, issueKey, targetStatusName) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            const headers = getJiraHeaders(tokenBase64);
            const transitionsRes = await axios.get(
                `${cleanUrl}/rest/api/3/issue/${issueKey}/transitions`,
                { headers }
            );
            const transition = transitionsRes.data.transitions.find(
                t => t.name.toLowerCase() === targetStatusName.toLowerCase()
            );

            if (!transition) return false;

            await axios.post(
                `${cleanUrl}/rest/api/3/issue/${issueKey}/transitions`,
                { transition: { id: transition.id } },
                { headers }
            );
            return true;
        } catch (error) {
            return false;
        }
    },

    addIssueToSprint: async (jiraUrl, tokenBase64, jiraSprintId, issueKey) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            await axios.post(
                `${cleanUrl}/rest/agile/1.0/sprint/${jiraSprintId}/issue`,
                { issues: [issueKey] },
                { headers: getJiraHeaders(tokenBase64) }
            );
            return true;
        } catch (error) {
            return false;
        }
    },

    moveIssueToBacklog: async (jiraUrl, tokenBase64, issueKey) => {
        try {
            const cleanUrl = jiraUrl.replace(/\/$/, "");
            await axios.post(
                `${cleanUrl}/rest/agile/1.0/backlog/issue`,
                { issues: [issueKey] },
                { headers: getJiraHeaders(tokenBase64) }
            );
            return true;
        } catch (error) {
            return false;
        }
    }
};