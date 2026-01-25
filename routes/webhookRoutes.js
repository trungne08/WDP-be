const WebhookController = require('../controllers/WebhookController');

// Export function để setup routes
module.exports = (app) => {
    /**
     * @swagger
     * /api/webhooks/jira:
     *   post:
     *     summary: Webhook endpoint để nhận real-time updates từ Jira
     *     tags: [Webhooks]
     *     description: |
     *       Jira sẽ gửi webhook đến endpoint này khi có thay đổi:
     *       - issue_created
     *       - issue_updated
     *       - issue_deleted
     *       
     *       **Cấu hình Webhook trên Jira:**
     *       1. Vào Jira Settings → System → Webhooks
     *       2. Tạo webhook mới với URL: `https://your-domain.com/api/webhooks/jira`
     *       3. Chọn events: Issue Created, Issue Updated, Issue Deleted
     *       4. Chọn projects: Chọn project cụ thể hoặc All Projects
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             description: Jira webhook payload
     *     responses:
     *       200:
     *         description: Webhook processed successfully
     *       400:
     *         description: Invalid webhook payload
     */
    app.post('/api/webhooks/jira', WebhookController.handleJiraWebhook);
};
