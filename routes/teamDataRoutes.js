const TeamApiController = require('../controllers/TeamApiController');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // TEAM DATA APIs (Dashboard, Tasks, Commits, Ranking)
    // ==========================================

    // 10) GET /api/teams/:teamId/dashboard
    /**
     * @swagger
     * /api/teams/{teamId}/dashboard:
     *   get:
     *     summary: Overview tổng quan (Task/Commit/Sprint)
     *     tags: [9. Teams - Dashboard]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Dashboard data
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       400:
     *         description: teamId không hợp lệ
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/teams/:teamId/dashboard', TeamApiController.getDashboard);

    // 11) GET /api/teams/:teamId/tasks?sprintId=&status=
    /**
     * @swagger
     * /api/teams/{teamId}/tasks:
     *   get:
     *     summary: Danh sách task (lọc theo sprintId/status)
     *     tags: [9. Teams - Dashboard]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: sprintId
     *         required: false
     *         schema:
     *           type: string
     *       - in: query
     *         name: status
     *         required: false
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Danh sách tasks
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 tasks:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     */
    app.get('/api/teams/:teamId/tasks', TeamApiController.getTasks);

    // 12) GET /api/teams/:teamId/commits?limit=10
    /**
     * @swagger
     * /api/teams/{teamId}/commits:
     *   get:
     *     summary: Nhặt commit gần nhất
     *     tags: [9. Teams - Dashboard]
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
     *     responses:
     *       200:
     *         description: Danh sách commits
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 commits:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     */
    app.get('/api/teams/:teamId/commits', TeamApiController.getCommits);

    // 13) GET /api/teams/:teamId/ranking
    /**
     * @swagger
     * /api/teams/{teamId}/ranking:
     *   get:
     *     summary: Bảng đóng góp (Jira Done SP + counted commits)
     *     tags: [9. Teams - Dashboard]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Bảng xếp hạng
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 ranking:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     */
    app.get('/api/teams/:teamId/ranking', TeamApiController.getRanking);
};
