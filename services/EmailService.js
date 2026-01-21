const nodemailer = require('nodemailer');

const sendEmailViaBrevoAPI = async (toEmail, subject, htmlContent, textContent) => {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.EMAIL_USER; // Email đã verify trong Brevo
    const senderName = "WDP System";

    if (!apiKey) {
        throw new Error('BREVO_API_KEY chưa được cấu hình. Vui lòng thêm vào Render Environment.');
    }

    if (!senderEmail) {
        throw new Error('EMAIL_USER chưa được cấu hình.');
    }

    let fetch;
    try {
        if (typeof globalThis.fetch === 'function') {
            fetch = globalThis.fetch;
        } else {
            const axios = require('axios');
            const response = await axios.post(
                'https://api.brevo.com/v3/smtp/email',
                {
                    sender: { name: senderName, email: senderEmail },
                    to: [{ email: toEmail }],
                    subject: subject,
                    htmlContent: htmlContent,
                    textContent: textContent
                },
                {
                    headers: {
                        'accept': 'application/json',
                        'api-key': apiKey,
                        'content-type': 'application/json'
                    }
                }
            );
            console.log('✅ Email đã được gửi qua Brevo API:', response.data.messageId);
            return { success: true, messageId: response.data.messageId };
        }
    } catch (error) {
        // Nếu fetch không có, dùng axios
        const axios = require('axios');
        try {
            const response = await axios.post(
                'https://api.brevo.com/v3/smtp/email',
                {
                    sender: { name: senderName, email: senderEmail },
                    to: [{ email: toEmail }],
                    subject: subject,
                    htmlContent: htmlContent,
                    textContent: textContent
                },
                {
                    headers: {
                        'accept': 'application/json',
                        'api-key': apiKey,
                        'content-type': 'application/json'
                    }
                }
            );
            console.log('✅ Email đã được gửi qua Brevo API:', response.data.messageId);
            return { success: true, messageId: response.data.messageId };
        } catch (apiError) {
            console.error('❌ Lỗi Brevo API:', apiError.response?.data || apiError.message);
            throw new Error(`Brevo API Error: ${apiError.response?.data?.message || apiError.message}`);
        }
    }

    // Nếu dùng fetch native
    try {
        console.log(`📡 Đang gửi email qua Brevo API đến ${toEmail}...`);
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: senderName, email: senderEmail },
                to: [{ email: toEmail }],
                subject: subject,
                htmlContent: htmlContent,
                textContent: textContent
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Brevo API Error: ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        console.log('✅ Email đã được gửi qua Brevo API:', data.messageId);
        return { success: true, messageId: data.messageId };
    } catch (error) {
        console.error('❌ Lỗi Brevo API:', error.message);
        throw error;
    }
};

// ==========================================
// SMTP TRANSPORTER (Fallback nếu không dùng API)
// ==========================================
const createTransporter = () => {
    // Ưu tiên 1: Nếu có EMAIL_SERVICE = 'brevo', tự động dùng Brevo SMTP
    if (process.env.EMAIL_SERVICE === 'brevo' || process.env.EMAIL_SERVICE === 'Brevo') {
        // Render thường chặn port 587, nên dùng port 465 (SSL) hoặc 2525
        const brevoPort = parseInt(process.env.EMAIL_PORT) || 2525; // Mặc định port 2525 (ít bị chặn nhất)
        const brevoSecure = brevoPort === 465; // SSL cho port 465, TLS cho port 587/2525
        
        console.log('📧 Sử dụng Brevo SMTP (tự động cấu hình)');
        console.log('📧 Brevo Port:', brevoPort, brevoSecure ? '(SSL)' : '(TLS)');
        
        return nodemailer.createTransport({
            host: 'smtp-relay.brevo.com',
            port: brevoPort,
            secure: brevoSecure,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            },
            connectionTimeout: 60000,
            socketTimeout: 60000,
            greetingTimeout: 30000,
            tls: {
                rejectUnauthorized: false
            },
            requireTLS: !brevoSecure,
            debug: process.env.NODE_ENV === 'development'
        });
    }
    
    // Ưu tiên 2: Nếu có EMAIL_HOST và EMAIL_PORT, dùng SMTP tùy chỉnh
    if (process.env.EMAIL_HOST && process.env.EMAIL_PORT) {
        const port = parseInt(process.env.EMAIL_PORT) || 587;
        const secure = process.env.EMAIL_SECURE === 'true' || port === 465;
        
        console.log('📧 Sử dụng SMTP tùy chỉnh:', {
            host: process.env.EMAIL_HOST,
            port: port,
            secure: secure
        });
        
        return nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: port,
            secure: secure,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            },
            connectionTimeout: 30000,
            socketTimeout: 30000,
            greetingTimeout: 30000,
            tls: {
                rejectUnauthorized: false
            }
        });
    }
    
    // Mặc định: Gmail SMTP (port 465 SSL)
    console.log('📧 Sử dụng Gmail SMTP (mặc định)');
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD
        },
        connectionTimeout: 30000,
        socketTimeout: 30000,
        greetingTimeout: 30000,
        tls: {
            rejectUnauthorized: false
        },
        debug: process.env.NODE_ENV === 'development'
    });
};

