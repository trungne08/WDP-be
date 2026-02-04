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
     *       User đã đăng nhập gọi API này để lấy URL GitHub authorize.
     *       Frontend sẽ nhận được `redirectUrl` và tự redirect bằng `window.location.href = redirectUrl`.
     *       Scope: `repo`, `user`.
     *     parameters:
     *       - in: query
     *         name: redirect_uri
     *         required: false
     *         schema:
     *           type: string
     *         description: |
     *           URL frontend để redirect về sau khi callback thành công.
     *           Ví dụ: `http://localhost:3000` (dev local) hoặc `https://your-fe-domain.com` (production).
     *           Nếu không truyền, sẽ dùng CLIENT_URL từ env hoặc mặc định `http://localhost:3000`.
     *     responses:
     *       200:
     *         description: Trả về URL để redirect đến GitHub
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 redirectUrl:
     *                   type: string
     *                   example: https://github.com/login/oauth/authorize?client_id=...
     */
    app.get('/api/integrations/github/connect', authenticateToken, IntegrationController.githubConnect);

    // Route tương thích với flow cũ /auth/github
    // Hỗ trợ query ?platform=web|mobile hoặc header x-platform để chọn GitHub App tương ứng
    app.get('/auth/github', authenticateToken, IntegrationController.githubConnect);

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

    // Route tương thích với cấu hình GitHub OAuth app cũ (/auth/github/callback)
    app.get('/auth/github/callback', IntegrationController.githubCallback);

    /**
     * @swagger
     * /api/integrations/jira/connect:
     *   get:
     *     summary: Bắt đầu flow OAuth2 kết nối Jira (Atlassian)
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       User đã đăng nhập gọi API này để lấy URL Atlassian authorize.
     *       Frontend sẽ nhận được `redirectUrl` và tự redirect bằng `window.location.href = redirectUrl`.
     *       Scope: `read:jira-user`, `read:jira-work`, `offline_access`.
     *     parameters:
     *       - in: query
     *         name: redirect_uri
     *         required: false
     *         schema:
     *           type: string
     *         description: |
     *           URL frontend để redirect về sau khi callback thành công.
     *           Ví dụ: `http://localhost:3000` (dev local) hoặc `https://your-fe-domain.com` (production).
     *           Nếu không truyền, sẽ dùng CLIENT_URL từ env hoặc mặc định `http://localhost:3000`.
     *     responses:
     *       200:
     *         description: Trả về URL để redirect đến Atlassian
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 redirectUrl:
     *                   type: string
     *                   example: https://auth.atlassian.com/authorize?client_id=...
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

    // Route tương thích với cấu hình Jira OAuth app (cả /auth/jira/callback và /auth/atlassian/callback)
    app.get('/auth/jira/callback', IntegrationController.jiraCallback);
    app.get('/auth/atlassian/callback', IntegrationController.jiraCallback);

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
     *       401:
     *         description: GitHub token không hợp lệ hoặc đã hết hạn (cần reconnect)
     *       500:
     *         description: Lỗi server
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
     *       401:
     *         description: Jira token không hợp lệ hoặc đã hết hạn (cần reconnect)
     *       500:
     *         description: Lỗi server
     */
    app.get('/api/integrations/jira/projects', authenticateToken, IntegrationController.getJiraProjects);

    /**
     * @swagger
     * /api/integrations/jira/boards:
     *   get:
     *     summary: Lấy danh sách boards của một Jira project
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Lấy danh sách boards (Scrum/Kanban) của một Jira project.
     *       Dùng để lấy board_id khi tạo project.
     *     parameters:
     *       - in: query
     *         name: projectKey
     *         required: true
     *         schema:
     *           type: string
     *         description: Jira project key (e.g., SCRUM, SWP)
     *     responses:
     *       200:
     *         description: Danh sách boards
     *       400:
     *         description: Thiếu projectKey hoặc chưa kết nối Jira
     *       401:
     *         description: Jira token không hợp lệ hoặc đã hết hạn (cần reconnect)
     *       500:
     *         description: Lỗi server
     */
    app.get('/api/integrations/jira/boards', authenticateToken, IntegrationController.getJiraBoards);

    /**
     * @swagger
     * /api/integrations/github/disconnect:
     *   delete:
     *     summary: Ngắt kết nối tài khoản GitHub
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       User đã đăng nhập có thể ngắt kết nối tài khoản GitHub đã liên kết.
     *       Sau khi ngắt kết nối, user có thể kết nối với tài khoản GitHub khác.
     *     responses:
     *       200:
     *         description: Ngắt kết nối GitHub thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "✅ Đã ngắt kết nối GitHub thành công!"
     *                 github:
     *                   type: null
     *       400:
     *         description: Chưa kết nối GitHub
     *       404:
     *         description: Không tìm thấy user
     */
    app.delete('/api/integrations/github/disconnect', authenticateToken, IntegrationController.disconnectGithub);

    /**
     * @swagger
     * /api/integrations/jira/disconnect:
     *   delete:
     *     summary: Ngắt kết nối tài khoản Jira (Atlassian)
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       User đã đăng nhập có thể ngắt kết nối tài khoản Jira đã liên kết.
     *       Sau khi ngắt kết nối, user có thể kết nối với tài khoản Jira khác.
     *     responses:
     *       200:
     *         description: Ngắt kết nối Jira thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "✅ Đã ngắt kết nối Jira thành công!"
     *                 jira:
     *                   type: null
     *       400:
     *         description: Chưa kết nối Jira
     *       404:
     *         description: Không tìm thấy user
     */
    app.delete('/api/integrations/jira/disconnect', authenticateToken, IntegrationController.disconnectJira);

    /**
     * @swagger
     * /api/integrations/projects/{projectId}/sync:
     *   post:
     *     summary: User tự đồng bộ dữ liệu GitHub và Jira cho project của mình
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       User (leader hoặc member) có thể tự sync dữ liệu GitHub commits và Jira tasks cho project của họ.
     *       Sử dụng accessToken từ integrations của chính user (không cần token từ team config).
     *       Yêu cầu:
     *       - User phải là leader hoặc member của project
     *       - User phải đã kết nối GitHub (nếu muốn sync GitHub)
     *       - User phải đã kết nối Jira (nếu muốn sync Jira)
     *       - Project phải có githubRepoUrl (nếu muốn sync GitHub)
     *       - Project phải có jiraProjectKey (nếu muốn sync Jira)
     *     parameters:
     *       - in: path
     *         name: projectId
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của project cần sync
     *     responses:
     *       200:
     *         description: Sync thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "✅ Đồng bộ dữ liệu hoàn tất!"
     *                 stats:
     *                   type: object
     *                   properties:
     *                     github:
     *                       type: number
     *                       description: Số commits đã sync
     *                     jira:
     *                       type: number
     *                       description: Số tasks đã sync
     *                     errors:
     *                       type: array
     *                       items:
     *                         type: string
     *       403:
     *         description: Không có quyền sync project này
     *       404:
     *         description: Không tìm thấy project
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/integrations/projects/:projectId/sync', authenticateToken, IntegrationController.syncMyProjectData);

    /**
     * @swagger
     * /api/integrations/my-commits:
     *   get:
     *     summary: Member xem commits GitHub của chính mình
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Member có thể xem commits GitHub của chính họ.
     *       Dữ liệu được lấy từ project mà user đang tham gia.
     *     parameters:
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: number
     *         description: Số lượng commits tối đa (mặc định 50, tối đa 100)
     *     responses:
     *       200:
     *         description: Danh sách commits của user
     */
    app.get('/api/integrations/my-commits', authenticateToken, IntegrationController.getMyCommits);

    /**
     * @swagger
     * /api/integrations/my-tasks:
     *   get:
     *     summary: Member xem tasks Jira của chính mình
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Member có thể xem tasks Jira của chính họ.
     *       Dữ liệu được lấy từ project mà user đang tham gia.
     *     parameters:
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: number
     *         description: Số lượng tasks tối đa (mặc định 50, tối đa 100)
     *       - in: query
     *         name: status
     *         required: false
     *         schema:
     *           type: string
     *         description: Lọc theo status (ví dụ Done, In Progress)
     *     responses:
     *       200:
     *         description: Danh sách tasks của user
     */
    app.get('/api/integrations/my-tasks', authenticateToken, IntegrationController.getMyTasks);

    /**
     * @swagger
     * /api/integrations/team/{teamId}/commits:
     *   get:
     *     summary: Leader xem commits GitHub của cả team (tất cả members)
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Chỉ Leader mới có quyền xem commits của cả team.
     *       Trả về commits của tất cả members trong team, phân loại theo từng member.
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: number
     *         description: Số lượng commits tối đa (mặc định 100, tối đa 500)
     *     responses:
     *       200:
     *         description: Commits của cả team
     *       403:
     *         description: Chỉ Leader mới có quyền
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/integrations/team/:teamId/commits', authenticateToken, IntegrationController.getTeamCommits);

    /**
     * @swagger
     * /api/integrations/team/{teamId}/tasks:
     *   get:
     *     summary: Leader xem tasks Jira của cả team (tất cả members)
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Chỉ Leader mới có quyền xem tasks của cả team.
     *       Trả về tasks của tất cả members trong team, phân loại theo từng member.
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: number
     *         description: Số lượng tasks tối đa (mặc định 100, tối đa 500)
     *       - in: query
     *         name: status
     *         required: false
     *         schema:
     *           type: string
     *         description: Lọc theo status (ví dụ Done, In Progress)
     *     responses:
     *       200:
     *         description: Tasks của cả team
     *       403:
     *         description: Chỉ Leader mới có quyền
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/integrations/team/:teamId/tasks', authenticateToken, IntegrationController.getTeamTasks);

    /**
     * @swagger
     * /api/integrations/team/{teamId}/member/{memberId}/commits:
     *   get:
     *     summary: Leader xem commits GitHub của một member cụ thể
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Chỉ Leader mới có quyền xem commits của member khác.
     *       Trả về commits GitHub của member được chỉ định.
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *       - in: path
     *         name: memberId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: number
     *         description: Số lượng commits tối đa (mặc định 50, tối đa 100)
     *     responses:
     *       200:
     *         description: Commits của member
     *       403:
     *         description: Chỉ Leader mới có quyền
     *       404:
     *         description: Không tìm thấy team hoặc member
     */
    app.get('/api/integrations/team/:teamId/member/:memberId/commits', authenticateToken, IntegrationController.getMemberCommits);

    /**
     * @swagger
     * /api/integrations/team/{teamId}/member/{memberId}/tasks:
     *   get:
     *     summary: Leader xem tasks Jira của một member cụ thể
     *     tags: [Integrations]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Chỉ Leader mới có quyền xem tasks của member khác.
     *       Trả về tasks Jira của member được chỉ định.
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *       - in: path
     *         name: memberId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: number
     *         description: Số lượng tasks tối đa (mặc định 50, tối đa 100)
     *       - in: query
     *         name: status
     *         required: false
     *         schema:
     *           type: string
     *         description: Lọc theo status (ví dụ Done, In Progress)
     *     responses:
     *       200:
     *         description: Tasks của member
     *       403:
     *         description: Chỉ Leader mới có quyền
     *       404:
     *         description: Không tìm thấy team hoặc member
     */
    app.get('/api/integrations/team/:teamId/member/:memberId/tasks', authenticateToken, IntegrationController.getMemberTasks);
};

