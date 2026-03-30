const express = require('express');
const router = express.Router();

// 1. Import Middleware xác thực (Tên file/hàm có thể khác tùy theo project của bạn)
const { requireAuth, authorizeRoles } = require('../middlewares/authMiddleware'); 

// 2. Import Controller chứa hàm Dashboard vừa tạo ban nãy
const DashboardController = require('../controllers/DashboardController'); // Sửa lại đường dẫn nếu cần

// ==========================================
// 📊 API DASHBOARD: TỔNG QUAN LỚP HỌC
// ==========================================
// Method: GET
// URL: /api/dashboard/classes/:classId
router.get(
    '/classes/:classId', 
    requireAuth,                                // Bắt buộc phải có token đăng nhập
    authorizeRoles('LECTURER', 'ADMIN'),        // Chỉ Giảng viên hoặc Admin mới được phép gọi API này
    DashboardController.getClassDashboardOverview
);

module.exports = router;