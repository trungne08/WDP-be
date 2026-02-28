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

    /**
     * @swagger
     * /api/notifications/my-notifications:
     *   get:
     *     summary: Lấy danh sách notifications của user (Cho notification bell)
     *     tags: [20. Notifications]
     *     description: |
     *       **Dùng cho:** Notification bell/dropdown trong web và app
     *       
     *       API này lấy danh sách notifications của user hiện tại, hỗ trợ:
     *       - Pagination (limit, skip)
     *       - Filter chỉ lấy unread
     *       - Sort theo thời gian mới nhất
     *       - Return unread count (cho badge)
     *       
     *       **Use case:**
     *       - Notification bell icon (hiển thị unread count)
     *       - Notification dropdown/panel
     *       - Notification center page
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: number
     *           default: 20
     *         description: Số lượng notifications tối đa (mặc định 20)
     *       - in: query
     *         name: skip
     *         schema:
     *           type: number
     *           default: 0
     *         description: Bỏ qua bao nhiêu notifications (cho pagination)
     *       - in: query
     *         name: unread_only
     *         schema:
     *           type: boolean
     *           default: false
     *         description: Chỉ lấy notifications chưa đọc
     *     responses:
     *       200:
     *         description: Danh sách notifications
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                   description: Tổng số notifications
     *                 unread:
     *                   type: number
     *                   description: Số notifications chưa đọc (cho badge!)
     *                 notifications:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       _id:
     *                         type: string
     *                       title:
     *                         type: string
     *                       message:
     *                         type: string
     *                       type:
     *                         type: string
     *                         example: TASK
     *                       is_read:
     *                         type: boolean
     *                       created_at:
     *                         type: string
     *                         format: date-time
     *                       data:
     *                         type: object
     *                         description: Metadata (class_id, assignment_id, etc.)
     *       401:
     *         description: Unauthorized
     */
    app.get(
        '/api/notifications/my-notifications',
        authenticateToken,
        NotificationController.getMyNotifications
    );

    /**
     * @swagger
     * /api/notifications/{notificationId}/read:
     *   put:
     *     summary: Đánh dấu notification đã đọc
     *     tags: [20. Notifications]
     *     description: |
     *       **Dùng khi:** User click vào notification
     *       
     *       Mark notification as read → Giảm unread count → Update badge
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: notificationId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Đã đánh dấu đã đọc
     *       404:
     *         description: Không tìm thấy notification
     */
    app.put(
        '/api/notifications/:notificationId/read',
        authenticateToken,
        NotificationController.markAsRead
    );

    /**
     * @swagger
     * /api/notifications/mark-all-read:
     *   put:
     *     summary: Đánh dấu TẤT CẢ notifications đã đọc
     *     tags: [20. Notifications]
     *     description: |
     *       **Dùng khi:** User click "Mark all as read" button
     *       
     *       Update tất cả unread notifications → is_read = true
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Đã đánh dấu tất cả đã đọc
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 updated:
     *                   type: number
     *                   description: Số notifications đã update
     */
    app.put(
        '/api/notifications/mark-all-read',
        authenticateToken,
        NotificationController.markAllAsRead
    );

    /**
     * @swagger
     * /api/notifications/clear-read:
     *   delete:
     *     summary: Xóa TẤT CẢ notifications đã đọc
     *     tags: [20. Notifications]
     *     description: |
     *       **Dùng khi:** User click "Clear all read" button
     *       
     *       Xóa tất cả notifications có is_read = true
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Đã xóa tất cả notifications đã đọc
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 deleted:
     *                   type: number
     *                   description: Số notifications đã xóa
     */
    app.delete(
        '/api/notifications/clear-read',
        authenticateToken,
        NotificationController.clearRead
    );

    /**
     * @swagger
     * /api/notifications/{notificationId}:
     *   delete:
     *     summary: Xóa một notification
     *     tags: [20. Notifications]
     *     description: |
     *       **Dùng khi:** User swipe/click delete trên notification item
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: notificationId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Đã xóa notification
     *       404:
     *         description: Không tìm thấy notification
     */
    app.delete(
        '/api/notifications/:notificationId',
        authenticateToken,
        NotificationController.deleteNotification
    );
};
