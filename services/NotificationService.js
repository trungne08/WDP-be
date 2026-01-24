const admin = require('../config/firebase');
const Notification = require('../models/Notification');
const Student = require('../models/Student');
const Lecturer = require('../models/Lecturer');

/**
 * Gửi thông báo (Lưu DB + Push FCM)
 * @param {string} userId - ID của user nhận
 * @param {string} role - Role của user ('STUDENT' hoặc 'LECTURER')
 * @param {string} title - Tiêu đề thông báo
 * @param {string} message - Nội dung thông báo
 * @param {object} data - Dữ liệu kèm theo (optional)
 * @param {string} type - Loại thông báo (SYSTEM, GRADE, TASK, ASSIGNMENT)
 */
const sendNotification = async (userId, role, title, message, data = {}, type = 'SYSTEM') => {
    try {
        // 1. Lưu vào Database
        // Set user_role_ref dựa trên role (cần thiết cho dynamic refPath)
        const user_role_ref = role === 'STUDENT' ? 'Student' : 'Lecturer';
        
        const notification = await Notification.create({
            user_id: userId,
            user_role: role,
            user_role_ref: user_role_ref, // Set trực tiếp để tránh lỗi validation
            title,
            message,
            type,
            data,
            is_read: false
        });

        // 2. Tìm User để lấy FCM Token
        let user = null;
        if (role === 'STUDENT') {
            user = await Student.findById(userId).select('fcm_token');
        } else if (role === 'LECTURER') {
            user = await Lecturer.findById(userId).select('fcm_token');
        }

        // 3. Gửi Push Notification nếu có token
        if (user && user.fcm_token) {
            // FCM yêu cầu data values phải là string
            const stringifiedData = {};
            for (const key in data) {
                if (Object.hasOwnProperty.call(data, key)) {
                    stringifiedData[key] = String(data[key]);
                }
            }

            // Thêm id của notification vào data để client có thể track
            stringifiedData.notification_id = notification._id.toString();
            stringifiedData.type = type;

            const messagePayload = {
                notification: {
                    title: title,
                    body: message
                },
                data: stringifiedData,
                token: user.fcm_token
            };

            try {
                const response = await admin.messaging().send(messagePayload);
                console.log('🔥 FCM sent successfully:', response);
            } catch (fcmError) {
                console.error('❌ FCM Send Error:', fcmError.message);
                // Có thể xử lý xóa token nếu lỗi là 'registration-token-not-registered'
                if (fcmError.code === 'messaging/registration-token-not-registered') {
                    user.fcm_token = null;
                    await user.save();
                    console.log('ℹ️ Removed invalid FCM token for user:', userId);
                }
            }
        } else {
            console.log(`ℹ️ User ${userId} (${role}) does not have FCM token. Notification saved to DB only.`);
        }

        return notification;

    } catch (error) {
        console.error('❌ Notification Service Error:', error);
        // Không throw lỗi để tránh ảnh hưởng luồng chính
    }
};

module.exports = {
    sendNotification
};
