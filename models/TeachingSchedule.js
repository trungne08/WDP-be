const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TeachingScheduleSchema = new Schema({
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    lecturer_id: { type: Schema.Types.ObjectId, ref: 'Lecturer', required: true },
    
    date: { type: Date, required: true }, // Ngày dạy
    slot: { type: Number, required: true }, // Slot (1, 2, 3, 4, 5, 6)
    room: { type: String, default: 'Online' }, // Phòng học
    
    topic: { type: String, required: true }, // Chủ đề bài giảng (Ví dụ: Intro to React)
    content: { type: String }, // Nội dung chi tiết
    note: { type: String }, // Ghi chú riêng của GV (Ví dụ: Nhớ điểm danh kỹ)
    
    status: { type: String, enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'], default: 'SCHEDULED' },
    
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TeachingSchedule', TeachingScheduleSchema);