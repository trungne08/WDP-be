const express = require('express');
const router = express.Router();
const ReviewController = require('../controllers/ReviewController');
const { authenticateToken } = require('../middleware/auth'); 

/**
 * @swagger
 * /api/reviews/submit:
 *   post:
 *     summary: Sinh viên nộp đánh giá chéo cuối môn học
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       API dùng để nộp kết quả đánh giá các thành viên trong nhóm vào cuối môn học.
 *
 *       Quy định:
 *       - Sinh viên phải đánh giá **tất cả các thành viên khác trong nhóm**.
 *       - Nếu điểm đánh giá **nhỏ hơn 2.0 sao**, bắt buộc phải nhập `comment` giải thích lý do.
 *       - Mỗi sinh viên chỉ được nộp **duy nhất một lần** cho toàn bộ dự án (sau khi nộp sẽ bị khóa).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - teamId
 *               - reviews
 *             properties:
 *               teamId:
 *                 type: string
 *                 example: "60d5ecb8b392d700153ef123"
 *                 description: ID của nhóm
 *               reviews:
 *                 type: array
 *                 description: Danh sách điểm đánh giá cho từng thành viên
 *                 items:
 *                   type: object
 *                   required:
 *                     - evaluated_id
 *                     - rating
 *                   properties:
 *                     evaluated_id:
 *                       type: string
 *                       example: "60d5ecb8b392d700153ef789"
 *                       description: ID của sinh viên được đánh giá
 *                     rating:
 *                       type: number
 *                       format: float
 *                       minimum: 0.5
 *                       maximum: 5.0
 *                       example: 4.5
 *                       description: Điểm sao (từ 0.5 đến 5.0)
 *                     comment:
 *                       type: string
 *                       example: "Làm việc nhiệt tình, hỗ trợ nhóm tốt"
 *                       description: Bắt buộc nếu rating < 2.0
 *     responses:
 *       200:
 *         description: Gửi đánh giá thành công. Dữ liệu đã được lưu và khóa.
 *       400:
 *         description: Dữ liệu đầu vào không hợp lệ.
 *       403:
 *         description: Đã nộp đánh giá cho dự án này rồi.
 *       404:
 *         description: Không tìm thấy nhóm.
 *       500:
 *         description: Lỗi máy chủ nội bộ.
 */
router.post('/api/reviews/submit', authenticateToken, ReviewController.submitPeerReview);

/**
 * @swagger
 * /api/reviews/team/{teamId}:
 *   get:
 *     summary: Giảng viên/Admin xem kết quả đánh giá chéo của nhóm
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       API dành cho GIẢNG VIÊN hoặc ADMIN để xem chi tiết kết quả đánh giá chéo của một nhóm.
 *
 *       Dữ liệu trả về được gom theo từng sinh viên, bao gồm:
 *       - Ai đã đánh giá
 *       - Nội dung nhận xét
 *       - Điểm trung bình nhận được
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID của nhóm cần xem kết quả đánh giá
 *     responses:
 *       200:
 *         description: Lấy dữ liệu đánh giá thành công.
 *       403:
 *         description: Không có quyền truy cập (chỉ Giảng viên/Admin).
 *       404:
 *         description: Không tìm thấy nhóm.
 *       500:
 *         description: Lỗi máy chủ nội bộ.
 */
router.get('/api/reviews/team/:teamId', authenticateToken, ReviewController.getTeamReviewsForLecturer);

/**
 * @swagger
 * /api/reviews/calculate:
 *   post:
 *     summary: Giảng viên chốt điểm cá nhân cho toàn dự án
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       API dành cho **GIẢNG VIÊN** để tính điểm cá nhân của từng sinh viên.
 *
 *       Hệ thống sẽ lấy **điểm nhóm (groupGrade)** và nhân với hệ số đóng góp
 *       (% Kỹ thuật từ AI, hệ số Peer Review) để tính ra **điểm cá nhân cuối cùng**.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - teamId
 *               - groupGrade
 *             properties:
 *               teamId:
 *                 type: string
 *                 example: "60d5ecb8b392d700153ef123"
 *                 description: ID của nhóm
 *               groupGrade:
 *                 type: number
 *                 example: 8.5
 *                 description: Điểm nhóm do giảng viên chấm (thang điểm 10)
 *     responses:
 *       200:
 *         description: Tính toán thành công. Trả về danh sách điểm chi tiết của từng sinh viên.
 *       400:
 *         description: Dữ liệu đầu vào không hợp lệ.
 *       403:
 *         description: Không có quyền truy cập (chỉ Giảng viên/Admin).
 *       404:
 *         description: Không tìm thấy nhóm.
 *       500:
 *         description: Lỗi máy chủ nội bộ.
 */
router.post('/api/reviews/calculate', authenticateToken, ReviewController.calculateSprintGrades);

/**
 * @swagger
 * /api/reviews/teams/{teamId}/my-grades:
 *   get:
 *     summary: Sinh viên xem điểm Assignment cá nhân
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       API dành cho sinh viên xem điểm đóng góp cá nhân của mình
 *       trong các Assignment/Sprint của nhóm.
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID của nhóm
 *     responses:
 *       200:
 *         description: Trả về danh sách điểm của sinh viên
 *       404:
 *         description: Không tìm thấy thành viên trong nhóm
 *       500:
 *         description: Lỗi máy chủ nội bộ
 */
router.get('/api/reviews/teams/:teamId/my-grades', authenticateToken, ReviewController.getMyAssignmentGrades);

/**
 * @swagger
 * /api/reviews/classes/{classId}/grades:
 *   get:
 *     summary: Giảng viên xem bảng điểm Assignment của cả lớp
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       API dành cho **Giảng viên / Admin**.
 *
 *       Trả về danh sách tất cả sinh viên trong lớp
 *       kèm theo điểm của từng Assignment/Sprint.
 *
 *       Dữ liệu này thường được dùng để:
 *       - Xuất file Excel bảng điểm tổng kết
 *       - Theo dõi đóng góp cá nhân của sinh viên
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID của lớp học
 *     responses:
 *       200:
 *         description: Lấy bảng điểm của lớp thành công
 *       403:
 *         description: Không có quyền truy cập
 *       404:
 *         description: Không tìm thấy lớp học
 *       500:
 *         description: Lỗi máy chủ nội bộ
 */
router.get('/api/reviews/classes/:classId/grades', authenticateToken, ReviewController.getClassGrades);

module.exports = router;