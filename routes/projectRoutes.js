const ProjectController = require('../controllers/ProjectController');
const { authenticateToken } = require('../middleware/auth');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // PROJECT APIs
    // ==========================================

    /**
     * @swagger
     * /api/projects:
     *   post:
     *     summary: Leader tạo Project mới cho nhóm
     *     tags: [Projects]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Leader (STUDENT) tạo Project mới cho nhóm hiện tại.
     *       - Validate: tất cả members phải đang thuộc cùng một team (TeamMember)
     *       - Validate: chưa member nào đã có project_id khác
     *       - Tự động set leader là user hiện tại, lecturer lấy từ Class của team (nếu có)
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *               - members
     *             properties:
     *               name:
     *                 type: string
     *                 example: E-Commerce Website
     *               members:
     *                 type: array
     *                 description: Danh sách student_id (không cần include leader, BE sẽ tự thêm)
     *                 items:
     *                   type: string
     *                   example: 64f0c7a3c9b1f23abc123456
     *               githubRepoUrl:
     *                 type: string
     *                 example: https://github.com/org/repo
     *               jiraProjectKey:
     *                 type: string
     *                 example: SWP2025
     *     responses:
     *       201:
     *         description: Tạo Project thành công
     *       400:
     *         description: Lỗi validation (members chưa có team, đã có project, ...)
     *       403:
     *         description: Không có quyền tạo (không phải STUDENT)
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/projects', authenticateToken, ProjectController.createProject);

    /**
     * @swagger
     * /api/projects/my-project:
     *   get:
     *     summary: Lấy Project hiện tại của sinh viên
     *     tags: [Projects]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Dành cho STUDENT. Trả về Project mà sinh viên hiện tại đang thuộc (nếu có),
     *       bao gồm leader, lecturer và danh sách members.
     *     responses:
     *       200:
     *         description: Thông tin Project (hoặc null nếu chưa có)
     *       403:
     *         description: Không phải STUDENT
     */
    app.get('/api/projects/my-project', authenticateToken, ProjectController.getMyProject);

    /**
     * @swagger
     * /api/projects/lecturer/classes/{classId}:
     *   get:
     *     summary: Giảng viên lấy danh sách Project theo classId
     *     tags: [Projects]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Dành cho LECTURER. Lấy tất cả Project thuộc các team trong classId đã cho
     *       (dựa trên quan hệ Team -> Class). Mỗi Project bao gồm leader và members đã populate.
     *     parameters:
     *       - in: path
     *         name: classId
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của lớp học
     *     responses:
     *       200:
     *         description: Danh sách Project của class
     *       400:
     *         description: classId không hợp lệ
     *       403:
     *         description: Không phải LECTURER
     */
    app.get('/api/projects/lecturer/classes/:classId', authenticateToken, ProjectController.getProjectsByClassForLecturer);

    /**
     * @swagger
     * /api/projects/my-projects:
     *   get:
     *     summary: Lấy TẤT CẢ projects của sinh viên (nhiều lớp)
     *     tags: [Projects]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Dành cho STUDENT. Trả về TẤT CẢ projects mà sinh viên đang tham gia ở các lớp khác nhau.
     *       Mỗi project bao gồm thông tin lớp (class) và team.
     *     responses:
     *       200:
     *         description: Danh sách projects của sinh viên
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 projects:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       _id:
     *                         type: string
     *                       name:
     *                         type: string
     *                       class:
     *                         type: object
     *                         description: Thông tin lớp của project này
     *                       team_id:
     *                         type: string
     *       403:
     *         description: Không phải STUDENT
     */
    app.get('/api/projects/my-projects', authenticateToken, ProjectController.getMyProjects);

    /**
     * @swagger
     * /api/projects/teams/{teamId}:
     *   get:
     *     summary: Lấy project của một team
     *     tags: [Projects]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Lấy project của một team cụ thể.
     *       - Student: Chỉ xem được team mà mình thuộc
     *       - Lecturer: Xem được team trong lớp của mình
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của team
     *     responses:
     *       200:
     *         description: Thông tin project của team (hoặc null nếu chưa có)
     *       403:
     *         description: Không có quyền xem team này
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/projects/teams/:teamId', authenticateToken, ProjectController.getProjectByTeam);

    /**
     * @swagger
     * /api/projects/classes/{classId}:
     *   get:
     *     summary: Lấy tất cả projects của một lớp
     *     tags: [Projects]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Lấy tất cả projects của một lớp học.
     *       - Student: Chỉ xem được lớp mà mình đang học
     *       - Lecturer: Chỉ xem được lớp của mình
     *     parameters:
     *       - in: path
     *         name: classId
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của lớp học
     *     responses:
     *       200:
     *         description: Danh sách projects của lớp
     *       403:
     *         description: Không có quyền xem lớp này
     *       404:
     *         description: Không tìm thấy lớp
     */
    app.get('/api/projects/classes/:classId', authenticateToken, ProjectController.getProjectsByClass);
};

