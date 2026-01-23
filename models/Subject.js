const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Model Môn học (Subject)
 * 
 * Một môn học có thể có nhiều lớp và nhiều giảng viên dạy
 * Ví dụ: "Software Engineering Project" có thể có:
 * - Lớp SE1943-A (GV: Thầy Dũng)
 * - Lớp SE1943-B (GV: Cô Hoa)
 */
const SubjectSchema = new Schema({
    // 1. Thông tin cơ bản
    name: { 
        type: String, 
        required: true,
        unique: true // Tên môn học phải unique
    },
    code: {
        type: String,
        required: true,
        unique: true // Mã môn học (VD: SWP301, PRJ301)
    },
    description: {
        type: String,
        default: ''
    },
    
    // 2. Thông tin học phần (nếu cần)
    credits: {
        type: Number,
        default: 0 // Số tín chỉ
    },
    
    // 3. Trạng thái
    status: {
        type: String,
        enum: ['Active', 'Archived'],
        default: 'Active'
    },
    
    // 4. Metadata
    created_by_admin: {
        type: Schema.Types.ObjectId,
        ref: 'Admin',
        required: true
    },
    created_at: { 
        type: Date, 
        default: Date.now 
    }
}, { 
    timestamps: true 
});

// Index để tìm nhanh
// Lưu ý: code và name đã có unique: true nên không cần index() thêm
SubjectSchema.index({ status: 1 });

module.exports = mongoose.models.Subject || mongoose.model('Subject', SubjectSchema);
