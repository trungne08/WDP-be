const bcrypt = require('bcryptjs'); // Import thư viện
const models = require('./models');
const TeamController = require('./controllers/TeamController');
const SyncController = require('./controllers/SyncController');
const AuthController = require('./controllers/AuthController');
const TeamApiController = require('./controllers/TeamApiController');
const ManagementController = require('./controllers/ManagementController');
const { authenticateToken } = require('./middleware/auth');

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
     *               ent:
     *                 type: string
     *                 description: "Khóa học (VD: K18, K19). Nếu không nhập sẽ tự động suy ra từ student_code"
     *                 example: K19
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
     *                 ent: K15
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
     *     description: LECTURER và STUDENT sẽ được tự động xác minh email khi đăng ký thành công (API `/api/auth/register` đã verify OTP và set is_verified = true).
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
     *                 access_token:
     *                   type: string
     *                   description: Access token để dùng cho các API cần authentication (hết hạn sau 15 phút)
     *                 refresh_token:
     *                   type: string
     *                   description: Refresh token để làm mới access token (hết hạn sau 30 ngày)
     *                 user:
     *                   type: object
     *                   description: Thông tin cơ bản của user (thông tin chi tiết lấy từ API /api/auth/me)
     *                   properties:
     *                     _id:
     *                       type: string
     *                     email:
     *                       type: string
     *                     role:
     *                       type: string
     *                       enum: [ADMIN, LECTURER, STUDENT]
     *                     full_name:
     *                       type: string
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

    /**
     * @swagger
     * /api/auth/me:
     *   get:
     *     summary: Lấy thông tin profile của user hiện tại
     *     tags: [Auth]
     *     description: Lấy thông tin đầy đủ của user từ token (dùng cho trang profile)
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Thông tin profile
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 user:
     *                   oneOf:
     *                     - $ref: '#/components/schemas/Admin'
     *                     - $ref: '#/components/schemas/Lecturer'
     *                     - $ref: '#/components/schemas/Student'
     *                 role:
     *                   type: string
     *                   enum: [ADMIN, LECTURER, STUDENT]
     *       401:
     *         description: Token không hợp lệ hoặc đã hết hạn
     *       403:
     *         description: Email chưa được xác minh (chỉ áp dụng cho LECTURER và STUDENT)
     *       500:
     *         description: Lỗi server
     */
    /**
     * @swagger
     * /api/auth/refresh-token:
     *   post:
     *     summary: Làm mới access token bằng refresh token
     *     tags: [Auth]
     *     description: Khi access token hết hạn, dùng refresh token để lấy access token mới
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - refresh_token
     *             properties:
     *               refresh_token:
     *                 type: string
     *                 description: Refresh token nhận được từ API login
     *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
     *     responses:
     *       200:
     *         description: Làm mới token thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                 access_token:
     *                   type: string
     *                   description: Access token mới (hết hạn sau 15 phút)
     *       400:
     *         description: Thiếu refresh_token
     *       401:
     *         description: Refresh token không hợp lệ hoặc đã hết hạn
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/auth/refresh-token', AuthController.refreshToken);

    /**
     * @swagger
     * /api/auth/me:
     *   get:
     *     summary: Lấy thông tin profile của user hiện tại
     *     tags: [Auth]
     *     description: Lấy thông tin đầy đủ của user từ token (dùng cho trang profile)
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Thông tin profile
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 user:
     *                   oneOf:
     *                     - $ref: '#/components/schemas/Admin'
     *                     - $ref: '#/components/schemas/Lecturer'
     *                     - $ref: '#/components/schemas/Student'
     *                 role:
     *                   type: string
     *                   enum: [ADMIN, LECTURER, STUDENT]
     *       401:
     *         description: Token không hợp lệ hoặc đã hết hạn
     *       403:
     *         description: Email chưa được xác minh (chỉ áp dụng cho LECTURER và STUDENT)
     *       500:
     *         description: Lỗi server
     */
    app.get('/api/auth/me', authenticateToken, AuthController.getProfile);

    /**
     * @swagger
     * /api/auth/logout:
     *   post:
     *     summary: Đăng xuất
     *     tags: [Auth]
     *     description: Đăng xuất khỏi hệ thống. Revoke refresh token và client cần xóa token khỏi localStorage/sessionStorage.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               refresh_token:
     *                 type: string
     *                 description: Refresh token để revoke (optional)
     *     responses:
     *       200:
     *         description: Đăng xuất thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *       401:
     *         description: Token không hợp lệ
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/auth/logout', authenticateToken, AuthController.logout);

    // ==========================================
    // TEAM MANAGEMENT APIs
    // ==========================================

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

    // ==========================================
    // TEAM MANAGEMENT APIs
    // ==========================================

    /**
     * @swagger
     * /api/teams:
     *   post:
     *     summary: Tạo nhóm dự án (Thay thế cho API seed-team cũ)
     *     tags: [Team Management]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - project_name
     *               - class_id
     *             properties:
     *               project_name:
     *                 type: string
     *                 example: E-Commerce Website
     *               class_id:
     *                 type: string
     *                 example: 507f1f77bcf86cd799439013
     *     responses:
     *       201:
     *         description: Tạo nhóm thành công
     *       400:
     *         description: Lỗi validation
     *       404:
     *         description: Không tìm thấy lớp học
     *       500:
     *         description: Lỗi server
     */
    app.post('/api/teams', TeamApiController.createTeam);

    /**
     * @swagger
     * /api/teams:
     *   get:
     *     summary: Lấy danh sách nhóm trong một lớp cụ thể
     *     tags: [Team Management]
     *     parameters:
     *       - in: query
     *         name: class_id
     *         schema:
     *           type: string
     *         description: Lọc theo lớp học
     *         example: 507f1f77bcf86cd799439013
     *     responses:
     *       200:
     *         description: Danh sách nhóm
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total:
     *                   type: number
     *                 teams:
     *                   type: array
     */
    app.get('/api/teams', TeamApiController.getTeams);

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