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
     *     tags: [8. Teams - Members]
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
     *     tags: [8. Teams - Members]
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
     *     tags: [8. Teams - Members]
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
     *     tags: [8. Teams - Members]
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

    // 10) GET /api/teams/:teamId/my-role
    /**
     * @swagger
     * /api/teams/{teamId}/my-role:
     *   get:
     *     summary: Kiểm tra role của user hiện tại trong team (Leader hoặc Member)
     *     tags: [8. Teams - Members]
     *     description: |
     *       API này dùng để check quyền của sinh viên trong một team cụ thể.
     *       FE có thể dùng API này để hiển thị/ẩn các chức năng chỉ Leader mới có.
     *       Một sinh viên có thể là Leader ở team này nhưng Member ở team khác.
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của team
     *     responses:
     *       200:
     *         description: Role của user trong team
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 team_id:
     *                   type: string
     *                 role_in_team:
     *                   type: string
     *                   enum: [Leader, Member]
     *                 is_leader:
     *                   type: boolean
     *                 is_member:
     *                   type: boolean
     *       403:
     *         description: Chỉ sinh viên mới có thể check role
     *       404:
     *         description: Không tìm thấy team hoặc user không phải thành viên
     *       401:
     *         description: Token không hợp lệ
     *       500:
     *         description: Lỗi server
     */
    app.get('/api/teams/:teamId/my-role', require('../middleware/auth').authenticateToken, TeamApiController.getMyRoleInTeam);
};
