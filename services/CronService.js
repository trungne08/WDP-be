const cron = require('node-cron');
const NotificationService = require('./NotificationService');
const TeamMember = require('../models/TeamMember');
const Project = require('../models/Project');
const Student = require('../models/Student'); // Import thêm Student
const Lecturer = require('../models/Lecturer'); // Import thêm Lecturer

/**
 * Khởi tạo các Cron Job (Tác vụ chạy ngầm định kỳ)
 */
const initScheduledJobs = () => {
    console.log('⏰ Cron Service đã được khởi tạo!');

    // ============================================================
    // JOB: CHẠY LÚC 7:00 SÁNG MỖI NGÀY
    // ============================================================
    cron.schedule('0 7 * * *', async () => {
        console.log('🌅 Bắt đầu Job buổi sáng (7:00 AM)...');

        // --- PHẦN 1: GỬI LỜI CHÀO BUỔI SÁNG ---
        try {
            console.log('👋 Đang gửi lời chào buổi sáng...');
            
            // 1. Lấy danh sách tất cả user (Chỉ lấy _id để nhẹ RAM)
            const students = await Student.find({}).select('_id');
            const lecturers = await Lecturer.find({}).select('_id');

            // 2. Gộp lại thành 1 mảng duy nhất
            const allUsers = [
                ...students.map(s => ({ _id: s._id, role: 'STUDENT' })),
                ...lecturers.map(l => ({ _id: l._id, role: 'LECTURER' }))
            ];

            // 3. Gửi thông báo (Dùng Promise.all để gửi song song cho nhanh)
            const greetingPromises = allUsers.map(user => {
                return NotificationService.sendNotification(
                    user._id,
                    user.role,
                    'Chào buổi sáng! ☀️',
                    'Chúc bạn một ngày mới tràn đầy năng lượng và học tập hiệu quả! 💪',
                    { type: 'DAILY_GREETING' }, // Loại thông báo
                    'SYSTEM' // Icon hiển thị
                );
            });

            await Promise.all(greetingPromises);
            console.log(`✅ Đã gửi lời chào tới ${allUsers.length} người dùng.`);

        } catch (error) {
            console.error('❌ Lỗi khi gửi lời chào buổi sáng:', error.message);
        }

        // --- PHẦN 2: QUÉT DEADLINE PROJECT ---
        try {
            console.log('🔍 Đang quét deadline project...');
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            // Tìm project hết hạn hôm nay
            const projectsDueToday = await Project.find({
                deadline: { $gte: startOfDay, $lte: endOfDay },
                status: { $ne: 'COMPLETED' }
            });

            for (const project of projectsDueToday) {
                // Tìm thành viên nhóm để nhắc
                const members = await TeamMember.find({ team_id: project.team_id }).populate('student_id');
                
                for (const member of members) {
                    if (member.student_id) {
                        NotificationService.sendNotification(
                            member.student_id._id,
                            'STUDENT',
                            '⏰ Nhắc nhở Deadline',
                            `Dự án "${project.name}" của nhóm bạn sẽ hết hạn vào hôm nay!`,
                            { 
                                project_id: project._id,
                                type: 'DEADLINE_REMINDER'
                            },
                            'TASK'
                        );
                    }
                }
            }
            console.log(`✅ Đã gửi nhắc nhở cho ${projectsDueToday.length} dự án đến hạn hôm nay.`);
        } catch (error) {
            console.error('❌ Lỗi khi chạy Job quét deadline:', error.message);
        }
    });
};

module.exports = {
    initScheduledJobs
};