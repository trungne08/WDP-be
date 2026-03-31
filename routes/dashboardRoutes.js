const express = require('express');
const router = express.Router();

const { authenticateToken, authorize } = require('../middleware/auth');

// 2. Import Controller chứa hàm Dashboard vừa tạo ban nãy
const DashboardController = require('../controllers/DashboardController'); // Sửa lại đường dẫn nếu cần

/**
 * @swagger
 * /api/dashboard/classes/{classId}:
 *   get:
 *     summary: Lấy dữ liệu Dashboard tổng quan của lớp học
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID của lớp học
 *     responses:
 *       200:
 *         description: Lấy dữ liệu thành công
 *       403:
 *         description: Không có quyền truy cập (chỉ giảng viên của lớp)
 *       404:
 *         description: Không tìm thấy lớp học
 *       500:
 *         description: Lỗi máy chủ nội bộ
 */
router.get('/api/dashboard/classes/:classId', authenticateToken, authorize('LECTURER', 'ADMIN'), DashboardController.getClassDashboardOverview);

/**
 * @swagger
 * /api/dashboard/teams/{teamId}:
 *   get:
 *     summary: Lấy dữ liệu Dashboard chi tiết của Nhóm (Giảng viên / Admin / Team Leader)
 *     description: |
 *       Trả về toàn cảnh sức khỏe dự án:
 *       - Tổng số Commit
 *       - Tổng số Task
 *       - Story Point hoàn thành
 *       - % đóng góp của từng thành viên
 *
 *       **Quyền truy cập:**
 *       - **Giảng viên**: Chỉ được xem nhóm thuộc lớp mình dạy
 *       - **Sinh viên**: Phải là Nhóm trưởng (Leader) của nhóm
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID của nhóm (Team ID)
 *     responses:
 *       200:
 *         description: Lấy dữ liệu Dashboard nhóm thành công
 *       401:
 *         description: Chưa đăng nhập (thiếu token)
 *       403:
 *         description: Không có quyền truy cập (không phải Leader hoặc Giảng viên quản lý)
 *       404:
 *         description: Không tìm thấy nhóm
 *       500:
 *         description: Lỗi máy chủ nội bộ
 */
router.get('/api/dashboard/teams/:teamId', authenticateToken, authorize('LECTURER', 'ADMIN', 'STUDENT'), DashboardController.getTeamDashboardOverview);

module.exports = router;