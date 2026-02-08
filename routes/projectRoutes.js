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
     *       - Validate: chưa member nào đã có project ở cùng lớp + cùng học kỳ + cùng môn
     *       - Tự động set leader là user hiện tại, lecturer lấy từ Class của team (nếu có)
     *       - Tự động lấy class_id, team_id, semester_id, subject_id từ Team → Class (không cần gửi lên)
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
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "✅ Tạo Project thành công!"
     *                 project:
     *                   type: object
     *                   properties:
     *                     _id:
     *                       type: string
     *                     name:
     *                       type: string
     *                     class_id:
     *                       type: object
     *                       description: Thông tin lớp học (tự động lấy từ Team)
     *                       properties:
     *                         _id:
     *                           type: string
     *                         name:
     *                           type: string
     *                         class_code:
     *                           type: string
     *                         subjectName:
     *                           type: string
     *                     team_id:
     *                       type: object
     *                       description: Thông tin team (tự động lấy từ TeamMember)
     *                       properties:
     *                         _id:
     *                           type: string
     *                         project_name:
     *                           type: string
     *                     semester_id:
     *                       type: object
     *                       description: Thông tin học kỳ (tự động lấy từ Class)
     *                       properties:
     *                         _id:
     *                           type: string
     *                         name:
     *                           type: string
     *                         code:
     *                           type: string
     *                     subject_id:
     *                       type: object
     *                       nullable: true
     *                       description: Thông tin môn học (tự động lấy từ Class, có thể null)
     *                       properties:
     *                         _id:
     *                           type: string
     *                         name:
     *                           type: string
     *                         code:
     *                           type: string
     *                     leader_id:
     *                       type: object
     *                       description: Thông tin leader (tự động set là user hiện tại)
     *                     lecturer_id:
     *                       type: object
     *                       nullable: true
     *                       description: Thông tin giảng viên (tự động lấy từ Class)
     *                     members:
     *                       type: array
     *                       items:
     *                         type: object
     *                       description: Danh sách thành viên (bao gồm cả leader)
     *                     githubRepoUrl:
     *                       type: string
     *                     jiraProjectKey:
     *                       type: string
     *             examples:
     *               success:
     *                 summary: Tạo project thành công
     *                 value:
     *                   message: "✅ Tạo Project thành công!"
     *                   project:
     *                     _id: "65a1b2c3d4e5f67890123456"
     *                     name: "E-Commerce Website"
     *                     class_id:
     *                       _id: "65a1b2c3d4e5f67890123457"
     *                       name: "SE1837"
     *                       class_code: "SE1837"
     *                       subjectName: "Software Engineering"
     *                     team_id:
     *                       _id: "65a1b2c3d4e5f67890123458"
     *                       project_name: "Team 1"
     *                     semester_id:
     *                       _id: "65a1b2c3d4e5f67890123459"
     *                       name: "Spring 2026"
     *                       code: "SP2026"
     *                     subject_id:
     *                       _id: "65a1b2c3d4e5f6789012345a"
     *                       name: "Software Engineering"
     *                       code: "SE"
     *                     leader_id:
     *                       _id: "65a1b2c3d4e5f6789012345b"
     *                       student_code: "SE170505"
     *                       email: "student@fpt.edu.vn"
     *                       full_name: "Nguyễn Văn A"
     *                     lecturer_id:
     *                       _id: "65a1b2c3d4e5f6789012345c"
     *                       email: "lecturer@fpt.edu.vn"
     *                       full_name: "Trần Thị B"
     *                     members:
     *                       - _id: "65a1b2c3d4e5f6789012345b"
     *                         student_code: "SE170505"
     *                         email: "student@fpt.edu.vn"
     *                         full_name: "Nguyễn Văn A"
     *                     githubRepoUrl: "https://github.com/org/repo"
     *                     jiraProjectKey: "SWP2025"
     *       400:
     *         description: Lỗi validation (members chưa có team, đã có project ở cùng lớp/kỳ/môn, ...)
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
     * /api/projects/can-create:
     *   get:
     *     summary: Check xem sinh viên có thể tạo project trong class này không
     *     tags: [Projects]
     *     security:
     *       - bearerAuth: []
     *     description: |
     *       Dành cho STUDENT. Check xem sinh viên đã có project trong class cụ thể chưa.
     *       Trả về `can_create: true` nếu chưa có project trong class đó, `false` nếu đã có.
     *       **QUAN TRỌNG**: Sinh viên có thể có nhiều project ở các class KHÁC NHAU.
     *       API này chỉ check trong 1 class cụ thể (theo class_id trong query).
     *     parameters:
     *       - in: query
     *         name: class_id
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của lớp học cần check
     *     responses:
     *       200:
     *         description: Thông tin có thể tạo project hay không
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 can_create:
     *                   type: boolean
     *                   description: true nếu có thể tạo, false nếu không
     *                 reason:
     *                   type: string
     *                   description: Lý do (có thể tạo hoặc đã có project)
     *                 existing_project:
     *                   type: object
     *                   nullable: true
     *                   description: Thông tin project đã tồn tại (nếu có)
     *       400:
     *         description: Thiếu class_id trong query
     *       403:
     *         description: Không phải STUDENT
     */
    app.get('/api/projects/can-create', authenticateToken, ProjectController.canCreateProject);

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

