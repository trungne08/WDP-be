const nodemailer = require('nodemailer');

// Cấu hình email transporter
// Mặc định dùng Gmail, có thể thay đổi trong .env
const createTransporter = () => {
    return nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
            user: process.env.EMAIL_USER, // Email gửi đi
            pass: process.env.EMAIL_PASSWORD // App Password (không phải password thường)
        },
        // Thêm timeout và connection options để tránh timeout trên Render
        connectionTimeout: 10000, // 10 giây
        socketTimeout: 10000, // 10 giây
        greetingTimeout: 10000, // 10 giây
        // Tăng số lần thử kết nối
        pool: true,
        maxConnections: 1,
        maxMessages: 3
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
            throw new Error('Email service chưa được cấu hình. Vui lòng kiểm tra file .env');
        }

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
        console.error('❌ Lỗi gửi email:', error.message);
        
        // Phân loại lỗi để báo rõ ràng hơn
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNECTION') {
            throw new Error('Không thể kết nối đến server email. Vui lòng kiểm tra kết nối mạng hoặc cấu hình email.');
        } else if (error.code === 'EAUTH') {
            throw new Error('Xác thực email thất bại. Vui lòng kiểm tra EMAIL_USER và EMAIL_PASSWORD trong .env');
        } else {
            throw error;
        }
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
            throw new Error('Email service chưa được cấu hình. Vui lòng kiểm tra file .env');
        }

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
        console.error('❌ Lỗi gửi email:', error.message);
        throw error;
    }
};

module.exports = {
    sendOTPEmail,
    sendVerificationOTPEmail
};
