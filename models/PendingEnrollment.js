const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Model lưu danh sách sinh viên chưa đăng ký từ template import
 * Khi sinh viên đăng ký, sẽ tự động check và enroll vào lớp
 * 
 * QUAN TRỌNG: Lưu thêm subjectName, semester_id, lecturer_id để match chính xác
 * vì một môn có thể có nhiều lớp và nhiều giảng viên
 */
const PendingEnrollmentSchema = new Schema({
    class_id: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    roll_number: { type: String, required: true }, // MSSV (student_code)
    email: { type: String }, // Email (có thể null cho K19+)
    full_name: { type: String },
    group: { type: Number, required: true }, // Số nhóm
    is_leader: { type: Boolean, default: false }, // Có phải leader không (từ cột Leader trong template)
    
    // Thông tin để match chính xác lớp học (quan trọng khi một môn có nhiều lớp/giảng viên)
    subjectName: { type: String, required: true }, // Tên môn học
    semester_id: { type: Schema.Types.ObjectId, ref: 'Semester', required: true }, // Học kỳ
    lecturer_id: { type: Schema.Types.ObjectId, ref: 'Lecturer', required: true }, // Giảng viên
    
    enrolled: { type: Boolean, default: false }, // Đã enroll chưa
    enrolled_at: { type: Date }, // Thời điểm enroll
    created_at: { type: Date, default: Date.now }
});

// Index để tìm nhanh khi đăng ký
// Match theo: subjectName + semester_id + lecturer_id + roll_number/email
PendingEnrollmentSchema.index({ roll_number: 1, enrolled: 1 });
PendingEnrollmentSchema.index({ email: 1, enrolled: 1 });
PendingEnrollmentSchema.index({ class_id: 1, enrolled: 1 });
PendingEnrollmentSchema.index({ subjectName: 1, semester_id: 1, lecturer_id: 1, roll_number: 1, enrolled: 1 });
PendingEnrollmentSchema.index({ subjectName: 1, semester_id: 1, lecturer_id: 1, email: 1, enrolled: 1 });

module.exports = mongoose.model('PendingEnrollment', PendingEnrollmentSchema);
