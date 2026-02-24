const TeamApiController = require('../controllers/TeamApiController');
const TeamController = require('../controllers/TeamController');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // TEAM MANAGEMENT APIs
    // ==========================================

    /**
     * @swagger
     * /api/teams:
     *   post:
     *     summary: Tạo nhóm dự án (Thay thế cho API seed-team cũ)
     *     tags: [7. Teams - Management]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - project_name
     *               - class_id
     *             properties:
     *               project_name:
     *                 type: string
     *                 example: E-Commerce Website
     *               class_id:
     *                 type: string
     *                 example: 507f1f77bcf86cd799439013
     *     responses:
     *       201:
     *         description: Tạo nhóm thành công
     *       400:
     *         description: Lỗi validation
     *       404:
     *         description: Không tìm thấy lớp học
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/teams', TeamApiController.createTeam);

    /**
     * @swagger
     * /api/teams:
     *   get:
     *     summary: Lấy danh sách nhóm trong một lớp cụ thể
     *     tags: [7. Teams - Management]
     *     parameters:
     *       - in: query
     *         name: class_id
     *         schema:
     *           type: string
     *         description: Lọc theo lớp học
     *         example: 507f1f77bcf86cd799439013
     *     responses:
     *       200:
     *         description: Danh sách nhóm
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 teams:
     *                   type: array
     */
    app.get('/api/teams', TeamApiController.getTeams);

    // 2) GET /api/teams/:teamId (Xem thông tin team)
    /**
     * @swagger
     * /api/teams/{teamId}:
     *   get:
     *     summary: Xem thông tin chi tiết team (kèm thành viên, project, thống kê)
     *     tags: [7. Teams - Management]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của team
     *     responses:
     *       200:
     *         description: Thông tin chi tiết team
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 team:
     *                   type: object
     *                   description: Thông tin team (đã populate class_id với semester, lecturer, subject)
     *                 members:
     *                   type: array
     *                   description: Danh sách thành viên trong team
     *                 project:
     *                   type: object
     *                   nullable: true
     *                   description: Project của team (nếu có)
     *                 stats:
     *                   type: object
     *                   description: Thống kê (số thành viên, sprints, tasks, commits)
     *       400:
     *         description: teamId không hợp lệ
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/teams/:teamId', TeamApiController.getTeam);

    // 3) PUT /api/teams/:teamId/config
    /**
     * @swagger
     * /api/teams/{teamId}/config:
     *   put:
     *     summary: Lưu cấu hình Jira/GitHub cho team
     *     tags: [7. Teams - Management]
     *     parameters:
     *       - in: path
     *         name: teamId
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
     *               jira_url: { type: string }
     *               jira_project_key: { type: string }
     *               jira_board_id: { type: number }
     *               api_token_jira: { type: string }
     *               github_repo_url: { type: string }
     *               api_token_github: { type: string }
     *     responses:
     *       200:
     *         description: Cập nhật thành công
     *       404:
     *         description: Không tìm thấy team
     *       500:
     *         description: Lỗi server
     */
    app.put('/api/teams/:teamId/config', TeamController.updateTeamConfig);
};
