const axios = require('axios');

// ==================================================================
// ⚠️ DEPRECATION NOTICE
// ==================================================================
// 
// JiraService (Basic Auth) đã DEPRECATED!
// 
// Lý do:
// - Bảo mật thấp hơn OAuth 2.0
// - Không tự động refresh token
// - Không có granular permissions
// - User phải manually tạo API token
// 
// Thay thế:
// - Dùng JiraSyncService (OAuth 2.0) cho tất cả Jira operations
// - Dùng JiraAuthService cho authentication flow
// 
// Migration guide:
// 1. User connect Jira qua OAuth: POST /api/integrations/jira/connect
// 2. Dùng JiraSyncService.syncWithAutoRefresh() cho tất cả API calls
// 3. Xóa team.api_token_jira, team.jira_url khỏi DB
// 
// ==================================================================

// ==================================================================
// 1. HELPER FUNCTIONS (LEGACY)
// ==================================================================

const getJiraHeaders = (token) => {
    console.warn('⚠️ [DEPRECATED] getJiraHeaders() - Please use JiraSyncService with OAuth 2.0');
    return {
        'Authorization': `Basic ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
};

/**
 * Chuyển đổi String thường -> Jira ADF (Dùng cho Description)
 * @deprecated Use JiraSyncService instead
 */
const textToADF = (text) => {
    console.warn('⚠️ [DEPRECATED] textToADF() - Please use JiraSyncService with OAuth 2.0');
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

    fetchAllBoardIssues: async (jiraUrl, boardId, tokenBase64) => {
        const cleanUrl = jiraUrl.replace(/\/$/, "");
        let allIssues = [];
        let startAt = 0;
        let isLast = false;

        // 1. Dò ID các field quan trọng
        const pointFieldId = await module.exports.getCustomFieldId(jiraUrl, tokenBase64, "Story Points") || "customfield_10026";
        // Field "Sprint" chứa thông tin sprint của task (Thường là customfield_10020)
        const sprintFieldId = await module.exports.getCustomFieldId(jiraUrl, tokenBase64, "Sprint") || "customfield_10020";

        try {
            while (!isLast) {
                // Gọi API Board Issue (Không lọc JQL gì cả -> Lấy hết)
                const response = await axios.get(`${cleanUrl}/rest/agile/1.0/board/${boardId}/issue`, {
                    headers: getJiraHeaders(tokenBase64),
                    params: {
                        startAt: startAt,
                        maxResults: 50,
                        fields: `summary,status,assignee,description,duedate,reporter,${pointFieldId},${sprintFieldId}`
                    }
                });

                const issues = response.data.issues;

                const mappedIssues = issues.map(issue => {
                    // --- LOGIC TÁCH SPRINT ---
                    let currentSprintId = null;
                    const sprintsData = issue.fields[sprintFieldId];

                    if (sprintsData && Array.isArray(sprintsData) && sprintsData.length > 0) {
                        // Jira trả về mảng các sprint task từng đi qua.
                        // Sprint đang active hoặc future thường nằm cuối mảng.
                        // Cấu trúc item: { id: 123, name: 'Sprint 1', state: 'active' }
                        const lastSprint = sprintsData[sprintsData.length - 1];
                        
                        // Parse ID (tùy version Jira trả về Object hay String)
                        if (lastSprint && lastSprint.id) {
                            currentSprintId = lastSprint.id;
                        } else if (typeof lastSprint === 'string') {
                            const match = lastSprint.match(/id=(\d+)/);
                            if (match) currentSprintId = Number(match[1]);
                        }
                    } 
                    // Nếu sprintsData null hoặc rỗng -> Task này đang ở Backlog (currentSprintId = null)

                    return {
                        issue_key: issue.key,
                        issue_id: issue.id,
                        summary: issue.fields.summary,
                        description: issue.fields.description || "",
                        status_name: issue.fields.status.name,
                        status_category: issue.fields.status.statusCategory.name,
                        assignee_account_id: issue.fields.assignee ? issue.fields.assignee.accountId : null,
                        reporter_account_id: issue.fields.reporter ? issue.fields.reporter.accountId : null,
                        due_date: issue.fields.duedate,
                        story_point: issue.fields[pointFieldId] || 0,
                        
                        // ID Sprint lấy từ Jira (để lát nữa map với DB)
                        jira_sprint_id: currentSprintId 
                    };
                });

                allIssues.push(...mappedIssues);

                if (issues.length < 50) isLast = true;
                else startAt += 50;
            }
            
            console.log(`📦 [Board Sync] Tổng cộng: ${allIssues.length} tasks (Sprint + Backlog).`);
            return allIssues;

        } catch (error) {
            console.error(`❌ Lỗi Fetch Board Issues:`, error.message);
            throw error;
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
        console.warn('⚠️ [DEPRECATED] moveIssueToBacklog() - Please use JiraSyncService with OAuth 2.0');
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

// ==================================================================
// ⚠️ FINAL WARNING
// ==================================================================
// 
// Nếu bạn đang thấy file này, có nghĩa là:
// 
// 1. Code của bạn đang dùng Basic Auth (KHÔNG AN TOÀN)
// 2. Token có thể hết hạn mà không tự refresh
// 3. Bạn đang miss out các tính năng OAuth 2.0
// 
// HÀNH ĐỘNG NGAY:
// → Migrate sang JiraSyncService + JiraAuthService
// → Xem IntegrationController để hiểu OAuth flow
// → Xem JiraController (refactored) để hiểu cách dùng
// 
// ==================================================================