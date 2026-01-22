const TeamApiController = require('../controllers/TeamApiController');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // TEAM MEMBERS APIs
    // ==========================================

    // 6) POST /api/teams/:teamId/seed-members
    /**
     * @swagger
     * /api/teams/{teamId}/seed-members:
     *   post:
     *     summary: Tạo SV giả + member trong team để test
     *     tags: [Team Members]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               count: { type: number, example: 5 }
     *     responses:
     *       200:
     *         description: Seed thành công
     */
    app.post('/api/teams/:teamId/seed-members', TeamApiController.seedMembers);

    // 7) GET /api/teams/:teamId/members
    /**
     * @swagger
     * /api/teams/{teamId}/members:
     *   get:
     *     summary: Lấy danh sách thành viên (kèm mapping Jira/Git)
     *     tags: [Team Members]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Danh sách thành viên
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 members:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/teams/:teamId/members', TeamApiController.getMembers);

    // 8) GET /api/teams/:teamId/jira-users
    /**
     * @swagger
     * /api/teams/{teamId}/jira-users:
     *   get:
     *     summary: Lấy DS user Jira (từ dữ liệu task đã sync)
     *     tags: [Team Members]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Danh sách Jira users
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 users:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/teams/:teamId/jira-users', TeamApiController.getJiraUsers);

    // 9) PUT /api/members/:memberId/mapping
    /**
     * @swagger
     * /api/members/{memberId}/mapping:
     *   put:
     *     summary: Mapping Jira accountId và GitHub username cho member
     *     tags: [Team Members]
     *     parameters:
     *       - in: path
     *         name: memberId
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               jira_account_id: { type: string }
     *               github_username: { type: string }
     *     responses:
     *       200:
     *         description: Cập nhật mapping thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "✅ Cập nhật mapping thành công!"
     *                 member:
     *                   type: object
     *                   description: Thông tin member đã được cập nhật
     *       400:
     *         description: memberId không hợp lệ hoặc thiếu dữ liệu
     *       404:
     *         description: Không tìm thấy member
     *       500:
     *         description: Lỗi server
     */
    app.put('/api/members/:memberId/mapping', TeamApiController.updateMemberMapping);
};
