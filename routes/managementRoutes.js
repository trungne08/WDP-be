const ManagementController = require('../controllers/ManagementController');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // MANAGEMENT APIs (Quản trị hệ thống)
    // ==========================================

    /**
     * @swagger
     * /api/management/semesters:
     *   post:
     *     summary: "Tạo học kỳ mới (VD: Spring 2026)"
     *     tags: [Management]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *               - code
     *               - start_date
     *               - end_date
     *             properties:
     *               name:
     *                 type: string
     *                 example: Spring 2026
     *               code:
     *                 type: string
     *                 example: SP2026
     *               start_date:
     *                 type: string
     *                 format: date
     *                 example: 2026-01-15
     *               end_date:
     *                 type: string
     *                 format: date
     *                 example: 2026-05-15
     *     responses:
     *       201:
     *         description: Tạo học kỳ thành công
     *       400:
     *         description: Lỗi validation
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/management/semesters', ManagementController.createSemester);

    /**
     * @swagger
     * /api/management/semesters:
     *   get:
     *     summary: Lấy danh sách học kỳ (Để hiển thị dropdown chọn kỳ)
     *     tags: [Management]
     *     responses:
     *       200:
     *         description: Danh sách học kỳ
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 semesters:
     *                   type: array
     */
    app.get('/api/management/semesters', ManagementController.getSemesters);

    /**
     * @swagger
     * /api/management/users:
     *   post:
     *     summary: Tạo User (Admin, Giảng viên, Mentor)
     *     tags: [Management]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - full_name
     *               - email
     *               - role
     *             properties:
     *               full_name:
     *                 type: string
     *                 example: Nguyễn Văn A
     *               email:
     *                 type: string
     *                 format: email
     *                 example: lecturer@fpt.edu.vn
     *               role:
     *                 type: string
     *                 enum: [ADMIN, LECTURER, MENTOR]
     *                 example: LECTURER
     *     responses:
     *       201:
     *         description: Tạo user thành công
     *       400:
     *         description: Lỗi validation
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/management/users', ManagementController.createUser);

    /**
     * @swagger
     * /api/management/users:
     *   get:
     *     summary: Lấy danh sách User (Lọc ra giảng viên để gán vào lớp)
     *     tags: [Management]
     *     parameters:
     *       - in: query
     *         name: role
     *         schema:
     *           type: string
     *           enum: [lecturer, mentor, admin]
     *         description: Lọc theo role
     *         example: lecturer
     *     responses:
     *       200:
     *         description: Danh sách user
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 users:
     *                   type: array
     */
    app.get('/api/management/users', ManagementController.getUsers);

    /**
     * @swagger
     * /api/management/classes:
     *   post:
     *     summary: Tạo Lớp học (Gắn lớp vào học kỳ & giảng viên)
     *     tags: [Management]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *               - semester_id
     *               - lecturer_id
     *             properties:
     *               name:
     *                 type: string
     *                 example: Software Engineering Project
     *               semester_id:
     *                 type: string
     *                 example: 507f1f77bcf86cd799439011
     *               lecturer_id:
     *                 type: string
     *                 example: 507f1f77bcf86cd799439012
     *     responses:
     *       201:
     *         description: Tạo lớp học thành công
     *       400:
     *         description: Lỗi validation
     *       404:
     *         description: Không tìm thấy học kỳ hoặc giảng viên
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/management/classes', ManagementController.createClass);

    /**
     * @swagger
     * /api/management/classes:
     *   get:
     *     summary: Lấy danh sách Lớp (Theo học kỳ)
     *     tags: [Management]
     *     parameters:
     *       - in: query
     *         name: semester_id
     *         schema:
     *           type: string
     *         description: Lọc theo học kỳ
     *         example: 507f1f77bcf86cd799439011
     *     responses:
     *       200:
     *         description: Danh sách lớp
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 classes:
     *                   type: array
     */
    app.get('/api/management/classes', ManagementController.getClasses);

