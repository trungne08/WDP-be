const IntegrationController = require('../controllers/IntegrationController');
const { authenticateToken } = require('../middleware/auth');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // INTEGRATIONS APIs (Account Integration)
    // ==========================================

    /**
     * @swagger
     * /api/integrations/github/connect:
     *   get:
     *     summary: Bắt đầu flow OAuth2 kết nối GitHub
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       User đã đăng nhập gọi API này để redirect sang GitHub authorize.
     *       Scope: `repo`, `user`.
     *     responses:
     *       302:
     *         description: Redirect sang GitHub
     */
    app.get('/api/integrations/github/connect', authenticateToken, IntegrationController.githubConnect);

    /**
     * @swagger
     * /api/integrations/github/callback:
     *   get:
     *     summary: GitHub OAuth2 callback
     *     tags: [Integrations]
     *     description: |
     *       GitHub redirect về đây với `code` và `state`.
     *       Server sẽ exchange code lấy access token, gọi `/user` để lấy githubId/username và lưu vào DB.
     *     parameters:
     *       - in: query
     *         name: code
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: state
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Kết nối GitHub thành công
     */
    app.get('/api/integrations/github/callback', IntegrationController.githubCallback);

    /**
     * @swagger
     * /api/integrations/jira/connect:
     *   get:
     *     summary: Bắt đầu flow OAuth2 kết nối Jira (Atlassian)
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       User đã đăng nhập gọi API này để redirect sang Atlassian authorize.
     *       Scope: `read:jira-user`, `read:jira-work`, `offline_access`.
     *     responses:
     *       302:
     *         description: Redirect sang Atlassian
     */
    app.get('/api/integrations/jira/connect', authenticateToken, IntegrationController.jiraConnect);

    /**
     * @swagger
     * /api/integrations/jira/callback:
     *   get:
     *     summary: Jira (Atlassian) OAuth2 callback
     *     tags: [Integrations]
     *     description: |
     *       Atlassian redirect về đây với `code` và `state`.
     *       Server sẽ:
     *       - Exchange code lấy access_token + refresh_token
     *       - Gọi `accessible-resources` để lấy `cloudId`
     *       - Gọi `/myself` để lấy `accountId` (jiraAccountId)
     *       - Lưu vào DB (integrations.jira)
     *     parameters:
     *       - in: query
     *         name: code
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: state
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Kết nối Jira thành công
     */
    app.get('/api/integrations/jira/callback', IntegrationController.jiraCallback);

    /**
     * @swagger
     * /api/integrations/github/repos:
     *   get:
     *     summary: Lấy danh sách repo GitHub để chọn từ dropdown
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Lấy token GitHub đã lưu trong DB → gọi GitHub API `/user/repos` → trả về danh sách repo.
     *     responses:
     *       200:
     *         description: Danh sách repo
     *       400:
     *         description: Chưa link GitHub
     */
    app.get('/api/integrations/github/repos', authenticateToken, IntegrationController.getGithubRepos);

    /**
     * @swagger
     * /api/integrations/jira/projects:
     *   get:
     *     summary: Lấy danh sách Jira project để chọn từ dropdown
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Lấy token Jira + cloudId đã lưu trong DB → gọi Jira API `/rest/api/3/project/search` → trả về danh sách project.
     *       Nếu token hết hạn sẽ thử refresh bằng refreshToken (offline_access) rồi gọi lại.
     *     responses:
     *       200:
     *         description: Danh sách project
     *       400:
     *         description: Chưa link Jira
     */
    app.get('/api/integrations/jira/projects', authenticateToken, IntegrationController.getJiraProjects);
};

