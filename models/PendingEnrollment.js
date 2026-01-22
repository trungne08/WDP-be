const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Model lưu danh sách sinh viên chưa đăng ký từ template import
 * Khi sinh viên đăng ký, sẽ tự động check và enroll vào lớp
 */
const PendingEnrollmentSchema = new Schema({
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    roll_number: { type: String, required: true }, // MSSV (student_code)
    email: { type: String }, // Email (có thể null cho K19+)
    full_name: { type: String },
    group: { type: Number, required: true }, // Số nhóm
    is_leader: { type: Boolean, default: false }, // Có phải leader không (từ cột Leader trong template)
    enrolled: { type: Boolean, default: false }, // Đã enroll chưa
    enrolled_at: { type: Date }, // Thời điểm enroll
    created_at: { type: Date, default: Date.now }
});

// Index để tìm nhanh khi đăng ký
PendingEnrollmentSchema.index({ roll_number: 1, enrolled: 1 });
PendingEnrollmentSchema.index({ email: 1, enrolled: 1 });
PendingEnrollmentSchema.index({ class_id: 1, enrolled: 1 });

module.exports = mongoose.model('PendingEnrollment', PendingEnrollmentSchema);
