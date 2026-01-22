const SyncController = require('../controllers/SyncController');
const TeamApiController = require('../controllers/TeamApiController');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // TEAM SYNC APIs
    // ==========================================

    // 4) POST /api/teams/:teamId/sync
    /**
     * @swagger
     * /api/teams/{teamId}/sync:
     *   post:
     *     summary: Kích hoạt sync Jira/Sprint/Task và Git/Commit
     *     tags: [Team Sync]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Sync thành công
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/teams/:teamId/sync', SyncController.syncTeamData);

    // 5) GET /api/teams/:teamId/sync-history
    /**
     * @swagger
     * /api/teams/{teamId}/sync-history:
     *   get:
     *     summary: Xem lịch sử sync (tối đa 20 lần gần nhất)
     *     tags: [Team Sync]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Lịch sử sync
     */
    app.get('/api/teams/:teamId/sync-history', TeamApiController.getSyncHistory);
};
