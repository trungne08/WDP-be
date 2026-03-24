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
     *       **Auto-register:** Sau OAuth Jira thành công, BE gọi API đăng ký dynamic webhook (scopes `read:webhook:jira`, `write:webhook:jira`, `delete:webhook:jira` — user phải OAuth lại nếu token cũ thiếu quyền).
     *       **Schema:** `webhookEvent`, `issue`, `issue.fields.*` (summary, status, assignee, story points qua customfield).
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
    app.post('/api/webhooks/jira', WebhookController.receiveJiraWebhook);

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
