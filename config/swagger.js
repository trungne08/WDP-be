const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'WDP Backend API',
            version: '1.0.0',
            description: 'API Documentation cho hệ thống quản lý dự án WDP (Web Development Project)',
            contact: {
                name: 'WDP Team',
            },
        },
        servers: [
            {
                url: process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL || 'http://localhost:5000',
                description: process.env.RENDER_EXTERNAL_URL ? 'Production server (Render)' : 'Development server',
            },
            ...(process.env.RENDER_EXTERNAL_URL ? [] : [{
                url: 'http://localhost:5000',
                description: 'Development server',
            }]),
        ],
        components: {
            schemas: {
                Admin: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        full_name: { type: 'string' },
                        role: { type: 'string', enum: ['ADMIN'] },
                        created_at: { type: 'string', format: 'date-time' },
                    },
                },
                Lecturer: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        full_name: { type: 'string' },
                        avatar_url: { type: 'string' },
                        role: { type: 'string', enum: ['LECTURER'] },
                        is_verified: { type: 'boolean', description: 'Email đã được xác minh chưa' },
                        created_at: { type: 'string', format: 'date-time' },
                    },
                },
                Student: {
                    type: 'object',
                    properties: {
                        _id: { type: 'string' },
                        student_code: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        full_name: { type: 'string' },
                        avatar_url: { type: 'string' },
                        major: { type: 'string' },
                        role: { type: 'string', enum: ['STUDENT'] },
                        is_verified: { type: 'boolean', description: 'Email đã được xác minh chưa' },
                        created_at: { type: 'string', format: 'date-time' },
                    },
                },
                RegisterRequest: {
                    type: 'object',
                    required: ['role', 'email', 'password'],
                    properties: {
                        role: { 
                            type: 'string', 
                            enum: ['LECTURER', 'STUDENT'],
                            description: 'Loại người dùng (CHỈ cho phép LECTURER hoặc STUDENT. ADMIN chỉ được tạo qua hệ thống quản trị)'
                        },
                        email: { 
                            type: 'string', 
                            format: 'email',
                            description: 'Email (phải unique)'
                        },
                        password: { 
                            type: 'string',
                            description: 'Mật khẩu (sẽ được hash tự động)'
                        },
                        full_name: { type: 'string' },
                        avatar_url: { type: 'string' },
                        student_code: { 
                            type: 'string',
                            description: 'MSSV (bắt buộc nếu role=STUDENT)'
                        },
                        major: { 
                            type: 'string',
                            description: 'Chuyên ngành (cho STUDENT)'
                        },
                    },
                },
                LoginRequest: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: { type: 'string', format: 'email' },
                        password: { type: 'string' },
                    },
                },
                ForgotPasswordRequest: {
                    type: 'object',
                    required: ['email', 'role'],
                    properties: {
                        email: { type: 'string', format: 'email' },
                        role: { type: 'string', enum: ['LECTURER', 'STUDENT'] }
                    }
                },
                VerifyOtpResetPasswordRequest: {
                    type: 'object',
                    required: ['email', 'role', 'otp_code', 'new_password'],
                    properties: {
                        email: { type: 'string', format: 'email' },
                        role: { type: 'string', enum: ['LECTURER', 'STUDENT'] },
                        otp_code: { type: 'string', description: 'Mã OTP 6 chữ số' },
                        new_password: { type: 'string', minLength: 6 }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string' },
                    },
                },
            },
        },
    },
    apis: ['./server.js', './controllers/*.js'], // Paths to files containing OpenAPI definitions
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
