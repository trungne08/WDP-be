const nodemailer = require('nodemailer');

// Cấu hình email transporter
// Cấu hình tường minh (explicit) với host và port - tốt hơn cho Render/Heroku/AWS
const createTransporter = () => {
    // Nếu có EMAIL_HOST và EMAIL_PORT, dùng SMTP trực tiếp
    if (process.env.EMAIL_HOST && process.env.EMAIL_PORT) {
        const port = parseInt(process.env.EMAIL_PORT) || 587;
        const secure = process.env.EMAIL_SECURE === 'true' || port === 465;
        
        return nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: port,
            secure: secure, // true for 465, false for other ports
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            },
            // Tăng timeout để tránh timeout trên Render
            connectionTimeout: 30000, // 30 giây
            socketTimeout: 30000, // 30 giây
            greetingTimeout: 30000, // 30 giây
            // Tùy chọn cho Render - không từ chối các chứng chỉ không hợp lệ
            tls: {
                rejectUnauthorized: false
            }
        });
    }
    
    // Mặc định: Thử port 465 (SSL) trước vì Render thường chặn port 587
    // Port 465 dùng SSL trực tiếp, không cần STARTTLS - ít bị chặn hơn
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465, // Dùng SSL thay vì STARTTLS (port 587)
        secure: true, // SSL required for port 465
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD
        },
        // Tăng timeout để tránh timeout trên Render
        connectionTimeout: 30000, // 30 giây
        socketTimeout: 30000, // 30 giây
        greetingTimeout: 30000, // 30 giây
        // Tùy chọn cho Render - không từ chối các chứng chỉ không hợp lệ
        tls: {
            rejectUnauthorized: false // Hữu ích trên một số server render
        },
        debug: process.env.NODE_ENV === 'development' // Enable debug in development
    });
};

/**
 * Gửi OTP qua email
 * @param {string} toEmail - Email người nhận
 * @param {string} otpCode - Mã OTP (6 chữ số)
 * @param {string} role - Role của user (ADMIN/LECTURER/STUDENT)
 */
