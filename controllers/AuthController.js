const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const models = require('../models');
const OTP = require('../models/OTP');
const { getRoleFromEmail, extractStudentCodeFromEmail } = require('../utils/roleHelper');

/** Thời hạn access token. Env JWT_ACCESS_EXPIRES: '15m' | '1h' | '24h' | ... (mặc định 1h) */
const getAccessExpires = () => process.env.JWT_ACCESS_EXPIRES || '1h';
const PendingEnrollment = require('../models/PendingEnrollment');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const Class = require('../models/Class');
const { sendOTPEmail, sendVerificationOTPEmail } = require('../services/EmailService');

// ==========================================
// YÊU CẦU OTP ĐĂNG KÝ (REQUEST REGISTRATION OTP)
// ==========================================
const requestRegistrationOTP = async (req, res) => {
    try {
        // Normalize email
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

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
            console.error('❌ Lỗi gửi email trong requestRegistrationOTP:', emailError);
            console.error('❌ Error message:', emailError.message);
            if (emailError.originalError) {
                console.error('❌ Original error:', emailError.originalError);
            }
            
            // Xóa OTP đã tạo nếu gửi email thất bại
            await OTP.deleteOne({ email, otp_code: otpCode });
            
            // Sử dụng error message từ EmailService (đã được format rõ ràng)
            const errorMessage = emailError.message || 'Không thể gửi email OTP.';
            
            // Trả về error với details nếu là development hoặc trên Render (để debug)
            const isRender = process.env.RENDER || process.env.NODE_ENV === 'production';
            return res.status(500).json({ 
                error: errorMessage,
                // Chỉ trả về details nếu là development hoặc trên Render để debug
                details: (process.env.NODE_ENV === 'development' || isRender) ? {
                    message: emailError.message,
                    code: emailError.originalError?.code || emailError.code,
                    responseCode: emailError.originalError?.responseCode
                } : undefined
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
        const { role, password, otp_code, full_name, avatar_url, major, ent } = req.body;
        // Normalize email and student_code
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';
        const student_code = req.body.student_code ? req.body.student_code.toString().trim().toUpperCase() : '';

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
            // Xử lý ENT (khóa học): Ưu tiên dùng từ request, nếu không có thì tự động suy ra từ MSSV
            let studentEnt = ent;
            if (!studentEnt && student_code && student_code.length >= 4) {
                // Tự động suy ra ENT từ MSSV, ví dụ CE190585 -> K19
                const yearPart = student_code.slice(2, 4); // "19" trong CE190585
                if (!isNaN(Number(yearPart))) {
                    studentEnt = `K${yearPart}`;
                }
            }

            newUser = await models.Student.create({
                email,
                password: hashedPassword,
                student_code,
                full_name: full_name || '',
                avatar_url: avatar_url || '',
                major: major || '',
                ent: studentEnt, // Có thể là từ request hoặc tự động suy ra
                role: 'STUDENT',
                is_verified: true // Đã verify OTP rồi
            });

            // ==========================================
            // TỰ ĐỘNG ENROLL VÀO LỚP NẾU CÓ TRONG PENDING ENROLLMENT
            // ==========================================
            // Logic: 
            // 1. Tìm tất cả PendingEnrollment chưa enroll theo roll_number hoặc email
            // 2. Với mỗi pending enrollment:
            //    - Validate class vẫn tồn tại và đang Active
            //    - Validate semester vẫn còn hiệu lực (nếu cần)
            //    - Tìm hoặc tạo Team theo Group
            //    - Tạo TeamMember (enroll vào lớp)
            //    - Đánh dấu enrolled = true
            // 3. Một sinh viên có thể enroll vào nhiều lớp (nhiều môn, nhiều lớp khác nhau)
            try {
                const Class = require('../models/Class');
                
                // Tìm pending enrollment theo student_code hoặc email
                // Match theo roll_number hoặc email để tìm tất cả các lớp mà sinh viên được import
                const pendingEnrollments = await PendingEnrollment.find({
                    enrolled: false,
                    $or: [
                        { roll_number: student_code.trim() },
                        { email: email.toLowerCase().trim() }
                    ]
                }).populate('class_id', 'name subjectName semester_id lecturer_id status')
                  .populate('semester_id', 'name code start_date end_date status');

                const enrolledClasses = [];
                const skippedClasses = [];

                for (const pending of pendingEnrollments) {
                    try {
                        // Validate 1: Class phải tồn tại
                        if (!pending.class_id || !pending.class_id._id) {
                            console.warn(`⚠️ Class không tồn tại cho pending enrollment ${pending._id}, bỏ qua`);
                            skippedClasses.push({
                                reason: 'Class không tồn tại',
                                pending_id: pending._id
                            });
                            continue;
                        }

                        // Validate 2: Class phải đang Active (không phải Archived)
                        if (pending.class_id.status === 'Archived') {
                            console.warn(`⚠️ Class ${pending.class_id.name} đã bị Archived, bỏ qua enrollment`);
                            skippedClasses.push({
                                class_name: pending.class_id.name,
                                reason: 'Class đã bị Archived'
                            });
                            continue;
                        }

                        // Validate 3: Semester phải tồn tại và đang Open (nếu cần)
                        if (pending.semester_id && pending.semester_id.status === 'Closed') {
                            console.warn(`⚠️ Semester ${pending.semester_id.name} đã Closed, bỏ qua enrollment`);
                            skippedClasses.push({
                                class_name: pending.class_id.name,
                                reason: 'Semester đã Closed'
                            });
                            continue;
                        }

                        // Log để debug
                        console.log(`📚 Enrolling student ${student_code} vào lớp: ${pending.class_id.name} (Môn: ${pending.class_id.subjectName}, Group: ${pending.group})`);

                        // Tìm hoặc tạo Team theo Group
                        let team = await Team.findOne({
                            class_id: pending.class_id._id,
                            project_name: `Group ${pending.group}`
                        });

                        if (!team) {
                            // Tạo team mới nếu chưa có
                            team = await Team.create({
                                class_id: pending.class_id._id,
                                project_name: `Group ${pending.group}`
                            });
                            console.log(`✅ Tạo team mới: Group ${pending.group} cho lớp ${pending.class_id.name}`);
                        }

                        // Kiểm tra TeamMember đã tồn tại chưa (tránh duplicate)
                        // Một sinh viên chỉ có thể ở 1 team trong 1 class
                        const existingMember = await TeamMember.findOne({
                            team_id: team._id,
                            student_id: newUser._id
                        });

                        if (!existingMember) {
                            // Tạo TeamMember (enroll vào lớp)
                            await TeamMember.create({
                                team_id: team._id,
                                student_id: newUser._id,
                                role_in_team: pending.is_leader ? 'Leader' : 'Member',
                                is_active: true
                            });

                            // Đánh dấu đã enroll
                            pending.enrolled = true;
                            pending.enrolled_at = new Date();
                            await pending.save();

                            enrolledClasses.push({
                                class_id: pending.class_id._id.toString(),
                                class_name: pending.class_id.name,
                                subject_name: pending.class_id.subjectName,
                                group: pending.group,
                                role: pending.is_leader ? 'Leader' : 'Member',
                                semester: pending.semester_id?.name || 'N/A'
                            });
                            
                            console.log(`✅ Đã enroll student ${student_code} vào lớp ${pending.class_id.name}, Group ${pending.group}, Role: ${pending.is_leader ? 'Leader' : 'Member'}`);
                        } else {
                            // Đã tồn tại TeamMember (có thể do enroll thủ công trước đó)
                            // Nhưng chưa đánh dấu pending.enrolled → đánh dấu lại
                            if (!pending.enrolled) {
                                pending.enrolled = true;
                                pending.enrolled_at = new Date();
                                await pending.save();
                                console.log(`ℹ️ Student ${student_code} đã có trong team, đánh dấu pending enrollment là enrolled`);
                            }
                        }
                    } catch (enrollError) {
                        console.error(`❌ Lỗi enroll vào lớp ${pending.class_id?._id || pending.class_id || 'unknown'}:`, enrollError.message);
                        skippedClasses.push({
                            class_name: pending.class_id?.name || 'Unknown',
                            reason: `Lỗi: ${enrollError.message}`
                        });
                        // Tiếp tục với lớp khác, không dừng lại
                    }
                }

                // Log kết quả
                if (enrolledClasses.length > 0) {
                    console.log(`✅ Tự động enroll ${enrolledClasses.length} lớp cho sinh viên ${student_code}:`, 
                        enrolledClasses.map(c => `${c.subject_name} - ${c.class_name} (Group ${c.group})`).join(', '));
                }
                
                if (skippedClasses.length > 0) {
                    console.warn(`⚠️ Bỏ qua ${skippedClasses.length} lớp (class không tồn tại/archived hoặc lỗi):`, 
                        skippedClasses.map(s => s.class_name || s.reason).join(', '));
                }
            } catch (autoEnrollError) {
                // Không throw error, chỉ log để không ảnh hưởng đến quá trình đăng ký
                console.error('❌ Lỗi tự động enroll:', autoEnrollError);
            }
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
        const { password } = req.body;
        // Normalize email
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

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

        // Trả về thông tin cơ bản (thông tin chi tiết lấy từ API /api/auth/me)
        const basicUserInfo = {
            _id: user._id.toString(),
            email: user.email,
            role: userRole,
            full_name: user.full_name || ''
        };

        const jwtSecret = process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
        const RefreshToken = require('../models/RefreshToken');

        // Tạo Access Token (mặc định 1h; cấu hình qua JWT_ACCESS_EXPIRES)
        const accessExpires = getAccessExpires();
        const accessToken = jwt.sign(
            {
                userId: user._id.toString(),
                email: user.email,
                role: userRole,
                type: 'access'
            },
            jwtSecret,
            { expiresIn: accessExpires }
        );

        // Tạo Refresh Token (dài hạn - 30 ngày)
        const refreshToken = jwt.sign(
            {
                userId: user._id.toString(),
                email: user.email,
                role: userRole,
                type: 'refresh'
            },
            jwtSecret,
            { expiresIn: '30d' } // Refresh token hết hạn sau 30 ngày
        );

        // Lưu refresh token vào database
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30); // 30 ngày

        await RefreshToken.create({
            user_id: user._id,
            role: userRole,
            token: refreshToken,
            expires_at: expiresAt
        });

        res.json({
            message: `✅ Đăng nhập thành công!`,
            access_token: accessToken,
            refresh_token: refreshToken,
            user: basicUserInfo
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
        const { role } = req.body;
        // Normalize email
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

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
        const { otp_code, new_password, confirm_password } = req.body;
        // Normalize email
        const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

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
// REFRESH TOKEN
// ==========================================
/**
 * POST /auth/refresh-token
 * Làm mới access token bằng refresh token
 */
const refreshToken = async (req, res) => {
    try {
        const { refresh_token } = req.body;

        // Validate input
        if (!refresh_token) {
            return res.status(400).json({
                error: 'refresh_token là bắt buộc'
            });
        }

        const jwtSecret = process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
        const RefreshToken = require('../models/RefreshToken');

        // Verify refresh token
        let decoded;
        try {
            decoded = jwt.verify(refresh_token, jwtSecret);
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    error: 'Refresh token đã hết hạn. Vui lòng đăng nhập lại.'
                });
            } else {
                return res.status(401).json({
                    error: 'Refresh token không hợp lệ.'
                });
            }
        }

        // Kiểm tra type phải là 'refresh'
        if (decoded.type !== 'refresh') {
            return res.status(401).json({
                error: 'Token không phải là refresh token.'
            });
        }

        // Kiểm tra refresh token có trong database và chưa bị revoke
        const tokenRecord = await RefreshToken.findOne({
            token: refresh_token,
            revoked: false,
            expires_at: { $gt: new Date() }
        });

        if (!tokenRecord) {
            return res.status(401).json({
                error: 'Refresh token không hợp lệ hoặc đã bị thu hồi.'
            });
        }

        // Kiểm tra user còn tồn tại không
        let user = null;
        if (decoded.role === 'ADMIN') {
            user = await models.Admin.findById(decoded.userId);
        } else if (decoded.role === 'LECTURER') {
            user = await models.Lecturer.findById(decoded.userId);
        } else if (decoded.role === 'STUDENT') {
            user = await models.Student.findById(decoded.userId);
        }

        if (!user) {
            // Revoke token nếu user không tồn tại
            await RefreshToken.updateOne(
                { token: refresh_token },
                { revoked: true }
            );
            return res.status(401).json({
                error: 'User không tồn tại.'
            });
        }

        // Tạo access token mới (cùng thời hạn với login)
        const accessExpires = getAccessExpires();
        const newAccessToken = jwt.sign(
            {
                userId: user._id.toString(),
                email: user.email,
                role: decoded.role,
                type: 'access'
            },
            jwtSecret,
            { expiresIn: accessExpires }
        );

        res.json({
            message: '✅ Làm mới token thành công!',
            access_token: newAccessToken
        });

    } catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// LẤY THÔNG TIN PROFILE (GET PROFILE)
// ==========================================
/**
 * GET /auth/me
 * Lấy thông tin profile của user hiện tại (từ token)
 */
const getProfile = async (req, res) => {
    try {
        // req.user và req.role đã được set bởi authenticateToken middleware
        const user = req.user;
        const role = req.role;

        // Trả về user info (không trả password)
        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({
            user: userResponse,
            role: role
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// CẬP NHẬT PROFILE (UPDATE PROFILE)
// ==========================================
/**
 * PUT /auth/me
 * Cập nhật thông tin profile của user hiện tại
 */
const updateProfile = async (req, res) => {
    try {
        // req.user và req.role đã được set bởi authenticateToken middleware
        const user = req.user;
        const role = req.role;
        const { full_name, avatar_url, major, ent } = req.body;

        // Validate: ít nhất phải có một trường để update
        if (!full_name && !avatar_url && major === undefined && ent === undefined) {
            return res.status(400).json({
                error: 'Vui lòng cung cấp ít nhất một trường để cập nhật (full_name, avatar_url, major, ent)'
            });
        }

        // Cập nhật các trường được phép theo role
        if (full_name !== undefined) {
            user.full_name = full_name;
        }

        // Admin không có avatar_url
        if (avatar_url !== undefined && role !== 'ADMIN') {
            user.avatar_url = avatar_url;
        }

        // Chỉ Student mới có major và ent
        if (role === 'STUDENT') {
            if (major !== undefined) {
                user.major = major;
            }
            if (ent !== undefined) {
                user.ent = ent;
            }
        } else {
            // Nếu không phải Student mà gửi major hoặc ent thì bỏ qua
            if (major !== undefined || ent !== undefined) {
                return res.status(400).json({
                    error: 'Chỉ Student mới có thể cập nhật major và ent'
                });
            }
        }

        // Lưu thay đổi
        await user.save();

        // Trả về user đã cập nhật (không trả password)
        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({
            message: '✅ Cập nhật profile thành công!',
            user: userResponse,
            role: role
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// LẤY DANH SÁCH LỚP CỦA SINH VIÊN (GET MY CLASSES)
// ==========================================
/**
 * GET /auth/me/classes
 * Lấy danh sách các lớp mà sinh viên tham gia (với role trong mỗi team)
 * Chỉ dành cho STUDENT
 */
const getMyClasses = async (req, res) => {
    try {
        // req.user và req.role đã được set bởi authenticateToken middleware
        const user = req.user;
        const role = req.role;

        // Chỉ cho phép STUDENT
        if (role !== 'STUDENT') {
            return res.status(403).json({
                error: 'Chỉ sinh viên mới có thể xem danh sách lớp của mình'
            });
        }

        // Lấy tất cả TeamMember của sinh viên này
        const teamMembers = await TeamMember.find({
            student_id: user._id,
            is_active: true
        })
        .populate({
            path: 'team_id',
            select: '_id project_name class_id',
            populate: {
                path: 'class_id',
                select: '_id name class_code semester_id lecturer_id',
                populate: [
                    {
                        path: 'semester_id',
                        select: '_id name code start_date end_date'
                    },
                    {
                        path: 'lecturer_id',
                        select: '_id email full_name'
                    }
                ]
            }
        })
        .lean();

        // Bỏ qua dữ liệu mồ côi (team/class đã bị xóa) — tránh crash khi populate trả null
        const validMembers = teamMembers.filter(tm => tm.team_id && tm.team_id.class_id);

        const classes = validMembers.map(tm => ({
            team_id: tm.team_id._id,
            team_name: tm.team_id.project_name,
            role_in_team: tm.role_in_team,
            is_leader: tm.role_in_team === 'Leader',
            class: {
                _id: tm.team_id.class_id._id,
                name: tm.team_id.class_id.name,
                class_code: tm.team_id.class_id.class_code,
                semester: tm.team_id.class_id.semester_id ?? null,
                lecturer: tm.team_id.class_id.lecturer_id ?? null
            }
        }));

        res.json({
            total: classes.length,
            classes: classes
        });
    } catch (error) {
        console.error('Get my classes error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// ĐĂNG XUẤT (LOGOUT)
// ==========================================
/**
 * POST /auth/logout
 * Đăng xuất (revoke refresh token)
 */
const logout = async (req, res) => {
    try {
        const { refresh_token } = req.body;

        if (refresh_token) {
            // Revoke refresh token trong database
            const RefreshToken = require('../models/RefreshToken');
            await RefreshToken.updateOne(
                { token: refresh_token },
                { revoked: true }
            );
        }

        res.json({
            message: '✅ Đăng xuất thành công! Vui lòng xóa token ở client.'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// GOOGLE TOKEN LOGIN (cho Mobile - dùng ID Token từ Google Sign-In SDK)
// ==========================================
/**
 * POST /auth/google/token
 * 
 * Dành cho mobile app: FE dùng Google Sign-In SDK (React Native, Flutter, etc.)
 * -> SDK hiển thị popup chọn tài khoản NGAY TRONG APP, không cần mở Chrome
 * -> FE gửi id_token lên đây, BE verify và trả JWT
 * 
 * Body: { id_token: "..." } hoặc { credential: "..." }
 */
const googleTokenLogin = async (req, res) => {
    try {
        const idToken = req.body.id_token || req.body.credential;
        if (!idToken) {
            return res.status(400).json({ 
                error: 'id_token hoặc credential là bắt buộc' 
            });
        }

        // Mobile (Android/iOS) dùng Client ID riêng; Web dùng GOOGLE_CLIENT_ID.
        // id_token từ Android có audience = Android Client ID → BE phải verify với cả hai.
        const webClientId = process.env.GOOGLE_CLIENT_ID;
        const androidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID || '';
        const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || '';
        const allowedAudiences = [webClientId, androidClientId, iosClientId].filter(Boolean);
        if (allowedAudiences.length === 0) {
            return res.status(500).json({ error: 'GOOGLE_CLIENT_ID chưa được cấu hình' });
        }

        const client = new OAuth2Client();
        const ticket = await client.verifyIdToken({
            idToken,
            audience: allowedAudiences.length === 1 ? allowedAudiences[0] : allowedAudiences
        });
        const payload = ticket.getPayload();
        const email = payload.email?.toLowerCase();
        const googleId = payload.sub;
        const displayName = payload.name || (payload.given_name && payload.family_name ? `${payload.given_name} ${payload.family_name}` : '');
        const avatarUrl = payload.picture || '';

        if (!email) {
            return res.status(400).json({ error: 'Không thể lấy email từ Google account' });
        }

        const role = getRoleFromEmail(email);
        let user = null;
        let UserModel = null;

        if (role === 'STUDENT') UserModel = models.Student;
        else if (role === 'LECTURER') UserModel = models.Lecturer;
        else if (role === 'ADMIN') UserModel = models.Admin;
        else {
            return res.status(400).json({ error: `Không thể xác định Role từ email: ${email}` });
        }

        user = await UserModel.findOne({
            $or: [{ googleId }, { email }]
        });

        if (user) {
            if (!user.googleId) user.googleId = googleId;
            if (avatarUrl && (!user.avatar_url || user.avatar_url !== avatarUrl)) user.avatar_url = avatarUrl;
            if (displayName && (!user.full_name || user.full_name !== displayName)) user.full_name = displayName;
            user.is_verified = true;
            await user.save();
        } else {
            const randomPassword = crypto.randomBytes(32).toString('hex');
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            const userData = {
                email,
                googleId,
                full_name: displayName,
                avatar_url: avatarUrl,
                password: hashedPassword,
                is_verified: true
            };
            if (role === 'STUDENT') {
                const studentCode = extractStudentCodeFromEmail(email);
                userData.student_code = studentCode || email.split('@')[0].toUpperCase();
            }
            user = await UserModel.create(userData);
        }

        const jwtSecret = process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
        const RefreshToken = require('../models/RefreshToken');
        const accessExpires = getAccessExpires();

        const accessToken = jwt.sign(
            { userId: user._id.toString(), email: user.email, role, type: 'access' },
            jwtSecret,
            { expiresIn: accessExpires }
        );
        const refreshToken = jwt.sign(
            { userId: user._id.toString(), email: user.email, role, type: 'refresh' },
            jwtSecret,
            { expiresIn: '30d' }
        );

        await RefreshToken.create({
            token: refreshToken,
            user_id: user._id.toString(),
            role,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        return res.json({
            message: 'Đăng nhập Google thành công',
            accessToken,
            refreshToken,
            role,
            user: {
                id: user._id,
                email: user.email,
                full_name: user.full_name,
                avatar_url: user.avatar_url,
                role
            }
        });
    } catch (error) {
        console.error('Google Token Login Error:', error);
        if (error.message?.includes('Token used too late') || error.message?.includes('expired')) {
            return res.status(401).json({ error: 'Token đã hết hạn, vui lòng đăng nhập lại' });
        }
        return res.status(401).json({ error: error.message || 'Xác thực Google thất bại' });
    }
};

// ==========================================
// GOOGLE OAUTH CALLBACK
// ==========================================
const googleCallback = async (req, res) => {
    try {
        // Passport strategy callback trả về user object với role đã được thêm vào
        // req.user được populate bởi passport.authenticate middleware
        if (!req.user || !req.user._id || !req.user.role) {
            return res.status(401).json({ error: 'Google authentication failed' });
        }

        const user = req.user;
        const role = user.role;

        // Tạo JWT tokens (giống như login thông thường)
        const jwtSecret = process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
        const RefreshToken = require('../models/RefreshToken');

        // Tạo Access Token (cùng thời hạn với login)
        const accessExpires = getAccessExpires();
        const accessToken = jwt.sign(
            {
                userId: user._id.toString(),
                email: user.email,
                role: role,
                type: 'access'
            },
            jwtSecret,
            { expiresIn: accessExpires }
        );

        // Tạo Refresh Token
        const refreshToken = jwt.sign(
            {
                userId: user._id.toString(),
                email: user.email,
                role: role,
                type: 'refresh'
            },
            jwtSecret,
            { expiresIn: '30d' }
        );

        // Lưu refresh token vào database
        await RefreshToken.create({
            token: refreshToken,
            user_id: user._id.toString(),
            role: role,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 ngày
        });

        // Redirect về frontend với tokens
        // Lấy redirect_uri từ state parameter (JWT) nếu có, nếu không thì dùng CLIENT_URL
        let frontendRedirectUri = process.env.CLIENT_URL || 'http://localhost:3000';
        
        // Google trả lại state trong req.query.state
        if (req.query.state) {
            try {
                const jwt = require('jsonwebtoken');
                const jwtSecret = process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
                const decoded = jwt.verify(req.query.state, jwtSecret);
                
                if (decoded.provider === 'google' && decoded.redirect_uri) {
                    frontendRedirectUri = decoded.redirect_uri;
                }
            } catch (err) {
                console.warn('⚠️ Không thể decode state từ Google callback, dùng CLIENT_URL mặc định:', err.message);
            }
        }
        
        const redirectUrl = `${frontendRedirectUri}/auth/callback/google?token=${accessToken}&refreshToken=${refreshToken}&role=${role}`;
        
        return res.redirect(redirectUrl);

    } catch (error) {
        console.error('Google OAuth Callback Error:', error);
        let frontendRedirectUri = process.env.CLIENT_URL || 'http://localhost:3000';
        
        // Cố gắng lấy từ state nếu có
        if (req.query.state) {
            try {
                const jwt = require('jsonwebtoken');
                const jwtSecret = process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
                const decoded = jwt.verify(req.query.state, jwtSecret);
                if (decoded.provider === 'google' && decoded.redirect_uri) {
                    frontendRedirectUri = decoded.redirect_uri;
                }
            } catch (err) {
                // Ignore error, dùng CLIENT_URL mặc định
            }
        }
        
        return res.redirect(`${frontendRedirectUri}/auth/callback/google?error=${encodeURIComponent(error.message)}`);
    }
};

// ==========================================
// CẬP NHẬT FCM TOKEN
// ==========================================
/**
 * POST /auth/fcm-token
 * Cập nhật FCM Token cho user hiện tại
 */
const updateFcmToken = async (req, res) => {
    try {
        const user = req.user; // Từ middleware authenticateToken
        const { fcm_token } = req.body;

        if (!fcm_token) {
            return res.status(400).json({ error: 'fcm_token là bắt buộc' });
        }

        user.fcm_token = fcm_token;
        await user.save();

        res.json({ message: '✅ Cập nhật FCM Token thành công!' });
    } catch (error) {
        console.error('Update FCM Token error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    requestRegistrationOTP,
    register,
    login,
    forgotPassword,
    verifyOTPAndResetPassword,
    refreshToken,
    getProfile,
    updateProfile,
    getMyClasses,
    logout,
    googleTokenLogin,
    googleCallback,
    updateFcmToken
};
