const AuthController = require('../controllers/AuthController');
const { authenticateToken } = require('../middleware/auth');

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
     * /api/auth/me:
     *   put:
     *     summary: Cập nhật thông tin profile của user hiện tại
     *     tags: [Auth]
     *     description: Cập nhật thông tin profile (full_name, avatar_url, major, ent). Mỗi role có các trường có thể cập nhật khác nhau.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               full_name:
     *                 type: string
     *                 description: Tên đầy đủ (tất cả roles)
     *                 example: Nguyễn Văn A
     *               avatar_url:
     *                 type: string
     *                 description: URL avatar (chỉ LECTURER và STUDENT, không áp dụng cho ADMIN)
     *                 example: https://example.com/avatar.jpg
     *               major:
     *                 type: string
     *                 description: Chuyên ngành (chỉ STUDENT)
     *                 example: Software Engineering
     *               ent:
     *                 type: string
     *                 description: Khóa học (chỉ STUDENT, ví dụ K18, K19)
     *                 example: K19
     *           examples:
     *             lecturer:
     *               summary: Cập nhật profile Lecturer
     *               value:
     *                 full_name: Trần Thị Giảng Viên
     *                 avatar_url: https://example.com/avatar.jpg
     *             student:
     *               summary: Cập nhật profile Student
     *               value:
     *                 full_name: Lê Văn Sinh Viên
     *                 avatar_url: https://example.com/avatar.jpg
     *                 major: Software Engineering
     *                 ent: K19
     *             admin:
     *               summary: Cập nhật profile Admin
     *               value:
     *                 full_name: Admin User
     *     responses:
     *       200:
     *         description: Cập nhật profile thành công
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "✅ Cập nhật profile thành công!"
     *                 user:
     *                   oneOf:
     *                     - $ref: '#/components/schemas/Admin'
     *                     - $ref: '#/components/schemas/Lecturer'
     *                     - $ref: '#/components/schemas/Student'
     *                 role:
     *                   type: string
     *                   enum: [ADMIN, LECTURER, STUDENT]
     *       400:
     *         description: Lỗi validation hoặc không có trường nào để cập nhật
     *       401:
     *         description: Token không hợp lệ hoặc đã hết hạn
     *       403:
     *         description: Email chưa được xác minh (chỉ áp dụng cho LECTURER và STUDENT)
     *       500:
     *         description: Lỗi server
     */
    app.put('/api/auth/me', authenticateToken, AuthController.updateProfile);

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
};