/**
     * @swagger
     * /api/management/classes/{classId}/grading-config:
     *   put:
     *     summary: Cấu hình trọng số điểm (Giảng viên)
     *     tags: [Management]
     *     description: |
     *       Giảng viên cấu hình các cột điểm (Grade Structure) và tỷ lệ tính điểm đóng góp (Contribution).
     *       - Tổng trọng số các cột điểm phải bằng 1 (100%).
     *       - Tổng trọng số đóng góp (Jira + Git + Review) phải bằng 1 (100%).
     *     parameters:
     *       - in: path
     *         name: classId
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của lớp học
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - gradeStructure
     *             properties:
     *               gradeStructure:
     *                 type: array
     *                 description: Danh sách các cột điểm của môn học
     *                 items:
     *                   type: object
     *                   required:
     *                     - name
     *                     - weight
     *                   properties:
     *                     name:
     *                       type: string
     *                       example: Assignment 1
     *                     weight:
     *                       type: number
     *                       format: float
     *                       example: 0.2
     *                       description: Trọng số (ví dụ 0.2 = 20%)
     *                     isGroupGrade:
     *                       type: boolean
     *                       default: false
     *                       description: Đánh dấu nếu đây là cột điểm nhóm (sẽ áp dụng công thức đóng góp)
     *               contributionConfig:
     *                 type: object
     *                 description: Cấu hình tỷ lệ tính điểm đóng góp (cho các cột điểm nhóm)
     *                 properties:
     *                   jiraWeight:
     *                     type: number
     *                     example: 0.4
     *                     description: Trọng số Jira (40%)
     *                   gitWeight:
     *                     type: number
     *                     example: 0.4
     *                     description: Trọng số Github (40%)
     *                   reviewWeight:
     *                     type: number
     *                     example: 0.2
     *                     description: Trọng số Peer Review (20%)
     *                   allowOverCeiling:
     *                     type: boolean
     *                     default: false
     *                     description: Cho phép điểm tổng > 10 (Bonus)
     *     responses:
     *       200:
     *         description: Cấu hình thành công
     *       400:
     *         description: Lỗi validation (Tổng trọng số không bằng 100%)
     *       404:
     *         description: Không tìm thấy lớp học
     *       500:
     *         description: Lỗi server
     */
    app.put('/api/management/classes/:classId/grading-config', ManagementController.configureClassGrading);
    
    /**
     * @swagger
     * /api/management/classes/{classId}/import-students:
     *   post:
     *     summary: Import danh sách sinh viên vào lớp từ template
     *     tags: [Management]
     *     description: |
     *       Giảng viên có thể import nhiều sinh viên cùng lúc để enroll vào lớp.
     *       **Lưu ý:** Sinh viên phải tự đăng ký tài khoản trước khi import.
     *       - K18 trở về trước: Tìm sinh viên dựa vào Email (có email trường cung cấp)
     *       - K19 trở về sau: Tìm sinh viên dựa vào RollNumber (student_code)
     *       Sinh viên có đánh dấu 'x' trong cột Leader sẽ tự động được set làm Leader của nhóm.
     *     parameters:
     *       - in: path
     *         name: classId
     *         required: true
     *         schema:
     *           type: string
     *         description: ID của lớp học
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - students
     *             properties:
     *               students:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required:
     *                     - RollNumber
     *                     - Email
     *                     - FullName
     *                     - Group
     *                   properties:
     *                     Class:
     *                       type: string
     *                       example: SE1943
     *                     RollNumber:
     *                       type: string
     *                       example: CE190585
     *                       description: Mã sinh viên (student_code)
     *                     Email:
     *                       type: string
     *                       format: email
     *                       example: minhlq.ce190585@gmail.com
     *                     MemberCode:
     *                       type: string
     *                       example: MinhLQCE190585
     *                     FullName:
     *                       type: string
     *                       example: Lâm Quốc Minh
     *                     Group:
     *                       type: number
     *                       example: 1
     *                       description: Số nhóm (sẽ tự động tạo Team nếu chưa có)
     *                     Leader:
     *                       type: string
     *                       example: x
     *                       description: Đánh dấu 'x' hoặc 'X' để set làm Leader
     *           example:
     *             students:
     *               - Class: SE1943
     *                 RollNumber: CE190585
     *                 Email: minhlq.ce190585@gmail.com
     *                 MemberCode: MinhLQCE190585
     *                 FullName: Lâm Quốc Minh
     *                 Group: 1
     *                 Leader: x
     *               - Class: SE1943
     *                 RollNumber: DE191059
     *                 Email: trankhanhduong@gmail.com
     *                 MemberCode: DuongTKDE191059
     *                 FullName: Trần Khánh Dương
     *                 Group: 1
     *                 Leader: ""
     *     responses:
     *       200:
     *         description: Import thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 summary:
     *                   type: object
     *                   properties:
     *                     total_rows:
     *                       type: number
     *                     success:
     *                       type: number
     *                     errors:
     *                       type: number
     *                     not_found:
     *                       type: number
     *                       description: Số sinh viên chưa đăng ký tài khoản
     *                     created_teams:
     *                       type: number
     *                     created_members:
     *                       type: number
     *                 details:
     *                   type: object
     *                   properties:
     *                     success:
     *                       type: array
     *                     errors:
     *                       type: array
     *                     not_found:
     *                       type: array
     *                       description: Danh sách sinh viên chưa đăng ký tài khoản
     *       400:
     *         description: Lỗi validation
     *       404:
     *         description: Không tìm thấy lớp học
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/management/classes/:classId/import-students', ManagementController.importStudents);
};
