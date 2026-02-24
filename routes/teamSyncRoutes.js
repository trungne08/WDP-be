const SyncController = require('../controllers/SyncController');
const TeamApiController = require('../controllers/TeamApiController');
const TeamSyncController = require('../controllers/TeamSyncController'); // Import controller mới

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // TEAM SYNC APIs
    // ==========================================

    /**
     * @swagger
     * /api/teams/{teamId}/sync-leader:
     *   post:
     *     summary: Đồng bộ Leader từ Jira Project về WDP
     *     tags: [7. Teams - Management]
     *     description: |
     *       Lấy thông tin Project Lead từ Jira và cập nhật role Leader cho thành viên tương ứng trong nhóm.
     *       Yêu cầu:
     *       - Leader trên Jira phải đã link tài khoản vào WDP.
     *       - Người gọi API phải đã link tài khoản Jira (để lấy token gọi API).
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Đồng bộ thành công
     *       400:
     *         description: Lỗi logic (chưa link acc, user không trong team...)
     *       404:
     *         description: Không tìm thấy team hoặc user
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/teams/:teamId/sync-leader', TeamSyncController.syncJiraLeader);

    // 4) POST /api/teams/:teamId/sync
    /**
     * @swagger
     * /api/teams/{teamId}/sync:
     *   post:
     *     summary: ⚠️ Sync dữ liệu (Team Config - LEGACY)
     *     tags: [7. Teams - Management]
     *     description: |
     *       **⚠️ API CŨ - Legacy!**
     *       
     *       Sync dữ liệu dùng token được config trong team (manual config).
     *       
     *       **Điểm khác biệt:**
     *       
     *       | Feature | API MỚI (OAuth) ⭐ | API CŨ (này) |
     *       |---------|-------------------|--------------|
     *       | Endpoint | `POST /integrations/projects/:projectId/sync` | `POST /teams/:teamId/sync` |
     *       | Token | OAuth (user token) | Team config (shared) |
     *       | Setup | Chỉ OAuth connect | Config team |
     *       | Recommended | ✅ YES | ⚠️ NO (legacy) |
     *       
     *       **Yêu cầu:**
     *       - Team đã config tokens (`PUT /teams/:teamId/config`)
     *       - Team có `api_token_github` và `api_token_jira`
     *       
     *       **Khuyến nghị:**
     *       → **Dùng API mới:** `POST /integrations/projects/:projectId/sync` (OAuth)
     *       → API này chỉ giữ lại để backward compatible
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
     *     tags: [7. Teams - Management]
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
