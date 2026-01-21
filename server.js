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
     * /api/auth/request-registration-otp:
     *   post:
     *     summary: Yêu cầu OTP để đăng ký (Bước 1)
     *     tags: [Auth]
     *     description: Chỉ cần nhập email để nhận OTP qua email. Sau đó gọi API `/api/auth/register` với OTP và đầy đủ thông tin để hoàn tất đăng ký.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - email
     *             properties:
     *               email:
     *                 type: string
     *                 format: email
     *                 example: student@fpt.edu.vn
     *     responses:
     *       200:
     *         description: OTP đã được gửi đến email
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
     *         description: Email đã được sử dụng hoặc lỗi validation
     *       403:
     *         description: Không cho phép đăng ký ADMIN
     *       500:
     *         description: Lỗi server hoặc không thể gửi email
     */
    app.post('/api/auth/request-registration-otp', AuthController.requestRegistrationOTP);

    /**
     * @swagger
     * /api/auth/register:
     *   post:
     *     summary: Đăng ký tài khoản mới với OTP (Bước 2)
     *     tags: [Auth]
     *     description: Nhập đầy đủ thông tin + OTP đã nhận được qua email để hoàn tất đăng ký. Tài khoản sẽ được kích hoạt ngay sau khi đăng ký thành công.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - role
     *               - email
     *               - password
     *               - otp_code
     *             properties:
     *               role:
     *                 type: string
     *                 enum: [LECTURER, STUDENT]
     *               email:
     *                 type: string
     *                 format: email
     *               password:
     *                 type: string
     *               otp_code:
     *                 type: string
     *                 description: Mã OTP 6 chữ số nhận được qua email
     *               full_name:
     *                 type: string
     *               avatar_url:
     *                 type: string
     *               student_code:
     *                 type: string
     *                 description: Bắt buộc nếu role=STUDENT
     *               major:
     *                 type: string
     *                 description: Cho STUDENT
     *           examples:
     *             lecturer:
     *               summary: Đăng ký Lecturer
     *               value:
     *                 role: LECTURER
     *                 email: lecturer@fpt.edu.vn
     *                 password: "123456"
     *                 otp_code: "123456"
     *                 full_name: Trần Thị Giảng Viên
     *                 avatar_url: https://example.com/avatar.jpg
     *             student:
     *               summary: Đăng ký Student
     *               value:
     *                 role: STUDENT
     *                 email: student@fpt.edu.vn
     *                 password: "123456"
     *                 otp_code: "123456"
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
     *       400:
     *         description: OTP không hợp lệ, đã hết hạn, hoặc email/student_code đã tồn tại
     *       403:
     *         description: Không cho phép đăng ký ADMIN
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
     *               - otp_code
     *             properties:
     *               email:
     *                 type: string
     *                 format: email
     *                 example: student@fpt.edu.vn
     *                 description: Email đã đăng ký
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
     *               - otp_code
     *               - new_password
     *               - confirm_password
     *             properties:
     *               email:
     *                 type: string
     *                 format: email
     *                 example: student@fpt.edu.vn
     *                 description: Email đã đăng ký
     *               otp_code:
     *                 type: string
     *                 example: "123456"
     *                 description: Mã OTP 6 chữ số nhận được qua email
     *               new_password:
     *                 type: string
     *                 example: "newpassword123"
     *                 description: Mật khẩu mới (tối thiểu 6 ký tự)
     *               confirm_password:
     *                 type: string
     *                 example: "newpassword123"
     *                 description: Xác nhận mật khẩu mới (phải khớp với new_password)
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
    // TEAM MANAGEMENT APIs
    // ==========================================

    // 1) POST /api/teams (Tạo team mới)
    /**
     * @swagger
     * /api/teams:
     *   post:
     *     summary: Tạo nhóm mới để lấy Team ID
     *     tags: [Team Management]
     *     responses:
     *       200:
     *         description: Tạo team thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 team_id:
     *                   type: string
     *                 data:
     *                   type: object
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/teams', TeamApiController.seedTeam);

    // 2) GET /api/teams/:teamId (Xem thông tin team)
    /**
     * @swagger
     * /api/teams/{teamId}:
     *   get:
     *     summary: Xem thông tin team + thống kê nhanh
     *     tags: [Team Management]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Thông tin team
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 team:
     *                   type: object
     *                 counts:
     *                   type: object
     *       400:
     *         description: teamId không hợp lệ
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/teams/:teamId', TeamApiController.getTeam);

    // 3) PUT /api/teams/:teamId/config
    /**
     * @swagger
     * /api/teams/{teamId}/config:
     *   put:
     *     summary: Lưu cấu hình Jira/GitHub cho team
     *     tags: [Team Configuration]
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
    app.put('/api/teams/:teamId/config', TeamController.updateTeamConfig);

    // ==========================================
    // TEAM SYNC APIs
    // ==========================================

    // 4) POST /api/teams/:teamId/sync
    /**
     * @swagger
     * /api/teams/{teamId}/sync:
     *   post:
     *     summary: Kích hoạt sync Jira/Sprint/Task và Git/Commit
     *     tags: [Team Sync]
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
    app.post('/api/teams/:teamId/sync', SyncController.syncTeamData);

    // 5) GET /api/teams/:teamId/sync-history
    /**
     * @swagger
     * /api/teams/{teamId}/sync-history:
     *   get:
     *     summary: Xem lịch sử sync (tối đa 20 lần gần nhất)
     *     tags: [Team Sync]
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
    app.get('/api/teams/:teamId/sync-history', TeamApiController.getSyncHistory);

    // ==========================================
    // TEAM MEMBERS APIs
    // ==========================================

    // 6) POST /api/teams/:teamId/seed-members
    /**
     * @swagger
     * /api/teams/{teamId}/seed-members:
     *   post:
     *     summary: Tạo SV giả + member trong team để test
     *     tags: [Team Members]
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
    app.post('/api/teams/:teamId/seed-members', TeamApiController.seedMembers);

    // 7) GET /api/teams/:teamId/members
    /**
     * @swagger
     * /api/teams/{teamId}/members:
     *   get:
     *     summary: Lấy danh sách thành viên (kèm mapping Jira/Git)
     *     tags: [Team Members]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Danh sách thành viên
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 members:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/teams/:teamId/members', TeamApiController.getMembers);

    // 8) GET /api/teams/:teamId/jira-users
    /**
     * @swagger
     * /api/teams/{teamId}/jira-users:
     *   get:
     *     summary: Lấy DS user Jira (từ dữ liệu task đã sync)
     *     tags: [Team Members]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Danh sách Jira users
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 users:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/teams/:teamId/jira-users', TeamApiController.getJiraUsers);

    // 9) PUT /api/members/:memberId/mapping
    /**
     * @swagger
     * /api/members/{memberId}/mapping:
     *   put:
     *     summary: Mapping Jira accountId và GitHub username cho member
     *     tags: [Team Members]
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
     *     responses:
     *       200:
     *         description: Cập nhật mapping thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "✅ Cập nhật mapping thành công!"
     *                 member:
     *                   type: object
     *                   description: Thông tin member đã được cập nhật
     *       400:
     *         description: memberId không hợp lệ hoặc thiếu dữ liệu
     *       404:
     *         description: Không tìm thấy member
     *       500:
     *         description: Lỗi server
     */
    app.put('/api/members/:memberId/mapping', TeamApiController.updateMemberMapping);

    // ==========================================
    // TEAM DATA APIs (Dashboard, Tasks, Commits, Ranking)
    // ==========================================

    // 10) GET /api/teams/:teamId/dashboard
    /**
     * @swagger
     * /api/teams/{teamId}/dashboard:
     *   get:
     *     summary: Overview tổng quan (Task/Commit/Sprint)
     *     tags: [Team Data]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Dashboard data
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       400:
     *         description: teamId không hợp lệ
     *       404:
     *         description: Không tìm thấy team
     */
    app.get('/api/teams/:teamId/dashboard', TeamApiController.getDashboard);

    // 11) GET /api/teams/:teamId/tasks?sprintId=&status=
    /**
     * @swagger
     * /api/teams/{teamId}/tasks:
     *   get:
     *     summary: Danh sách task (lọc theo sprintId/status)
     *     tags: [Team Data]
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
     *     responses:
     *       200:
     *         description: Danh sách tasks
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 tasks:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     */
    app.get('/api/teams/:teamId/tasks', TeamApiController.getTasks);

    // 12) GET /api/teams/:teamId/commits?limit=10
    /**
     * @swagger
     * /api/teams/{teamId}/commits:
     *   get:
     *     summary: Nhặt commit gần nhất
     *     tags: [Team Data]
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
     *     responses:
     *       200:
     *         description: Danh sách commits
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 commits:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     */
    app.get('/api/teams/:teamId/commits', TeamApiController.getCommits);

    // 13) GET /api/teams/:teamId/ranking
    /**
     * @swagger
     * /api/teams/{teamId}/ranking:
     *   get:
     *     summary: Bảng đóng góp (Jira Done SP + counted commits)
     *     tags: [Team Data]
     *     parameters:
     *       - in: path
     *         name: teamId
     *         required: true
     *         schema:
     *           type: string
     *     responses:
     *       200:
     *         description: Bảng xếp hạng
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 ranking:
     *                   type: array
     *       400:
     *         description: teamId không hợp lệ
     */
    app.get('/api/teams/:teamId/ranking', TeamApiController.getRanking);
};