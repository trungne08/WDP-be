const WebhookController = require('../controllers/WebhookController');

// Export function để setup routes
module.exports = (app) => {
    
    /**
     * @swagger
     * /api/webhooks/jira:
     *   post:
     *     summary: Webhook Jira (path thật có Cloud ID — xem mô tả)
     *     tags: [21. Webhooks]
     *     description: |
     *       **Route Express:** `POST /api/webhooks/jira/:webhookCloudId`.
     *       `webhookCloudId` = Atlassian Cloud ID (UUID), khớp `Project.jiraCloudId`.
     *       Sự kiện: `jira:issue_created`, `jira:issue_updated`, `jira:issue_deleted`.
     *       Đăng ký: `registerJiraWebhook` lúc Sync project → URL `.../api/webhooks/jira/<cloudId>`.
     *       Sau khi cập nhật MongoDB, Socket.io emit `task_created` / `task_updated` (xoá issue: `task_updated` + `action:delete`) tới room `project:<projectId>`, room lớp (`join_class`), và `io.emit` toàn cục.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             description: Jira webhook payload
     *     responses:
     *       200:
     *         description: Plain text `Jira Webhook received` (luôn 200 để tránh retry)
     */
    app.post('/api/webhooks/jira/:webhookCloudId', WebhookController.receiveJiraWebhook);

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