const sendOTPEmail = async (toEmail, otpCode, role) => {
    try {
        // Kiểm tra cấu hình email
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            console.error('⚠️ EMAIL_USER hoặc EMAIL_PASSWORD chưa được cấu hình trong .env');
            console.error('⚠️ EMAIL_USER:', process.env.EMAIL_USER ? 'Đã có' : 'THIẾU');
            console.error('⚠️ EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? 'Đã có' : 'THIẾU');
            throw new Error('Email service chưa được cấu hình. Vui lòng kiểm tra file .env');
        }

        // Log thông tin cấu hình (không log password)
        console.log('📧 Đang gửi email từ:', process.env.EMAIL_USER);
        console.log('📧 Đến:', toEmail);
        console.log('📧 SMTP Host:', process.env.EMAIL_HOST || 'smtp.gmail.com');
        console.log('📧 SMTP Port:', process.env.EMAIL_PORT || '465');

        const transporter = createTransporter();

        const mailOptions = {
            from: `"WDP System" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: '🔐 Mã OTP đặt lại mật khẩu - WDP',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">🔐 Đặt lại mật khẩu</h2>
                    <p>Xin chào,</p>
                    <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản <strong>${role}</strong> của bạn.</p>
                    <div style="background-color: #f4f4f4; padding: 20px; border-radius: 5px; text-align: center; margin: 20px 0;">
                        <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px; margin: 0;">${otpCode}</h1>
                    </div>
                    <p><strong>Mã OTP này có hiệu lực trong 10 phút.</strong></p>
                    <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #999; font-size: 12px;">Email này được gửi tự động từ hệ thống WDP. Vui lòng không trả lời email này.</p>
                </div>
            `,
            text: `Mã OTP đặt lại mật khẩu của bạn là: ${otpCode}. Mã này có hiệu lực trong 10 phút.`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email OTP đã được gửi:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        // Log chi tiết lỗi để debug (quan trọng để xem Google trả về gì)
        console.error('❌ ========== LỖI GỬI EMAIL (sendOTPEmail) ==========');
        console.error('❌ Error message:', error.message);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error response:', error.response || 'N/A');
        console.error('❌ Error responseCode:', error.responseCode || 'N/A');
        console.error('❌ Error command:', error.command || 'N/A');
        console.error('❌ Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        console.error('❌ ====================================');
        
        // Phân loại lỗi để báo rõ ràng hơn
        let errorMessage = 'Không thể gửi email OTP.';
        
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNECTION' || error.code === 'ESOCKET') {
            errorMessage = 'Không thể kết nối đến server email. Render có thể đang chặn SMTP port. Vui lòng kiểm tra cấu hình EMAIL_USER và EMAIL_PASSWORD trên Render, đảm bảo dùng App Password cho Gmail.';
        } else if (error.code === 'EAUTH' || error.responseCode === 535) {
            errorMessage = 'Xác thực email thất bại. Vui lòng kiểm tra EMAIL_USER và EMAIL_PASSWORD trên Render. Lưu ý: Phải dùng App Password cho Gmail (không dùng mật khẩu thường). Vào Google Account > Security > App passwords để tạo App Password.';
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Kết nối bị từ chối. Render có thể đang chặn SMTP port. Vui lòng kiểm tra cấu hình EMAIL_HOST và EMAIL_PORT trên Render.';
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'Không tìm thấy server email. Vui lòng kiểm tra EMAIL_HOST trên Render (mặc định là smtp.gmail.com).';
        } else if (error.responseCode === 553) {
            errorMessage = 'Địa chỉ email người gửi không hợp lệ. Vui lòng kiểm tra EMAIL_USER trên Render.';
        } else if (error.responseCode === 550) {
            errorMessage = 'Địa chỉ email người nhận không hợp lệ hoặc bị từ chối.';
        } else if (error.message && error.message.includes('Invalid login')) {
            errorMessage = 'Đăng nhập email thất bại. Vui lòng kiểm tra EMAIL_USER và EMAIL_PASSWORD trên Render. Phải dùng App Password cho Gmail.';
        } else if (error.message && error.message.includes('Email service chưa được cấu hình')) {
            errorMessage = 'Email service chưa được cấu hình trên Render. Vui lòng thêm các biến môi trường: EMAIL_USER và EMAIL_PASSWORD trong Render dashboard.';
        }
        
        const detailedError = new Error(errorMessage);
        detailedError.originalError = error;
        throw detailedError;
    }
};

/**
 * Gửi OTP xác minh email khi đăng ký
 * @param {string} toEmail - Email người nhận
 * @param {string} otpCode - Mã OTP (6 chữ số)
 * @param {string} role - Role của user (LECTURER/STUDENT)
 */
const sendVerificationOTPEmail = async (toEmail, otpCode, role) => {
    try {
        // Kiểm tra cấu hình email
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            console.error('⚠️ EMAIL_USER hoặc EMAIL_PASSWORD chưa được cấu hình trong .env');
            console.error('⚠️ EMAIL_USER:', process.env.EMAIL_USER ? 'Đã có' : 'THIẾU');
            console.error('⚠️ EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? 'Đã có' : 'THIẾU');
            throw new Error('Email service chưa được cấu hình. Vui lòng kiểm tra file .env');
        }

        // Log thông tin cấu hình (không log password)
        console.log('📧 Đang gửi email từ:', process.env.EMAIL_USER);
        console.log('📧 Đến:', toEmail);
        console.log('📧 SMTP Host:', process.env.EMAIL_HOST || 'smtp.gmail.com');
        console.log('📧 SMTP Port:', process.env.EMAIL_PORT || '465');

        const transporter = createTransporter();

        const mailOptions = {
            from: `"WDP System" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: '✅ Xác minh email đăng ký - WDP',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">✅ Xác minh email đăng ký</h2>
                    <p>Xin chào,</p>
                    <p>Cảm ơn bạn đã đăng ký tài khoản <strong>${role}</strong> trên hệ thống WDP.</p>
                    <p>Để hoàn tất đăng ký, vui lòng xác minh email của bạn bằng mã OTP bên dưới:</p>
                    <div style="background-color: #f4f4f4; padding: 20px; border-radius: 5px; text-align: center; margin: 20px 0;">
                        <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px; margin: 0;">${otpCode}</h1>
                    </div>
                    <p><strong>Mã OTP này có hiệu lực trong 10 phút.</strong></p>
                    <p>Nếu bạn không đăng ký tài khoản này, vui lòng bỏ qua email này.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #999; font-size: 12px;">Email này được gửi tự động từ hệ thống WDP. Vui lòng không trả lời email này.</p>
                </div>
            `,
            text: `Mã OTP xác minh email của bạn là: ${otpCode}. Mã này có hiệu lực trong 10 phút.`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email OTP xác minh đã được gửi:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        // Log chi tiết lỗi để debug (quan trọng để xem Google trả về gì)
        console.error('❌ ========== LỖI GỬI EMAIL (sendVerificationOTPEmail) ==========');
        console.error('❌ Error message:', error.message);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error response:', error.response || 'N/A');
        console.error('❌ Error responseCode:', error.responseCode || 'N/A');
        console.error('❌ Error command:', error.command || 'N/A');
        console.error('❌ Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        console.error('❌ ====================================');
        
        // Phân loại lỗi để báo rõ ràng hơn
        let errorMessage = 'Không thể gửi email OTP.';
        
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNECTION' || error.code === 'ESOCKET') {
            errorMessage = 'Không thể kết nối đến server email. Render có thể đang chặn SMTP port. Vui lòng kiểm tra cấu hình EMAIL_USER và EMAIL_PASSWORD trên Render, đảm bảo dùng App Password cho Gmail.';
        } else if (error.code === 'EAUTH' || error.responseCode === 535) {
            errorMessage = 'Xác thực email thất bại. Vui lòng kiểm tra EMAIL_USER và EMAIL_PASSWORD trên Render. Lưu ý: Phải dùng App Password cho Gmail (không dùng mật khẩu thường). Vào Google Account > Security > App passwords để tạo App Password.';
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Kết nối bị từ chối. Render có thể đang chặn SMTP port. Vui lòng kiểm tra cấu hình EMAIL_HOST và EMAIL_PORT trên Render.';
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'Không tìm thấy server email. Vui lòng kiểm tra EMAIL_HOST trên Render (mặc định là smtp.gmail.com).';
        } else if (error.responseCode === 553) {
            errorMessage = 'Địa chỉ email người gửi không hợp lệ. Vui lòng kiểm tra EMAIL_USER trên Render.';
        } else if (error.responseCode === 550) {
            errorMessage = 'Địa chỉ email người nhận không hợp lệ hoặc bị từ chối.';
        } else if (error.message && error.message.includes('Invalid login')) {
            errorMessage = 'Đăng nhập email thất bại. Vui lòng kiểm tra EMAIL_USER và EMAIL_PASSWORD trên Render. Phải dùng App Password cho Gmail.';
        } else if (error.message && error.message.includes('Email service chưa được cấu hình')) {
            errorMessage = 'Email service chưa được cấu hình trên Render. Vui lòng thêm các biến môi trường: EMAIL_USER và EMAIL_PASSWORD trong Render dashboard.';
        }
        
        const detailedError = new Error(errorMessage);
        detailedError.originalError = error;
        throw detailedError;
    }
};

module.exports = {
    sendOTPEmail,
    sendVerificationOTPEmail
};
