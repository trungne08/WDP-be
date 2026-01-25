const AcademicController = require('../controllers/AcademicController');
const { authenticateToken, authorize } = require('../middleware/auth');

module.exports = (app) => {
    // ==========================================
    // TEACHING SCHEDULE ROUTES
    // ==========================================

    /**
     * @swagger
     * /api/academic/schedules:
     *   post:
     *     summary: Tạo lịch giảng dạy (Note lịch dạy) - Chỉ Giảng viên
     *     tags: [Academic]
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
     *               - date
     *               - slot
     *               - topic
     *             properties:
     *               classId:
     *                 type: string
     *               date:
     *                 type: string
     *                 format: date
     *               slot:
     *                 type: number
     *                 description: Ca học (1-6)
     *               room:
     *                 type: string
     *               topic:
     *                 type: string
     *               content:
     *                 type: string
     *               note:
     *                 type: string
     *     responses:
     *       201:
     *         description: Tạo thành công
     */
    app.post(
        '/api/academic/schedules',
        authenticateToken,
        authorize(['LECTURER']),
        AcademicController.createSchedule
    );

    /**
     * @swagger
     * /api/academic/classes/{classId}/schedules:
     *   get:
     *     summary: Lấy danh sách lịch dạy của một lớp
     *     tags: [Academic]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: classId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Danh sách lịch dạy
     */
    app.get(
        '/api/academic/classes/:classId/schedules',
        authenticateToken,
        authorize(['LECTURER', 'STUDENT']),
        AcademicController.getSchedulesByClass
    );

    // ==========================================
    // ASSIGNMENT & LAB ROUTES
    // ==========================================

    /**
     * @swagger
     * /api/academic/assignments:
     *   post:
     *     summary: Tạo Bài tập (Assignment) hoặc Lab - Chỉ Giảng viên
     *     tags: [Academic]
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
     *               - type
     *               - deadline
     *             properties:
     *               classId:
     *                 type: string
     *               title:
     *                 type: string
     *               description:
     *                 type: string
     *               type:
     *                 type: string
     *                 enum: [ASSIGNMENT, LAB]
     *               deadline:
     *                 type: string
     *                 format: date-time
     *               resources:
     *                 type: array
     *                 items:
     *                   type: string
     *     responses:
     *       201:
     *         description: Tạo thành công
     */
    app.post(
        '/api/academic/assignments',
        authenticateToken,
        authorize(['LECTURER']),
        AcademicController.createAssignment
    );

    /**
     * @swagger
     * /api/academic/classes/{classId}/assignments:
     *   get:
     *     summary: Lấy danh sách Bài tập & Lab của lớp
     *     tags: [Academic]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: classId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [ASSIGNMENT, LAB]
     *         description: Lọc theo loại (Nếu không truyền sẽ lấy cả 2)
     *     responses:
     *       200:
     *         description: Danh sách bài tập
     */
    app.get(
        '/api/academic/classes/:classId/assignments',
        authenticateToken,
        authorize(['LECTURER', 'STUDENT']),
        AcademicController.getAssignmentsByClass
    );
};