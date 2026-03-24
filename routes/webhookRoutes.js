const WebhookController = require('../controllers/WebhookController');

// Export function để setup routes
module.exports = (app) => {
    /**
     * @swagger
     * /api/webhooks/jira:
     *   post:
     *     summary: Webhook endpoint để nhận real-time updates từ Jira
     *     tags: [21. Webhooks]
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

    /**
     * @swagger
     * /api/webhooks/github:
     *   post:
     *     summary: Webhook GitHub (push) — đồng bộ commit real-time
     *     tags: [21. Webhooks]
     *     description: |
     *       GitHub gọi endpoint này khi có push (Content-Type application/json).
     *       Không dùng JWT Bearer; URL được đăng ký tự động khi liên kết repo với project.
     */
    app.post('/api/webhooks/github', WebhookController.receiveGithubWebhook);
};
