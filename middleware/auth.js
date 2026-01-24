const jwt = require('jsonwebtoken');
const models = require('../models');

/**
 * Middleware xác thực JWT token
 * Thêm req.user và req.role sau khi verify thành công
 */
const authenticateToken = async (req, res, next) => {
    try {
        // Lấy token từ header
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

        if (!token) {
            return res.status(401).json({
                error: 'Không tìm thấy token. Vui lòng đăng nhập lại.'
            });
        }

        // Verify token
        const jwtSecret = process.env.JWT_SECRET || 'wdp-secret-key-change-in-production';
        const decoded = jwt.verify(token, jwtSecret);

        // Kiểm tra type phải là 'access'
        if (decoded.type && decoded.type !== 'access') {
            return res.status(401).json({
                error: 'Token không phải là access token. Vui lòng dùng access token để truy cập API.'
            });
        }

        // Lấy thông tin user từ database dựa vào userId và role trong token
        let user = null;
        if (decoded.role === 'ADMIN') {
            user = await models.Admin.findById(decoded.userId);
        } else if (decoded.role === 'LECTURER') {
            user = await models.Lecturer.findById(decoded.userId);
        } else if (decoded.role === 'STUDENT') {
            user = await models.Student.findById(decoded.userId);
        }

        if (!user) {
            return res.status(401).json({
                error: 'Token không hợp lệ hoặc user không tồn tại.'
            });
        }

        // Kiểm tra email đã được verify chưa (chỉ cho LECTURER và STUDENT)
        if ((decoded.role === 'LECTURER' || decoded.role === 'STUDENT') && !user.is_verified) {
            return res.status(403).json({
                error: 'Email chưa được xác minh. Vui lòng xác minh email trước khi sử dụng hệ thống.',
                requires_verification: true
            });
        }

        // Thêm user và role vào request để các route sau có thể dùng
        req.user = user;
        req.role = decoded.role;
        req.userId = decoded.userId;

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Token không hợp lệ. Vui lòng đăng nhập lại.'
            });
        } else if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token đã hết hạn. Vui lòng đăng nhập lại.'
            });
        } else {
            console.error('Auth middleware error:', error);
            return res.status(500).json({
                error: 'Lỗi xác thực token.'
            });
        }
    }
};

/**
 * Middleware phân quyền (Authorization)
 * @param {string|string[]} roles - Danh sách các role được phép truy cập
 */
const authorize = (roles = []) => {
    // Nếu roles là string, chuyển thành array
    if (typeof roles === 'string') {
        roles = [roles];
    }

    return (req, res, next) => {
        // req.role đã được set từ middleware authenticateToken
        if (!req.role) {
             return res.status(401).json({ error: 'Unauthorized: Không tìm thấy thông tin role' });
        }

        if (roles.length && !roles.includes(req.role)) {
            return res.status(403).json({ 
                error: `Forbidden: Bạn không có quyền truy cập tài nguyên này. Yêu cầu: ${roles.join(', ')}` 
            });
        }

        next();
    };
};

module.exports = {
    authenticateToken,
    authorize
};
