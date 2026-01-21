const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const models = require('../models');
const OTP = require('../models/OTP');
const { sendOTPEmail, sendVerificationOTPEmail } = require('../services/EmailService');

// ==========================================
// ĐĂNG KÝ (REGISTER)
// ==========================================
const register = async (req, res) => {
    try {
        const { role, email, password, full_name, student_code, avatar_url, major } = req.body;

        // Validate role - KHÔNG CHO PHÉP ĐĂNG KÝ ADMIN
        if (!['LECTURER', 'STUDENT'].includes(role)) {
            return res.status(403).json({ 
                error: 'Role không hợp lệ. Chỉ cho phép đăng ký LECTURER hoặc STUDENT. ADMIN chỉ được tạo qua hệ thống quản trị.' 
            });
        }

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email và password là bắt buộc' 
            });
        }

        // Validate student_code cho STUDENT
        if (role === 'STUDENT' && !student_code) {
            return res.status(400).json({ 
                error: 'student_code là bắt buộc cho STUDENT' 
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        let newUser;

        // Tạo user theo role (CHỈ LECTURER và STUDENT) với is_verified = false
        if (role === 'LECTURER') {
            // Check email đã tồn tại chưa
            const existingLecturer = await models.Lecturer.findOne({ email });
            if (existingLecturer) {
                return res.status(400).json({ error: 'Email đã được sử dụng' });
            }

            newUser = await models.Lecturer.create({
                email,
                password: hashedPassword,
                full_name: full_name || '',
                avatar_url: avatar_url || '',
                role: 'LECTURER',
                is_verified: false // Chưa verify email
            });
        } 
        else if (role === 'STUDENT') {
            // Check email hoặc student_code đã tồn tại chưa
            const existingStudent = await models.Student.findOne({ 
                $or: [{ email }, { student_code }] 
            });
            if (existingStudent) {
                return res.status(400).json({ 
                    error: 'Email hoặc student_code đã được sử dụng' 
                });
            }

            newUser = await models.Student.create({
                email,
                password: hashedPassword,
                student_code,
                full_name: full_name || '',
                avatar_url: avatar_url || '',
                major: major || '',
                role: 'STUDENT',
                is_verified: false // Chưa verify email
            });
        }

        // Tạo mã OTP 6 chữ số để xác minh email
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Thời gian hết hạn: 10 phút
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);

        // Xóa các OTP cũ của email này (nếu có)
        await OTP.deleteMany({ email, role, is_used: false });

        // Lưu OTP vào database với type là 'VERIFICATION'
        await OTP.create({
            email,
            otp_code: otpCode,
            role,
            expires_at: expiresAt
        });

        // Gửi email OTP xác minh
        try {
            await sendVerificationOTPEmail(email, otpCode, role);
            
            // Trả về user (không trả password)
            const userResponse = newUser.toObject();
            delete userResponse.password;

            res.status(201).json({
                message: `✅ Đăng ký ${role} thành công! Vui lòng kiểm tra email để xác minh tài khoản.`,
                user: userResponse,
                requires_verification: true
            });
        } catch (emailError) {
            console.error('Lỗi gửi email:', emailError);
            // Xóa user đã tạo nếu gửi email thất bại
            await (role === 'LECTURER' ? models.Lecturer : models.Student).findByIdAndDelete(newUser._id);
            // Xóa OTP đã tạo
            await OTP.deleteOne({ email, otp_code: otpCode });
            return res.status(500).json({ 
                error: 'Không thể gửi email xác minh. Vui lòng kiểm tra cấu hình email hoặc thử lại sau.' 
            });
        }

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// ĐĂNG NHẬP (LOGIN)
// ==========================================
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email và password là bắt buộc' 
            });
        }

        // Tìm user trong cả 3 collection (Admin, Lecturer, Student)
        let user = null;
        let userModel = null;
        let userRole = null;

        // Thử tìm trong Admin
        user = await models.Admin.findOne({ email });
        if (user) {
            userModel = models.Admin;
            userRole = 'ADMIN';
        } 
        // Nếu không có, thử Lecturer
        else {
            user = await models.Lecturer.findOne({ email });
            if (user) {
                userModel = models.Lecturer;
                userRole = 'LECTURER';
            } 
            // Nếu không có, thử Student
            else {
                user = await models.Student.findOne({ email });
                if (user) {
                    userModel = models.Student;
                    userRole = 'STUDENT';
                }
            }
        }

        // Không tìm thấy user
        if (!user) {
            return res.status(401).json({ 
                error: 'Email hoặc password không đúng' 
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ 
                error: 'Email hoặc password không đúng' 
            });
        }

        // Kiểm tra email đã được verify chưa (chỉ cho LECTURER và STUDENT)
        if ((userRole === 'LECTURER' || userRole === 'STUDENT') && !user.is_verified) {
            return res.status(403).json({
                error: 'Email chưa được xác minh. Vui lòng kiểm tra email và xác minh tài khoản trước khi đăng nhập.',
                requires_verification: true
            });
        }

        // Trả về user info (không trả password)
        const userResponse = user.toObject();
        delete userResponse.password;

        // Tạo JWT Token
        const jwtSecret = process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
        const token = jwt.sign(
            {
                userId: user._id.toString(),
                email: user.email,
                role: userRole
            },
            jwtSecret,
            { expiresIn: '7d' } // Token hết hạn sau 7 ngày
        );

        res.json({
            message: `✅ Đăng nhập thành công!`,
            token,
            user: userResponse,
            role: userRole
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// QUÊN MẬT KHẨU (FORGOT PASSWORD) - CHỈ STUDENT & LECTURER
// ==========================================
const forgotPassword = async (req, res) => {
    try {
        const { email, role } = req.body;

        // Validate input
        if (!email || !role) {
            return res.status(400).json({ 
                error: 'Email và role là bắt buộc' 
            });
        }

        // Không hỗ trợ ADMIN ở flow OTP reset
        if (!['LECTURER', 'STUDENT'].includes(role)) {
            return res.status(403).json({
                error: 'Chỉ hỗ trợ quên mật khẩu cho LECTURER và STUDENT.'
            });
        }

        // Tìm user theo email và role
        let user = null;
        if (role === 'LECTURER') {
            user = await models.Lecturer.findOne({ email });
        } else if (role === 'STUDENT') {
            user = await models.Student.findOne({ email });
        }

        // Không tìm thấy user - nhưng không báo lỗi để tránh email enumeration
        if (!user) {
            // Trả về success giả để bảo mật (không cho biết email có tồn tại hay không)
            return res.json({
                message: 'Nếu email tồn tại trong hệ thống, mã OTP đã được gửi đến email của bạn.'
            });
        }

        // Tạo mã OTP 6 chữ số
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Thời gian hết hạn: 10 phút
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);

        // Xóa các OTP cũ của email này (nếu có)
        await OTP.deleteMany({ email, role, is_used: false });

        // Lưu OTP vào database
        await OTP.create({
            email,
            otp_code: otpCode,
            role,
            expires_at: expiresAt
        });

        // Gửi email OTP
        try {
            await sendOTPEmail(email, otpCode, role);
            res.json({
                message: 'Mã OTP đã được gửi đến email của bạn. Vui lòng kiểm tra hộp thư (bao gồm cả thư mục Spam).',
                expires_in_minutes: 10
            });
        } catch (emailError) {
            console.error('Lỗi gửi email:', emailError);
            // Xóa OTP đã tạo nếu gửi email thất bại
            await OTP.deleteOne({ email, otp_code: otpCode });
            return res.status(500).json({ 
                error: 'Không thể gửi email OTP. Vui lòng kiểm tra cấu hình email hoặc thử lại sau.' 
            });
        }

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// XÁC THỰC OTP VÀ ĐẶT LẠI MẬT KHẨU - CHỈ STUDENT & LECTURER
// ==========================================
const verifyOTPAndResetPassword = async (req, res) => {
    try {
        const { email, role, otp_code, new_password } = req.body;

        // Validate input
        if (!email || !role || !otp_code || !new_password) {
            return res.status(400).json({ 
                error: 'Email, role, otp_code và new_password là bắt buộc' 
            });
        }

        if (!['LECTURER', 'STUDENT'].includes(role)) {
            return res.status(403).json({
                error: 'Chỉ hỗ trợ đặt lại mật khẩu cho LECTURER và STUDENT.'
            });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ 
                error: 'Mật khẩu mới phải có ít nhất 6 ký tự' 
            });
        }

        // Tìm OTP hợp lệ
        const otpRecord = await OTP.findOne({
            email,
            role,
            otp_code,
            is_used: false,
            expires_at: { $gt: new Date() } // Chưa hết hạn
        });

        if (!otpRecord) {
            return res.status(400).json({ 
                error: 'Mã OTP không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã OTP mới.' 
            });
        }

        // Tìm user
        let user = null;
        if (role === 'LECTURER') {
            user = await models.Lecturer.findOne({ email });
        } else if (role === 'STUDENT') {
            user = await models.Student.findOne({ email });
        }

        if (!user) {
            return res.status(404).json({ 
                error: 'Không tìm thấy người dùng' 
            });
        }

        // Hash mật khẩu mới
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        // Cập nhật mật khẩu
        user.password = hashedPassword;
        await user.save();

        // Đánh dấu OTP đã sử dụng
        otpRecord.is_used = true;
        await otpRecord.save();

        res.json({
            message: '✅ Đặt lại mật khẩu thành công! Bạn có thể đăng nhập với mật khẩu mới.'
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// XÁC MINH EMAIL ĐĂNG KÝ (VERIFY REGISTRATION OTP)
// ==========================================
const verifyRegistrationOTP = async (req, res) => {
    try {
        const { email, role, otp_code } = req.body;

        // Validate input
        if (!email || !role || !otp_code) {
            return res.status(400).json({ 
                error: 'Email, role và otp_code là bắt buộc' 
            });
        }

        if (!['LECTURER', 'STUDENT'].includes(role)) {
            return res.status(400).json({ 
                error: 'Role không hợp lệ' 
            });
        }

        // Tìm OTP hợp lệ
        const otpRecord = await OTP.findOne({
            email,
            role,
            otp_code,
            is_used: false,
            expires_at: { $gt: new Date() } // Chưa hết hạn
        });

        if (!otpRecord) {
            return res.status(400).json({ 
                error: 'Mã OTP không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã OTP mới.' 
            });
        }

        // Tìm user
        let user = null;
        if (role === 'LECTURER') {
            user = await models.Lecturer.findOne({ email });
        } else if (role === 'STUDENT') {
            user = await models.Student.findOne({ email });
        }

        if (!user) {
            return res.status(404).json({ 
                error: 'Không tìm thấy người dùng' 
            });
        }

        // Nếu đã verify rồi thì không cần làm gì
        if (user.is_verified) {
            return res.json({
                message: 'Email đã được xác minh trước đó.',
                user: user.toObject()
            });
        }

        // Cập nhật is_verified = true
        user.is_verified = true;
        await user.save();

        // Đánh dấu OTP đã sử dụng
        otpRecord.is_used = true;
        await otpRecord.save();

        // Trả về user (không trả password)
        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({
            message: '✅ Xác minh email thành công! Bạn có thể đăng nhập ngay bây giờ.',
            user: userResponse
        });

    } catch (error) {
        console.error('Verify registration OTP error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    register,
    login,
    forgotPassword,
    verifyOTPAndResetPassword,
    verifyRegistrationOTP
};
