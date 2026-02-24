const NotificationService = require('../services/NotificationService');
const TeamMember = require('../models/TeamMember');
const Class = require('../models/Class');
const Team = require('../models/Team');

/**
 * Gửi thông báo thủ công cho cả lớp
 * Dành cho Giảng viên/Admin thông báo: Nghỉ học, Nhắc deadline, Tin tức...
 */
const sendManualNotification = async (req, res) => {
    try {
        const { classId, title, message } = req.body;

        // 1. Validation
        if (!classId || !title || !message) {
            return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (classId, title, message)' });
        }

        // 2. Kiểm tra lớp tồn tại
        const targetClass = await Class.findById(classId);
        if (!targetClass) {
            return res.status(404).json({ error: 'Lớp học không tồn tại' });
        }

        // 3. Lấy danh sách sinh viên trong lớp (thông qua bảng TeamMember)
        // Tìm tất cả Team thuộc Class -> Tìm tất cả Member thuộc Team đó
        const teams = await Team.find({ class_id: classId }).select('_id');
        const teamIds = teams.map(t => t._id);
        
        const members = await TeamMember.find({ 
            team_id: { $in: teamIds },
            is_active: true 
        }).populate('student_id');

        // 4. Lọc ra danh sách ID sinh viên (Loại bỏ những record lỗi không có student_id)
        const studentIds = members
            .filter(m => m.student_id) // Chỉ lấy record có student hợp lệ
            .map(m => m.student_id._id);

        if (studentIds.length === 0) {
            return res.status(400).json({ error: 'Lớp này chưa có sinh viên nào để gửi!' });
        }

        // 5. Bắn thông báo hàng loạt (Dùng Promise.all cho nhanh)
        console.log(`📢 Đang gửi thông báo thủ công tới ${studentIds.length} sinh viên lớp ${targetClass.name}...`);
        
        const notificationPromises = studentIds.map(studentId => {
            return NotificationService.sendNotification(
                studentId,
                'STUDENT',
                title, // Tiêu đề giảng viên nhập
                message, // Nội dung giảng viên nhập
                { 
                    class_id: classId,
                    type: 'MANUAL_ANNOUNCEMENT' // Loại thông báo: Tin tức thủ công
                }, 
                'TASK' // Loại hiển thị icon (TASK/SYSTEM)
            );
        });

        await Promise.all(notificationPromises);

        return res.json({ 
            message: `✅ Đã gửi thông báo thành công cho ${studentIds.length} sinh viên!`,
            target_class: targetClass.name,
            total_sent: studentIds.length
        });

    } catch (error) {
        console.error('Manual Notification Error:', error);
        return res.status(500).json({ error: 'Lỗi server khi gửi thông báo: ' + error.message });
    }
};

/**
 * Gửi thông báo cho một sinh viên cụ thể (Tùy chọn thêm)
 */
const sendStudentNotification = async (req, res) => {
    try {
        const { studentId, title, message } = req.body;
        
        if (!studentId || !title || !message) {
            return res.status(400).json({ error: 'Thiếu thông tin (studentId, title, message)' });
        }

        await NotificationService.sendNotification(
            studentId,
            'STUDENT',
            title,
            message,
            { type: 'PERSONAL_MESSAGE' },
            'SYSTEM'
        );

        return res.json({ message: '✅ Đã gửi tin nhắn riêng cho sinh viên!' });
    } catch (error) {
        console.error('Send Personal Notification Error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Lấy danh sách notifications của user hiện tại (cho notification bell)
 */
const getMyNotifications = async (req, res) => {
    try {
        const { role, userId } = req;
        const { limit = 20, skip = 0, unread_only = false } = req.query;

        // Build query
        const query = {
            user_id: userId,
            user_role: role
        };

        // Filter chỉ lấy unread nếu cần
        if (unread_only === 'true' || unread_only === true) {
            query.is_read = false;
        }

        // Lấy notifications
        const notifications = await Notification.find(query)
            .sort({ created_at: -1 }) // Mới nhất lên đầu
            .limit(parseInt(limit))
            .skip(parseInt(skip))
            .lean();

        // Count total và unread
        const total = await Notification.countDocuments({ user_id: userId, user_role: role });
        const unread = await Notification.countDocuments({ user_id: userId, user_role: role, is_read: false });

        return res.json({
            total,
            unread,
            notifications
        });

    } catch (error) {
        console.error('Get Notifications Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

/**
 * Đánh dấu notification đã đọc
 */
const markAsRead = async (req, res) => {
    try {
        const { role, userId } = req;
        const { notificationId } = req.params;

        const notification = await Notification.findOne({
            _id: notificationId,
            user_id: userId,
            user_role: role
        });

        if (!notification) {
            return res.status(404).json({ error: 'Không tìm thấy notification' });
        }

        notification.is_read = true;
        await notification.save();

        return res.json({ 
            message: '✅ Đã đánh dấu đã đọc',
            notification
        });

    } catch (error) {
        console.error('Mark as Read Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

/**
 * Đánh dấu TẤT CẢ notifications đã đọc
 */
const markAllAsRead = async (req, res) => {
    try {
        const { role, userId } = req;

        const result = await Notification.updateMany(
            {
                user_id: userId,
                user_role: role,
                is_read: false
            },
            { is_read: true }
        );

        return res.json({ 
            message: '✅ Đã đánh dấu tất cả đã đọc',
            updated: result.modifiedCount
        });

    } catch (error) {
        console.error('Mark All as Read Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

/**
 * Xóa notification
 */
const deleteNotification = async (req, res) => {
    try {
        const { role, userId } = req;
        const { notificationId } = req.params;

        const result = await Notification.deleteOne({
            _id: notificationId,
            user_id: userId,
            user_role: role
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Không tìm thấy notification' });
        }

        return res.json({ message: '✅ Đã xóa notification' });

    } catch (error) {
        console.error('Delete Notification Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

/**
 * Xóa TẤT CẢ notifications đã đọc
 */
const clearRead = async (req, res) => {
    try {
        const { role, userId } = req;

        const result = await Notification.deleteMany({
            user_id: userId,
            user_role: role,
            is_read: true
        });

        return res.json({ 
            message: '✅ Đã xóa tất cả notifications đã đọc',
            deleted: result.deletedCount
        });

    } catch (error) {
        console.error('Clear Read Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

module.exports = {
    sendManualNotification,
    sendStudentNotification,
    getMyNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearRead
};
