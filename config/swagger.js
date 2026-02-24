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
        tags: [
            // ==========================================
            // AUTHENTICATION & USER
            // ==========================================
            {
                name: '1. Auth - Login & Register',
                description: '🔐 **Đăng ký, Đăng nhập, Quên mật khẩu**\n\nAPIs để user tạo tài khoản và đăng nhập vào hệ thống. Hỗ trợ OTP qua email và Google OAuth.'
            },
            {
                name: '2. Auth - Profile',
                description: '👤 **Quản lý Profile cá nhân**\n\nAPIs để xem và cập nhật thông tin profile của user hiện tại (full_name, avatar, major, ent).'
            },
            
            // ==========================================
            // OAUTH INTEGRATIONS
            // ==========================================
            {
                name: '3. OAuth - GitHub',
                description: '🔗 **Kết nối tài khoản GitHub**\n\nOAuth flow để link GitHub account. Sau khi link, hệ thống có thể sync commits tự động.'
            },
            {
                name: '4. OAuth - Jira',
                description: '🔗 **Kết nối tài khoản Jira**\n\nOAuth flow để link Jira (Atlassian) account. Sau khi link, hệ thống có thể sync tasks/sprints tự động.'
            },
            {
                name: '5. OAuth - Google',
                description: '🔗 **Đăng nhập bằng Google**\n\nGoogle OAuth2 flow cho login nhanh (không cần tạo password).'
            },
            
            // ==========================================
            // PROJECTS
            // ==========================================
            {
                name: '6. Projects',
                description: '📁 **Quản lý Projects**\n\nAPIs để tạo và xem projects. Mỗi project thuộc 1 team trong 1 class. Sinh viên có thể có nhiều projects ở các classes khác nhau.\n\n**Lưu ý:** Mỗi sinh viên chỉ được có 1 project trong 1 class.'
            },
            
            // ==========================================
            // TEAMS
            // ==========================================
            {
                name: '7. Teams - Management',
                description: '👥 **Quản lý Teams**\n\nAPIs để tạo team, xem thông tin team, cấu hình Jira/GitHub cho team, và sync dữ liệu.'
            },
            {
                name: '8. Teams - Members',
                description: '👤 **Quản lý Thành viên**\n\nAPIs để xem danh sách members, check role (Leader/Member), và mapping tài khoản Jira/GitHub.'
            },
            {
                name: '9. Teams - Dashboard',
                description: '📊 **Dashboard & Thống kê**\n\nAPIs để xem tổng quan team: tasks, commits, ranking, và các chỉ số đóng góp.'
            },
            
            // ==========================================
            // JIRA
            // ==========================================
            {
                name: '10. Jira - External Data',
                description: '🎯 **Lấy dữ liệu từ Jira API**\n\nAPIs để lấy projects và boards từ Jira (cho dropdown chọn khi tạo project).\n\n**Lưu ý:** Cần kết nối tài khoản Jira trước (OAuth).'
            },
            {
                name: '11. Jira - Sprints',
                description: '📅 **Quản lý Sprints**\n\nCRUD sprints trong database. Data được sync từ Jira board.'
            },
            {
                name: '12. Jira - Tasks',
                description: '✅ **Quản lý Tasks (Issues)**\n\nCRUD tasks trong database. Data được sync từ Jira issues.'
            },
            
            // ==========================================
            // GITHUB
            // ==========================================
            {
                name: '13. GitHub - Repos',
                description: '📦 **Lấy dữ liệu từ GitHub API**\n\nAPIs để lấy repos từ GitHub (cho dropdown chọn khi tạo project).\n\n**Lưu ý:** Cần kết nối tài khoản GitHub trước (OAuth).'
            },
            
            // ==========================================
            // CONTRIBUTIONS
            // ==========================================
            {
                name: '14. Contributions',
                description: '📈 **Xem đóng góp cá nhân**\n\nAPIs để member xem commits và tasks của chính mình, hoặc Leader xem của cả team.'
            },
            
            // ==========================================
            // ADMIN - MANAGEMENT
            // ==========================================
            {
                name: '15. Admin - Semesters',
                description: '📅 **Quản lý Học kỳ**\n\nCRUD semesters (Spring 2026, Fall 2026...). Admin tạo học kỳ trước khi tạo classes.'
            },
            {
                name: '16. Admin - Subjects',
                description: '📚 **Quản lý Môn học**\n\nCRUD subjects (SWP301, SE1234...). Admin tạo môn học để gán cho classes.'
            },
            {
                name: '17. Admin - Classes',
                description: '🎓 **Quản lý Lớp học**\n\nCRUD classes, import sinh viên, cấu hình grading. Mỗi class thuộc 1 semester và 1 lecturer.'
            },
            {
                name: '18. Admin - Users',
                description: '👥 **Quản lý Users**\n\nCRUD users (Admin, Lecturer). Sinh viên tự đăng ký, không cần API này.'
            },
            
            // ==========================================
            // TEACHING
            // ==========================================
            {
                name: '19. Teaching',
                description: '📖 **Lịch giảng dạy & Assignments**\n\nAPIs để giảng viên tạo lịch dạy (schedules) và giao bài tập (assignments/labs) cho lớp.'
            },
            
            // ==========================================
            // NOTIFICATIONS & WEBHOOKS
            // ==========================================
            {
                name: '20. Notifications',
                description: '🔔 **Gửi thông báo**\n\nAPIs để giảng viên/admin gửi thông báo push (FCM) cho sinh viên.'
            },
            {
                name: '21. Webhooks',
                description: '🔗 **Webhooks từ External Services**\n\nEndpoints để nhận webhooks từ Jira (real-time sync khi có thay đổi).'
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Nhập JWT token nhận được từ API login'
                }
            },
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
                        ent: { type: 'string', description: 'Khóa học (VD: K18, K19)' },
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
    apis: ['./routes/*.js', './controllers/*.js'], // Paths to files containing OpenAPI definitions
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
