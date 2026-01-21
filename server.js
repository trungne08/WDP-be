const bcrypt = require('bcryptjs'); // Import thư viện
const models = require('./models');
const TeamController = require('./controllers/TeamController');
const SyncController = require('./controllers/SyncController');
const AuthController = require('./controllers/AuthController');
const TeamApiController = require('./controllers/TeamApiController');

// Export function để setup routes
module.exports = (app) => {
    // ==========================================
    // AUTH APIs (ĐĂNG KÝ & ĐĂNG NHẬP)
    // ==========================================
    /**
     * @swagger
     * /api/auth/register:
     *   post:
     *     summary: Đăng ký tài khoản mới (cần xác minh email bằng OTP)
     *     tags: [Auth]
     *     description: Sau khi đăng ký thành công, hệ thống sẽ gửi mã OTP về email. Bạn cần gọi API `/api/auth/verify-registration-otp` để xác minh email trước khi có thể đăng nhập.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/RegisterRequest'
     *           examples:
     *             lecturer:
     *               summary: Đăng ký Lecturer
     *               value:
     *                 role: LECTURER
     *                 email: lecturer@fpt.edu.vn
     *                 password: "123456"
     *                 full_name: Trần Thị Giảng Viên
     *                 avatar_url: https://example.com/avatar.jpg
     *             student:
     *               summary: Đăng ký Student
     *               value:
     *                 role: STUDENT
     *                 email: student@fpt.edu.vn
     *                 password: "123456"
     *                 student_code: SE150000
     *                 full_name: Lê Văn Sinh Viên
     *                 major: Software Engineering
     *     responses:
     *       201:
     *         description: Đăng ký thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 user:
     *                   oneOf:
     *                     - $ref: '#/components/schemas/Lecturer'
     *                     - $ref: '#/components/schemas/Student'
     *                 requires_verification:
     *                   type: boolean
     *                   description: Luôn là true, cần verify OTP để kích hoạt tài khoản
     *       403:
     *         description: Không cho phép đăng ký ADMIN
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       400:
     *         description: Lỗi validation hoặc email đã tồn tại
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/auth/register', AuthController.register);

    /**
     * @swagger
     * /api/auth/verify-registration-otp:
     *   post:
     *     summary: Xác minh email đăng ký bằng OTP
     *     tags: [Auth]
     *     description: Xác minh email sau khi đăng ký. Chỉ áp dụng cho LECTURER và STUDENT.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - email
     *               - role
     *               - otp_code
     *             properties:
     *               email:
     *                 type: string
     *                 format: email
     *                 example: student@fpt.edu.vn
     *               role:
     *                 type: string
     *                 enum: [LECTURER, STUDENT]
     *                 example: STUDENT
     *               otp_code:
     *                 type: string
     *                 example: "123456"
     *                 description: Mã OTP 6 chữ số nhận được qua email khi đăng ký
     *     responses:
     *       200:
     *         description: Xác minh email thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 user:
     *                   oneOf:
     *                     - $ref: '#/components/schemas/Lecturer'
     *                     - $ref: '#/components/schemas/Student'
     *       400:
     *         description: OTP không hợp lệ hoặc đã hết hạn
     *       404:
     *         description: Không tìm thấy người dùng
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/auth/verify-registration-otp', AuthController.verifyRegistrationOTP);

    /**
     * @swagger
     * /api/auth/forgot-password:
     *   post:
     *     summary: Yêu cầu gửi OTP qua email để đặt lại mật khẩu
     *     tags: [Auth]
     *     description: Chỉ áp dụng cho LECTURER và STUDENT (không hỗ trợ ADMIN).
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - email
     *               - role
     *             properties:
     *               email:
     *                 type: string
     *                 format: email
     *                 example: admin@gmail.com
     *               role:
     *                 type: string
     *                 enum: [LECTURER, STUDENT]
     *                 example: STUDENT
     *     responses:
     *       200:
     *         description: OTP đã được gửi đến email (hoặc thông báo giả nếu email không tồn tại)
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 expires_in_minutes:
     *                   type: number
     *       400:
     *         description: Lỗi validation
     *       403:
     *         description: Chỉ hỗ trợ quên mật khẩu cho LECTURER và STUDENT
     *       500:
     *         description: Lỗi server hoặc không thể gửi email
     */
    app.post('/api/auth/forgot-password', AuthController.forgotPassword);

    /**
     * @swagger
     * /api/auth/verify-otp-reset-password:
     *   post:
     *     summary: Xác thực OTP và đặt lại mật khẩu mới
     *     tags: [Auth]
     *     description: Chỉ áp dụng cho LECTURER và STUDENT (không hỗ trợ ADMIN).
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - email
     *               - role
     *               - otp_code
     *               - new_password
     *             properties:
     *               email:
     *                 type: string
     *                 format: email
     *                 example: admin@gmail.com
     *               role:
     *                 type: string
     *                 enum: [LECTURER, STUDENT]
     *                 example: STUDENT
     *               otp_code:
     *                 type: string
     *                 example: "123456"
     *                 description: Mã OTP 6 chữ số nhận được qua email
     *               new_password:
     *                 type: string
     *                 example: "newpassword123"
     *                 description: Mật khẩu mới (tối thiểu 6 ký tự)
     *     responses:
     *       200:
     *         description: Đặt lại mật khẩu thành công
     *       400:
     *         description: OTP không hợp lệ, đã hết hạn, hoặc mật khẩu không đủ mạnh
     *       403:
     *         description: Chỉ hỗ trợ đặt lại mật khẩu cho LECTURER và STUDENT
     *       404:
     *         description: Không tìm thấy người dùng
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/auth/verify-otp-reset-password', AuthController.verifyOTPAndResetPassword);

    /**
     * @swagger
     * /api/auth/login:
     *   post:
     *     summary: Đăng nhập vào hệ thống
     *     tags: [Auth]
     *     description: LECTURER và STUDENT phải xác minh email trước khi đăng nhập (gọi `/api/auth/verify-registration-otp` sau khi đăng ký).
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/LoginRequest'
     *           example:
     *             email: admin@example.com
     *             password: "123456"
     *     responses:
     *       200:
     *         description: Đăng nhập thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 token:
     *                   type: string
     *                   description: JWT Token để dùng cho các API cần authentication (hết hạn sau 7 ngày)
     *                 user:
     *                   oneOf:
     *                     - $ref: '#/components/schemas/Admin'
     *                     - $ref: '#/components/schemas/Lecturer'
     *                     - $ref: '#/components/schemas/Student'
     *                 role:
     *                   type: string
     *                   enum: [ADMIN, LECTURER, STUDENT]
     *       401:
     *         description: Email hoặc password không đúng
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Email chưa được xác minh (chỉ áp dụng cho LECTURER và STUDENT)
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 error:
     *                   type: string
     *                 requires_verification:
     *                   type: boolean
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/auth/login', AuthController.login);

    // ==========================================
    // UTILITY APIs
    // ==========================================
    /**
     * @swagger
     * /api/seed-test:
     *   get:
     *     summary: Tạo Admin test mặc định
     *     tags: [Utility]
     *     description: Tạo một Admin mặc định để test (email: admin@gmail.com, password: 123456). Chỉ tạo nếu chưa có Admin nào trong DB.
     *     responses:
     *       200:
     *         description: Tạo Admin thành công hoặc đã có Admin rồi
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 msg:
     *                   type: string
     *                 data:
     *                   $ref: '#/components/schemas/Admin'
     *       500:
     *         description: Lỗi server
     */
    app.get('/api/seed-test', async (req, res) => {
        try {
            const count = await models.Admin.countDocuments();
            if (count > 0) return res.send('⚠️ Có Admin rồi, không tạo nữa.');

            // 1. Tạo mật khẩu mã hóa (Hash)
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('123456', salt); // Mật khẩu là 123456

            // 2. Lưu vào DB
            const newAdmin = await models.Admin.create({
                email: "admin@gmail.com",
                full_name: "Super Admin",
                password: hashedPassword, // Lưu chuỗi loằng ngoằng vào đây
                role: "ADMIN"
            });

            res.json({ msg: "✅ Tạo Admin thành công!", data: newAdmin });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ==========================================
    // TEAM APIs (theo bảng API)
    // ==========================================

    // 1) POST /seed-team
    /**
     * @swagger
     * /seed-team:
     *   post:
     *     summary: Tạo nhóm mới (seed) để lấy Team ID
     *     tags: [Teams]
     *     responses:
     *       200:
     *         description: Tạo team thành công
     *       500:
     *         description: Lỗi server
     */
    app.post('/seed-team', TeamApiController.seedTeam);

    // 2) PUT /teams/:teamId/config
    /**
     * @swagger
     * /teams/{teamId}/config:
     *   put:
     *     summary: Lưu cấu hình Jira/GitHub cho team
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               jira_url: { type: string }
     *               jira_project_key: { type: string }
     *               jira_board_id: { type: number }
     *               api_token_jira: { type: string }
     *               github_repo_url: { type: string }
     *               api_token_github: { type: string }
     *     responses:
     *       200:
     *         description: Cập nhật thành công
     *       404:
     *         description: Không tìm thấy team
     *       500:
     *         description: Lỗi server
     */
    app.put('/teams/:teamId/config', TeamController.updateTeamConfig);

    // 3) GET /teams/:teamId
    /**
     * @swagger
     * /teams/{teamId}:
     *   get:
     *     summary: Xem thông tin team + thống kê nhanh
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Thông tin team
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/teams/:teamId', TeamApiController.getTeam);

    // 4) POST /teams/:teamId/sync
    /**
     * @swagger
     * /teams/{teamId}/sync:
     *   post:
     *     summary: Kích hoạt sync Jira/Sprint/Task và Git/Commit
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Sync thành công
     *       500:
     *         description: Lỗi server
     */
    app.post('/teams/:teamId/sync', SyncController.syncTeamData);

    // 5) GET /teams/:teamId/sync-history
    /**
     * @swagger
     * /teams/{teamId}/sync-history:
     *   get:
     *     summary: Xem lịch sử sync (tối đa 20 lần gần nhất)
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Lịch sử sync
     */
    app.get('/teams/:teamId/sync-history', TeamApiController.getSyncHistory);

    // 6) POST /teams/:teamId/seed-members
    /**
     * @swagger
     * /teams/{teamId}/seed-members:
     *   post:
     *     summary: Tạo SV giả + member trong team để test
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               count: { type: number, example: 5 }
     *     responses:
     *       200:
     *         description: Seed thành công
     */
    app.post('/teams/:teamId/seed-members', TeamApiController.seedMembers);

    // 7) GET /teams/:teamId/members
    /**
     * @swagger
     * /teams/{teamId}/members:
     *   get:
     *     summary: Lấy danh sách thành viên (kèm mapping Jira/Git)
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     */
    app.get('/teams/:teamId/members', TeamApiController.getMembers);

    // 8) GET /teams/:teamId/jira-users
    /**
     * @swagger
     * /teams/{teamId}/jira-users:
     *   get:
     *     summary: Lấy DS user Jira (từ dữ liệu task đã sync)
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     */
    app.get('/teams/:teamId/jira-users', TeamApiController.getJiraUsers);

    // 9) PUT /members/:memberId/mapping
    /**
     * @swagger
     * /members/{memberId}/mapping:
     *   put:
     *     summary: Mapping Jira accountId và GitHub username cho member
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: memberId
     *         required: true
     *         schema:
     *           type: string
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               jira_account_id: { type: string }
     *               github_username: { type: string }
     */
    app.put('/members/:memberId/mapping', TeamApiController.updateMemberMapping);

    // 10) GET /teams/:teamId/dashboard
    /**
     * @swagger
     * /teams/{teamId}/dashboard:
     *   get:
     *     summary: Overview tổng quan (Task/Commit/Sprint)
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     */
    app.get('/teams/:teamId/dashboard', TeamApiController.getDashboard);

    // 11) GET /teams/:teamId/tasks?sprintId=&status=
    /**
     * @swagger
     * /teams/{teamId}/tasks:
     *   get:
     *     summary: Danh sách task (lọc theo sprintId/status)
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: sprintId
     *         required: false
     *         schema:
     *           type: string
     *       - in: query
     *         name: status
     *         required: false
     *         schema:
     *           type: string
     */
    app.get('/teams/:teamId/tasks', TeamApiController.getTasks);

    // 12) GET /teams/:teamId/commits?limit=10
    /**
     * @swagger
     * /teams/{teamId}/commits:
     *   get:
     *     summary: Nhặt commit gần nhất
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *       - in: query
     *         name: limit
     *         required: false
     *         schema:
     *           type: number
     */
    app.get('/teams/:teamId/commits', TeamApiController.getCommits);

    // 13) GET /teams/:teamId/ranking
    /**
     * @swagger
     * /teams/{teamId}/ranking:
     *   get:
     *     summary: Bảng đóng góp (Jira Done SP + counted commits)
     *     tags: [Teams]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     */
    app.get('/teams/:teamId/ranking', TeamApiController.getRanking);
};