// ==========================================
// GỬI EMAIL QUA SMTP (Fallback)
// ==========================================
const sendEmailViaSMTP = async (toEmail, subject, htmlContent, textContent) => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        console.error('⚠️ EMAIL_USER hoặc EMAIL_PASSWORD chưa được cấu hình');
        throw new Error('Email service chưa được cấu hình. Vui lòng kiểm tra file .env');
    }

    const transporter = createTransporter();
    const mailOptions = {
        from: `"WDP System" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: subject,
        html: htmlContent,
        text: textContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email đã được gửi qua SMTP:', info.messageId);
    return { success: true, messageId: info.messageId };
};

// ==========================================
// PUBLIC FUNCTIONS
// ==========================================

/**
 * Gửi OTP đặt lại mật khẩu
 * @param {string} toEmail - Email người nhận
 * @param {string} otpCode - Mã OTP (6 chữ số)
 * @param {string} role - Role của user (ADMIN/LECTURER/STUDENT)
 */
const sendOTPEmail = async (toEmail, otpCode, role) => {
    try {
        const subject = '🔐 Mã OTP đặt lại mật khẩu - WDP';
        const htmlContent = `
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
        `;
        const textContent = `Mã OTP đặt lại mật khẩu của bạn là: ${otpCode}. Mã này có hiệu lực trong 10 phút.`;

        // Ưu tiên dùng Brevo API nếu có BREVO_API_KEY
        if (process.env.BREVO_API_KEY) {
            console.log('📡 Sử dụng Brevo API (bypass SMTP ports)');
            return await sendEmailViaBrevoAPI(toEmail, subject, htmlContent, textContent);
        }

        // Fallback về SMTP
        console.log('📧 Sử dụng SMTP (fallback)');
        return await sendEmailViaSMTP(toEmail, subject, htmlContent, textContent);
    } catch (error) {
        console.error('❌ ========== LỖI GỬI EMAIL (sendOTPEmail) ==========');
        console.error('❌ Error message:', error.message);
        console.error('❌ Error code:', error.code);
        console.error('❌ Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        console.error('❌ ====================================');
        
        let errorMessage = 'Không thể gửi email OTP.';
        
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNECTION' || error.code === 'ESOCKET') {
            if (process.env.BREVO_API_KEY) {
                errorMessage = 'Lỗi kết nối Brevo API. Vui lòng kiểm tra BREVO_API_KEY trên Render.';
            } else if (process.env.EMAIL_SERVICE === 'brevo') {
                errorMessage = 'Không thể kết nối đến Brevo SMTP. Render có thể đang chặn SMTP port. Khuyến nghị: Thêm BREVO_API_KEY vào Render để dùng API (bypass SMTP ports).';
            } else {
                errorMessage = 'Không thể kết nối đến server email. Render có thể đang chặn SMTP port. Khuyến nghị: Dùng Brevo API (thêm BREVO_API_KEY vào Render).';
            }
        } else if (error.code === 'EAUTH' || error.responseCode === 535) {
            if (process.env.BREVO_API_KEY) {
                errorMessage = 'Xác thực Brevo API thất bại. Vui lòng kiểm tra BREVO_API_KEY trên Render.';
            } else {
                errorMessage = 'Xác thực email thất bại. Vui lòng kiểm tra EMAIL_USER và EMAIL_PASSWORD trên Render.';
            }
        } else if (error.message && error.message.includes('BREVO_API_KEY')) {
            errorMessage = error.message;
        } else if (error.message && error.message.includes('Brevo API Error')) {
            errorMessage = `Lỗi Brevo API: ${error.message}. Vui lòng kiểm tra BREVO_API_KEY và EMAIL_USER trên Render.`;
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
        const subject = '✅ Xác minh email đăng ký - WDP';
        const htmlContent = `
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
        `;
        const textContent = `Mã OTP xác minh email của bạn là: ${otpCode}. Mã này có hiệu lực trong 10 phút.`;

        // Ưu tiên dùng Brevo API nếu có BREVO_API_KEY
        if (process.env.BREVO_API_KEY) {
            console.log('📡 Sử dụng Brevo API (bypass SMTP ports)');
            return await sendEmailViaBrevoAPI(toEmail, subject, htmlContent, textContent);
        }

        // Fallback về SMTP
        console.log('📧 Sử dụng SMTP (fallback)');
        return await sendEmailViaSMTP(toEmail, subject, htmlContent, textContent);
    } catch (error) {
        console.error('❌ ========== LỖI GỬI EMAIL (sendVerificationOTPEmail) ==========');
        console.error('❌ Error message:', error.message);
        console.error('❌ Error code:', error.code);
        console.error('❌ Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        console.error('❌ ====================================');
        
        let errorMessage = 'Không thể gửi email OTP.';
        
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNECTION' || error.code === 'ESOCKET') {
            if (process.env.BREVO_API_KEY) {
                errorMessage = 'Lỗi kết nối Brevo API. Vui lòng kiểm tra BREVO_API_KEY trên Render.';
            } else if (process.env.EMAIL_SERVICE === 'brevo') {
                errorMessage = 'Không thể kết nối đến Brevo SMTP. Render có thể đang chặn SMTP port. Khuyến nghị: Thêm BREVO_API_KEY vào Render để dùng API (bypass SMTP ports).';
            } else {
                errorMessage = 'Không thể kết nối đến server email. Render có thể đang chặn SMTP port. Khuyến nghị: Dùng Brevo API (thêm BREVO_API_KEY vào Render).';
            }
        } else if (error.code === 'EAUTH' || error.responseCode === 535) {
            if (process.env.BREVO_API_KEY) {
                errorMessage = 'Xác thực Brevo API thất bại. Vui lòng kiểm tra BREVO_API_KEY trên Render.';
            } else {
                errorMessage = 'Xác thực email thất bại. Vui lòng kiểm tra EMAIL_USER và EMAIL_PASSWORD trên Render.';
            }
        } else if (error.message && error.message.includes('BREVO_API_KEY')) {
            errorMessage = error.message;
        } else if (error.message && error.message.includes('Brevo API Error')) {
            errorMessage = `Lỗi Brevo API: ${error.message}. Vui lòng kiểm tra BREVO_API_KEY và EMAIL_USER trên Render.`;
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
