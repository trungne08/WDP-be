const NotificationController = require('../controllers/NotificationController');
const { authenticateToken, authorize } = require('../middleware/auth');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // NOTIFICATION ROUTES
    // ==========================================

    /**
     * @swagger
     * /api/notifications/send-class:
     *   post:
     *     summary: Gửi thông báo thủ công cho cả lớp (Giảng viên/Admin)
     *     tags: [20. Notifications]
     *     description: Dùng để thông báo nghỉ học, nhắc deadline, tin tức chung cho cả lớp.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - classId
     *               - title
     *               - message
     *             properties:
     *               classId:
     *                 type: string
     *                 example: 65a1b2c3d4e5f67890123456
     *               title:
     *                 type: string
     *                 example: 📢 Thông báo nghỉ học chiều nay
     *               message:
     *                 type: string
     *                 example: Chiều nay thầy bận họp đột xuất, cả lớp được nghỉ nhé.
     *     responses:
     *       200:
     *         description: Gửi thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 target_class:
     *                   type: string
     *                 total_sent:
     *                   type: number
     *       400:
     *         description: Thiếu thông tin hoặc lớp chưa có sinh viên
     *       403:
     *         description: Không có quyền (Chỉ Admin/Lecturer)
     *       404:
     *         description: Không tìm thấy lớp học
     */
    app.post(
        '/api/notifications/send-class', 
        authenticateToken, 
        authorize(['LECTURER', 'ADMIN']), // Chỉ cho phép Giảng viên và Admin
        NotificationController.sendManualNotification
    );

    /**
     * @swagger
     * /api/notifications/send-student:
     *   post:
     *     summary: Gửi tin nhắn riêng cho 1 sinh viên (Tùy chọn)
     *     tags: [20. Notifications]
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - studentId
     *               - title
     *               - message
     *             properties:
     *               studentId:
     *                 type: string
     *               title:
     *                 type: string
     *               message:
     *                 type: string
     *     responses:
     *       200:
     *         description: Gửi thành công
     */
    app.post(
        '/api/notifications/send-student',
        authenticateToken,
        authorize(['LECTURER', 'ADMIN']),
        NotificationController.sendStudentNotification
    );
};
