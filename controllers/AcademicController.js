const TeachingSchedule = require('../models/TeachingSchedule');
const Assignment = require('../models/Assignment');
const Class = require('../models/Class');

// ============================================================
// PHẦN 1: QUẢN LÝ LỊCH GIẢNG DẠY (TEACHING SCHEDULE)
// ============================================================

// Tạo lịch dạy mới
const createSchedule = async (req, res) => {
    try {
        const { classId, date, slot, room, topic, content, note } = req.body;
        
        // Validation cơ bản
        if (!classId || !date || !slot || !topic) {
            return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (classId, date, slot, topic)' });
        }

        const newSchedule = new TeachingSchedule({
            class_id: classId,
            lecturer_id: req.user._id, // Lấy ID giảng viên từ token
            date,
            slot,
            room,
            topic,
            content,
            note
        });

        await newSchedule.save();
        res.status(201).json({ message: '✅ Tạo lịch giảng dạy thành công!', data: newSchedule });
    } catch (error) {
        console.error('Create Schedule Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Lấy danh sách lịch dạy của một lớp
const getSchedulesByClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const schedules = await TeachingSchedule.find({ class_id: classId }).sort({ date: 1, slot: 1 });
        res.json(schedules);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Cập nhật lịch dạy (Ví dụ: Update note, đổi phòng)
const updateSchedule = async (req, res) => {
    try {
        const { scheduleId } = req.params;
        const updateData = req.body;

        const updatedSchedule = await TeachingSchedule.findOneAndUpdate(
            { _id: scheduleId, lecturer_id: req.user._id }, // Chỉ GV tạo mới được sửa
            updateData,
            { new: true }
        );

        if (!updatedSchedule) {
            return res.status(404).json({ error: 'Không tìm thấy lịch dạy hoặc bạn không có quyền sửa' });
        }

        res.json({ message: '✅ Cập nhật thành công!', data: updatedSchedule });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================================
// PHẦN 2: QUẢN LÝ BÀI TẬP & LAB (ASSIGNMENT / LAB)
// ============================================================

// Tạo Assignment hoặc Lab
const createAssignment = async (req, res) => {
    try {
        const { classId, title, description, type, deadline, resources } = req.body;

        if (!classId || !title || !type || !deadline) {
            return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (classId, title, type, deadline)' });
        }

        if (!['ASSIGNMENT', 'LAB'].includes(type)) {
            return res.status(400).json({ error: 'Type phải là ASSIGNMENT hoặc LAB' });
        }

        const newAssignment = new Assignment({
            class_id: classId,
            lecturer_id: req.user._id,
            title,
            description,
            type,
            deadline,
            resources
        });

        await newAssignment.save();
        res.status(201).json({ message: `✅ Tạo ${type} thành công!`, data: newAssignment });
    } catch (error) {
        console.error('Create Assignment Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Lấy danh sách bài tập của lớp
const getAssignmentsByClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const { type } = req.query; // Có thể filter theo ?type=LAB hoặc ?type=ASSIGNMENT

        const filter = { class_id: classId };
        if (type) filter.type = type;

        const assignments = await Assignment.find(filter).sort({ deadline: 1 });
        res.json(assignments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    createSchedule,
    getSchedulesByClass,
    updateSchedule,
    createAssignment,
    getAssignmentsByClass
};