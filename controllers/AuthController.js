const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const models = require('../models');
const OTP = require('../models/OTP');
const { sendOTPEmail, sendVerificationOTPEmail } = require('../services/EmailService');

// ==========================================
// YÊU CẦU OTP ĐĂNG KÝ (REQUEST REGISTRATION OTP)
// ==========================================
const requestRegistrationOTP = async (req, res) => {
    try {
        const { email } = req.body;

        // Validate input
        if (!email) {
            return res.status(400).json({ 
                error: 'Email là bắt buộc' 
            });
        }

        // Kiểm tra email đã tồn tại chưa (trong cả Lecturer và Student)
        const existingLecturer = await models.Lecturer.findOne({ email });
        const existingStudent = await models.Student.findOne({ email });

        if (existingLecturer || existingStudent) {
            return res.status(400).json({ 
                error: 'Email đã được sử dụng' 
            });
        }

        // Tạo mã OTP 6 chữ số
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Thời gian hết hạn: 10 phút
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);

        // Xóa các OTP cũ của email này (nếu có) - chỉ xóa OTP chưa hết hạn và chưa dùng
        // Lưu ý: OTP đã dùng sẽ bị xóa ngay sau khi verify, nên chỉ cần xóa OTP chưa hết hạn
        await OTP.deleteMany({ 
            email, 
            type: 'VERIFICATION',
            expires_at: { $gt: new Date() } // Chỉ xóa OTP chưa hết hạn
        });

        // Lưu OTP vào database với type là 'VERIFICATION' (không có role ở đây)
        // Role sẽ được set khi đăng ký ở bước 2
        await OTP.create({
            email,
            otp_code: otpCode,
            role: 'STUDENT', // Tạm thời set default, sẽ được update khi register
            type: 'VERIFICATION',
            expires_at: expiresAt
        });

        // Gửi email OTP (không cần role trong email nữa)
        try {
            await sendVerificationOTPEmail(email, otpCode, 'USER'); // Generic role
            res.json({
                message: 'Mã OTP đã được gửi đến email của bạn. Vui lòng kiểm tra hộp thư (bao gồm cả thư mục Spam).',
                expires_in_minutes: 10
            });
        } catch (emailError) {
            console.error('Lỗi gửi email:', emailError);
            // Xóa OTP đã tạo nếu gửi email thất bại
            await OTP.deleteOne({ email, otp_code: otpCode });
            
            // Phân loại lỗi để báo rõ ràng hơn
            let errorMessage = 'Không thể gửi email OTP.';
            if (emailError.message && emailError.message.includes('timeout')) {
                errorMessage = 'Không thể kết nối đến server email (timeout). Vui lòng kiểm tra cấu hình EMAIL_USER và EMAIL_PASSWORD trên Render, hoặc thử lại sau.';
            } else if (emailError.message && emailError.message.includes('EAUTH')) {
                errorMessage = 'Xác thực email thất bại. Vui lòng kiểm tra EMAIL_USER và EMAIL_PASSWORD trên Render (phải dùng App Password cho Gmail).';
            } else if (emailError.message && emailError.message.includes('ECONNECTION')) {
                errorMessage = 'Không thể kết nối đến server email. Render có thể đang chặn SMTP port. Vui lòng thử lại sau hoặc liên hệ admin.';
            }
            
            return res.status(500).json({ 
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? emailError.message : undefined
            });
        }

    } catch (error) {
        console.error('Request registration OTP error:', error);
        
        // Nếu lỗi duplicate key do index cũ, báo rõ ràng
        if (error.message && error.message.includes('verification_token')) {
            return res.status(500).json({ 
                error: 'Lỗi database: Index cũ verification_token vẫn còn. Vui lòng liên hệ admin để xóa index này trên MongoDB Atlas.',
                details: error.message
            });
        }
        
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// ĐĂNG KÝ (REGISTER) - VỚI OTP
// ==========================================
const register = async (req, res) => {
    try {
        const { role, email, password, otp_code, full_name, student_code, avatar_url, major } = req.body;

        // Validate role - KHÔNG CHO PHÉP ĐĂNG KÝ ADMIN
        if (!['LECTURER', 'STUDENT'].includes(role)) {
            return res.status(403).json({ 
                error: 'Role không hợp lệ. Chỉ cho phép đăng ký LECTURER hoặc STUDENT. ADMIN chỉ được tạo qua hệ thống quản trị.' 
            });
        }

        // Validate required fields
        if (!email || !password || !otp_code) {
            return res.status(400).json({ 
                error: 'Email, password và otp_code là bắt buộc' 
            });
        }

        // Validate student_code cho STUDENT
        if (role === 'STUDENT' && !student_code) {
            return res.status(400).json({ 
                error: 'student_code là bắt buộc cho STUDENT' 
            });
        }

        // Kiểm tra OTP hợp lệ trước (không cần role vì OTP chỉ lưu email)
        // Lưu ý: OTP đã dùng sẽ bị xóa ngay, nên không cần check is_used
        const otpRecord = await OTP.findOne({
            email,
            otp_code,
            type: 'VERIFICATION',
            expires_at: { $gt: new Date() } // Chưa hết hạn
        });

        if (!otpRecord) {
            return res.status(400).json({ 
                error: 'Mã OTP không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã OTP mới.' 
            });
        }

        // Kiểm tra email đã tồn tại chưa (double check)
        let existingUser = null;
        if (role === 'LECTURER') {
            existingUser = await models.Lecturer.findOne({ email });
        } else if (role === 'STUDENT') {
            existingUser = await models.Student.findOne({ 
                $or: [{ email }, { student_code }] 
            });
        }

        if (existingUser) {
            return res.status(400).json({ 
                error: role === 'STUDENT' ? 'Email hoặc student_code đã được sử dụng' : 'Email đã được sử dụng'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        let newUser;

        // Tạo user theo role (CHỈ LECTURER và STUDENT) với is_verified = true (vì đã verify OTP)
        if (role === 'LECTURER') {
            newUser = await models.Lecturer.create({
                email,
                password: hashedPassword,
                full_name: full_name || '',
                avatar_url: avatar_url || '',
                role: 'LECTURER',
                is_verified: true // Đã verify OTP rồi
            });
        } 
        else if (role === 'STUDENT') {
            newUser = await models.Student.create({
                email,
                password: hashedPassword,
                student_code,
                full_name: full_name || '',
                avatar_url: avatar_url || '',
                major: major || '',
                role: 'STUDENT',
                is_verified: true // Đã verify OTP rồi
            });
        }

        // Xóa OTP ngay sau khi verify thành công (đã dùng rồi không cần giữ)
        await OTP.deleteOne({ _id: otpRecord._id });

        // Trả về user (không trả password)
        const userResponse = newUser.toObject();
        delete userResponse.password;

        res.status(201).json({
            message: `✅ Đăng ký ${role} thành công!`,
            user: userResponse
        });

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

        // Xóa các OTP cũ của email này (nếu có) - chỉ xóa OTP chưa hết hạn
        await OTP.deleteMany({ 
            email, 
            role, 
            type: 'RESET_PASSWORD',
            expires_at: { $gt: new Date() } // Chỉ xóa OTP chưa hết hạn
        });

        // Lưu OTP vào database
        await OTP.create({
            email,
            otp_code: otpCode,
            role,
            type: 'RESET_PASSWORD',
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
        const { email, otp_code, new_password, confirm_password } = req.body;

        // Validate input
        if (!email || !otp_code || !new_password || !confirm_password) {
            return res.status(400).json({ 
                error: 'Email, otp_code, new_password và confirm_password là bắt buộc' 
            });
        }

        // Kiểm tra mật khẩu mới và xác nhận mật khẩu phải giống nhau
        if (new_password !== confirm_password) {
            return res.status(400).json({ 
                error: 'Mật khẩu mới và xác nhận mật khẩu không khớp' 
            });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ 
                error: 'Mật khẩu mới phải có ít nhất 6 ký tự' 
            });
        }

        // Tìm OTP hợp lệ bằng email và otp_code (tự động tìm role từ OTP record)
        // Lưu ý: OTP đã dùng sẽ bị xóa ngay, nên không cần check is_used
        const otpRecord = await OTP.findOne({
            email,
            otp_code,
            type: 'RESET_PASSWORD',
            expires_at: { $gt: new Date() } // Chưa hết hạn
        });

        if (!otpRecord) {
            return res.status(400).json({ 
                error: 'Mã OTP không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã OTP mới.' 
            });
        }

        // Tự động tìm user bằng email và role từ OTP record
        let user = null;
        if (otpRecord.role === 'LECTURER') {
            user = await models.Lecturer.findOne({ email });
        } else if (otpRecord.role === 'STUDENT') {
            user = await models.Student.findOne({ email });
        } else {
            return res.status(403).json({
                error: 'Chỉ hỗ trợ đặt lại mật khẩu cho LECTURER và STUDENT.'
            });
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

        // Xóa OTP ngay sau khi verify thành công (đã dùng rồi không cần giữ)
        await OTP.deleteOne({ _id: otpRecord._id });

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
        const { email, otp_code } = req.body;

        // Validate input
        if (!email || !otp_code) {
            return res.status(400).json({ 
                error: 'Email và otp_code là bắt buộc' 
            });
        }

        // Tìm OTP hợp lệ bằng email và otp_code
        // Lưu ý: OTP đã dùng sẽ bị xóa ngay, nên không cần check is_used
        const otpRecord = await OTP.findOne({
            email,
            otp_code,
            type: 'VERIFICATION',
            expires_at: { $gt: new Date() } // Chưa hết hạn
        });

        if (!otpRecord) {
            return res.status(400).json({ 
                error: 'Mã OTP không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã OTP mới.' 
            });
        }

        // Tìm user bằng email và role từ OTP record
        let user = null;
        if (otpRecord.role === 'LECTURER') {
            user = await models.Lecturer.findOne({ email });
        } else if (otpRecord.role === 'STUDENT') {
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

        // Xóa OTP ngay sau khi verify thành công (đã dùng rồi không cần giữ)
        await OTP.deleteOne({ _id: otpRecord._id });

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
    requestRegistrationOTP,
    register,
    login,
    forgotPassword,
    verifyOTPAndResetPassword,
    verifyRegistrationOTP
};
